"""SEC EDGAR XBRL company facts (keyless, same fair-access User-Agent as the filings feed): a fundamentals snapshot per
watchlist ticker from the issuer's own 10-K / 10-Q numbers. T11 long-term desk, audit-only research.

Per ticker: revenue TTM (+ YoY), net income TTM, operating cash flow and capex TTM, free cash flow (OCF - capex), cash +
short-term investments, long-term debt, shares outstanding (+ YoY dilution) and, only when free cash flow is negative,
months of runway at that burn. Everything is computed from reported facts; a number the filings do not support is None,
never estimated. No price here: multiples (market cap, EV, P/S, FCF yield) come from aai/intel/valuation.py joining the watch_quotes feed."""
from __future__ import annotations
import time
from datetime import date, timedelta
from ... import guard
from ..core import FetchError, num
from .edgar import DEFAULT_WATCH, TICKERS

FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
CONCEPTS = {  # first concept with the newest data wins (issuers switch tags over time, e.g. Apple left `Revenues` in 2018)
    "revenue": ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax",
                "SalesRevenueNet", "RevenuesNetOfInterestExpense"),
    "net_income": ("NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"),
    "ocf": ("NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"),
    "capex": ("PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"),
    "cash": ("CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"),
    "st_inv": ("ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"),
    "debt": ("LongTermDebt", "LongTermDebtNoncurrent", "LongTermNotesPayable", "ConvertibleNotesPayable"),
}
SHARES = "EntityCommonStockSharesOutstanding"
SHARES_FALLBACK = "WeightedAverageNumberOfSharesOutstandingBasic"   # some filers (e.g. Strategy/MSTR) tag no cover-page count
BANK_TAGS = ("Deposits", "InterestExpenseDeposits")   # deposit-taking lender: FCF and runway do not apply
FORMS = ("10-K", "10-Q", "10-K/A", "10-Q/A", "10-KT")
MAX_TICKERS = 25
STALE_DAYS = 200      # newest reported period older than this: the issuer is late or stopped filing 10-Qs
NOTE = ("SEC XBRL company facts from 10-K/10-Q filings. TTM = trailing four quarters (FY + YTD - prior YTD). "
        "FCF = operating cash flow - capex. Runway = (cash + short-term investments) / monthly FCF burn. Not a signal.")
_clock = time.time


def _d(s) -> date | None:
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def _rows(facts: dict, names, unit="USD") -> tuple[str | None, list[dict]]:
    """The concept (of `names`) whose 10-K/10-Q facts reach the latest period, deduped by period keeping the latest filing."""
    g = (facts or {}).get("us-gaap") or {}
    best, best_rows, best_end = None, [], None
    for n in names:
        xs = (((g.get(n) or {}).get("units") or {}).get(unit)) or []
        per = {}
        for x in xs:
            if not isinstance(x, dict) or str(x.get("form") or "") not in FORMS:
                continue
            v, end, st = num(x.get("val")), _d(x.get("end")), _d(x.get("start")) if x.get("start") else None
            if v is None or end is None:
                continue
            k = (st, end)
            if k not in per or str(x.get("filed") or "") >= per[k]["filed"]:
                per[k] = {"start": st, "end": end, "val": v, "filed": str(x.get("filed") or ""), "form": str(x.get("form"))}
        rows = list(per.values())
        if rows:
            e = max(r["end"] for r in rows)
            if best_end is None or e > best_end:
                best, best_rows, best_end = n, rows, e
    return best, best_rows


def _dur(r) -> int:
    return (r["end"] - r["start"]).days if r.get("start") else 0


def _near(a: date, b: date, tol=10) -> bool:
    return abs((a - b).days) <= tol


def ttm(rows: list[dict], end: date) -> float | None:
    """Trailing-twelve-month sum of a duration concept ending at `end`, from reported periods only:
    a fiscal year ending there; else FY + YTD - prior-year YTD; else four chained quarters. None if unsupported."""
    dur = [r for r in rows if r.get("start")]
    fy = [r for r in dur if r["end"] == end and 350 <= _dur(r) <= 380]
    if fy:
        return fy[0]["val"]
    ytd = sorted((r for r in dur if r["end"] == end and 80 <= _dur(r) < 350), key=_dur, reverse=True)
    for x in ytd:
        prior_fy = [r for r in dur if 350 <= _dur(r) <= 380 and _near(r["end"], x["start"] - timedelta(days=1))]
        prior_ytd = [r for r in dur if abs(_dur(r) - _dur(x)) <= 10 and _near(r["end"], x["end"] - timedelta(days=365))]
        if prior_fy and prior_ytd:
            return prior_fy[0]["val"] + x["val"] - prior_ytd[0]["val"]
    q = [r for r in dur if 80 <= _dur(r) <= 100]
    chain, e = [], end
    for _ in range(4):
        nxt = next((r for r in q if _near(r["end"], e, 5)), None)
        if not nxt:
            return None
        chain.append(nxt["val"]); e = nxt["start"] - timedelta(days=1)
    return sum(chain)


def latest_end(rows: list[dict]) -> date | None:
    ends = [r["end"] for r in rows if r.get("start") and _dur(r) <= 380]
    return max(ends) if ends else None


def _instant(rows: list[dict], end: date | None = None) -> tuple[float | None, date | None]:
    inst = [r for r in rows if not r.get("start")]
    if end is not None:
        inst = [r for r in inst if _near(r["end"], end, 5)]
    if not inst:
        return None, None
    r = max(inst, key=lambda r: (r["end"], r["filed"]))
    return r["val"], r["end"]


def shares(facts: dict) -> dict:
    """Cover-page shares outstanding (dei), summed across share classes in one filing; YoY vs the cover ~1 year earlier.
    Without a cover-page count, falls back to the latest quarter's weighted-average basic shares vs the same quarter a year
    earlier (`shares_basis` says which)."""
    xs = ((((facts or {}).get("dei") or {}).get(SHARES) or {}).get("units") or {}).get("shares") or []
    grp: dict = {}
    for x in xs:
        v, end = num(x.get("val")) if isinstance(x, dict) else None, _d(x.get("end")) if isinstance(x, dict) else None
        if v is None or end is None or v <= 0:
            continue
        grp.setdefault((str(x.get("accn") or ""), end), []).append(v)
    if grp:
        pts = sorted(((end, sum(v), len(v)) for (_, end), v in grp.items()), key=lambda p: p[0])
        basis = "cover page"
    else:
        _, q = _rows(facts, (SHARES_FALLBACK,), unit="shares")
        pts = sorted(((r["end"], r["val"], 1) for r in q if r.get("start") and 80 <= _dur(r) <= 100 and r["val"] > 0), key=lambda p: p[0])
        basis = "weighted avg basic (quarter)"
    if not pts:
        return {"shares": None, "shares_end": None, "shares_yoy": None, "share_classes": 0, "shares_basis": None,
                "shares_prior": None, "shares_prior_end": None}
    end, now, ncls = pts[-1]
    target = end - timedelta(days=365)
    old = [p for p in pts if abs((p[0] - target).days) <= 60]
    prior = min(old, key=lambda p: abs((p[0] - target).days)) if old else None
    return {"shares": now, "shares_end": end.isoformat(), "share_classes": ncls, "shares_basis": basis,
            "shares_yoy": (now / prior[1] - 1) if prior and prior[1] else None,
            # T11e: the YoY base as reported (not split-adjusted), so the valuation join can adjust for a split in between
            "shares_prior": prior[1] if prior else None, "shares_prior_end": prior[0].isoformat() if prior else None}


def snapshot(facts: dict, now_ts: float | None = None) -> dict:
    """Pure: one ticker's fundamentals snapshot from a companyfacts `facts` block."""
    today = date.fromtimestamp(now_ts or _clock())
    rev_c, rev = _rows(facts, CONCEPTS["revenue"])
    _, ni = _rows(facts, CONCEPTS["net_income"])
    _, ocf = _rows(facts, CONCEPTS["ocf"])
    _, cap = _rows(facts, CONCEPTS["capex"])
    _, cash = _rows(facts, CONCEPTS["cash"])
    _, sti = _rows(facts, CONCEPTS["st_inv"])
    _, debt = _rows(facts, CONCEPTS["debt"])
    # the snapshot period is the newest cash-flow period (every 10-Q/10-K has one); revenue may be absent (pre-revenue)
    end = latest_end(ocf) or latest_end(ni) or latest_end(rev)
    out = {"period_end": end.isoformat() if end else None, "revenue_concept": rev_c, "flags": []}
    if end is None:
        out["flags"].append("NO US-GAAP DATA")
        out.update(shares(facts))
        return out
    filed = max((r["filed"] for r in ocf + ni + rev if r["end"] == end), default=None)
    form = next((r["form"] for r in sorted(ocf + ni + rev, key=lambda r: r["filed"], reverse=True) if r["end"] == end), None)
    r_now = ttm(rev, end) if rev else None
    # pre-revenue issuers often stop tagging revenue; an old revenue concept is not today's TTM
    if rev and latest_end(rev) and (end - latest_end(rev)).days > 100:
        r_now = None
    r_prev = ttm(rev, end - timedelta(days=365)) if r_now is not None else None
    if r_now is not None and r_prev is None:   # prior-year period ends a few days off the exact date (52/53-week years)
        cand = [r["end"] for r in rev if r.get("start") and _near(r["end"], end - timedelta(days=365))]
        r_prev = next((v for v in (ttm(rev, c) for c in cand) if v is not None), None)
    o, c = ttm(ocf, end), ttm(cap, end) if cap else None
    fcf = (o - (c or 0.0)) if o is not None else None
    g = (facts or {}).get("us-gaap") or {}
    bank = bool(_rows(facts, BANK_TAGS[:1])[1]) and BANK_TAGS[1] in g
    if bank:   # a bank's operating cash flow swings with trading assets and loans; "burn" and "runway" would be noise
        fcf = None
    cv, cend = _instant(cash, end)
    if cv is None:
        cv, cend = _instant(cash)
    sv, _ = _instant(sti, cend) if cend else (None, None)
    dv, _ = _instant(debt, cend) if cend else (None, None)
    liq = (cv or 0.0) + (sv or 0.0) if cv is not None else None
    # runway only for an operating burn (OCF < 0); a profitable company out-spending OCF on capex is flagged, not timed
    runway = (liq / (-fcf / 12.0)) if (fcf is not None and fcf < 0 and o is not None and o < 0 and liq) else None
    out.update({"filed": filed, "form": form, "revenue_ttm": r_now,
                "revenue_yoy": (r_now / r_prev - 1) if (r_now is not None and r_prev and r_prev > 0) else None,
                "net_income_ttm": ttm(ni, end), "ocf_ttm": o, "capex_ttm": c, "fcf_ttm": fcf,
                "fcf_basis": ("n/a for a bank (deposits/loans run through operating cash flow)" if bank else
                              "OCF - capex" if c is not None else ("OCF only (no capex tag)" if o is not None else None)),
                "cash": cv, "st_investments": sv, "liquidity": liq, "cash_end": cend.isoformat() if cend else None,
                "debt": dv, "runway_months": round(runway, 1) if runway is not None else None})
    out.update(shares(facts))
    f = out["flags"]
    if bank:
        f.append("BANK")
    if fcf is not None and fcf < 0:
        f.append("BURN")
        if o is not None and o >= 0:
            f.append("CAPEX_GT_OCF")
    if runway is not None and runway < 12:
        f.append("RUNWAY_LT_12M")
    if out["shares_yoy"] is not None and out["shares_yoy"] >= 0.10:
        f.append("DILUTION_GT_10PCT")
    if (today - end).days > STALE_DAYS:
        f.append("STALE PERIOD")
    return out


def fetch(f, cfg, prev=None) -> dict:
    ic = cfg.get("intel", {})
    watch = [str(t).upper() for t in (ic.get("watchlist") or DEFAULT_WATCH)][:MAX_TICKERS]
    contact = ic.get("sec_contact") or "zoora-aai-terminal@localhost"
    hdr = {"User-Agent": f"Zoora-AAI-Terminal/1.0 research {contact}"}
    pause = lambda: time.sleep(0.15)
    prev_cik = (prev or {}).get("cik_map") or {}
    if all(t in prev_cik for t in watch):
        cik_map = {t: prev_cik[t] for t in watch}
    else:
        tick = f.get(TICKERS, headers=hdr, timeout=20)
        allmap = {str(v.get("ticker")).upper(): (int(v.get("cik_str")), guard.clean(v.get("title"), 60))
                  for v in (tick.values() if isinstance(tick, dict) else []) if num(v.get("cik_str"))}
        cik_map = {t: allmap[t] for t in watch if t in allmap}
        pause()
    if not cik_map:
        raise FetchError("EDGAR XBRL: no watchlist ticker resolved to a CIK", retryable=False)
    rows, errors = [], {}
    for t, (cik, title) in cik_map.items():
        try:
            body = f.get(FACTS.format(cik=cik), headers=hdr, timeout=30, retries=1)
        except FetchError as e:
            errors[t] = e.reason; continue
        finally:
            pause()
        try:
            snap = snapshot((body or {}).get("facts") or {})
        except Exception as e:  # noqa: BLE001  one malformed issuer drops only that row
            errors[t] = f"parse error: {type(e).__name__}"; continue
        rows.append({"ticker": t, "company": title, "cik": cik,
                     "url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-&dateb=&owner=include&count=40",
                     **snap})
    if not rows:
        raise FetchError("EDGAR XBRL: every company facts request failed: " + "; ".join(f"{k} {v}" for k, v in list(errors.items())[:3]))
    src = "file" if ic.get("watchlist_source") == "file" else "config"
    return {"watchlist": watch, "watchlist_source": src, "unresolved": [t for t in watch if t not in cik_map],
            "cik_map": cik_map, "rows": rows, "errors": errors, "note": NOTE}


def _shares_line(r: dict, qrows: dict) -> str:
    """T11i: the spoken 1Y share-count change, split-adjusted like panel 18 and the dilution alarm (valuation.split_yoy).
    A split that cannot be taken out is spoken as 'not comparable', never as the reported jump (a 10:1 is not +900%)."""
    from aai.intel import valuation
    try:
        y = valuation.split_yoy(r, qrows.get(str(r.get("ticker") or "").upper()))
    except Exception:  # noqa: BLE001  malformed row: say nothing rather than a wrong number
        return ""
    if y["status"] == "unknown":
        return ", share count change not comparable across a split"
    v = y["yoy"]
    if v is None or abs(v) < 0.02:
        return ""
    return f", share count {v * 100:+.0f}% in a year" + (", split-adjusted" if y["status"] == "adjusted" else "")


def text(p: dict | None, quotes: dict | None = None) -> str:
    """Spoken summary: burners with the shortest runway first, then the rest by name. Never a buy/sell call.
    `quotes` (the watch_quotes payload) supplies split events for the share-count line (T11i); without it the reported
    change is spoken as before."""
    if not p or not p.get("rows"):
        return ""
    qrows = {}
    for q in ((quotes or {}).get("rows") if isinstance(quotes, dict) and isinstance(quotes.get("rows"), list) else []):
        if isinstance(q, dict) and isinstance(q.get("ticker"), str):
            qrows[q["ticker"].upper()] = q
    def m(v):
        if v is None:
            return "n/a"
        a = abs(v)
        s = f"{a / 1e9:.1f} billion" if a >= 1e9 else f"{a / 1e6:.0f} million" if a >= 1e6 else f"{a:,.0f}"
        return ("minus " if v < 0 else "") + s + " dollars"
    rows = [r for r in p["rows"] if r.get("period_end")]
    burn = sorted((r for r in rows if r.get("runway_months") is not None), key=lambda r: r["runway_months"])
    rest = [r for r in rows if r not in burn]
    bits = []
    for r in (burn + rest)[:4]:
        s = f"{r['ticker']}: revenue TTM {m(r.get('revenue_ttm'))}"
        if r.get("revenue_yoy") is not None:
            s += f" ({r['revenue_yoy'] * 100:+.0f}% year on year)"
        fl = r.get("flags") or []
        if "BANK" in fl:
            s += ", a bank, so no free cash flow or runway read"
        else:
            s += f", free cash flow {m(r.get('fcf_ttm'))}" + (", capex above operating cash flow" if "CAPEX_GT_OCF" in fl else "")
        if r.get("runway_months") is not None:
            s += (f", about {r['runway_months']:.0f} months of runway on {m(r.get('liquidity'))} cash" if r["runway_months"] < 120
                  else f", a small burn against {m(r.get('liquidity'))} cash, over ten years of runway")
        s += _shares_line(r, qrows)
        bits.append(s)
    s = (f"Fundamentals from SEC filings for {len(rows)} watchlist names, latest 10-Q or 10-K, no price so no multiples. "
         + ". ".join(bits) + ".")
    if len(rows) > 4:
        s += f" {len(rows) - 4} more on the fundamentals panel."
    return s
