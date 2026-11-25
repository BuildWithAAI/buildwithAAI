"""Yahoo Finance FX provider (free, no key). Verified working from this box.

Known limitations (documented, not hidden):
* Prices are indicative mid quotes, not a broker's bid/ask; volume is 0.
* Intraday history is capped by Yahoo: 1m ~ last 30 days (7 days per request),
  5m/15m/30m ~ last 60 days, 1h ~ last 730 days. Daily goes back to ~2003.
* H4 is not native; it is resampled from 1h on UTC-midnight boundaries (a
  broker's H4/D1 are usually aligned to NY 17:00 / server GMT+2/+3).
* Daily bar session boundaries are Yahoo's, not the broker's NY close.
"""

from __future__ import annotations

import logging
import warnings
from datetime import datetime, timedelta, timezone

import pandas as pd

from ..instruments import get_instrument
from .base import DataProvider, ProviderError, Timeframe
from .validation import normalize_ohlcv, resample_ohlcv

log = logging.getLogger(__name__)

_INTERVAL = {Timeframe.M1: "1m", Timeframe.M5: "5m", Timeframe.M15: "15m", Timeframe.M30: "30m",
             Timeframe.H1: "1h", Timeframe.D1: "1d"}
_MAX_DAYS = {Timeframe.M1: 29, Timeframe.M5: 59, Timeframe.M15: 59, Timeframe.M30: 59, Timeframe.H1: 729}
_CHUNK_DAYS = {Timeframe.M1: 7}


class YFinanceProvider(DataProvider):
    name = "yfinance"

    def supported_timeframes(self) -> list[Timeframe]:
        return list(_INTERVAL) + [Timeframe.H4]

    def max_lookback_days(self, tf: Timeframe) -> int | None:
        return _MAX_DAYS.get(Timeframe.H1 if tf is Timeframe.H4 else tf)

    def fetch(self, pair: str, timeframe: Timeframe, start: datetime | None = None,
              end: datetime | None = None) -> pd.DataFrame:
        if timeframe is Timeframe.H4:
            h1 = self.fetch(pair, Timeframe.H1, start, end)
            return resample_ohlcv(h1, Timeframe.H4, Timeframe.H1)
        import yfinance as yf  # lazy import

        inst = get_instrument(pair)
        now = datetime.now(timezone.utc)
        end = end or now
        cap = _MAX_DAYS.get(timeframe)
        if start is None:
            start = now - timedelta(days=cap) if cap else datetime(2010, 1, 1, tzinfo=timezone.utc)
        if cap is not None and (now - start).days > cap:
            log.warning("%s %s: clamping start to provider limit of %d days", pair, timeframe.value, cap)
            start = now - timedelta(days=cap)
        chunk = _CHUNK_DAYS.get(timeframe)
        windows: list[tuple[datetime, datetime]] = []
        if chunk:
            s = start
            while s < end:
                e = min(s + timedelta(days=chunk), end)
                windows.append((s, e))
                s = e
        else:
            windows = [(start, end)]
        frames = []
        for s, e in windows:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                df = yf.download(inst.yfinance_ticker, start=s, end=e, interval=_INTERVAL[timeframe],
                                 progress=False, auto_adjust=False, threads=False)
            if df is not None and not df.empty:
                frames.append(df)
        if not frames:
            raise ProviderError(f"yfinance returned no data for {pair} {timeframe.value} {start}..{end}")
        out = pd.concat([normalize_ohlcv(f) for f in frames])
        return out[~out.index.duplicated(keep="last")].sort_index()
