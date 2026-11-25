from __future__ import annotations

from .base import ExchangeAdapter
from .blofin import BlofinAdapter
from .bybit import BybitAdapter


def get_adapter(name: str, **kwargs) -> ExchangeAdapter:
    name = name.lower()
    if name == "blofin":
        return BlofinAdapter(**kwargs)
    if name == "bybit":
        return BybitAdapter(**kwargs)
    raise ValueError(f"unknown exchange {name!r}")


__all__ = ["ExchangeAdapter", "BlofinAdapter", "BybitAdapter", "get_adapter"]
