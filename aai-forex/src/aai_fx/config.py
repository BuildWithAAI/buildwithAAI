"""Typed configuration loaded from YAML (pydantic v2)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

from .instruments import normalize_symbol

HARD_MAX_RISK_PCT = 3.0  # user mandate: never size above 3% per trade


class AccountConfig(BaseModel):
    currency: str = "USD"
    starting_equity: float = Field(10_000.0, gt=0)


class RiskConfig(BaseModel):
    risk_per_trade_pct: float = Field(1.0, gt=0)
    min_risk_pct: float = Field(1.0, gt=0)
    max_risk_pct: float = Field(3.0, gt=0)
    max_open_risk_pct: float = Field(6.0, gt=0)
    daily_loss_limit_pct: float = Field(4.0, gt=0)
    max_correlated_risk_pct: float = Field(4.0, gt=0)
    max_positions_per_usd_direction: int = Field(3, ge=1)
    kill_switch_drawdown_pct: float = Field(20.0, gt=0)
    kill_switch_file: str = "state/KILL_SWITCH"
    kill_switch_flatten: bool = True  # on engage, close all open positions at the next open
    max_lot: float = Field(50.0, gt=0)

    @model_validator(mode="after")
    def _bounds(self) -> "RiskConfig":
        if self.max_risk_pct > HARD_MAX_RISK_PCT:
            raise ValueError(f"max_risk_pct {self.max_risk_pct} exceeds hard cap {HARD_MAX_RISK_PCT}%")
        if not (self.min_risk_pct <= self.risk_per_trade_pct <= self.max_risk_pct):
            raise ValueError(
                f"risk_per_trade_pct {self.risk_per_trade_pct} outside [{self.min_risk_pct}, {self.max_risk_pct}]"
            )
        return self


class PairCost(BaseModel):
    spread_pips: float = Field(1.0, ge=0)
    slippage_pips: float = Field(0.2, ge=0)
    stop_slippage_pips: float = Field(0.5, ge=0)
    commission_per_lot_side: float | None = Field(None, ge=0)  # None -> CostConfig default
    # Overnight financing as % p.a. of position notional (negative = you pay).
    # Charged once per UTC calendar day crossed (weekends included -> triple
    # swap is implicitly covered). ASSUMPTION unless copied from MT5 symbol_info.
    swap_long_pct_pa: float = 0.0
    swap_short_pct_pa: float = 0.0


class InstrumentSpec(BaseModel):
    """Per-broker overrides of instruments.Instrument (confirm from MT5 symbol_info)."""
    contract_size: float | None = Field(None, gt=0)
    pip_size: float | None = Field(None, gt=0)
    lot_step: float | None = Field(None, gt=0)
    min_lot: float | None = Field(None, gt=0)
    max_lot: float | None = Field(None, gt=0)
    broker_symbol: str | None = None


class CostConfig(BaseModel):
    commission_per_lot_side: float = Field(3.5, ge=0)  # account currency
    default: PairCost = PairCost()
    per_pair: dict[str, PairCost] = Field(default_factory=dict)

    @field_validator("per_pair")
    @classmethod
    def _norm(cls, v: dict[str, PairCost]) -> dict[str, PairCost]:
        return {normalize_symbol(k): c for k, c in v.items()}

    def for_pair(self, pair: str) -> PairCost:
        return self.per_pair.get(normalize_symbol(pair), self.default)

    def commission_for(self, pair: str) -> float:
        c = self.for_pair(pair).commission_per_lot_side
        return self.commission_per_lot_side if c is None else c


class HistorySpec(BaseModel):
    start: str | None = None  # ISO date
    lookback_days: int | None = None


class DataConfig(BaseModel):
    provider: Literal["yfinance", "mt5", "csv", "dukascopy"] = "yfinance"
    store_dir: str = "data"
    history: dict[str, HistorySpec] = Field(default_factory=dict)


class StrategyConfig(BaseModel):
    impl: str | None = None  # registry name; defaults to the config key
    enabled: bool = True
    scan: bool = True
    timeframe: str
    params: dict[str, Any] = Field(default_factory=dict)


class WalkForwardConfig(BaseModel):
    train_bars: int = 750
    test_bars: int = 250
    grid: dict[str, list[Any]] = Field(default_factory=dict)
    objective: Literal["sharpe", "expectancy_r", "profit_factor"] = "sharpe"


class BacktestConfig(BaseModel):
    oos_fraction: float = Field(0.3, gt=0, lt=1)
    walkforward: dict[str, WalkForwardConfig] = Field(default_factory=dict)


class ReportingConfig(BaseModel):
    out_dir: str = "reports"
    audit_path: str = "audit/audit.jsonl"
    runs_dir: str = "runs"


class ExecutionConfig(BaseModel):
    mode: Literal["paper"] = "paper"  # live mode intentionally not representable in config
    paper_state_dir: str = "state/paper"


class AppConfig(BaseModel):
    account: AccountConfig = AccountConfig()
    pairs: list[str] = Field(default_factory=lambda: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"])
    risk: RiskConfig = RiskConfig()
    instruments: dict[str, InstrumentSpec] = Field(default_factory=dict)
    costs: CostConfig = CostConfig()
    data: DataConfig = DataConfig()
    strategies: dict[str, StrategyConfig] = Field(default_factory=dict)
    backtest: BacktestConfig = BacktestConfig()
    reporting: ReportingConfig = ReportingConfig()
    execution: ExecutionConfig = ExecutionConfig()

    @field_validator("pairs")
    @classmethod
    def _pairs(cls, v: list[str]) -> list[str]:
        return [normalize_symbol(p) for p in v]

    def apply_instruments(self) -> None:
        from .instruments import register_instrument
        for sym, spec in self.instruments.items():
            register_instrument(sym, **{k: v for k, v in spec.model_dump().items() if v is not None})

    def fingerprint(self) -> str:
        blob = json.dumps(self.model_dump(mode="json"), sort_keys=True).encode()
        return hashlib.sha256(blob).hexdigest()[:16]


def load_config(path: str | Path) -> AppConfig:
    with open(path, "r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    cfg = AppConfig.model_validate(raw)
    cfg.apply_instruments()
    return cfg
