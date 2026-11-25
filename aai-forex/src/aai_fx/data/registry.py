from __future__ import annotations

from .base import DataProvider


def make_provider(name: str, **kwargs: object) -> DataProvider:
    if name == "yfinance":
        from .yfinance_provider import YFinanceProvider
        return YFinanceProvider()
    if name == "mt5":
        from .mt5_provider import MT5Provider
        return MT5Provider(**kwargs)  # type: ignore[arg-type]
    if name == "dukascopy":
        from .dukascopy_provider import DukascopyProvider
        return DukascopyProvider(str(kwargs.get("cache_dir", "data/raw/dukascopy")))
    if name == "csv":
        from .csv_provider import CSVProvider
        return CSVProvider(str(kwargs.get("root", "data/csv")))
    raise ValueError(f"unknown provider {name}")
