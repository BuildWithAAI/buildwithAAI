"""Pure-Python Solana program-derived addresses (no solana/solders dependency): base58 and find_program_address.
Used by the scanner to locate a mint's pump.fun bonding-curve account (seeds ["bonding-curve", mint]) for the Mayhem check."""
from __future__ import annotations
import hashlib

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_IDX = {c: i for i, c in enumerate(ALPHABET)}
PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
_P = 2 ** 255 - 19
_D = (-121665 * pow(121666, _P - 2, _P)) % _P


def b58decode(s: str) -> bytes:
    n = 0
    for c in s:
        n = n * 58 + _IDX[c]
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    pad = len(s) - len(s.lstrip("1"))
    return b"\0" * pad + raw


def b58encode(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = ALPHABET[r] + out
    pad = len(b) - len(b.lstrip(b"\0"))
    return "1" * pad + out


def on_curve(b: bytes) -> bool:
    """True if the 32 bytes decompress to an ed25519 point (such an address could have a private key: not a PDA)."""
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    if y >= _P:
        return False
    yy = y * y % _P
    x2 = (yy - 1) * pow((_D * yy + 1) % _P, _P - 2, _P) % _P
    return x2 == 0 or pow(x2, (_P - 1) // 2, _P) == 1


def find_program_address(seeds, program_id: str):
    prog = b58decode(program_id)
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b"".join(seeds) + bytes([bump]) + prog + b"ProgramDerivedAddress").digest()
        if not on_curve(h):
            return b58encode(h), bump
    raise ValueError("no viable bump")


def pump_bonding_curve(mint: str) -> str:
    return find_program_address([b"bonding-curve", b58decode(mint)], PUMP_PROGRAM)[0]
