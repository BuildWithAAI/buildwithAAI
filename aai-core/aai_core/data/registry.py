"""Single entry point: Market(settings) -> .feed(asset_class) with candles()/quote()."""
from __future__ import annotations
from ..config import Settings
from ..infra.cache import DiskCache
from .crypto import PerpFeed
from .forex import ForexFeed
from .equity import EquityFeed


class Market:
    def __init__(self, settings: Settings | None = None, cache: DiskCache | None = None):
        self.settings = settings or Settings()
        self.cache = cache or DiskCache(self.settings.cache_path, self.settings.cache_mode)
        self._feeds = {}

    def feed(self, asset_class: str):
        if asset_class not in self._feeds:
            cls = {"crypto_perp": PerpFeed, "forex": ForexFeed, "equity": EquityFeed}.get(asset_class)
            if cls is None:
                raise ValueError(f"no market-data feed for asset class {asset_class!r}")
            self._feeds[asset_class] = cls(self.cache, self.settings)
        return self._feeds[asset_class]

    def source_stats(self) -> dict:
        out = {}
        for f in self._feeds.values():
            for attr in ("venues",):
                for n, v in getattr(f, attr, {}).items():
                    out[n] = v.h.snapshot()
            for n in ("y", "f"):
                if hasattr(f, n):
                    out[getattr(f, n).h.name] = getattr(f, n).h.snapshot()
        out["cache"] = dict(self.cache.stats)
        return out
