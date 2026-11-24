"""Report schema for AAI Terminal (versioned). Export with `aai-fx schema`."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION: Literal["aai-fx/report/v1"] = "aai-fx/report/v1"


class Metrics(BaseModel):
    model_config = ConfigDict(extra="allow")
    trade_count: int
    cagr_pct: float | None = None
    sharpe: float | None = None
    sortino: float | None = None
    max_drawdown_pct: float | None = None
    win_rate_pct: float | None = None
    profit_factor: float | None = None
    expectancy_r: float | None = None
    total_return_pct: float | None = None
    starting_equity: float | None = None
    ending_equity: float | None = None


class DataProvenance(BaseModel):
    provider: str
    timeframe: str
    pairs: list[str]
    first_bar: str | None
    last_bar: str | None
    bars_per_pair: dict[str, int]
    validation: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)


class SplitResult(BaseModel):
    split_ts: str
    in_sample: Metrics
    out_of_sample: Metrics


class WalkForwardSummary(BaseModel):
    train_bars: int
    test_bars: int
    grid_size: int
    objective: str
    windows: list[dict[str, Any]]
    oos_metrics: Metrics
    notes: list[str] = Field(default_factory=list)


class StrategyResult(BaseModel):
    run_id: str
    strategy: str
    timeframe: str
    params: dict[str, Any]
    period_start: str | None
    period_end: str | None
    metrics: Metrics
    per_pair: dict[str, dict[str, Any]]
    signals: int
    approved_entries: int
    rejections: dict[str, int]
    kill_switch: str | None
    drawdown_kill_enforced: bool = True
    first_drawdown_breach: str | None = None
    spread_slippage_cost: float
    is_oos: SplitResult | None = None
    walk_forward: WalkForwardSummary | None = None
    data: DataProvenance | None = None
    artifacts: dict[str, str] = Field(default_factory=dict)


class ScanSignal(BaseModel):
    pair: str
    strategy: str
    timeframe: str
    action: str
    bar_close_ts: str
    ref_price: float
    stop: float | None
    target: float | None
    reason: str
    risk: dict[str, Any] | None = None
    paper_order_id: str | None = None


class ScanResult(BaseModel):
    generated_at: str
    strategies: list[dict[str, Any]]
    signals: list[ScanSignal]
    market_state: list[dict[str, Any]]
    paper_positions: list[dict[str, Any]]
    kill_switch_engaged: bool
    notes: list[str] = Field(default_factory=list)


class AuditInfo(BaseModel):
    path: str
    records: int
    chain_ok: bool
    message: str = ""


class AAIReport(BaseModel):
    schema_version: Literal["aai-fx/report/v1"] = SCHEMA_VERSION
    report_id: str
    generated_at: str
    kind: Literal["backtest", "scan", "combined"]
    producer: dict[str, str]
    config_fingerprint: str
    mode: Literal["paper"] = "paper"
    live_trading: Literal[False] = False
    account: dict[str, Any]
    risk_limits: dict[str, Any]
    backtests: list[StrategyResult] = Field(default_factory=list)
    scan: ScanResult | None = None
    audit: list[AuditInfo] = Field(default_factory=list)
    disclaimers: list[str] = Field(default_factory=list)


DISCLAIMERS = [
    "PAPER/SIMULATED ONLY. No live orders were placed.",
    "Backtest results are historical simulations on free indicative mid-price data, not broker bid/ask; "
    "they are not evidence of future profitability.",
    "Reference strategies are research scaffolding; no claim of edge or profitability is made.",
    "Spreads, commissions and slippage are modeled with fixed per-pair assumptions; real costs vary by broker, "
    "session and news.",
]
