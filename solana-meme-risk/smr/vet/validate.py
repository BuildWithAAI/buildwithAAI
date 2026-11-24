"""Input validation. The mint string is untrusted: it is only ever base58-decoded and compared, never interpolated
into shell, SQL or prompts. Token name/symbol/URI are never read by the gate (hostile data per agent-guard)."""
from __future__ import annotations
from ..paper.pda import ALPHABET, b58decode, on_curve

_ALPHA = set(ALPHABET)
RESERVED = {
    "11111111111111111111111111111111", "So11111111111111111111111111111111111111112",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
}


def validate_mint(mint) -> tuple[bool, str, dict]:
    """-> (ok, code, info). info.pump_suffix is informational only (pump.fun vanity mints end in 'pump',
    SDK-created mints may not; the on-chain bonding-curve check is what proves pump.fun origin)."""
    if not isinstance(mint, str):
        return False, "MINT_NOT_STRING", {}
    if not (32 <= len(mint) <= 44):
        return False, "MINT_BAD_LENGTH", {"length": len(mint)}
    if any(ch not in _ALPHA for ch in mint):
        return False, "MINT_NOT_BASE58", {}
    try:
        raw = b58decode(mint)
    except Exception:
        return False, "MINT_NOT_BASE58", {}
    if len(raw) != 32:
        return False, "MINT_NOT_32_BYTES", {"bytes": len(raw)}
    if mint in RESERVED:
        return False, "MINT_RESERVED_ADDRESS", {}
    return True, "OK", {"pump_suffix": mint.endswith("pump"), "on_curve": on_curve(raw)}
