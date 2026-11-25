"""Dukascopy public historical datafeed provider (free, no key).

Source: ``https://datafeed.dukascopy.com/datafeed/{SYM}/{YYYY}/{MM0}/{SIDE}_candles_hour_1.bi5``
(MM0 is the 0-based month). Each file is LZMA-compressed; records are 24 bytes
big-endian: ``uint32 seconds-from-month-start, int32 open, close, low, high,
float32 tick-volume``. Prices are integers scaled by the symbol's point
(1e5 for AUDUSD, 1e3 for XAUUSD and JPY pairs).

Why this source: it is spot (not futures), has separate BID and ASK candles
(so the mid and a real *Dukascopy* spread can be derived) and H1 history back
to the 2000s -- far more than yfinance's ~730-day intraday cap.

Caveats (documented, not hidden):
* Dukascopy is an ECN bank feed; Bybit MT5 prices/spreads will differ.
* The server is flaky (intermittent HTTP 503/504); downloads are retried and
  raw files are cached under ``data/raw/dukascopy``.
* Hours with no ticks are emitted as flat zero-volume candles; they are dropped.
* Mid OHLC is (bid+ask)/2 per field -- the mid high/low is an approximation.
* The current, incomplete month is fetched too (file may be missing -> skipped).
* H4/D1 are resampled from H1 on *broker server-time* boundaries
  (New York close = 00:00 server time, i.e. the usual GMT+2/+3 MT5 convention).
  D1 bars are labelled 00:00 UTC of their trading date (a label up to ~3h after
  the true open, never before the true close -> conservative, no lookahead).
"""

from __future__ import annotations

import logging
import lzma
import struct
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .base import DataProvider, ProviderError, Timeframe

log = logging.getLogger(__name__)

BASE_URL = "https://datafeed.dukascopy.com/datafeed"
POINT = {"XAUUSD": 1e3, "XAGUSD": 1e3}
FIRST_YEAR = {"XAUUSD": 2008, "AUDUSD": 2008}
_EMPTY = b"EMPTY"


def point_of(sym: str) -> float:
    return POINT.get(sym, 1e3 if sym.endswith("JPY") else 1e5)


def decode_bi5(raw: bytes, month_start: pd.Timestamp, point: float) -> pd.DataFrame:
    if not raw:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    b = lzma.decompress(raw)
    n = len(b) // 24
    arr = np.frombuffer(b[: n * 24], dtype=np.dtype([("t", ">u4"), ("o", ">i4"), ("c", ">i4"), ("l", ">i4"),
                                                     ("h", ">i4"), ("v", ">f4")]))
    idx = month_start + pd.to_timedelta(arr["t"].astype(np.int64), unit="s")
    df = pd.DataFrame({"open": arr["o"] / point, "high": arr["h"] / point, "low": arr["l"] / point,
                       "close": arr["c"] / point, "volume": arr["v"].astype(float)}, index=pd.DatetimeIndex(idx))
    return df


class DukascopyProvider(DataProvider):
    name = "dukascopy"

    def __init__(self, cache_dir: str | Path = "data/raw/dukascopy", workers: int = 3, retries: int = 10) -> None:
        self.cache_dir = Path(cache_dir)
        self.workers = workers
        self.retries = retries

    def supported_timeframes(self) -> list[Timeframe]:
        return [Timeframe.H1, Timeframe.H4, Timeframe.D1]

    # ---------------- raw download with cache ----------------
    def _path(self, sym: str, side: str, y: int, m: int) -> Path:
        return self.cache_dir / sym / side / f"{y:04d}-{m:02d}.bi5"

    def _get(self, sym: str, side: str, y: int, m: int, current: bool) -> bytes:
        p = self._path(sym, side, y, m)
        if p.exists() and not current:
            data = p.read_bytes()
            return b"" if data == _EMPTY else data
        url = f"{BASE_URL}/{sym}/{y:04d}/{m - 1:02d}/{side}_candles_hour_1.bi5"
        delay = 2.0
        for attempt in range(self.retries):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 aai-fx research"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                p.parent.mkdir(parents=True, exist_ok=True)
                if not current:
                    p.write_bytes(data if data else _EMPTY)
                return data
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    if not current:
                        p.parent.mkdir(parents=True, exist_ok=True)
                        p.write_bytes(_EMPTY)
                    return b""
                log.debug("%s HTTP %s (attempt %d)", url, e.code, attempt + 1)
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                log.debug("%s %s (attempt %d)", url, e, attempt + 1)
            time.sleep(delay)
            delay = min(delay * 1.6, 30.0)
        raise ProviderError(f"dukascopy: giving up on {url} after {self.retries} attempts")

    def fetch_h1_side(self, sym: str, side: str, start: datetime, end: datetime) -> pd.DataFrame:
        now = datetime.now(timezone.utc)
        months = pd.period_range(pd.Timestamp(start).tz_localize(None) if pd.Timestamp(start).tzinfo else start,
                                 pd.Timestamp(end).tz_localize(None) if pd.Timestamp(end).tzinfo else end, freq="M")
        jobs = [(p.year, p.month) for p in months]
        pt = point_of(sym)

        def one(ym: tuple[int, int]) -> pd.DataFrame:
            y, m = ym
            cur = (y, m) == (now.year, now.month)
            raw = self._get(sym, side, y, m, cur)
            return decode_bi5(raw, pd.Timestamp(year=y, month=m, day=1, tz="UTC"), pt)

        with ThreadPoolExecutor(self.workers) as ex:
            frames = [f for f in ex.map(one, jobs) if len(f)]
        if not frames:
            raise ProviderError(f"dukascopy: no {side} data for {sym}")
        df = pd.concat(frames).sort_index()
        return df[~df.index.duplicated(keep="last")]

    def fetch_h1_mid(self, sym: str, start: datetime, end: datetime) -> pd.DataFrame:
        bid = self.fetch_h1_side(sym, "BID", start, end)
        ask = self.fetch_h1_side(sym, "ASK", start, end)
        j = bid.join(ask, lsuffix="_b", rsuffix="_a", how="inner")
        j = j[(j["volume_b"] > 0) & (j["volume_a"] > 0)]  # drop flat no-tick filler hours
        out = pd.DataFrame(index=j.index)
        for c in ("open", "high", "low", "close"):
            out[c] = (j[f"{c}_b"] + j[f"{c}_a"]) / 2.0
        out["volume"] = j["volume_b"]
        out["spread"] = j["close_a"] - j["close_b"]  # quoted spread at bar close (price units)
        return out

    def fetch(self, pair: str, timeframe: Timeframe, start: datetime | None = None,
              end: datetime | None = None) -> pd.DataFrame:
        sym = pair.upper().replace("+", "")
        start = start or datetime(FIRST_YEAR.get(sym, 2008), 1, 1, tzinfo=timezone.utc)
        end = end or datetime.now(timezone.utc)
        h1 = self.fetch_h1_mid(sym, start, end)
        if timeframe is Timeframe.H1:
            return h1
        return resample_server_time(h1, timeframe)


def resample_server_time(h1: pd.DataFrame, tf: Timeframe, min_fill: float = 0.5) -> pd.DataFrame:
    """Resample UTC H1 bars on MT5-style server-time boundaries (NY 17:00 = 00:00).

    Server time = New York local time + 7h (DST-aware) -> GMT+2 winter / GMT+3 summer.
    """
    if tf not in (Timeframe.H4, Timeframe.D1):
        raise ValueError(tf)
    ny = h1.index.tz_convert("America/New_York")
    server = (ny.tz_localize(None) + pd.Timedelta(hours=7))
    hours = 4 if tf is Timeframe.H4 else 24
    bucket = server.floor(f"{hours}h")
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    if "spread" in h1.columns:
        agg["spread"] = "median"
    g = h1.assign(_b=bucket).groupby("_b")
    out = g.agg(agg)
    cnt = g.size()
    out = out[cnt >= max(1, int(hours * min_fill))]
    if tf is Timeframe.D1:
        out = out[out.index.dayofweek < 5]  # server-time trading date Mon..Fri
        out.index = pd.DatetimeIndex(out.index).tz_localize("UTC")  # label = 00:00 UTC of trading date
    else:
        # true UTC open of the bucket: server bucket start -> NY -> UTC (ambiguous/nonexistent handled)
        loc = (pd.DatetimeIndex(out.index) - pd.Timedelta(hours=7)).tz_localize(
            "America/New_York", ambiguous="NaT", nonexistent="shift_forward").tz_convert("UTC")
        keep = ~loc.isna()
        out = out[keep]
        out.index = loc[keep]
    out.index.name = None
    return out
