"""
PQC (Post-Quantum Cryptography) module for NEXUS L5 VCU Simulator.
Implements ML-KEM-768 key exchange + AES-256-GCM frame encryption.
"""
from .pqc_handler import PQCSession

__all__ = ['PQCSession']

