"""Cross-asset quotes from the Yahoo Finance chart endpoint (keyless, unofficial; equities ~real-time to 15 min delayed).
Stooq was tried first: its CSV endpoints return 404 / a JavaScript bot challenge from this machine."""
from __future__ import annotations
import time
from ..core import FetchError, num

URL = "https://query1.finance.yahoo.com/v8/finance/chart/{s}"
SYMBOLS = [("SPY", "SPY", "S&P 500 ETF", "equity"), ("QQQ", "QQQ", "Nasdaq 100 ETF", "equity"), ("IWM", "IWM", "Russell 2000 ETF", "equity"),
           ("^VIX", "VIX", "CBOE VIX", "vol"), ("^VIX3M", "VIX3M", "CBOE 3M VIX", "vol"), ("DX-Y.NYB", "DXY", "US dollar index", "fx"), ("^TNX", "TNX", "10Y yield (CBOE)", "rates"),
           ("GC=F", "GOLD", "Gold futures", "commodity"), ("CL=F", "WTI", "WTI crude futures", "commodity"),
           ("EURUSD=X", "EURUSD", "EUR/USD", "fx"), ("USDJPY=X", "USDJPY", "USD/JPY", "fx"), ("AUDUSD=X", "AUDUSD", "AUD/USD", "fx"),
           ("GBPUSD=X", "GBPUSD", "GBP/USD", "fx"), ("USDCAD=X", "USDCAD", "USD/CAD", "fx"), ("USDCHF=X", "USDCHF", "USD/CHF", "fx"),
           ("BTC-USD", "BTCUSD", "Bitcoin spot", "crypto")]
# The 11 SPDR Select Sector ETFs (GICS sectors) for the stocks-desk breadth strip (own feed: `sectors`).
SECTORS = [("XLK", "XLK", "Technology", "sector"), ("XLC", "XLC", "Communication Services", "sector"),
           ("XLY", "XLY", "Consumer Discretionary", "sector"), ("XLF", "XLF", "Financials", "sector"),
           ("XLI", "XLI", "Industrials", "sector"), ("XLV", "XLV", "Health Care", "sector"),
           ("XLP", "XLP", "Consumer Staples", "sector"), ("XLE", "XLE", "Energy", "sector"),
           ("XLB", "XLB", "Materials", "sector"), ("XLU", "XLU", "Utilities", "sector"),
           ("XLRE", "XLRE", "Real Estate", "sector")]


def parse(sym, label, name, cls, j, spark_n: int = 30) -> dict:
    try:
        res = j["chart"]["result"][0]
        meta = res["meta"]
    except (KeyError, IndexError, TypeError):
        err = ((j or {}).get("chart") or {}).get("error") if isinstance(j, dict) else None
        raise FetchError(f"{label}: no chart result" + (f" ({str(err.get('code'))[:30]})" if isinstance(err, dict) else ""), retryable=False)
    closes = [num(c) for c in (((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or [])]
    stamps = res.get("timestamp") or []
    series = [[t, c] for t, c in zip(stamps, closes) if c is not None]
    last = num(meta.get("regularMarketPrice"))
    if last is None:
        raise FetchError(f"{label}: no price", retryable=False)
    rmt = num(meta.get("regularMarketTime"))
    # daily bars: if the last bar is the current session, the previous close is the bar before it
    if series and rmt and 0 <= rmt - series[-1][0] < 86400:
        prev = series[-2][1] if len(series) > 1 else None
    else:
        prev = series[-1][1] if series else None
    c20 = series[-21][1] if len(series) > 20 else (series[0][1] if series else None)
    return {"symbol": label, "yahoo": sym, "name": name, "class": cls, "last": last, "prev_close": prev,
            "chg": round(last / prev - 1, 5) if prev else None, "chg_20d": round(last / c20 - 1, 5) if c20 else None,
            "ts": num(meta.get("regularMarketTime")), "currency": str(meta.get("currency") or "")[:4],
            "spark": series[-max(2, int(spark_n)):]}


# Sectors keep ~3 months of closes so breadth can rebuild "% above the close 20 sessions earlier" for 20+ sessions
# (20 sessions of lookback + 20 sessions of history + margin for holidays); markets keep the lighter 2mo / 30-bar spark.
SECTOR_RANGE, SECTOR_SPARK = "3mo", 64


def fetch(f, cfg, prev=None, symbols=None, rng: str = "2mo", spark_n: int = 30) -> dict:
    rows, errors = [], {}
    for sym, label, name, cls in (symbols or SYMBOLS):
        try:
            rows.append(parse(sym, label, name, cls, f.get(URL.format(s=sym), params={"range": rng, "interval": "1d"}, timeout=10), spark_n))
        except FetchError as e:
            errors[label] = e.reason
        time.sleep(0.12)  # be polite
    if not rows:
        raise FetchError("yahoo: " + "; ".join(f"{k} {v}" for k, v in errors.items())[:200])
    return {"rows": rows, "errors": errors}


def fetch_sectors(f, cfg, prev=None) -> dict:
    """SPDR sector ETFs only (11 chart calls); same parser and politeness as `fetch`. Partial results keep the errors."""
    return fetch(f, cfg, prev, symbols=SECTORS, rng=SECTOR_RANGE, spark_n=SECTOR_SPARK)


# T11d watchlist quotes (own feed: `watch_quotes`): one price per watchlist ticker so panel 18 can show market cap / EV /
# P-S / FCF yield next to the SEC numbers. A year of weekly bars with split events, so a split after the 10-Q cover date
# is detected (and the multiples withheld) instead of mixing pre-split shares with a post-split price.
# T11e: two years of split events, so the 1Y share-count change (prior cover up to ~425 days before a cover that is up to
# 200 days old) can be split-adjusted too.
WATCH_RANGE, WATCH_INTERVAL, WATCH_MAX = "2y", "1wk", 25


def parse_watch(t: str, j) -> dict:
    try:
        res = j["chart"]["result"][0]
        meta = res["meta"]
    except (KeyError, IndexError, TypeError):
        raise FetchError(f"{t}: no chart result", retryable=False)
    last = num(meta.get("regularMarketPrice"))
    if last is None or last <= 0:
        raise FetchError(f"{t}: no price", retryable=False)
    splits = []
    for s in (((res.get("events") or {}).get("splits") or {}).values()):
        if not isinstance(s, dict):
            continue
        d, n, dn = num(s.get("date")), num(s.get("numerator")), num(s.get("denominator"))
        if d and n and dn and n > 0 and dn > 0:
            splits.append({"ts": d, "ratio": round(n / dn, 6), "label": f"{n:g}:{dn:g}"})
    splits.sort(key=lambda s: s["ts"])
    return {"ticker": t, "last": last, "ts": num(meta.get("regularMarketTime")), "currency": str(meta.get("currency") or "")[:4],
            "exchange": str(meta.get("exchangeName") or "")[:12], "splits": splits[-4:]}


def fetch_watch(f, cfg, prev=None) -> dict:
    """Last price + split events for the owner's watchlist (same list the filings/fundamentals feeds use, max 25)."""
    from .edgar import DEFAULT_WATCH
    ic = cfg.get("intel", {}) if hasattr(cfg, "get") else {}
    watch = [str(t).upper() for t in (ic.get("watchlist") or DEFAULT_WATCH)][:WATCH_MAX]
    rows, errors = [], {}
    for t in watch:
        try:
            rows.append(parse_watch(t, f.get(URL.format(s=t), params={"range": WATCH_RANGE, "interval": WATCH_INTERVAL, "events": "split"}, timeout=10)))
        except FetchError as e:
            errors[t] = e.reason
        time.sleep(0.12)  # be polite
    if not rows:
        raise FetchError("yahoo watchlist: " + "; ".join(f"{k} {v}" for k, v in errors.items())[:200])
    return {"watchlist": watch, "rows": rows, "errors": errors}
