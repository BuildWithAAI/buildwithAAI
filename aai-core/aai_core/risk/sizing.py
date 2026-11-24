"""Fixed-fractional position sizing: risk a fixed % of bankroll between entry and stop.

  risk_amount = bankroll * risk_pct / 100
  qty         = risk_amount / |entry - stop|          (in base units / shares / FX base currency)
  notional    = qty * entry  (quote currency)       leverage = notional / bankroll

quote_to_account converts the instrument's quote currency into the account currency (bankroll units):
e.g. USDJPY with a USD account -> 1/price; EURUSD -> 1; EURGBP -> GBPUSD rate. Default 1.0
(USDT perps and USD equities with a USD account).

Policy for every AAI agent: 1-3% risk per position. Requests above MAX_RISK_PCT are clamped (never raised).
"""
from __future__ import annotations
import math

MIN_RISK_PCT, MAX_RISK_PCT, DEFAULT_RISK_PCT = 1.0, 3.0, 1.0


class SizingError(ValueError):
    pass


def validate_stop(side: str, entry: float, stop: float) -> None:
    if side not in ("long", "short"):
        raise SizingError(f"side must be long|short, got {side!r}")
    if not (entry > 0 and stop > 0):
        raise SizingError("entry and stop must be > 0")
    if side == "long" and stop >= entry:
        raise SizingError(f"long stop {stop} must be below entry {entry}")
    if side == "short" and stop <= entry:
        raise SizingError(f"short stop {stop} must be above entry {entry}")


def clamp_risk_pct(risk_pct: float | None) -> tuple[float, list[str]]:
    notes = []
    r = DEFAULT_RISK_PCT if risk_pct is None else float(risk_pct)
    if r > MAX_RISK_PCT:
        notes.append(f"risk_pct {r} clamped to policy max {MAX_RISK_PCT}")
        r = MAX_RISK_PCT
    if r <= 0:
        raise SizingError("risk_pct must be > 0")
    if r < MIN_RISK_PCT:
        notes.append(f"risk_pct {r} is below the usual 1-3% band (allowed)")
    return r, notes


def floor_step(x: float, step: float | None) -> float:
    if not step:
        return x
    return math.floor(x / step + 1e-9) * step


def position_size(bankroll: float, risk_pct: float, entry: float, stop: float, side: str,
                  qty_step: float | None = None, max_leverage: float | None = None,
                  max_notional: float | None = None, quote_to_account: float = 1.0) -> dict:
    """Return the sizing dict used in risk_decision.suggested_size. Caps only ever shrink the size."""
    if bankroll <= 0:
        raise SizingError("bankroll must be > 0")
    validate_stop(side, entry, stop)
    if not quote_to_account or quote_to_account <= 0:
        raise SizingError("quote_to_account must be > 0")
    fx = quote_to_account
    risk_amount = bankroll * risk_pct / 100.0
    dist = abs(entry - stop)
    qty = risk_amount / (dist * fx)
    capped = []
    if max_leverage is not None and qty * entry * fx > bankroll * max_leverage:
        qty, _ = bankroll * max_leverage / (entry * fx), capped.append(f"max_leverage {max_leverage}x")
    if max_notional is not None and qty * entry * fx > max_notional:
        qty, _ = max_notional / (entry * fx), capped.append(f"max_notional {round(max_notional, 2)}")
    q2 = floor_step(qty, qty_step)
    if q2 != qty:
        capped.append(f"qty_step {qty_step}")
    qty = q2
    return {
        "risk_pct": round(qty * dist * fx / bankroll * 100, 6),
        "risk_pct_target": risk_pct,
        "risk_amount": round(qty * dist * fx, 6),
        "entry": entry, "stop": stop, "side": side,
        "stop_distance": dist, "stop_distance_pct": round(dist / entry * 100, 6),
        "qty": qty, "notional": round(qty * entry * fx, 6),
        "leverage": round(qty * entry * fx / bankroll, 6),
        "bankroll": bankroll, "capped_by": capped,
    }
