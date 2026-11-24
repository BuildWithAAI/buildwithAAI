"""Validator for smr.signal/1. Stdlib only. Every field is treated as untrusted data.

Design-only: this module never signs transactions, never touches a wallet key, never talks to RPC.
The HMAC secret here authenticates transport only (it is NOT a funds key)."""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import sys
import time
import uuid

SCHEMA = "smr.signal/1"
MAX_LINE_BYTES = 4096
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TOP_KEYS = {"schema", "signal_id", "nonce", "created_at_ms", "expires_at_ms", "book", "mint", "side", "size",
            "max_slippage_bps", "venue_hint", "risk", "observed", "reason", "source_agent", "tag"}
REQUIRED = TOP_KEYS - {"observed"}
BOOKS = {"experiment100"}
SOURCES = {"smr_experiment100"}
VENUES = {"auto", "pump_curve", "pumpswap", "jupiter"}
DECISIONS = {"NORMAL", "REDUCED", "SKIP"}
QUALITY = {"CLEAR", "FLAG", "UNKNOWN"}
REASON_RE = re.compile(r"^[\w .,:;!?$%&()+\-/#@']{0,200}$")
MAX_TTL_MS = {"BUY": 30_000, "SELL": 120_000}   # PROPOSED
MAX_SKEW_MS = 5_000


class SignalRejected(ValueError):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


def _rej(code, detail=""):
    raise SignalRejected(code, detail)


def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        i = B58.find(ch)
        if i < 0:
            _rej("mint_not_base58")
        n = n * 58 + i
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    pad = len(s) - len(s.lstrip("1"))
    return b"\x00" * pad + raw


def canonical(sig: dict) -> bytes:
    body = {k: v for k, v in sig.items() if k != "tag"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def compute_tag(sig: dict, secret: bytes) -> str:
    return hmac.new(secret, canonical(sig), hashlib.sha256).hexdigest()


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v):
    return (isinstance(v, (int, float)) and not isinstance(v, bool)) and v == v and v not in (float("inf"), float("-inf"))


def _injection_findings(text: str) -> list:
    """Use agent-guard's detector when importable; the strict charset check always applies regardless."""
    try:
        sys.path.insert(0, "/workspace/agent-guard")
        from agent_guard import sanitize  # type: ignore
        return [f for f in sanitize.detect_injection(text) if f.get("severity") in ("HIGH", "CRITICAL")]
    except Exception:
        return []


class ReplayStore:
    """In-memory seen-store. The real executor persists this (e.g. sqlite) on the owner's machine."""

    def __init__(self):
        self._ids: set[str] = set()
        self._nonces: set[str] = set()

    def check_and_add(self, signal_id: str, nonce: str):
        if signal_id in self._ids:
            _rej("duplicate_signal_id")
        if nonce in self._nonces:
            _rej("replayed_nonce")
        self._ids.add(signal_id)
        self._nonces.add(nonce)


def parse_line(line: bytes | str) -> dict:
    raw = line.encode() if isinstance(line, str) else line
    if len(raw) > MAX_LINE_BYTES:
        _rej("too_large")
    try:
        obj = json.loads(raw, parse_constant=lambda c: _rej("bad_number", c))
    except SignalRejected:
        raise
    except Exception as e:  # noqa: BLE001
        _rej("bad_json", type(e).__name__)
    if not isinstance(obj, dict):
        _rej("not_object")
    return obj


def validate(sig: dict, *, secret: bytes, replay: ReplayStore, now_ms: int | None = None) -> dict:
    """Return the signal unchanged if valid; raise SignalRejected otherwise. Never repairs input."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    keys = set(sig)
    if keys - TOP_KEYS:
        _rej("unknown_keys", ",".join(sorted(keys - TOP_KEYS))[:80])
    if REQUIRED - keys:
        _rej("missing_keys", ",".join(sorted(REQUIRED - keys)))
    if sig["schema"] != SCHEMA:
        _rej("bad_schema")
    sid = sig["signal_id"]
    try:
        if not isinstance(sid, str) or str(uuid.UUID(sid)) != sid or uuid.UUID(sid).version != 4:
            _rej("bad_signal_id")
    except ValueError:
        _rej("bad_signal_id")
    if not (isinstance(sig["nonce"], str) and re.fullmatch(r"[0-9a-f]{32}", sig["nonce"])):
        _rej("bad_nonce")
    if sig["book"] not in BOOKS:
        _rej("bad_book")
    if sig["source_agent"] not in SOURCES:
        _rej("bad_source_agent")
    if sig["venue_hint"] not in VENUES:
        _rej("bad_venue_hint")
    mint = sig["mint"]
    if not (isinstance(mint, str) and 32 <= len(mint) <= 44) or len(b58decode(mint)) != 32:
        _rej("bad_mint")
    side = sig["side"]
    if side not in ("BUY", "SELL"):
        _rej("bad_side")
    size = sig["size"]
    if not isinstance(size, dict) or len(size) != 1:
        _rej("bad_size")
    (sk, sv), = size.items()
    if side == "BUY":
        if sk not in ("usd", "sol") or not _is_num(sv) or sv <= 0:
            _rej("bad_size")
    else:
        if sk != "fraction_bps" or not _is_int(sv) or not 1 <= sv <= 10000:
            _rej("bad_size")
    slip = sig["max_slippage_bps"]
    if not _is_int(slip) or not 1 <= slip <= 5000:
        _rej("bad_slippage")
    risk = sig["risk"]
    if not isinstance(risk, dict) or set(risk) != {"score", "decision", "mayhem", "quality"}:
        _rej("bad_risk")
    if not _is_num(risk["score"]) or not 0 <= risk["score"] <= 100:
        _rej("bad_risk_score")
    if risk["decision"] not in DECISIONS or risk["quality"] not in QUALITY:
        _rej("bad_risk_enum")
    if risk["mayhem"] not in (True, False, None):
        _rej("bad_mayhem")
    obs = sig.get("observed")
    if obs is not None:
        if not isinstance(obs, dict) or set(obs) - {"mcap_usd", "liq_usd", "price_usd"}:
            _rej("bad_observed")
        if any(not _is_num(v) or v < 0 for v in obs.values()):
            _rej("bad_observed")
    reason = sig["reason"]
    if not isinstance(reason, str) or not REASON_RE.fullmatch(reason):
        _rej("bad_reason")
    if _injection_findings(reason):
        _rej("reason_injection")
    c, e = sig["created_at_ms"], sig["expires_at_ms"]
    if not (_is_int(c) and _is_int(e)) or e <= c:
        _rej("bad_times")
    if c > now_ms + MAX_SKEW_MS:
        _rej("from_future")
    if e - c > MAX_TTL_MS[side]:
        _rej("ttl_too_long")
    if now_ms >= e:
        _rej("expired")
    tag = sig["tag"]
    if not (isinstance(tag, str) and re.fullmatch(r"[0-9a-f]{64}", tag)):
        _rej("bad_tag")
    if not hmac.compare_digest(tag, compute_tag(sig, secret)):
        _rej("tag_mismatch")
    replay.check_and_add(sid, sig["nonce"])   # only after authentication, so forged lines can't poison the store
    return sig
