"""Typed configuration (YAML -> pydantic). Risk hard caps are enforced here."""
from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

HARD_MAX_TRADE_RISK_PCT = 3.0
HARD_MAX_TOTAL_RISK_PCT = 3.0
LIVE_CONFIRMATION_PHRASE = "I_UNDERSTAND_THIS_IS_REAL_MONEY"


class PathsCfg(BaseModel):
    root: Path = Path(".")
    seed_posts: list[Path] = Field(default_factory=lambda: [Path("/workspace/billy/raw_posts.jsonl")])
    inbox_dir: Path = Path("data/inbox")
    posts_store: Path = Path("data/posts.jsonl")
    signals_store: Path = Path("data/signals.jsonl")
    state_file: Path = Path("data/state.json")
    cache_db: Path = Path("data/cache/market.sqlite")
    events_file: Path = Path("config/events.yaml")
    reports_dir: Path = Path("reports")
    paper_ledger: Path = Path("data/paper/ledger.jsonl")

    def resolve(self) -> "PathsCfg":
        r = self.root.resolve()

        def fix(p: Path) -> Path:
            return p if p.is_absolute() else (r / p)

        return PathsCfg(
            root=r,
            seed_posts=[fix(p) for p in self.seed_posts],
            inbox_dir=fix(self.inbox_dir),
            posts_store=fix(self.posts_store),
            signals_store=fix(self.signals_store),
            state_file=fix(self.state_file),
            cache_db=fix(self.cache_db),
            events_file=fix(self.events_file),
            reports_dir=fix(self.reports_dir),
            paper_ledger=fix(self.paper_ledger),
        )


class MarketCfg(BaseModel):
    base_url: str = "https://data-api.binance.vision"
    quote: str = "USDT"
    intervals: list[Literal["1h", "4h", "1d"]] = ["1h", "4h", "1d"]
    history_start: str = "2023-06-01"
    request_pause_s: float = 0.15
    timeout_s: float = 20.0


class StrategyCfg(BaseModel):
    rules: list[Literal["breakout", "retest"]] = ["breakout", "retest"]
    scenario_strength: Literal["explicit", "directional"] = "directional"
    n_hold: int = Field(2, ge=1, le=12)
    retest_tol_pct: float = Field(0.3, ge=0, le=5)
    stop_mode: Literal["structural", "close_back"] = "structural"
    stop_atr_mult: float = Field(0.5, ge=0, le=5)
    atr_period: int = 14
    min_rr: float = Field(1.0, ge=0)
    fallback_target_r: float = Field(2.0, gt=0)
    max_chase_pct: float = Field(1.0, ge=0)
    max_level_distance_pct: float = Field(15.0, gt=0)
    signal_ttl_hours: int = Field(24, ge=1)
    time_stop_hours: int = Field(72, ge=1)
    skip_indecisive: bool = False
    require_bias_alignment: bool = True
    btc_filter: bool = True
    skip_on_position_mismatch: bool = False
    position_mismatch_tol_pct: float = 1.0
    event_blackout_before_h: float = 2.0
    event_blackout_after_h: float = 2.0
    partial_at_r: float = 1.0
    partial_fraction: float = Field(0.5, ge=0, le=1)
    breakeven_after_partial: bool = True


class RiskCfg(BaseModel):
    base_risk_pct: float = 1.0
    confirmed_risk_pct: float = 2.0
    max_trade_risk_pct: float = 3.0
    max_total_risk_pct: float = 3.0
    daily_loss_limit_pct: float = 3.0
    max_positions_per_asset: int = 1
    max_notional_per_trade_pct: float = 100.0
    max_gross_notional_pct: float = 200.0
    corr_lookback_days: int = 30
    corr_threshold: float = 0.7
    correlated_size_mult: float = Field(0.5, gt=0, le=1)
    weekend_size_mult: float = Field(1.0, gt=0, le=1)

    @model_validator(mode="after")
    def _caps(self) -> "RiskCfg":
        if self.max_trade_risk_pct > HARD_MAX_TRADE_RISK_PCT:
            raise ValueError(f"max_trade_risk_pct may not exceed the hard cap {HARD_MAX_TRADE_RISK_PCT}%")
        if self.max_total_risk_pct > HARD_MAX_TOTAL_RISK_PCT:
            raise ValueError(f"max_total_risk_pct may not exceed the hard cap {HARD_MAX_TOTAL_RISK_PCT}%")
        for name in ("base_risk_pct", "confirmed_risk_pct"):
            v = getattr(self, name)
            if not 0 < v <= self.max_trade_risk_pct:
                raise ValueError(f"{name}={v} must be in (0, max_trade_risk_pct={self.max_trade_risk_pct}]")
        return self


class CostCfg(BaseModel):
    fee_bps: float = 10.0  # Binance spot taker default 0.10%
    slippage_bps: float = 5.0


class BacktestCfg(BaseModel):
    start_equity: float = 10_000.0
    start: str | None = None
    end: str | None = None
    oos_fraction: float = Field(0.3, gt=0, lt=1)
    wf_train_days: int = 60
    wf_test_days: int = 30
    min_trades_for_selection: int = 10
    grid: dict[str, list] = Field(
        default_factory=lambda: {
            "n_hold": [1, 2, 3],
            "stop_mode": ["structural", "close_back"],
            "stop_atr_mult": [0.5, 1.0],
            "scenario_strength": ["explicit", "directional"],
            "require_bias_alignment": [True, False],
        }
    )


class ExecutionCfg(BaseModel):
    mode: Literal["paper"] = "paper"  # the only supported mode
    live_enabled: bool = False
    live_confirmation: str = ""


class SignalsCfg(BaseModel):
    notional_equity: float = 10_000.0
    lookback_hours: int = 36

    @field_validator("notional_equity")
    @classmethod
    def _pos(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("notional_equity must be > 0")
        return v


class Settings(BaseModel):
    assets: list[str] = ["BTC", "ETH", "XRP", "LTC", "LINK"]
    handle: str = "cryptoWZRD_"
    user_id: str = "1100373132135804928"
    paths: PathsCfg = PathsCfg()
    market: MarketCfg = MarketCfg()
    strategy: StrategyCfg = StrategyCfg()
    risk: RiskCfg = RiskCfg()
    costs: CostCfg = CostCfg()
    backtest: BacktestCfg = BacktestCfg()
    execution: ExecutionCfg = ExecutionCfg()
    signals: SignalsCfg = SignalsCfg()


def load_settings(path: str | Path | None = None, root: str | Path | None = None) -> Settings:
    data: dict = {}
    if path is not None:
        with open(path) as f:
            data = yaml.safe_load(f) or {}
    s = Settings.model_validate(data)
    if root is not None:
        s.paths.root = Path(root)
    elif path is not None and not s.paths.root.is_absolute():
        # config/default.yaml -> project root is parent of config/
        s.paths.root = (Path(path).resolve().parent.parent / s.paths.root)
    s.paths = s.paths.resolve()
    return s
