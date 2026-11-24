"""Pre-trade risk checks. Every decision is explainable (reasons list) and is
written to the audit log by the caller.

Checks, in order:
1. kill switch
2. drawdown kill (engages kill switch)
3. daily loss limit (equity vs. start-of-UTC-day equity)
4. sizing at configured risk % (clamped to [min,max], hard max 3%)
5. max open risk (sum of open initial-risk % incl. candidate)
6. correlated USD exposure: same-direction USD risk % and position count
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Mapping

import pandas as pd

from ..config import HARD_MAX_RISK_PCT, RiskConfig
from ..instruments import get_instrument
from .kill_switch import KillSwitch
from .sizing import position_size


@dataclass
class OpenRisk:
    pair: str
    side: int
    risk_amount: float  # account ccy at entry (initial risk)


@dataclass
class RiskDecision:
    approved: bool
    pair: str
    side: int
    lots: float = 0.0
    risk_pct: float = 0.0
    risk_amount: float = 0.0
    stop_pips: float = 0.0
    pip_value_per_lot: float = 0.0
    reasons: list[str] = field(default_factory=list)
    checks: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class RiskManager:
    def __init__(self, cfg: RiskConfig, account_ccy: str = "USD", kill_switch: KillSwitch | None = None,
                 drawdown_kill_enabled: bool = True) -> None:
        self.cfg = cfg
        self.drawdown_kill_enabled = drawdown_kill_enabled
        self.first_drawdown_breach: str | None = None  # recorded even when the kill is disabled (research mode)
        self.account_ccy = account_ccy
        self.kill = kill_switch or KillSwitch(None)
        self.peak_equity: float | None = None
        self._day: pd.Timestamp | None = None
        self.day_start_equity: float | None = None

    # ---- state updates -------------------------------------------------
    def on_equity(self, ts: pd.Timestamp, equity: float) -> None:
        day = ts.tz_convert("UTC").normalize() if ts.tzinfo else ts.normalize()
        if self._day is None or day != self._day:
            self._day = day
            self.day_start_equity = equity
        self.peak_equity = equity if self.peak_equity is None else max(self.peak_equity, equity)
        dd = self.drawdown_pct(equity)
        if dd >= self.cfg.kill_switch_drawdown_pct:
            if self.first_drawdown_breach is None:
                self.first_drawdown_breach = f"{ts.isoformat()} drawdown {dd:.2f}%"
            if self.drawdown_kill_enabled and not self.kill.engaged:
                self.kill.engage(f"drawdown {dd:.2f}% >= {self.cfg.kill_switch_drawdown_pct}% at {ts.isoformat()}")

    def drawdown_pct(self, equity: float) -> float:
        if not self.peak_equity:
            return 0.0
        return max(0.0, 100.0 * (1 - equity / self.peak_equity))

    def daily_loss_pct(self, equity: float) -> float:
        if not self.day_start_equity:
            return 0.0
        return max(0.0, 100.0 * (1 - equity / self.day_start_equity))

    # ---- decision ------------------------------------------------------
    def evaluate(self, pair: str, side: int, entry: float, stop: float, equity: float,
                 open_positions: list[OpenRisk], rates: Mapping[str, float], cost_pips: float = 0.0,
                 risk_pct: float | None = None) -> RiskDecision:
        c = self.cfg
        dec = RiskDecision(approved=False, pair=pair, side=side)
        if self.kill.engaged:
            dec.reasons.append(f"KILL SWITCH engaged: {self.kill.reason}")
            return dec
        dd = self.drawdown_pct(equity)
        dec.checks["drawdown_pct"] = round(dd, 4)
        if dd >= c.kill_switch_drawdown_pct and self.drawdown_kill_enabled:
            self.kill.engage(f"drawdown {dd:.2f}% >= {c.kill_switch_drawdown_pct}%")
            dec.reasons.append(f"KILL SWITCH engaged: {self.kill.reason}")
            return dec
        dl = self.daily_loss_pct(equity)
        dec.checks["daily_loss_pct"] = round(dl, 4)
        if dl >= c.daily_loss_limit_pct:
            dec.reasons.append(f"daily loss {dl:.2f}% >= limit {c.daily_loss_limit_pct}%")
            return dec
        if side not in (1, -1):
            dec.reasons.append("invalid side")
            return dec
        if (side > 0 and stop >= entry) or (side < 0 and stop <= entry):
            dec.reasons.append("stop on wrong side of entry")
            return dec
        if any(p.pair == pair for p in open_positions):
            dec.reasons.append(f"already have an open position in {pair}")
            return dec

        rp = c.risk_per_trade_pct if risk_pct is None else risk_pct
        rp = min(max(rp, c.min_risk_pct), c.max_risk_pct, HARD_MAX_RISK_PCT)
        sz = position_size(pair, equity, rp, entry, stop, self.account_ccy, rates, max_lot=c.max_lot,
                           cost_pips=cost_pips)
        dec.stop_pips, dec.pip_value_per_lot = sz.stop_pips, sz.pip_value_per_lot
        if sz.rejected_reason:
            dec.reasons.append(sz.rejected_reason)
            return dec
        cand_pct = 100.0 * sz.risk_amount_actual / equity

        open_pct = sum(100.0 * p.risk_amount / equity for p in open_positions)
        dec.checks["open_risk_pct_after"] = round(open_pct + cand_pct, 4)
        if open_pct + cand_pct > c.max_open_risk_pct + 1e-9:
            dec.reasons.append(f"open risk {open_pct + cand_pct:.2f}% > max {c.max_open_risk_pct}%")
            return dec

        usd_dir = get_instrument(pair).usd_direction(side)
        if usd_dir != 0:
            same = [p for p in open_positions if get_instrument(p.pair).usd_direction(p.side) == usd_dir]
            same_pct = sum(100.0 * p.risk_amount / equity for p in same) + cand_pct
            dec.checks["usd_direction"] = "long USD" if usd_dir > 0 else "short USD"
            dec.checks["same_usd_dir_positions_after"] = len(same) + 1
            dec.checks["same_usd_dir_risk_pct_after"] = round(same_pct, 4)
            if len(same) + 1 > c.max_positions_per_usd_direction:
                dec.reasons.append(f"{len(same) + 1} positions {dec.checks['usd_direction']} > max "
                                   f"{c.max_positions_per_usd_direction}")
                return dec
            if same_pct > c.max_correlated_risk_pct + 1e-9:
                dec.reasons.append(f"correlated USD risk {same_pct:.2f}% > max {c.max_correlated_risk_pct}%")
                return dec

        dec.approved = True
        dec.lots = sz.lots
        dec.risk_amount = sz.risk_amount_actual
        dec.risk_pct = cand_pct
        dec.reasons.append(f"approved {sz.lots} lots, risk {cand_pct:.2f}% ({sz.stop_pips:.1f} pip stop"
                           f"{f' + {cost_pips:.1f} cost' if cost_pips else ''})")
        return dec
