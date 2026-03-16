/**
 * ═══════════════════════════════════════════════════════════════
 * NEXUS L5 — Post-Quantum Cryptography Client Module
 * Handles ML-KEM-768 handshake (via server-side encapsulation)
 * and AES-256-GCM frame encryption/decryption using Web Crypto API.
 * ═══════════════════════════════════════════════════════════════
 *
 * Protocol:
 *   1. Server sends { type: "pqc_ek", ek: "<hex>" }
 *   2. Client calls /api/encaps with ek → gets { ct, shared_key }
 *   3. Client sends { type: "pqc_ct", ct: "<hex>" }
 *   4. Server confirms { type: "pqc_ready", success: true }
 *   5. All subsequent frames are AES-256-GCM encrypted
 */

export class PQCClient {
    constructor() {
        // State
        this.handshakeComplete = false;
        this.enabled = true;
        this.algorithm = '';

        // Crypto material
        this._sharedKeyRaw = null; // Raw hex from server
        this._aesKey = null;       // CryptoKey for Web Crypto API

        // Counters (must match server nonce scheme)
        this._decryptCounter = 0;  // For server→client (direction 'S')
        this._encryptCounter = 0;  // For client→server (direction 'C')

        // Telemetry
        this.handshakeMs = 0;
        this.framesDecrypted = 0;
        this.framesEncrypted = 0;
        this.lastDecryptUs = 0;
        this.lastEncryptUs = 0;

        // Pending handshake promise
        this._handshakeResolve = null;
        this._handshakeReject = null;
    }

    /**
     * Handle a handshake message from the server.
     * Returns true if the message was consumed (is a PQC handshake message).
     */
    async handleMessage(ws, data) {
        if (typeof data === 'string') {
            try {
                const msg = JSON.parse(data);

                // Step 1: Receive encapsulation key
                if (msg.type === 'pqc_ek') {
                    this.algorithm = msg.algorithm || 'ML-KEM-768';
                    console.log(`[PQC] Received ${this.algorithm} encapsulation key (${msg.ek.length / 2} bytes)`);

                    const t0 = performance.now();

                    // Step 2: Call server-side encapsulation endpoint
                    try {
                        const resp = await fetch('/api/encaps', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ek: msg.ek }),
                        });
                        const result = await resp.json();

                        // Store shared key
                        this._sharedKeyRaw = result.shared_key;

                        // Derive AES-256-GCM key using SHA-256 with domain separator
                        // Must match server: SHA-256("NEXUS-PQC-V1:" + raw_shared)
                        const rawBytes = this._hexToBytes(result.shared_key);
                        const prefix = new TextEncoder().encode('NEXUS-PQC-V1:');
                        const combined = new Uint8Array(prefix.length + rawBytes.length);
                        combined.set(prefix, 0);
                        combined.set(rawBytes, prefix.length);

                        const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
                        this._aesKey = await crypto.subtle.importKey(
                            'raw', hashBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
                        );

                        // Step 3: Send ciphertext back to server
                        ws.send(JSON.stringify({
                            type: 'pqc_ct',
                            ct: result.ct,
                        }));

                        this.handshakeMs = performance.now() - t0;
                        console.log(`[PQC] Encapsulation complete, ciphertext sent (${this.handshakeMs.toFixed(1)} ms)`);

                    } catch (err) {
                        console.error('[PQC] Encapsulation failed:', err);
                        this.enabled = false;
                    }

                    return true; // consumed
                }

                // Step 4: Server confirms handshake
                if (msg.type === 'pqc_ready') {
                    if (msg.success) {
                        this.handshakeComplete = true;
                        this.handshakeMs += msg.handshake_ms || 0;
                        console.log(`[PQC] ✅ Handshake complete — AES-256-GCM channel active`);
                        console.log(`[PQC] Total handshake: ${this.handshakeMs.toFixed(1)} ms`);
                    } else {
                        console.warn('[PQC] ⚠️ Server handshake failed, falling back to plaintext');
                        this.enabled = false;
                    }

                    if (this._handshakeResolve) {
                        this._handshakeResolve(this.handshakeComplete);
                    }

                    return true; // consumed
                }

                return false; // not a PQC message
            } catch (e) {
                return false;
            }
        }
        return false;
    }

    /**
     * Wait for the handshake to complete.
     * Returns a promise that resolves when pqc_ready is received.
     */
    waitForHandshake() {
        if (this.handshakeComplete) return Promise.resolve(true);
        return new Promise((resolve, reject) => {
            this._handshakeResolve = resolve;
            this._handshakeReject = reject;
            // Timeout after 15s
            setTimeout(() => {
                if (!this.handshakeComplete) {
                    this.enabled = false;
                    resolve(false);
                }
            }, 15000);
        });
    }

    /**
     * Decrypt an incoming encrypted frame from the server.
     * @param {Object} payload - { pqc: true, ct: "<hex>", nonce: "<hex>", tag: "<hex>" }
     * @returns {Object} Decrypted JSON object
     */
    async decrypt(payload) {
        if (!payload.pqc || !this.handshakeComplete || !this._aesKey) {
            // Plaintext passthrough
            return typeof payload.data === 'string' ? JSON.parse(payload.data) : payload;
        }

        const t0 = performance.now();

        try {
            const ct = this._hexToBytes(payload.ct);
            const nonce = this._hexToBytes(payload.nonce);
            const tag = this._hexToBytes(payload.tag);

            // AES-GCM in Web Crypto expects ciphertext + tag concatenated
            const ctWithTag = new Uint8Array(ct.length + tag.length);
            ctWithTag.set(ct, 0);
            ctWithTag.set(tag, ct.length);

            const plainBuf = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: nonce, tagLength: 128 },
                this._aesKey,
                ctWithTag
            );

            const plaintext = new TextDecoder().decode(plainBuf);
            this.lastDecryptUs = (performance.now() - t0) * 1000;
            this.framesDecrypted++;

            return JSON.parse(plaintext);
        } catch (err) {
            console.error('[PQC] Decryption failed:', err);
            // Fallback: try parsing as plaintext
            return payload;
        }
    }

    /**
     * Encrypt an outgoing message to the server.
     * @param {Object} data - JSON object to encrypt
     * @returns {Object} Encrypted payload or plaintext wrapper
     */
    async encrypt(data) {
        if (!this.enabled || !this.handshakeComplete || !this._aesKey) {
            return data; // Pass through as plaintext
        }

        const t0 = performance.now();

        try {
            const plaintext = JSON.stringify(data);
            const plainBytes = new TextEncoder().encode(plaintext);

            // Generate nonce: direction 'C' + 3 padding + 8-byte counter
            const nonce = this._makeNonce(this._encryptCounter, 0x43); // 'C' = 0x43
            this._encryptCounter++;

            const encBuf = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: nonce, tagLength: 128 },
                this._aesKey,
                plainBytes
            );

            // Web Crypto returns ciphertext + tag concatenated
            const encBytes = new Uint8Array(encBuf);
            const ct = encBytes.slice(0, encBytes.length - 16);
            const tag = encBytes.slice(encBytes.length - 16);

            this.lastEncryptUs = (performance.now() - t0) * 1000;
            this.framesEncrypted++;

            return {
                pqc: true,
                ct: this._bytesToHex(ct),
                nonce: this._bytesToHex(nonce),
                tag: this._bytesToHex(tag),
            };
        } catch (err) {
            console.error('[PQC] Encryption failed:', err);
            return data; // Fallback to plaintext
        }
    }

    /**
     * Toggle PQC encryption on/off.
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    /**
     * Get security telemetry for the dashboard.
     */
    getTelemetry() {
        return {
            pqcActive: this.enabled && this.handshakeComplete,
            pqcAlgorithm: this.algorithm,
            pqcSymmetric: 'AES-256-GCM',
            pqcHandshakeComplete: this.handshakeComplete,
            pqcHandshakeMs: this.handshakeMs,
            pqcFramesDecrypted: this.framesDecrypted,
            pqcFramesEncrypted: this.framesEncrypted,
            pqcDecryptUs: this.lastDecryptUs,
            pqcEncryptUs: this.lastEncryptUs,
            pqcEnabled: this.enabled,
        };
    }

    // ── Utility methods ──

    _makeNonce(counter, directionByte) {
        const nonce = new Uint8Array(12);
        nonce[0] = directionByte;
        // bytes 1-3: padding (0x00)
        // bytes 4-11: big-endian counter
        const view = new DataView(nonce.buffer);
        // Use two 32-bit writes for the 64-bit counter (JS safe integer limit)
        view.setUint32(4, Math.floor(counter / 0x100000000));
        view.setUint32(8, counter >>> 0);
        return nonce;
    }

    _hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes;
    }

    _bytesToHex(bytes) {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

