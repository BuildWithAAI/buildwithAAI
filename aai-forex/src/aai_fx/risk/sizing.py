"""Fixed-fractional position sizing from stop distance."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any, Mapping

from ..instruments import Instrument, get_instrument
from .pip import pip_value_per_lot


@dataclass
class SizingResult:
    lots: float
    risk_amount_target: float  # equity * risk_pct
    risk_amount_actual: float  # after lot rounding (incl. est. costs if given)
    stop_pips: float
    pip_value_per_lot: float
    risk_pct_actual: float
    rejected_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def position_size(pair: str | Instrument, equity: float, risk_pct: float, entry: float, stop: float,
                  account_ccy: str, rates: Mapping[str, float], max_lot: float | None = None,
                  cost_pips: float = 0.0) -> SizingResult:
    """Lots such that a stop-out loses <= equity*risk_pct/100 (in account ccy).

    ``cost_pips`` (spread+slippage expected on the round trip) is added to the
    stop distance so the *realised* loss on a stop-out stays within budget.
    Lots are rounded DOWN to the lot step; if that gives < min lot the trade
    is rejected rather than over-risked.
    """
    inst = pair if isinstance(pair, Instrument) else get_instrument(pair)
    if equity <= 0:
        raise ValueError("equity must be positive")
    if not (0 < risk_pct <= 100):
        raise ValueError("risk_pct must be in (0, 100]")
    stop_pips = abs(entry - stop) / inst.pip_size
    if stop_pips <= 0:
        raise ValueError("stop distance must be > 0")
    pv = pip_value_per_lot(inst, account_ccy, rates)
    budget = equity * risk_pct / 100.0
    eff_pips = stop_pips + max(cost_pips, 0.0)
    raw = budget / (eff_pips * pv)
    cap = min(inst.max_lot, max_lot) if max_lot else inst.max_lot
    raw = min(raw, cap)
    steps = math.floor(raw / inst.lot_step + 1e-9)
    lots = round(steps * inst.lot_step, 8)
    reason = None
    if lots < inst.min_lot:
        reason = f"size {raw:.4f} lots < min lot {inst.min_lot} (stop {stop_pips:.1f} pips too wide for budget)"
        lots = 0.0
    actual = lots * eff_pips * pv
    return SizingResult(lots=lots, risk_amount_target=budget, risk_amount_actual=actual, stop_pips=stop_pips,
                        pip_value_per_lot=pv, risk_pct_actual=100.0 * actual / equity, rejected_reason=reason)
