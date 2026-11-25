"""Public Dukascopy M1 bid/ask candles; cached daily and resampled to M15.

Research only: no credentials or broker connection. Records use the same
24-byte candle layout as the hourly provider.
"""
from __future__ import annotations

import logging
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import pandas as pd

from .dukascopy_provider import BASE_URL, POINT, decode_bi5

log = logging.getLogger(__name__)
_EMPTY = b"EMPTY"


def resample_utc(df: pd.DataFrame, minutes: int = 15) -> pd.DataFrame:
    """Resample open-labelled UTC candles, retaining explicit spread columns."""
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    if "spread_open" in df:
        agg.update({"spread_open": "first", "spread_close": "last"})
    elif "spread" in df:
        agg["spread"] = "median"
    out = df.resample(f"{minutes}min", label="left", closed="left").agg(agg).dropna(subset=["open", "close"])
    return out


class DukascopyMinuteProvider:
    """Fetch and cache daily BID/ASK M1 files; callers choose the stored TF."""
    def __init__(self, cache_dir: str | Path, workers: int = 8, retries: int = 8) -> None:
        self.cache_dir = Path(cache_dir)
        self.workers, self.retries = workers, retries
        self.errors: list[str] = []

    def _path(self, sym: str, side: str, d: pd.Timestamp) -> Path:
        return self.cache_dir / sym / side / d.strftime("%Y") / f"{d:%Y-%m-%d}.bi5"

    def _get(self, sym: str, side: str, d: pd.Timestamp) -> bytes:
        p = self._path(sym, side, d)
        current = d.date() == datetime.now().date()
        if p.exists() and not current:
            raw = p.read_bytes()
            return b"" if raw == _EMPTY else raw
        u = f"{BASE_URL}/{sym}/{d.year}/{d.month - 1:02d}/{d.day:02d}/{side}_candles_min_1.bi5"
        delay = 1.0
        for attempt in range(self.retries):
            try:
                req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 aai-fx research"})
                with urllib.request.urlopen(req, timeout=45) as r:
                    raw = r.read()
                p.parent.mkdir(parents=True, exist_ok=True)
                if not current:
                    p.write_bytes(raw if raw else _EMPTY)
                return raw
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    p.parent.mkdir(parents=True, exist_ok=True)
                    if not current:
                        p.write_bytes(_EMPTY)
                    return b""
                log.debug("%s HTTP %s attempt %d", u, e.code, attempt + 1)
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                log.debug("%s %s attempt %d", u, e, attempt + 1)
            time.sleep(delay)
            delay = min(delay * 1.5, 10.0)
        raise RuntimeError(f"giving up on {u}")

    def side(self, sym: str, side: str, start: datetime, end: datetime) -> pd.DataFrame:
        days = pd.date_range(start, end, freq="D", tz="UTC")
        def one(d: pd.Timestamp) -> tuple[str, pd.DataFrame]:
            key = d.strftime("%Y-%m")
            try:
                raw = self._get(sym, side, d)
                return key, decode_bi5(raw, d, POINT.get(sym, 1e5))
            except RuntimeError as e:
                self.errors.append(str(e))
                return key, pd.DataFrame()
        partial = self.cache_dir / sym / (side + "_monthly")
        partial.mkdir(parents=True, exist_ok=True)
        by_month: dict[str, list[pd.Timestamp]] = {}
        for d in days: by_month.setdefault(d.strftime("%Y-%m"), []).append(d)
        frames: list[pd.DataFrame] = []
        for key, ds in by_month.items():
            cached = partial / (key + ".parquet")
            if cached.exists():
                frames.append(pd.read_parquet(cached))
                continue
            todo = [d for d in ds if not self._path(sym, side, d).exists()]
            decoded: list[pd.DataFrame] = []
            if todo:
                with ThreadPoolExecutor(self.workers) as ex:
                    for d, frame in zip(todo, ex.map(one, todo)):
                        if len(frame[1]): decoded.append(frame[1])
            basic = [self._path(sym, side, d) for d in ds if self._path(sym, side, d).exists()]
            for d in ds:
                pp = self._path(sym, side, d)
                if pp.exists():
                    raw = pp.read_bytes()
                    if raw != _EMPTY:
                        decoded.append(decode_bi5(raw, d, POINT.get(sym, 1e5)))
            if decoded:
                f = pd.concat(decoded).sort_index()
                f = f[~f.index.duplicated(keep="last")]
                f.to_parquet(cached)
                frames.append(f)
                print(side, key, len(f), "new_days", len(todo), flush=True)
        if not frames:
            raise ValueError(f"no {side} M1 data for {sym}")
        df = pd.concat(frames).sort_index()
        return df[(~df.index.duplicated(keep="last")) & (df.volume > 0)]

    def fetch_m1(self, sym: str, start: datetime, end: datetime) -> pd.DataFrame:
        bid = self.side(sym, "BID", start, end)
        ask = self.side(sym, "ASK", start, end)
        j = bid.join(ask, lsuffix="_bid", rsuffix="_ask", how="inner")
        out = pd.DataFrame(index=j.index)
        for c in ("open", "high", "low", "close"):
            out[c] = (j[f"{c}_bid"] + j[f"{c}_ask"]) / 2
            out[f"{c}_bid"] = j[f"{c}_bid"]
            out[f"{c}_ask"] = j[f"{c}_ask"]
        out["volume"] = j.volume_bid
        out["spread_open"] = j.open_ask - j.open_bid
        out["spread_close"] = j.close_ask - j.close_bid
        return out
