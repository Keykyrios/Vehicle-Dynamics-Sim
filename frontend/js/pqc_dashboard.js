/**
 * ═══════════════════════════════════════════════════════════════
 * NEXUS L5 — PQC Security Dashboard
 * Displays ML-KEM-768 handshake status, AES-256-GCM encryption
 * metrics, and provides a toggle for pen-test comparison.
 * ═══════════════════════════════════════════════════════════════
 */

export class PQCDashboard {
    constructor() {
        this._container = document.getElementById('pqc-dashboard');
        this._built = false;
        this._build(); // Eagerly build DOM
    }

    _build() {
        if (!this._container || this._built) return;
        this._built = true;

        this._container.innerHTML = `
            <div class="pqc-header">
                <div class="pqc-shield" id="pqc-shield">🔒</div>
                <div class="pqc-title">
                    <span class="pqc-label">POST-QUANTUM CRYPTOGRAPHY</span>
                    <span class="pqc-status-text" id="pqc-status-text">Initializing...</span>
                </div>
                <label class="pqc-toggle">
                    <input type="checkbox" id="pqc-toggle-cb" checked>
                    <span class="pqc-toggle-slider"></span>
                </label>
            </div>

            <div class="pqc-grid">
                <div class="pqc-card pqc-card-algo">
                    <div class="pqc-card-label">KEY EXCHANGE</div>
                    <div class="pqc-card-value" id="pqc-algo">—</div>
                    <div class="pqc-card-sub" id="pqc-ek-size">—</div>
                </div>
                <div class="pqc-card pqc-card-sym">
                    <div class="pqc-card-label">SYMMETRIC</div>
                    <div class="pqc-card-value" id="pqc-sym">—</div>
                    <div class="pqc-card-sub" id="pqc-key-bits">—</div>
                </div>
                <div class="pqc-card pqc-card-handshake">
                    <div class="pqc-card-label">HANDSHAKE</div>
                    <div class="pqc-card-value" id="pqc-handshake-ms">—</div>
                    <div class="pqc-card-sub">Total negotiation time</div>
                </div>
                <div class="pqc-card pqc-card-keygen">
                    <div class="pqc-card-label">KEYGEN</div>
                    <div class="pqc-card-value" id="pqc-keygen-ms">—</div>
                    <div class="pqc-card-sub">ML-KEM keypair generation</div>
                </div>
            </div>

            <div class="pqc-metrics">
                <div class="pqc-metric-row">
                    <span class="pqc-metric-label">Frames Encrypted</span>
                    <span class="pqc-metric-value" id="pqc-frames-enc">0</span>
                </div>
                <div class="pqc-metric-row">
                    <span class="pqc-metric-label">Frames Decrypted</span>
                    <span class="pqc-metric-value" id="pqc-frames-dec">0</span>
                </div>
                <div class="pqc-metric-row">
                    <span class="pqc-metric-label">Encrypt Overhead</span>
                    <span class="pqc-metric-value" id="pqc-enc-us">— µs</span>
                </div>
                <div class="pqc-metric-row">
                    <span class="pqc-metric-label">Decrypt Overhead</span>
                    <span class="pqc-metric-value" id="pqc-dec-us">— µs</span>
                </div>
            </div>

            <div class="pqc-security-bar">
                <div class="pqc-bar-label">QUANTUM SECURITY LEVEL</div>
                <div class="pqc-bar-track">
                    <div class="pqc-bar-fill" id="pqc-security-bar-fill"></div>
                </div>
                <div class="pqc-bar-legend">
                    <span>Classical</span>
                    <span>NIST Level 3 (ML-KEM-768)</span>
                    <span>Level 5</span>
                </div>
            </div>

            <div class="pqc-pentest-info" id="pqc-pentest-info">
                <span class="pqc-pentest-icon">🔍</span>
                <span>Pen-test mode: Disable toggle to send plaintext. Use Wireshark on port 8000 to compare.</span>
            </div>
        `;

        // Toggle handler
        const toggle = document.getElementById('pqc-toggle-cb');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                this._onToggle(e.target.checked);
            });
        }

        this._onToggleCallback = null;
    }

    /**
     * Register a callback for when PQC is toggled.
     * @param {Function} cb - Called with (enabled: boolean)
     */
    onToggle(cb) {
        this._onToggleCallback = cb;
    }

    _onToggle(enabled) {
        const shield = document.getElementById('pqc-shield');
        const statusText = document.getElementById('pqc-status-text');
        const pentestInfo = document.getElementById('pqc-pentest-info');

        if (enabled) {
            if (shield) shield.textContent = '🔒';
            if (statusText) {
                statusText.textContent = 'ENCRYPTED CHANNEL ACTIVE';
                statusText.className = 'pqc-status-text pqc-active';
            }
            if (pentestInfo) pentestInfo.classList.remove('pqc-pentest-visible');
        } else {
            if (shield) shield.textContent = '🔓';
            if (statusText) {
                statusText.textContent = '⚠ PLAINTEXT MODE (PEN-TEST)';
                statusText.className = 'pqc-status-text pqc-plaintext';
            }
            if (pentestInfo) pentestInfo.classList.add('pqc-pentest-visible');
        }

        if (this._onToggleCallback) {
            this._onToggleCallback(enabled);
        }
    }

    /**
     * Update dashboard with latest PQC telemetry.
     * @param {Object} state - Full state object with pqc_* fields
     */
    update(state) {
        if (!state) return;
        if (!this._built) this._build();
        if (!this._container) return;

        // Algorithm info
        this._setText('pqc-algo', state.pqc_algorithm || '—');
        this._setText('pqc-sym', state.pqc_symmetric || '—');
        this._setText('pqc-key-bits', state.pqc_key_bits ? `${state.pqc_key_bits}-bit key` : '—');
        this._setText('pqc-ek-size', state.pqc_ek_bytes ? `${state.pqc_ek_bytes} byte public key` : '—');

        // Timing
        this._setText('pqc-handshake-ms',
            state.pqc_handshake_ms !== undefined ? `${state.pqc_handshake_ms.toFixed(1)} ms` : '—');
        this._setText('pqc-keygen-ms',
            state.pqc_keygen_ms !== undefined ? `${state.pqc_keygen_ms.toFixed(1)} ms` : '—');

        // Counters
        this._setText('pqc-frames-enc',
            state.pqc_frames_encrypted !== undefined ? state.pqc_frames_encrypted.toLocaleString() : '0');
        this._setText('pqc-frames-dec',
            state.pqc_frames_decrypted !== undefined ? state.pqc_frames_decrypted.toLocaleString() : '0');

        // Overhead
        this._setText('pqc-enc-us',
            state.pqc_encrypt_us !== undefined ? `${state.pqc_encrypt_us.toFixed(1)} µs` : '— µs');
        this._setText('pqc-dec-us',
            state.pqc_decrypt_us !== undefined ? `${state.pqc_decrypt_us.toFixed(1)} µs` : '— µs');

        // Status
        const shield = document.getElementById('pqc-shield');
        const statusText = document.getElementById('pqc-status-text');

        if (state.pqc_active) {
            if (shield) shield.textContent = '🔒';
            if (statusText) {
                statusText.textContent = 'ENCRYPTED CHANNEL ACTIVE';
                statusText.className = 'pqc-status-text pqc-active';
            }
        } else if (state.pqc_handshake_complete && !state.pqc_enabled) {
            if (shield) shield.textContent = '🔓';
            if (statusText) {
                statusText.textContent = '⚠ PLAINTEXT MODE (PEN-TEST)';
                statusText.className = 'pqc-status-text pqc-plaintext';
            }
        } else if (!state.pqc_handshake_complete) {
            if (shield) shield.textContent = '⏳';
            if (statusText) {
                statusText.textContent = 'HANDSHAKE PENDING...';
                statusText.className = 'pqc-status-text';
            }
        }

        // Security bar: ML-KEM-768 = NIST Level 3 = 60% of the max bar
        const barFill = document.getElementById('pqc-security-bar-fill');
        if (barFill) {
            if (state.pqc_active) {
                barFill.style.width = '60%';
                barFill.className = 'pqc-bar-fill pqc-bar-active';
            } else {
                barFill.style.width = '0%';
                barFill.className = 'pqc-bar-fill';
            }
        }
    }

    _setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }
}

