"""Arena configuration (config/arena.yaml)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, model_validator

from ..config import ROOT

ARM_KINDS = ("range_breakout", "ema_pullback", "vol_squeeze", "funding_fade", "oi_divergence", "maker_scalp")
RISK_CAP = 0.03          # absolute ceiling for any arm, any version
LEVERAGE_CAP = 10.0


class ArenaLimits(BaseModel):
    risk_per_trade: float = 0.015
    min_risk: float = 0.01
    max_risk: float = 0.03
    max_leverage: float = 10.0
    margin_leverage: float = 10.0
    maintenance_margin_rate: float = 0.005
    liquidation_buffer: float = 0.25
    max_concurrent: int = 2
    one_per_symbol: bool = True
    daily_loss_limit: float = 0.05
    max_drawdown_kill: float = 0.30
    max_signal_age_min: float = 10.0

    @model_validator(mode="after")
    def _caps(self) -> ArenaLimits:
        if self.max_risk > RISK_CAP:
            raise ValueError(f"max_risk {self.max_risk} exceeds the hard cap {RISK_CAP}")
        if not self.min_risk <= self.risk_per_trade <= self.max_risk:
            raise ValueError(f"risk_per_trade {self.risk_per_trade} outside [{self.min_risk}, {self.max_risk}]")
        if self.max_leverage > LEVERAGE_CAP or self.margin_leverage > LEVERAGE_CAP:
            raise ValueError(f"leverage above {LEVERAGE_CAP}x is not allowed")
        if self.max_concurrent < 1:
            raise ValueError("max_concurrent must be >= 1")
        return self


class LearningCfg(BaseModel):
    min_trades: int = 20
    min_trades_between_changes: int = 20
    cut_risk_after: int = 30
    cut_risk_er: float = -0.3
    bench_after: int = 40
    bench_er: float = -0.5


class ArmCfg(BaseModel):
    kind: str
    timeframe: str
    params: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True
    symbols: list[str] | None = None
    limits: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _kind(self) -> ArmCfg:
        if self.kind not in ARM_KINDS:
            raise ValueError(f"unknown arm kind {self.kind!r}; expected one of {ARM_KINDS}")
        return self


class ArenaCfg(BaseModel):
    exchange: str = "blofin"
    symbols: list[str] = Field(default_factory=lambda: ["BTC-USDT", "ETH-USDT", "SOL-USDT"])
    initial_equity: float = 100.0
    limits: ArenaLimits = ArenaLimits()
    learning: LearningCfg = LearningCfg()
    arms: dict[str, ArmCfg] = Field(default_factory=dict)

    def arm_limits(self, arm: str) -> ArenaLimits:
        over = self.arms[arm].limits if arm in self.arms else {}
        return ArenaLimits.model_validate({**self.limits.model_dump(), **over})

    def arm_symbols(self, arm: str) -> list[str]:
        return self.arms[arm].symbols or self.symbols


def load_arena_config(path: str | Path | None = None) -> ArenaCfg:
    p = Path(path) if path else ROOT / "config" / "arena.yaml"
    raw = yaml.safe_load(p.read_text()) if p.exists() else {}
    return ArenaCfg.model_validate(raw or {})
