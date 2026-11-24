"""Risk engine: per-trade sizing, total open-risk cap, correlation haircut, notional caps,
daily-loss kill switch. Hard caps (3% per trade / 3% total) are enforced here regardless of config."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

import pandas as pd

from ..config import HARD_MAX_TOTAL_RISK_PCT, HARD_MAX_TRADE_RISK_PCT, RiskCfg

MIN_RISK_PCT = 0.25  # below this the remaining budget is not worth a trade


@dataclass
class OpenRisk:
    asset: str
    side: str
    risk_usd: float  # current $ at risk to stop (0 once stop is at breakeven)
    notional_usd: float


@dataclass
class RiskDecision:
    approved: bool
    qty: float = 0.0
    risk_pct: float = 0.0
    risk_usd: float = 0.0
    notional_usd: float = 0.0
    tier: str = ""
    reason: str = ""
    notes: tuple[str, ...] = ()


def rolling_corr(d1_closes: dict[str, pd.Series], asof: datetime, lookback_days: int) -> pd.DataFrame:
    """Correlation of daily returns using ONLY daily candles closed before `asof`."""
    frames = {}
    for a, s in d1_closes.items():
        closed = s[s.index + pd.Timedelta(days=1) <= asof].tail(lookback_days + 1)
        frames[a] = closed.pct_change().dropna()
    df = pd.DataFrame(frames).dropna()
    if len(df) < 10:
        return pd.DataFrame()
    return df.corr()


class RiskEngine:
    def __init__(self, cfg: RiskCfg):
        self.cfg = cfg
        self.max_trade = min(cfg.max_trade_risk_pct, HARD_MAX_TRADE_RISK_PCT)
        self.max_total = min(cfg.max_total_risk_pct, HARD_MAX_TOTAL_RISK_PCT)
        self._day: date | None = None
        self._day_start_equity = 0.0
        self.killed_days: set[date] = set()

    # ---- kill switch -------------------------------------------------------------------------
    def on_equity(self, ts: datetime, equity: float) -> None:
        d = ts.date()
        if d != self._day:
            self._day, self._day_start_equity = d, equity
        elif self._day_start_equity > 0:
            dd = (self._day_start_equity - equity) / self._day_start_equity * 100
            if dd >= self.cfg.daily_loss_limit_pct:
                self.killed_days.add(d)

    def kill_switch_active(self, ts: datetime) -> bool:
        return ts.date() in self.killed_days

    # ---- sizing ------------------------------------------------------------------------------
    def size(self, *, ts: datetime, equity: float, asset: str, side: str, entry: float, stop: float,
             confirmed: bool, open_positions: list[OpenRisk], corr: pd.DataFrame | None = None) -> RiskDecision:
        if equity <= 0:
            return RiskDecision(False, reason="no_equity")
        if self.kill_switch_active(ts):
            return RiskDecision(False, reason="daily_loss_kill_switch")
        if sum(1 for p in open_positions if p.asset == asset) >= self.cfg.max_positions_per_asset:
            return RiskDecision(False, reason="asset_position_limit")
        per_unit = abs(entry - stop)
        if per_unit <= 0 or (side == "long" and stop >= entry) or (side == "short" and stop <= entry):
            return RiskDecision(False, reason="invalid_stop")

        notes: list[str] = []
        tier = "confirmed" if confirmed else "base"
        risk_pct = min(self.cfg.confirmed_risk_pct if confirmed else self.cfg.base_risk_pct, self.max_trade)

        if corr is not None and not corr.empty and asset in corr.index:
            for p in open_positions:
                if p.side == side and p.asset != asset and p.asset in corr.columns \
                        and corr.loc[asset, p.asset] >= self.cfg.corr_threshold:
                    risk_pct *= self.cfg.correlated_size_mult
                    notes.append(f"corr_haircut_vs_{p.asset}")
                    break
        if ts.weekday() >= 5 and self.cfg.weekend_size_mult < 1:
            risk_pct *= self.cfg.weekend_size_mult
            notes.append("weekend_haircut")

        open_pct = sum(p.risk_usd for p in open_positions) / equity * 100
        budget = self.max_total - open_pct
        if budget < MIN_RISK_PCT:
            return RiskDecision(False, reason="total_risk_cap", tier=tier)
        if risk_pct > budget:
            risk_pct = budget
            notes.append("clipped_to_total_risk_cap")

        risk_usd = equity * risk_pct / 100
        qty = risk_usd / per_unit
        notional = qty * entry
        max_notional = equity * self.cfg.max_notional_per_trade_pct / 100
        gross_left = equity * self.cfg.max_gross_notional_pct / 100 - sum(p.notional_usd for p in open_positions)
        cap = min(max_notional, gross_left)
        if cap <= 0:
            return RiskDecision(False, reason="gross_notional_cap", tier=tier)
        if notional > cap:
            qty = cap / entry
            notional = cap
            risk_usd = qty * per_unit
            risk_pct = risk_usd / equity * 100
            notes.append("clipped_to_notional_cap")
        if risk_pct < MIN_RISK_PCT / 2:
            return RiskDecision(False, reason="size_too_small", tier=tier)
        assert risk_pct <= HARD_MAX_TRADE_RISK_PCT + 1e-9
        assert open_pct + risk_pct <= HARD_MAX_TOTAL_RISK_PCT + 1e-9
        return RiskDecision(True, qty=qty, risk_pct=risk_pct, risk_usd=risk_usd, notional_usd=notional,
                            tier=tier, notes=tuple(notes))
