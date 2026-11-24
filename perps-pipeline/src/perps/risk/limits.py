"""Portfolio-level risk gates: daily loss limit, concurrency, drawdown kill switch, manual kill switch."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from ..config import RiskCfg

GLOBAL_KILL_FILE = Path("/workspace/agent-guard/state/KILL_SWITCH")  # agent-guard box-wide kill switch


def _global_kill() -> bool:
    import os
    return Path(os.environ.get("AGENT_GUARD_KILL_FILE") or GLOBAL_KILL_FILE).exists()


@dataclass
class RiskState:
    peak_equity: float
    day: str = ""
    day_start_equity: float = 0.0
    killed: bool = False
    kill_reason: str = ""
    rejections: dict[str, int] = field(default_factory=dict)


class RiskManager:
    def __init__(self, cfg: RiskCfg, initial_equity: float, kill_file: Path | None = None) -> None:
        self.cfg = cfg
        self.kill_file = kill_file
        self.state = RiskState(peak_equity=initial_equity, day_start_equity=initial_equity)

    @property
    def risk_fraction(self) -> float:
        return self.cfg.risk_per_trade

    def on_equity(self, ts: pd.Timestamp, equity: float) -> None:
        day = ts.strftime("%Y-%m-%d")
        if day != self.state.day:
            self.state.day = day
            self.state.day_start_equity = equity
        self.state.peak_equity = max(self.state.peak_equity, equity)
        dd = 1 - equity / self.state.peak_equity if self.state.peak_equity > 0 else 1.0
        if not self.state.killed and dd >= self.cfg.max_drawdown_kill:
            self.state.killed = True
            self.state.kill_reason = f"max drawdown {dd:.1%} >= {self.cfg.max_drawdown_kill:.0%} at {ts}"

    def daily_loss_hit(self, equity: float) -> bool:
        if self.state.day_start_equity <= 0:
            return True
        return (equity / self.state.day_start_equity - 1) <= -self.cfg.daily_loss_limit

    def manual_kill(self) -> bool:
        # agent-guard: the global flag applies wherever an on-disk kill file is honoured (paper/live), not backtests
        return self.cfg.kill_switch or (self.kill_file is not None and (self.kill_file.exists() or _global_kill()))

    def can_open(self, equity: float, open_positions: int, symbol_open: bool = False) -> tuple[bool, str]:
        reason = ""
        if self.manual_kill():
            reason = "manual kill switch"
        elif self.state.killed:
            reason = "drawdown kill switch"
        elif equity <= 0:
            reason = "no equity"
        elif self.daily_loss_hit(equity):
            reason = "daily loss limit"
        elif open_positions >= self.cfg.max_concurrent_positions:
            reason = "max concurrent positions"
        elif symbol_open:
            reason = "position already open on symbol"
        if reason:
            self.state.rejections[reason] = self.state.rejections.get(reason, 0) + 1
            return False, reason
        return True, "ok"
