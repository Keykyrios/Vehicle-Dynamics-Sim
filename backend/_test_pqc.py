"""
Quick smoke test for PQC integration.
Tests ML-KEM-768 key exchange and AES-256-GCM encryption round-trip.
"""
import sys
import time
import json

sys.path.insert(0, '.')
from pqc import PQCSession

print("=" * 60)
print("  NEXUS L5 — PQC Unit Test")
print("=" * 60)

# ── Test 1: Key Generation ──
print("\n[1] ML-KEM-768 Key Generation...")
session = PQCSession()
ek = session.generate_keypair()
print(f"    ✅ Encapsulation key: {len(ek)} bytes")
print(f"    ✅ Keygen time: {session.keygen_time_ms:.2f} ms")
assert len(ek) > 0, "Encapsulation key is empty"
assert session.keygen_time_ms > 0, "Keygen time not recorded"

# ── Test 2: Encapsulation + Decapsulation ──
print("\n[2] ML-KEM-768 Encapsulation + Decapsulation...")
# Simulate what the browser does via /api/encaps
client_session = PQCSession()
shared_key_client, ct = client_session.server_encapsulate(ek)
print(f"    ✅ Ciphertext: {len(ct)} bytes")
print(f"    ✅ Client shared key: {len(shared_key_client)} bytes")

# Server-side decapsulation
success = session.complete_handshake(ct)
assert success, "Handshake failed"
print(f"    ✅ Handshake complete: {session.handshake_time_ms:.2f} ms")

# Verify shared keys match (raw, pre-derivation)
assert session._raw_shared == shared_key_client, "Shared secrets do NOT match!"
print(f"    ✅ Shared secrets match (both {len(shared_key_client)} bytes)")

# ── Test 3: AES-256-GCM Encrypt/Decrypt Round-Trip ──
print("\n[3] AES-256-GCM Encrypt → Decrypt Round-Trip...")

# Build the same AES key that the browser would derive
import hashlib
client_aes_key = hashlib.sha256(
    b"NEXUS-PQC-V1:" + shared_key_client
).digest()
# Verify it matches the server's derived key
assert session._shared_key == client_aes_key, "Derived AES keys do NOT match!"
print(f"    ✅ Derived AES-256 keys match")

# Encrypt a sample physics frame
test_frame = {
    'vx': 12.345,
    'vy': 0.678,
    'gamma': 0.1234,
    'TL': 45.67,
    'TR': 38.21,
    'RI': 0.234,
    'status': 'NOMINAL: ASMC QP TORQUE VECTORING',
}
plaintext = json.dumps(test_frame)
encrypted = session.encrypt(plaintext)
assert encrypted['pqc'] is True, "Encrypted payload missing pqc flag"
assert 'ct' in encrypted, "Missing ciphertext"
assert 'nonce' in encrypted, "Missing nonce"
assert 'tag' in encrypted, "Missing tag"
print(f"    ✅ Encrypted: {len(encrypted['ct'])} hex chars ciphertext")

# Decrypt
decrypted = session.decrypt(encrypted)
assert decrypted == plaintext, "Decrypted text doesn't match original!"
decrypted_obj = json.loads(decrypted)
assert decrypted_obj['vx'] == 12.345, "Data corrupted after decrypt"
print(f"    ✅ Decrypted matches original")

# ── Test 4: Multiple Frame Encryption ──
print("\n[4] 1000-frame encryption stress test...")
t0 = time.perf_counter()
for i in range(1000):
    test_frame['vx'] = i * 0.01
    enc = session.encrypt(json.dumps(test_frame))
    dec = session.decrypt(enc)
elapsed = (time.perf_counter() - t0) * 1000
avg_per_frame = elapsed / 1000
print(f"    ✅ 1000 encrypt+decrypt in {elapsed:.1f} ms ({avg_per_frame:.3f} ms/frame)")
assert avg_per_frame < 5, f"Too slow: {avg_per_frame:.3f} ms/frame"

# ── Test 5: Plaintext Passthrough (PQC disabled) ──
print("\n[5] Plaintext passthrough when disabled...")
session.enabled = False
passthrough = session.encrypt("hello")
assert passthrough['pqc'] is False, "Should be plaintext when disabled"
assert passthrough['data'] == "hello", "Data should pass through"
result = session.decrypt(passthrough)
assert result == "hello", "Decrypt passthrough failed"
session.enabled = True
print(f"    ✅ Plaintext passthrough works")

# ── Test 6: Telemetry ──
print("\n[6] Security telemetry...")
telem = session.get_telemetry()
required_fields = [
    'pqc_active', 'pqc_algorithm', 'pqc_symmetric', 'pqc_key_bits',
    'pqc_ek_bytes', 'pqc_handshake_complete', 'pqc_handshake_ms',
    'pqc_keygen_ms', 'pqc_frames_encrypted', 'pqc_frames_decrypted',
    'pqc_encrypt_us', 'pqc_decrypt_us', 'pqc_enabled',
]
missing = [f for f in required_fields if f not in telem]
assert not missing, f"Missing telemetry fields: {missing}"
assert telem['pqc_active'] is True
assert telem['pqc_algorithm'] == 'ML-KEM-768'
assert telem['pqc_symmetric'] == 'AES-256-GCM'
assert telem['pqc_key_bits'] == 256
assert telem['pqc_frames_encrypted'] == 1001
print(f"    ✅ All {len(required_fields)} telemetry fields present")
for k, v in sorted(telem.items()):
    print(f"       {k}: {v}")

print("\n" + "=" * 60)
print("  ALL PQC TESTS PASSED ✅")
print("=" * 60)

