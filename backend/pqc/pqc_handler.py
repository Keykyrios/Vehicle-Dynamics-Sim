"""
==========================================================================
 NEXUS L5 — Post-Quantum Cryptography Session Handler
 Implements ML-KEM-768 (FIPS 203) key exchange + AES-256-GCM encryption
 for securing the real-time VCU telemetry WebSocket channel.
==========================================================================

Security Architecture:
    1. Server generates ML-KEM-768 keypair (ek, dk)
    2. Server sends encapsulation key (ek) to client
    3. Client encapsulates → (shared_key, ciphertext)
    4. Client sends ciphertext to server
    5. Server decapsulates → shared_key
    6. Both sides use shared_key for AES-256-GCM symmetric encryption

This module handles the server-side (steps 1, 5, 6) and provides
an encapsulation helper endpoint for the browser client.
"""

import time
import json
import hashlib
import struct
from typing import Optional, Tuple

from kyber_py.ml_kem import ML_KEM_768
from Crypto.Cipher import AES


class PQCSession:
    """
    Manages a single PQC-secured WebSocket session.

    Lifecycle:
        1. generate_keypair()         → produces ek (public) to send to client
        2. complete_handshake(ct)      → decapsulates client's ciphertext → shared key
        3. encrypt(plaintext) / decrypt(payload)  → AES-256-GCM frame crypto
    """

    ALGORITHM = "ML-KEM-768"
    SYMMETRIC = "AES-256-GCM"
    KEY_SIZE_BITS = 256
    NONCE_SIZE = 12  # bytes, standard for AES-GCM

    def __init__(self):
        # Key material
        self._ek: Optional[bytes] = None   # Encapsulation key (public)
        self._dk: Optional[bytes] = None   # Decapsulation key (private)
        self._shared_key: Optional[bytes] = None  # 32-byte AES key
        self._raw_shared: Optional[bytes] = None   # Raw ML-KEM shared secret

        # State
        self.handshake_complete = False
        self.enabled = True  # Can be toggled for pen-test comparison

        # Counters
        self._encrypt_counter = 0  # Nonce counter (encrypt direction)
        self._decrypt_counter = 0  # Nonce counter (decrypt direction)
        self.frames_encrypted = 0
        self.frames_decrypted = 0

        # Timing telemetry
        self.keygen_time_ms = 0.0
        self.handshake_time_ms = 0.0
        self._handshake_start = 0.0
        self._last_encrypt_us = 0.0
        self._last_decrypt_us = 0.0

    # ──────────────────────────────────────────────
    #  Step 1: Key Generation (server-side)
    # ──────────────────────────────────────────────

    def generate_keypair(self) -> bytes:
        """
        Generate ML-KEM-768 keypair.

        Returns:
            ek (bytes): Encapsulation key to send to the client.
        """
        self._handshake_start = time.perf_counter()

        t0 = time.perf_counter()
        self._ek, self._dk = ML_KEM_768.keygen()
        self.keygen_time_ms = (time.perf_counter() - t0) * 1000

        return self._ek

    # ──────────────────────────────────────────────
    #  Step 2: Server-side encapsulation helper
    #  (for browser clients that can't run ML-KEM natively)
    # ──────────────────────────────────────────────

    def server_encapsulate(self, ek_bytes: bytes) -> Tuple[bytes, bytes]:
        """
        Run ML-KEM encapsulation on behalf of the client.
        Used when browser can't run lattice crypto natively.

        Args:
            ek_bytes: Encapsulation key (could be the server's own ek, or
                      another party's ek in a multi-party scenario)

        Returns:
            (shared_key, ciphertext): The encapsulated shared secret and ciphertext.
        """
        shared_key, ct = ML_KEM_768.encaps(ek_bytes)
        return shared_key, ct

    # ──────────────────────────────────────────────
    #  Step 3: Handshake Completion (server decapsulates)
    # ──────────────────────────────────────────────

    def complete_handshake(self, ct_bytes: bytes) -> bool:
        """
        Complete the PQC handshake by decapsulating the client's ciphertext.

        Args:
            ct_bytes: Ciphertext from the client's encapsulation.

        Returns:
            True if handshake succeeded.
        """
        if self._dk is None:
            raise RuntimeError("generate_keypair() must be called first")

        try:
            self._raw_shared = ML_KEM_768.decaps(self._dk, ct_bytes)

            # Derive AES-256 key from the 32-byte ML-KEM shared secret
            # using SHA-256 with a domain separator for good practice
            self._shared_key = hashlib.sha256(
                b"NEXUS-PQC-V1:" + self._raw_shared
            ).digest()

            self.handshake_complete = True
            self.handshake_time_ms = (time.perf_counter() - self._handshake_start) * 1000

            return True
        except Exception as e:
            print(f"[PQC] Handshake failed: {e}")
            self.handshake_complete = False
            return False

    # ──────────────────────────────────────────────
    #  Step 4a: Encrypt outgoing frame
    # ──────────────────────────────────────────────

    def encrypt(self, plaintext: str) -> dict:
        """
        Encrypt a JSON string using AES-256-GCM.

        Args:
            plaintext: JSON string to encrypt.

        Returns:
            dict with 'ct' (ciphertext hex), 'nonce' (hex), 'tag' (hex)
        """
        if not self.enabled or not self.handshake_complete:
            # Passthrough when PQC is disabled
            return {"pqc": False, "data": plaintext}

        t0 = time.perf_counter()

        # Generate nonce from counter (deterministic, non-repeating)
        nonce = self._make_nonce(self._encrypt_counter, direction=b'S')
        self._encrypt_counter += 1

        cipher = AES.new(self._shared_key, AES.MODE_GCM, nonce=nonce)
        ct_bytes, tag = cipher.encrypt_and_digest(plaintext.encode('utf-8'))

        self._last_encrypt_us = (time.perf_counter() - t0) * 1_000_000
        self.frames_encrypted += 1

        return {
            "pqc": True,
            "ct": ct_bytes.hex(),
            "nonce": nonce.hex(),
            "tag": tag.hex(),
        }

    # ──────────────────────────────────────────────
    #  Step 4b: Decrypt incoming frame
    # ──────────────────────────────────────────────

    def decrypt(self, payload: dict) -> str:
        """
        Decrypt an AES-256-GCM encrypted message.

        Args:
            payload: dict with 'ct', 'nonce', 'tag' (all hex strings)

        Returns:
            Decrypted JSON string.
        """
        if not payload.get('pqc', False):
            # Plaintext passthrough
            return payload.get('data', '{}')

        if not self.handshake_complete:
            raise RuntimeError("Cannot decrypt: handshake not complete")

        t0 = time.perf_counter()

        ct_bytes = bytes.fromhex(payload['ct'])
        nonce = bytes.fromhex(payload['nonce'])
        tag = bytes.fromhex(payload['tag'])

        cipher = AES.new(self._shared_key, AES.MODE_GCM, nonce=nonce)
        plaintext = cipher.decrypt_and_verify(ct_bytes, tag)

        self._last_decrypt_us = (time.perf_counter() - t0) * 1_000_000
        self.frames_decrypted += 1

        return plaintext.decode('utf-8')

    # ──────────────────────────────────────────────
    #  Nonce generation
    # ──────────────────────────────────────────────

    def _make_nonce(self, counter: int, direction: bytes = b'S') -> bytes:
        """
        Create a 12-byte nonce from a counter + direction byte.
        Direction prevents nonce reuse: b'S' for server→client, b'C' for client→server.
        """
        # 1 byte direction + 3 bytes padding + 8 bytes counter = 12 bytes
        return direction + b'\x00\x00\x00' + struct.pack('>Q', counter)

    # ──────────────────────────────────────────────
    #  Telemetry for dashboard
    # ──────────────────────────────────────────────

    def get_telemetry(self) -> dict:
        """Return PQC security metrics for the frontend dashboard."""
        return {
            'pqc_active': self.enabled and self.handshake_complete,
            'pqc_algorithm': self.ALGORITHM,
            'pqc_symmetric': self.SYMMETRIC,
            'pqc_key_bits': self.KEY_SIZE_BITS,
            'pqc_ek_bytes': len(self._ek) if self._ek else 0,
            'pqc_handshake_complete': self.handshake_complete,
            'pqc_handshake_ms': round(self.handshake_time_ms, 2),
            'pqc_keygen_ms': round(self.keygen_time_ms, 2),
            'pqc_frames_encrypted': self.frames_encrypted,
            'pqc_frames_decrypted': self.frames_decrypted,
            'pqc_encrypt_us': round(self._last_encrypt_us, 1),
            'pqc_decrypt_us': round(self._last_decrypt_us, 1),
            'pqc_enabled': self.enabled,
        }

