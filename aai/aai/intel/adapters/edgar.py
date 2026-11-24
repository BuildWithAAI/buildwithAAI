"""SEC EDGAR (keyless, fair-access: declared User-Agent with a contact, <= 10 req/s; we stay far below).
Recent Form 4 insider transactions (open-market buys = code P) and 8-K current reports for a configurable watchlist."""
from __future__ import annotations
import re, time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from ... import guard
from ..core import FetchError, num

TICKERS = "https://www.sec.gov/files/company_tickers.json"
SUBS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
ARCH = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{doc}"
INDEX = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type={form}&dateb=&owner=include&count=40"
DEFAULT_WATCH = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "JPM", "COIN", "MSTR", "PLTR"]
ITEMS_8K = {"1.01": "Material agreement", "1.02": "Agreement terminated", "1.03": "Bankruptcy", "1.05": "Cybersecurity incident",
            "2.01": "Acquisition/disposition", "2.02": "Results of operations", "2.03": "New debt obligation",
            "2.05": "Restructuring costs", "2.06": "Impairment", "3.01": "Delisting notice", "3.02": "Unregistered equity sale",
            "4.01": "Auditor change", "4.02": "Non-reliance on financials", "5.01": "Change in control",
            "5.02": "Officer/director change", "5.03": "Bylaws/charter amendment", "5.07": "Shareholder vote", "7.01": "Reg FD disclosure",
            "8.01": "Other events", "9.01": "Financial exhibits"}
TX_CODES = {"P": "open-market buy", "S": "open-market sale", "A": "award", "M": "option exercise", "F": "tax withholding",
            "G": "gift", "C": "conversion", "X": "option exercise", "D": "disposition to issuer", "J": "other"}
MAX_FORM4_FETCH = 24
LOOKBACK_DAYS = 30
_clock = time.time   # tests replay recorded filings against a fixed clock


def _t(node, path):
    x = node.find(path)
    return (x.text or "").strip() if x is not None and x.text else ""


def parse_form4(xml_text: str) -> dict:
    if len(xml_text) > 2_000_000:
        raise FetchError("form 4 too large", retryable=False)
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        raise FetchError("form 4 XML unparsable", retryable=False)
    owner = guard.clean(_t(root, "reportingOwner/reportingOwnerId/rptOwnerName"), 60)
    rel = root.find("reportingOwner/reportingOwnerRelationship")
    role = []
    if rel is not None:
        if _t(rel, "isDirector") in ("1", "true"):
            role.append("Director")
        if _t(rel, "isOfficer") in ("1", "true"):
            role.append(guard.clean(_t(rel, "officerTitle"), 40) or "Officer")
        if _t(rel, "isTenPercentOwner") in ("1", "true"):
            role.append("10% owner")
    tx, buy_sh, buy_usd, sell_sh, sell_usd = [], 0.0, 0.0, 0.0, 0.0
    for t in root.findall("nonDerivativeTable/nonDerivativeTransaction"):
        code = _t(t, "transactionCoding/transactionCode")[:1]
        sh, pxv = num(_t(t, "transactionAmounts/transactionShares/value")), num(_t(t, "transactionAmounts/transactionPricePerShare/value"))
        ad = _t(t, "transactionAmounts/transactionAcquiredDisposedCode/value")[:1]
        tx.append({"code": code, "what": TX_CODES.get(code, code or "?"), "date": _t(t, "transactionDate/value")[:10],
                   "shares": sh, "price": pxv, "ad": ad})
        if code == "P" and sh:
            buy_sh += sh; buy_usd += sh * (pxv or 0)
        if code == "S" and sh:
            sell_sh += sh; sell_usd += sh * (pxv or 0)
    plan = _t(root, "aff10b5One") in ("1", "true")
    codes = sorted({x["code"] for x in tx if x["code"]})
    return {"owner": owner, "role": ", ".join(role) or "insider", "codes": codes, "n_tx": len(tx), "plan_10b5_1": plan,
            "buy_shares": buy_sh or None, "buy_usd": round(buy_usd) if buy_usd else None,
            "sell_shares": sell_sh or None, "sell_usd": round(sell_usd) if sell_usd else None,
            "is_buy": buy_sh > 0, "period": _t(root, "periodOfReport")[:10]}


def recent_filings(sub: dict, forms=("4", "8-K"), days=LOOKBACK_DAYS, now_ts=None) -> list[dict]:
    r = ((sub or {}).get("filings") or {}).get("recent") or {}
    n = len(r.get("form") or [])
    cut = (now_ts or _clock()) - days * 86400
    out = []
    for i in range(n):
        form = r["form"][i]
        if form not in forms:
            continue
        try:
            acc_ts = datetime.fromisoformat(str(r["acceptanceDateTime"][i]).replace("Z", "+00:00")).timestamp()
        except (ValueError, KeyError, IndexError):
            continue
        if acc_ts < cut:
            continue
        items = [x.strip() for x in str((r.get("items") or [""] * n)[i] or "").split(",") if x.strip()]
        out.append({"form": form, "accession": r["accessionNumber"][i], "filed": r["filingDate"][i], "accepted_ts": acc_ts,
                    "doc": r["primaryDocument"][i], "items": items})
    return out


def fetch(f, cfg, prev=None) -> dict:
    ic = cfg.get("intel", {})
    watch = [str(t).upper() for t in (ic.get("watchlist") or DEFAULT_WATCH)][:25]
    contact = ic.get("sec_contact") or "zoora-aai-terminal@localhost"
    hdr = {"User-Agent": f"Zoora-AAI-Terminal/1.0 research {contact}"}
    pause = lambda: time.sleep(0.15)
    prev_cik = (prev or {}).get("cik_map") or {}
    cache = {x["accession"]: x for x in (prev or {}).get("filings") or [] if x.get("form") == "4" and x.get("parsed")}
    if all(t in prev_cik for t in watch):
        cik_map = {t: prev_cik[t] for t in watch}
    else:
        tick = f.get(TICKERS, headers=hdr, timeout=20)
        allmap = {str(v.get("ticker")).upper(): (int(v.get("cik_str")), guard.clean(v.get("title"), 60))
                  for v in (tick.values() if isinstance(tick, dict) else []) if num(v.get("cik_str"))}
        cik_map = {t: allmap[t] for t in watch if t in allmap}
        pause()
    if not cik_map:
        raise FetchError("EDGAR: no watchlist ticker resolved to a CIK", retryable=False)
    filings, errors, fetched4 = [], {}, 0
    for t, (cik, title) in cik_map.items():
        try:
            sub = f.get(SUBS.format(cik=cik), headers=hdr, timeout=20, retries=1)
        except FetchError as e:
            errors[t] = e.reason; continue
        finally:
            pause()
        for x in recent_filings(sub):
            acc = x["accession"].replace("-", "")
            base = re.sub(r"^xsl[^/]*/", "", x["doc"])
            row = {**x, "ticker": t, "company": title, "cik": cik,
                   "url": ARCH.format(cik=cik, acc=acc, doc=x["doc"] if x["form"] != "4" else x["doc"]),
                   "items_text": [ITEMS_8K.get(i, i) for i in x["items"] if i != "9.01"]}
            if x["form"] == "4":
                if x["accession"] in cache:
                    row.update({k: v for k, v in cache[x["accession"]].items() if k in ("parsed", "insider")})
                elif fetched4 < MAX_FORM4_FETCH:
                    fetched4 += 1
                    try:
                        row["insider"] = parse_form4(f.get(ARCH.format(cik=cik, acc=acc, doc=base), as_="text", headers=hdr, timeout=15, retries=1))
                        row["parsed"] = True
                    except FetchError as e:
                        row["insider"], row["parsed"] = {"error": e.reason}, False
                    pause()
            filings.append(row)
    filings.sort(key=lambda x: -x["accepted_ts"])
    buys = [x for x in filings if x["form"] == "4" and (x.get("insider") or {}).get("is_buy")]
    return {"watchlist": watch, "cik_map": cik_map, "filings": filings[:120], "insider_buys": buys[:20],
            "n_form4": sum(1 for x in filings if x["form"] == "4"), "n_8k": sum(1 for x in filings if x["form"] == "8-K"),
            "lookback_days": LOOKBACK_DAYS, "errors": errors, "form4_fetched": fetched4}
