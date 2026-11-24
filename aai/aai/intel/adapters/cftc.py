"""CFTC Commitments of Traders via the public Socrata API (keyless). Legacy futures-only report (non-commercial net)
plus Traders in Financial Futures (leveraged-fund net) where the market is financial. Weekly: Tuesday data, Friday release."""
from __future__ import annotations
from datetime import datetime, timezone
from ..core import FetchError, num

LEGACY = "https://publicreporting.cftc.gov/resource/6dca-aqww.json"
TFF = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"
PAGE = "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"
MARKETS = [("099741", "EUR", "Euro FX", "fx"), ("097741", "JPY", "Japanese yen", "fx"), ("096742", "GBP", "British pound", "fx"),
           ("232741", "AUD", "Australian dollar", "fx"), ("090741", "CAD", "Canadian dollar", "fx"), ("092741", "CHF", "Swiss franc", "fx"),
           ("098662", "DXY", "US dollar index", "fx"), ("088691", "XAU", "Gold (COMEX)", "commodity"),
           ("084691", "XAG", "Silver (COMEX)", "commodity"), ("067651", "WTI", "WTI crude (NYMEX)", "commodity"),
           ("13874A", "ES", "E-mini S&P 500", "equity"), ("209742", "NQ", "Nasdaq mini", "equity"),
           ("133741", "BTC", "Bitcoin (CME)", "crypto"), ("146021", "ETH", "Ether (CME)", "crypto")]
LEG_FIELDS = ("cftc_contract_market_code,report_date_as_yyyy_mm_dd,open_interest_all,noncomm_positions_long_all,"
              "noncomm_positions_short_all,change_in_noncomm_long_all,change_in_noncomm_short_all,comm_positions_long_all,comm_positions_short_all")
HIST_WEEKS = 12
TFF_FIELDS = ("cftc_contract_market_code,report_date_as_yyyy_mm_dd,lev_money_positions_long,lev_money_positions_short,"
              "change_in_lev_money_long,change_in_lev_money_short,asset_mgr_positions_long,asset_mgr_positions_short")


def _date(s):
    try:
        return datetime.fromisoformat(str(s)[:10]).replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def parse(legacy: list, tff: list) -> dict:
    if not isinstance(legacy, list) or not legacy:
        raise FetchError("COT legacy: no rows", retryable=False)
    by_code: dict[str, list] = {}
    for r in legacy:
        by_code.setdefault(str(r.get("cftc_contract_market_code")), []).append(r)
    tff_by: dict[str, list] = {}
    for r in tff if isinstance(tff, list) else []:
        tff_by.setdefault(str(r.get("cftc_contract_market_code")), []).append(r)
    rows, latest = [], None
    for code, sym, name, cls in MARKETS:
        rs = sorted(by_code.get(code) or [], key=lambda r: str(r.get("report_date_as_yyyy_mm_dd")), reverse=True)
        if not rs:
            continue
        r = rs[0]
        lo, sh, oi = num(r.get("noncomm_positions_long_all")), num(r.get("noncomm_positions_short_all")), num(r.get("open_interest_all"))
        dl, ds = num(r.get("change_in_noncomm_long_all")), num(r.get("change_in_noncomm_short_all"))
        if lo is None or sh is None:
            continue
        net = lo - sh
        prev = None
        if len(rs) > 1 and num(rs[1].get("noncomm_positions_long_all")) is not None:
            prev = num(rs[1]["noncomm_positions_long_all"]) - num(rs[1]["noncomm_positions_short_all"])
        hist = [num(x.get("noncomm_positions_long_all")) - num(x.get("noncomm_positions_short_all")) for x in rs[:26]
                if num(x.get("noncomm_positions_long_all")) is not None and num(x.get("noncomm_positions_short_all")) is not None]
        rng = (min(hist), max(hist)) if len(hist) >= 4 else None
        # Last 12 weekly reports, oldest first: [report_date, nc_net, oi]. Already in the fetched page, so no extra call.
        h12 = []
        for x in rs[:HIST_WEEKS]:
            xl, xs, xo = num(x.get("noncomm_positions_long_all")), num(x.get("noncomm_positions_short_all")), num(x.get("open_interest_all"))
            if xl is not None and xs is not None:
                h12.append([str(x.get("report_date_as_yyyy_mm_dd"))[:10], xl - xs, xo])
        h12.reverse()
        ts = _date(r.get("report_date_as_yyyy_mm_dd"))
        latest = max(latest or 0, ts or 0)
        row = {"code": code, "symbol": sym, "name": name, "class": cls, "report_date": str(r.get("report_date_as_yyyy_mm_dd"))[:10],
               "ts": ts, "oi": oi, "nc_long": lo, "nc_short": sh, "nc_net": net,
               "nc_net_chg": (dl - ds) if dl is not None and ds is not None else (net - prev if prev is not None else None),
               "nc_net_pct_oi": round(net / oi * 100, 1) if oi else None,
               "nc_index_26w": round((net - rng[0]) / (rng[1] - rng[0]) * 100) if rng and rng[1] > rng[0] else None, "n_weeks": len(hist), "nc_hist": h12}
        t = sorted(tff_by.get(code) or [], key=lambda x: str(x.get("report_date_as_yyyy_mm_dd")), reverse=True)
        if t and str(t[0].get("report_date_as_yyyy_mm_dd"))[:10] == row["report_date"]:
            ll, ls = num(t[0].get("lev_money_positions_long")), num(t[0].get("lev_money_positions_short"))
            cl, cs = num(t[0].get("change_in_lev_money_long")), num(t[0].get("change_in_lev_money_short"))
            al, ash = num(t[0].get("asset_mgr_positions_long")), num(t[0].get("asset_mgr_positions_short"))
            if ll is not None and ls is not None:
                row.update(lev_net=ll - ls, lev_net_chg=(cl - cs) if cl is not None and cs is not None else None,
                           am_net=(al - ash) if al is not None and ash is not None else None)
        rows.append(row)
    if not rows:
        raise FetchError("COT: none of the tracked markets present", retryable=False)
    return {"rows": rows, "report_date": datetime.fromtimestamp(latest, timezone.utc).strftime("%Y-%m-%d") if latest else None,
            "report_ts": latest}


def fetch(f, cfg, prev=None) -> dict:
    codes = ",".join(f"'{c}'" for c, *_ in MARKETS)
    q = {"$where": f"cftc_contract_market_code in({codes})", "$order": "report_date_as_yyyy_mm_dd DESC", "$limit": str(len(MARKETS) * 27)}
    legacy = f.get(LEGACY, params={**q, "$select": LEG_FIELDS}, timeout=30)
    fin = ",".join(f"'{c}'" for c, _, _, cls in MARKETS if cls != "commodity")
    try:
        tff = f.get(TFF, params={"$where": f"cftc_contract_market_code in({fin})", "$order": "report_date_as_yyyy_mm_dd DESC",
                                 "$limit": "40", "$select": TFF_FIELDS}, timeout=30)
    except FetchError:
        tff = []   # leveraged-fund columns simply stay empty
    return parse(legacy, tff)
