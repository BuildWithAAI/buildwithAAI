"""T11d price-based multiples for the watchlist: joins the SEC XBRL fundamentals snapshot (feed `fundamentals`) with one
last price per ticker (feed `watch_quotes`). Pure and read-only.

Market cap = price x shares outstanding (cover page, summed across classes); EV = market cap + long-term debt - (cash +
short-term investments); P/S = market cap / revenue TTM; FCF yield = FCF TTM / market cap.
Never estimated: a missing price, share count, revenue or debt leaves that multiple None. Multiples are withheld when the
share count cannot be trusted against today's price: a split after the cover date, a share count older than
SHARES_STALE_DAYS, or a non-USD quote. Banks get no EV or FCF yield (deposits are not debt; FCF does not apply).
T11e: a split after the share-count date is exact arithmetic, so the reported count is multiplied by Yahoo's split
ratio(s) and the row is flagged SPLIT_ADJUSTED (cover-page counts are as-of the cover date and are never restated). A
weighted-average count with a split between the period end and the filing date is still withheld (the filing may already
be restated). The 1Y share-count change gets the same treatment (`split_yoy`), so a 10:1 split never reads as +900%
dilution. Research only, not a signal."""
from __future__ import annotations
from datetime import date, datetime, timezone

SHARES_STALE_DAYS = 200
SPLIT_RATIO_MIN, SPLIT_RATIO_MAX = 0.001, 1000.0   # outside this a Yahoo split event is treated as bad data, never applied
YOY_WINDOW_DAYS = 425      # xbrl.shares picks the prior cover within 365 +- 60 days; used when shares_prior_end is absent
NOTE = ("Market cap = last price x cover-page shares outstanding. EV = market cap + long-term debt - cash - short-term "
        "investments. P/S = market cap / revenue TTM. FCF yield = FCF TTM / market cap. Delayed quote; not a signal.")


def _d(s) -> date | None:
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def _n(v) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf") else None


def _day(ts) -> date:
    return datetime.fromtimestamp(ts, timezone.utc).date()


def splits_of(q: dict | None) -> tuple[list[dict], list[dict]]:
    """(usable, bad) split events from one watch_quotes row, oldest first. Usable = numeric ts and a sane ratio != 1."""
    good, bad = [], []
    for s in ((q or {}).get("splits") or []):
        if not isinstance(s, dict) or not _n(s.get("ts")):
            continue
        r = _n(s.get("ratio"))
        (good if r is not None and SPLIT_RATIO_MIN <= r <= SPLIT_RATIO_MAX and r != 1 else bad).append(s)
    return sorted(good, key=lambda s: s["ts"]), bad


def _prod(xs: list[dict]) -> float:
    f = 1.0
    for s in xs:
        f *= float(s["ratio"])
    return f


def _desc(xs: list[dict]) -> str:
    return " and ".join(f"{s.get('label') or s['ratio']} on {_day(s['ts']).isoformat()}" for s in xs)


def split_yoy(fr: dict, q: dict | None) -> dict:
    """T11e: the 1Y share-count change with any split between the prior count and the current one taken out.
    {'yoy': adjusted or raw, 'status': 'raw' | 'adjusted' | 'unknown' | 'none', 'note': str, 'raw': reported yoy}.
    'unknown' = a split falls in the comparison window but the prior count or its date is missing (old payload), so the
    change is not comparable and must not raise a dilution alarm. Without a quote row there is no split data: 'raw'."""
    raw = _n(fr.get("shares_yoy"))
    out = {"yoy": raw, "raw": raw, "status": "none" if raw is None else "raw", "note": ""}
    send = _d(fr.get("shares_end"))
    if raw is None or send is None or not q:
        return out
    good, _ = splits_of(q)
    pend = _d(fr.get("shares_prior_end"))
    lo = pend or date.fromordinal(send.toordinal() - YOY_WINDOW_DAYS)
    between = [s for s in good if lo < _day(s["ts"]) <= send]
    if not between:
        return out
    prior, sh = _n(fr.get("shares_prior")), _n(fr.get("shares"))
    if (fr.get("shares_basis") or "cover page") != "cover page":
        out.update(yoy=None, status="unknown",
                   note=f"{_desc(between)} inside the 1Y window; weighted-average counts may already be restated, so the change is not comparable")
        return out
    if pend is None or not prior or not sh:
        out.update(yoy=None, status="unknown",
                   note=f"{_desc(between)} inside the 1Y window; prior count not in this snapshot, so the change is not comparable")
        return out
    f = _prod(between)
    out.update(yoy=sh / (prior * f) - 1, status="adjusted",
               note=f"split-adjusted for {_desc(between)} (reported {raw * 100:+.0f}%)")
    return out


def one(fr: dict, q: dict | None, now: float) -> dict:
    """Multiples for one fundamentals row `fr` and its quote `q` (or None)."""
    t = str(fr.get("ticker") or "")
    out = {"ticker": t, "price": None, "price_ts": None, "mcap": None, "ev": None, "ps": None, "fcf_yield": None,
           "ev_fcf": None, "shares_basis": fr.get("shares_basis"), "withheld": None, "flags": [],
           "shares": _n(fr.get("shares")), "shares_reported": _n(fr.get("shares")), "split_adj": None}
    y = split_yoy(fr, q)
    out.update(shares_yoy=y["yoy"], shares_yoy_status=y["status"], shares_yoy_note=y["note"])
    if not q:
        out["withheld"] = "no quote"
        return out
    price = _n(q.get("last"))
    out.update(price=price, price_ts=_n(q.get("ts")))
    if price is None or price <= 0:
        out["withheld"] = "no price"
        return out
    cur = str(q.get("currency") or "")
    if cur and cur != "USD":
        out["withheld"] = f"quote in {cur[:4]}, filings in USD"
        return out
    sh = _n(fr.get("shares"))
    if not sh or sh <= 0:
        out["withheld"] = "no share count in the filings"
        return out
    send = _d(fr.get("shares_end"))
    today = datetime.fromtimestamp(now, timezone.utc).date()
    if send is None or (today - send).days > SHARES_STALE_DAYS:
        out["withheld"] = f"share count from {fr.get('shares_end') or 'an unknown date'} is too old to price"
        return out
    good, bad = splits_of(q)
    if [s for s in bad if _day(s["ts"]) > send]:
        s = [s for s in bad if _day(s["ts"]) > send][-1]
        out["withheld"] = f"split on {_day(s['ts']).isoformat()} has an unusable ratio ({s.get('label') or s.get('ratio')})"
        out["flags"].append("SPLIT_SINCE_COVER")
        return out
    after = [s for s in good if _day(s["ts"]) > send]
    if after:
        wavg = (fr.get("shares_basis") or "cover page") != "cover page"
        filed = _d(fr.get("filed"))
        if wavg and (filed is None or any(_day(s["ts"]) <= filed for s in after)):
            # a weighted-average count in a filing made after the split is usually already restated: adjusting again
            # could double it, so this stays withheld instead of guessed
            s = after[-1]
            out["withheld"] = (f"{s.get('label') or 'a'} split on {_day(s['ts']).isoformat()} after the {send.isoformat()} "
                               f"weighted-average count, before or at the {filed or 'unknown'} filing (may already be restated)")
            out["flags"].append("SPLIT_SINCE_COVER")
            return out
        f = _prod(after)
        sh = sh * f
        out.update(shares=sh, split_adj={"factor": f, "splits": [{"date": _day(s["ts"]).isoformat(), "label": s.get("label"),
                                                                   "ratio": s["ratio"]} for s in after],
                                         "shares_reported": out["shares_reported"], "shares_end": send.isoformat(),
                                         "note": f"split-adjusted: reported {send.isoformat()} count x {f:g} for {_desc(after)}"})
        out["flags"].append("SPLIT_ADJUSTED")
    flags = fr.get("flags") or []
    bank = "BANK" in flags
    mcap = price * sh
    out["mcap"] = mcap
    if (fr.get("shares_basis") or "cover page") != "cover page":
        out["flags"].append("SHARES_WAVG")   # weighted-average basic for the quarter: lags fresh issuance
    debt, liq = _n(fr.get("debt")), _n(fr.get("liquidity"))
    if not bank and debt is not None and liq is not None:
        out["ev"] = mcap + debt - liq
    rev = _n(fr.get("revenue_ttm"))
    if rev is not None and rev > 0:
        out["ps"] = mcap / rev
    fcf = _n(fr.get("fcf_ttm"))
    if fcf is not None and not bank:
        out["fcf_yield"] = fcf / mcap
        if out["ev"] is not None and out["ev"] > 0 and fcf > 0:
            out["ev_fcf"] = out["ev"] / fcf
    return out


def compute(payloads: dict, now: float, statuses: dict | None = None) -> dict:
    """{'rows': {ticker: multiples}, 'priced': n, 'missing': [...], ...}. Empty rows when either feed has no data."""
    fp, qp = (payloads or {}).get("fundamentals") or {}, (payloads or {}).get("watch_quotes") or {}
    st = statuses or {}
    out = {"rows": {}, "priced": 0, "n": 0, "missing": [], "withheld": [], "split_adjusted": [], "note": NOTE,
           "fundamentals_status": st.get("fundamentals"), "quotes_status": st.get("watch_quotes"), "quotes_ts": None}
    frows = [r for r in (fp.get("rows") or []) if isinstance(r, dict) and r.get("ticker")]
    if not frows or not qp.get("rows"):
        return out
    qs = {str(q.get("ticker")).upper(): q for q in qp.get("rows") or [] if isinstance(q, dict) and q.get("ticker")}
    ts = [t for t in (_n(q.get("ts")) for q in qs.values()) if t]
    out["quotes_ts"] = max(ts) if ts else None
    for fr in frows:
        t = str(fr["ticker"]).upper()
        m = one(fr, qs.get(t), now)
        out["rows"][t] = m
        out["n"] += 1
        if m.get("split_adj"):
            out["split_adjusted"].append(t)
        if m["mcap"] is not None:
            out["priced"] += 1
        elif m["withheld"] == "no quote":
            out["missing"].append(t)
        else:
            out["withheld"].append(t)
    return out


def _cap(v: float) -> str:
    return f"{v / 1e12:.2f} trillion" if v >= 1e12 else f"{v / 1e9:.1f} billion" if v >= 1e9 else f"{v / 1e6:.0f} million"


def text(v: dict | None, limit: int = 4) -> str:
    """Spoken line: the priced names by market cap, with P/S and FCF yield. Never a buy/sell call."""
    if not v or not v.get("priced"):
        return ""
    rows = sorted((r for r in v["rows"].values() if r.get("mcap")), key=lambda r: -r["mcap"])
    bits = []
    for r in rows[:limit]:
        s = f"{r['ticker']} {_cap(r['mcap'])} dollars market cap"
        if r.get("ps") is not None:
            s += f", {r['ps']:.1f} times sales"
        if r.get("fcf_yield") is not None:
            s += f", free cash flow yield {r['fcf_yield'] * 100:.1f}%"
        bits.append(s)
    s = f"Priced {v['priced']} of {v['n']} at the last delayed quote: " + "; ".join(bits) + "."
    if v.get("split_adjusted"):
        s += f" Share counts split-adjusted for {', '.join(v['split_adjusted'][:4])}."
    if v.get("withheld"):
        s += f" Multiples withheld for {', '.join(v['withheld'][:4])} (see the panel for why)."
    return s
