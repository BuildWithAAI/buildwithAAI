"""Solana key helpers: base58, program-derived addresses, associated token accounts.

Python 3 stdlib only. Holds no case data.

    from solkeys import get_ata, TOKEN_PROGRAM, TOKEN_2022
    ata = get_ata(owner, mint)                 # classic SPL Token account
    ata22 = get_ata(owner, mint, TOKEN_2022)   # Token-2022 mints

Useful for auditing one wallet's activity in one token cheaply: the ATA's
signature history (getSignaturesForAddress) holds only transactions that
touched that wallet's balance of that token.
"""

from __future__ import annotations

import hashlib

TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"

# ------------------------------------------------------------------ base58
_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        n = n * 58 + _B58.index(ch)
    full = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    pad = len(s) - len(s.lstrip("1"))
    return b"\x00" * pad + full


def b58encode(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = _B58[r] + out
    pad = len(b) - len(b.lstrip(b"\x00"))
    return "1" * pad + out


# ------------------------------------------------------- PDA / ATA (ed25519)
_P = 2 ** 255 - 19
_D = (-121665 * pow(121666, _P - 2, _P)) % _P


def _on_curve(b: bytes) -> bool:
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    if y >= _P:
        return False
    y2 = y * y % _P
    u = (y2 - 1) % _P
    v = (_D * y2 + 1) % _P
    x2 = u * pow(v, _P - 2, _P) % _P
    return x2 == 0 or pow(x2, (_P - 1) // 2, _P) == 1


def find_program_address(seeds: list[bytes], program_id: str) -> tuple[str, int]:
    pid = b58decode(program_id)
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b"".join(seeds) + bytes([bump]) + pid + b"ProgramDerivedAddress").digest()
        if not _on_curve(h):
            return b58encode(h), bump
    raise ValueError("no viable bump")


def get_ata(owner: str, mint: str, token_program: str = TOKEN_PROGRAM) -> str:
    return find_program_address([b58decode(owner), b58decode(token_program), b58decode(mint)], ATA_PROGRAM)[0]
