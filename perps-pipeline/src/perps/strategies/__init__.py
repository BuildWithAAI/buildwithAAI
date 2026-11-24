from __future__ import annotations

from typing import Any

from .base import ExitParams, Strategy
from .ema_pullback import EmaPullback
from .range_breakout import RangeBreakout
from .vol_squeeze import VolSqueeze

REGISTRY: dict[str, type[Strategy]] = {cls.name: cls for cls in (RangeBreakout, EmaPullback, VolSqueeze)}


def build_strategy(name: str, timeframe: str, params: dict[str, Any] | None = None) -> Strategy:
    if name not in REGISTRY:
        raise KeyError(f"unknown strategy {name!r}; available: {sorted(REGISTRY)}")
    return REGISTRY[name](timeframe, params)


__all__ = ["REGISTRY", "ExitParams", "Strategy", "build_strategy"]
