"""Typed configuration loaded from YAML (config/default.yaml + config/strategies.yaml)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, model_validator

ROOT = Path(__file__).resolve().parents[2]


class ProjectCfg(BaseModel):
    data_dir: Path = Path("data")
    reports_dir: Path = Path("reports")
    state_dir: Path = Path("state")


class ExchangeCfg(BaseModel):
    default: Literal["blofin", "bybit"] = "blofin"


class UniverseCfg(BaseModel):
    base: list[str] = Field(default_factory=lambda: ["BTC-USDT", "ETH-USDT", "SOL-USDT"])
    top_volume_extra: int = 0
    min_24h_quote_volume: float = 50_000_000


class CapitalCfg(BaseModel):
    initial_equity: float = 100.0


class FeeRates(BaseModel):
    maker: float = 0.0002
    taker: float = 0.0006


class SlippageCfg(BaseModel):
    market_bps: float = 2.0
    stop_bps: float = 3.0
    atr_frac: float = 0.0


class RiskCfg(BaseModel):
    risk_per_trade: float = 0.015
    hard_cap: float = 0.03
    allow_above_hard_cap: bool = False
    absolute_max: float = 0.12
    min_risk_per_trade: float = 0.01
    daily_loss_limit: float = 0.05
    max_concurrent_positions: int = 3
    max_leverage: float = 10.0
    margin_leverage: float = 10.0
    maintenance_margin_rate: float = 0.005
    liquidation_buffer: float = 0.25
    max_drawdown_kill: float = 0.30
    kill_switch: bool = False
    kill_switch_file: Path | None = Path("state/KILL")

    @model_validator(mode="after")
    def _validate(self) -> RiskCfg:
        if self.absolute_max > 0.12:
            raise ValueError("absolute_max cannot exceed 0.12 (12%)")
        if not 0 < self.risk_per_trade <= self.absolute_max:
            raise ValueError(f"risk_per_trade must be in (0, {self.absolute_max}]")
        if self.risk_per_trade > self.hard_cap and not self.allow_above_hard_cap:
            raise ValueError(
                f"risk_per_trade {self.risk_per_trade:.4f} exceeds hard_cap {self.hard_cap:.4f}; "
                "set allow_above_hard_cap: true to override explicitly"
            )
        if self.max_leverage <= 0 or self.margin_leverage <= 0:
            raise ValueError("leverage settings must be positive")
        if self.max_concurrent_positions < 1:
            raise ValueError("max_concurrent_positions must be >= 1")
        return self


class ExecutionCfg(BaseModel):
    enabled: bool = False

    @model_validator(mode="after")
    def _phase1(self) -> ExecutionCfg:
        if self.enabled:
            raise ValueError(
                "execution.enabled=true is not supported in Phase 1: no execution layer exists. "
                "Live trading requires a separately reviewed Phase 2 module and explicit opt-in."
            )
        return self


class BacktestCfg(BaseModel):
    is_fraction: float = 0.7
    walk_forward_folds: int = 4
    take_profit_fee: Literal["maker", "taker"] = "taker"
    same_bar_policy: Literal["stop_first"] = "stop_first"
    research_ignore_drawdown_kill: bool = True


class BackfillCfg(BaseModel):
    days: dict[str, int] = Field(default_factory=lambda: {"1H": 365, "4H": 365, "15m": 180, "5m": 120})
    include_1m_days: int = 0


class PaperStrategyRef(BaseModel):
    name: str
    timeframe: str


class PaperCfg(BaseModel):
    strategies: list[PaperStrategyRef] = Field(default_factory=list)
    max_signal_age_bars: int = 1


class Settings(BaseModel):
    project: ProjectCfg = ProjectCfg()
    exchange: ExchangeCfg = ExchangeCfg()
    universe: UniverseCfg = UniverseCfg()
    capital: CapitalCfg = CapitalCfg()
    fees: dict[str, FeeRates] = Field(default_factory=lambda: {"blofin": FeeRates(), "bybit": FeeRates(taker=0.00055)})
    slippage: SlippageCfg = SlippageCfg()
    risk: RiskCfg = RiskCfg()
    execution: ExecutionCfg = ExecutionCfg()
    backtest: BacktestCfg = BacktestCfg()
    backfill: BackfillCfg = BackfillCfg()
    paper: PaperCfg = PaperCfg()
    strategies: dict[str, dict[str, Any]] = Field(default_factory=dict)

    def path(self, p: Path) -> Path:
        return p if p.is_absolute() else ROOT / p

    @property
    def data_dir(self) -> Path:
        return self.path(self.project.data_dir)

    @property
    def reports_dir(self) -> Path:
        return self.path(self.project.reports_dir)

    @property
    def state_dir(self) -> Path:
        return self.path(self.project.state_dir)

    def fee_rates(self, exchange: str | None = None) -> FeeRates:
        return self.fees.get(exchange or self.exchange.default, FeeRates())


def load_settings(config_path: str | Path | None = None, strategies_path: str | Path | None = None) -> Settings:
    cfg_file = Path(config_path) if config_path else ROOT / "config" / "default.yaml"
    strat_file = Path(strategies_path) if strategies_path else ROOT / "config" / "strategies.yaml"
    raw: dict[str, Any] = yaml.safe_load(cfg_file.read_text()) if cfg_file.exists() else {}
    if strat_file.exists():
        raw["strategies"] = yaml.safe_load(strat_file.read_text()) or {}
    return Settings.model_validate(raw or {})
