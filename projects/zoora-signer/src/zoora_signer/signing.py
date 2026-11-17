"""Local signatures. The shipped broadcaster never asks for one."""

from __future__ import annotations

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def verify_ed25519(public_key: bytes, message: bytes, signature: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(public_key).verify(signature, message)
    except (InvalidSignature, ValueError):
        return False
    return True


def sign_message(secret: bytes, message: bytes) -> bytes:
    from solders.keypair import Keypair

    keypair = Keypair.from_bytes(secret)
    return bytes(keypair.sign_message(message))


def throwaway_secret() -> bytes:
    from solders.keypair import Keypair

    return bytes(Keypair())


def public_key(secret: bytes) -> str:
    from solders.keypair import Keypair

    return str(Keypair.from_bytes(secret).pubkey())
