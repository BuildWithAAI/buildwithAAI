"""DefiLlama stablecoin supply (keyless): total USD-pegged supply and 1d / 7d / 30d change, top issuers."""
from __future__ import annotations
from ... import guard
from ..core import FetchError, num

URL = "https://stablecoins.llama.fi/stablecoins"


def _usd(d):
    return num((d or {}).get("peggedUSD")) if isinstance(d, dict) else None


def parse(j) -> dict:
    assets = (j or {}).get("peggedAssets") if isinstance(j, dict) else None
    if not assets:
        raise FetchError("defillama: no peggedAssets", retryable=False)
    tot = {"now": 0.0, "d1": 0.0, "d7": 0.0, "d30": 0.0}
    top = []
    for a in assets:
        if a.get("pegType") != "peggedUSD":
            continue
        c, d1, d7, d30 = (_usd(a.get(k)) for k in ("circulating", "circulatingPrevDay", "circulatingPrevWeek", "circulatingPrevMonth"))
        if c is None:
            continue
        tot["now"] += c; tot["d1"] += d1 or c; tot["d7"] += d7 or c; tot["d30"] += d30 or c
        top.append({"symbol": guard.clean(a.get("symbol"), 12), "name": guard.clean(a.get("name"), 40), "supply": c,
                    "chg_7d": (c - d7) if d7 else None})
    top.sort(key=lambda x: -x["supply"])
    return {"total_usd": tot["now"], "chg_1d_usd": tot["now"] - tot["d1"], "chg_7d_usd": tot["now"] - tot["d7"],
            "chg_30d_usd": tot["now"] - tot["d30"], "chg_7d_pct": (tot["now"] / tot["d7"] - 1) if tot["d7"] else None,
            "top": top[:5]}


def fetch(f, cfg, prev=None) -> dict:
    return parse(f.get(URL, params={"includePrices": "false"}, timeout=20))
