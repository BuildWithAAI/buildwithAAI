from .base import BarContext, LookaheadError, Signal, SignalAction, Strategy
from .session_breakout import SessionBreakout
from .trend_swing import TrendSwing
from .zoora import ZooraCross, ZooraPullback, ZooraTrend, ema_warmup_bars

REGISTRY: dict[str, type[Strategy]] = {"trend_swing": TrendSwing, "session_breakout": SessionBreakout,
                                    "zoora_trend": ZooraTrend, "zoora_pullback": ZooraPullback, "zoora_cross": ZooraCross}


def make_strategy(name: str, timeframe: str, params: dict | None = None, impl: str | None = None) -> Strategy:
    key = impl or name
    if key not in REGISTRY:
        raise KeyError(f"unknown strategy {key}; known: {sorted(REGISTRY)}")
    s = REGISTRY[key](timeframe=timeframe, **(params or {}))
    s.name = name
    return s


def strategy_from_config(name: str, cfg: "object", params_override: dict | None = None) -> Strategy:
    sc = cfg.strategies[name]  # type: ignore[attr-defined]
    return make_strategy(name, sc.timeframe, {**sc.params, **(params_override or {})}, sc.impl)


__all__ = ["BarContext", "LookaheadError", "Signal", "SignalAction", "Strategy", "TrendSwing",
           "SessionBreakout", "ZooraTrend", "ZooraPullback", "ZooraCross", "ema_warmup_bars", "REGISTRY", "make_strategy"]
