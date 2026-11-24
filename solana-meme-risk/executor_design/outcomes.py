"""UNKNOWN-outcome handling for sent transactions. Pure decision logic: no RPC, no signing, no resend.

Rules:
  * A pending record is written BEFORE send (write-ahead), status UNKNOWN, with the tx's lastValidBlockHeight.
  * UNKNOWN BUY counts as an open position at max exposure until resolved.
  * Resolution is by signature status AND wallet balance deltas on-chain. Never blindly resend the same intent.
  * Only after the blockhash has expired (block height > lastValidBlockHeight) with no signature found AND balances
    show no fill may the intent be marked EXPIRED_NOT_LANDED; a fresh signal is then required for any retry."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Pending:
    signature: str
    signal_id: str
    mint: str
    side: str                       # BUY | SELL
    max_exposure_usd: float
    last_valid_block_height: int
    status: str = "UNKNOWN"         # UNKNOWN | CONFIRMED | FAILED | EXPIRED_NOT_LANDED


def resolve(p: Pending, *, sig_status: str | None, current_block_height: int | None,
            balance_delta_seen: bool | None) -> str:
    """sig_status: None (not found) | 'processed' | 'confirmed' | 'finalized' | 'failed' (from getSignatureStatuses).
    balance_delta_seen: did the burner's SOL/token balances change consistent with this tx (None = could not read)."""
    if p.status != "UNKNOWN":
        return p.status
    if sig_status in ("confirmed", "finalized"):
        p.status = "CONFIRMED" if balance_delta_seen is not False else "UNKNOWN"  # mismatch -> keep UNKNOWN, alert
    elif sig_status == "failed":
        p.status = "FAILED" if balance_delta_seen is not True else "UNKNOWN"
    elif sig_status is None and current_block_height is not None and current_block_height > p.last_valid_block_height:
        p.status = "EXPIRED_NOT_LANDED" if balance_delta_seen is False else "UNKNOWN"
    # 'processed', or not found before expiry, or unreadable chain state -> stays UNKNOWN
    return p.status


def may_submit_new_intent(p: Pending) -> bool:
    """Resending the same signed tx or re-building the same intent is only allowed once definitively not landed.
    Even then the executor requires a NEW valid signal (new signal_id/nonce) — the old one is consumed."""
    return p.status in ("FAILED", "EXPIRED_NOT_LANDED")
