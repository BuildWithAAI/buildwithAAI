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


def parse(sym, label, name, cls, j) -> dict:
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
            "spark": series[-30:]}


def fetch(f, cfg, prev=None) -> dict:
    rows, errors = [], {}
    for sym, label, name, cls in SYMBOLS:
        try:
            rows.append(parse(sym, label, name, cls, f.get(URL.format(s=sym), params={"range": "2mo", "interval": "1d"}, timeout=10)))
        except FetchError as e:
            errors[label] = e.reason
        time.sleep(0.12)  # be polite
    if not rows:
        raise FetchError("yahoo: " + "; ".join(f"{k} {v}" for k, v in errors.items())[:200])
    return {"rows": rows, "errors": errors}
