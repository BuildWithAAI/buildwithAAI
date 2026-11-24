"""Build and validate OHLCV candles from per-trade prices. Stdlib only, no case data.

    from candles import build_candles, validate, normalize
    c = build_candles(trades, t_start, t_end, step=5)   # trades: {blockTime, slot, tx_index, price, volume}
    validate(c)                                          # raises ValueError on a bad candle
    n = normalize(c, ref_price, ref_time)                # price 1.0 at ref, t in seconds from ref

Rules:
  * trades are ordered by (slot, tx_index) so same-second trades keep chain order;
  * a bucket covers [t, t+step); open = first trade price, close = last;
  * an empty bucket is a flat candle at the previous close with volume 0 and
    `empty: true` (no invented price movement); buckets before the first trade
    are omitted;
  * validation: high >= max(open, close), low <= min(open, close), all prices > 0.
"""


def build_candles(trades, t_start, t_end, step=5):
    rows = sorted((t for t in trades if t.get("price") and t_start <= t["blockTime"] < t_end),
                  key=lambda t: (t["slot"], t.get("tx_index") or 0))
    out, prev_close, i = [], None, 0
    for b in range(t_start, t_end, step):
        bucket = []
        while i < len(rows) and rows[i]["blockTime"] < b + step:
            bucket.append(rows[i])
            i += 1
        if bucket:
            ps = [t["price"] for t in bucket]
            c = {"t": b, "open": ps[0], "high": max(ps), "low": min(ps), "close": ps[-1],
                 "volume": sum(t.get("volume", 0.0) for t in bucket), "trades": len(bucket),
                 "buys": sum(1 for t in bucket if t.get("side") == "buy"),
                 "sells": sum(1 for t in bucket if t.get("side") == "sell")}
            prev_close = ps[-1]
            out.append(c)
        elif prev_close is not None:
            out.append({"t": b, "open": prev_close, "high": prev_close, "low": prev_close,
                        "close": prev_close, "volume": 0.0, "trades": 0, "buys": 0, "sells": 0,
                        "empty": True})
    return out


def validate(candles):
    for c in candles:
        if min(c["open"], c["high"], c["low"], c["close"]) <= 0:
            raise ValueError(f"non-positive price at t={c['t']}")
        if c["high"] < max(c["open"], c["close"]) or c["low"] > min(c["open"], c["close"]):
            raise ValueError(f"inconsistent OHLC at t={c['t']}")
    return True


def normalize(candles, ref_price, ref_time, digits=6):
    """Prices divided by ref_price (so ref = 1.0); times as seconds from ref_time."""
    out = []
    for c in candles:
        n = {k: c[k] for k in ("trades", "buys", "sells") if k in c}
        n["t"] = c["t"] - ref_time
        for k in ("open", "high", "low", "close"):
            n[k] = round(c[k] / ref_price, digits)
        if c.get("empty"):
            n["empty"] = True
        out.append(n)
    return out
