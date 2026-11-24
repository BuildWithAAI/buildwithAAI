"""Cross-agent exposure aggregation and correlation.

A *book* is the AAI Terminal's view of every agent's open and proposed positions:
  {"account": {"bankroll": 10000, "equity": 9800, "equity_peak": 10400, "day_start_equity": 9900},
   "limits":  {"max_total_risk_pct": 6, "max_correlated_risk_pct": 4, "daily_loss_limit_pct": 3, ...},
   "positions": [{"agent": "perps", "asset_class": "crypto_perp", "symbol": "ETHUSDT", "side": "long",
                  "entry": 3000, "stop": 2900, "qty": 1.0, "status": "open"|"proposed"}, ...]}
risk_amount defaults to qty*|entry-stop|; trading positions without a stop count their full notional as risk
(conservative, e.g. meme coins).

horizon: "trading" | "long_term". Long-term holdings (Stocks Roth/401k, 2040 Future) are reported in gross
exposure but excluded from the per-trade risk budgets (a buy-and-hold position has no stop, so its "risk"
is not comparable to a 1-3% stop-based trade). Default: equity without a stop -> long_term, else trading.
"""
from __future__ import annotations
import json, math
from .vol import log_returns

CRYPTO = {"crypto_perp", "solana_meme", "crypto_spot"}
ASSUMED_CRYPTO_CORR = 0.8   # used when two crypto assets lack overlapping price data (memecoins)


def position_risk(p: dict) -> tuple[float, float]:
    """-> (notional, risk_amount) in account currency."""
    qty, entry = float(p.get("qty") or 0), float(p.get("entry") or 0)
    notional = float(p.get("notional") or qty * entry)
    if p.get("risk_amount") is not None:
        return notional, float(p["risk_amount"])
    if p.get("stop") and qty:
        return notional, qty * abs(entry - float(p["stop"]))
    return notional, notional


def horizon(p: dict) -> str:
    h = p.get("horizon")
    if h in ("trading", "long_term"):
        return h
    return "long_term" if p.get("asset_class") == "equity" and not p.get("stop") else "trading"


def trading_positions(positions: list[dict]) -> list[dict]:
    return [p for p in positions if horizon(p) == "trading"]


def load_book(path: str | None) -> dict:
    if not path:
        return {"account": {}, "limits": {}, "positions": []}
    with open(path) as f:
        b = json.load(f)
    b.setdefault("account", {}); b.setdefault("limits", {}); b.setdefault("positions", [])
    return b


def aggregate(book: dict, bankroll: float | None = None) -> dict:
    bankroll = bankroll or book["account"].get("bankroll") or book["account"].get("equity")
    by_class, by_agent, gross, net, risk, lt = {}, {}, 0.0, 0.0, 0.0, 0.0
    rows = []
    for p in book["positions"]:
        n, r = position_risk(p)
        hz = horizon(p)
        if hz == "long_term":
            lt += n; r = 0.0
        sgn = 1 if p.get("side", "long") == "long" else -1
        gross += n; net += sgn * n; risk += r
        for key, d in ((p.get("asset_class", "?"), by_class), (p.get("agent", "?"), by_agent)):
            e = d.setdefault(key, {"gross": 0.0, "net": 0.0, "risk": 0.0, "n": 0})
            e["gross"] += n; e["net"] += sgn * n; e["risk"] += r; e["n"] += 1
        rows.append({**{k: p.get(k) for k in ("agent", "asset_class", "symbol", "side", "status")}, "horizon": hz, "notional": round(n, 2), "risk_amount": round(r, 2)})
    pct = (lambda x: round(x / bankroll * 100, 4)) if bankroll else (lambda x: None)
    for d in (by_class, by_agent):
        for e in d.values():
            e.update({"gross_pct": pct(e["gross"]), "net_pct": pct(e["net"]), "risk_pct": pct(e["risk"])})
            for k in ("gross", "net", "risk"):
                e[k] = round(e[k], 2)
    return {"bankroll": bankroll, "n_positions": len(rows), "gross": round(gross, 2), "net": round(net, 2),
            "total_risk": round(risk, 2), "long_term_notional": round(lt, 2), "long_term_pct": pct(lt), "gross_pct": pct(gross), "net_pct": pct(net), "total_risk_pct": pct(risk),
            "by_asset_class": by_class, "by_agent": by_agent, "positions": rows}


def correlation(a: list[float], b: list[float]) -> float | None:
    """Pearson correlation of two equal-length return series (None if < 10 points or zero variance)."""
    n = min(len(a), len(b))
    if n < 10:
        return None
    a, b = a[-n:], b[-n:]
    ma, mb = sum(a) / n, sum(b) / n
    sa = math.sqrt(sum((x - ma) ** 2 for x in a)); sb = math.sqrt(sum((y - mb) ** 2 for y in b))
    if sa == 0 or sb == 0:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sa * sb)


def aligned_returns(sa: list, sb: list) -> tuple[list[float], list[float]]:
    """Align two daily candle lists on calendar day (UTC) and return log returns of common days."""
    da = {c[0] // 86400: c[4] for c in sa}
    db = {c[0] // 86400: c[4] for c in sb}
    days = sorted(set(da) & set(db))
    return log_returns([da[d] for d in days]), log_returns([db[d] for d in days])


def correlated_risk(candidate: dict, positions: list[dict], corr_of, threshold: float = 0.7) -> dict:
    """Sum the risk of positions that move WITH the candidate (same direction & corr>=thr, or opposite
    direction & corr<=-thr). corr_of(pos) -> float|None. Unknown correlation between two crypto assets is
    assumed ASSUMED_CRYPTO_CORR (conservative); unknown otherwise counts as uncorrelated."""
    cs = 1 if candidate["side"] == "long" else -1
    members, total = [], 0.0
    for p in trading_positions(positions):
        rho = corr_of(p)
        assumed = False
        if rho is None and p.get("asset_class") in CRYPTO and candidate["asset_class"] in CRYPTO:
            rho, assumed = ASSUMED_CRYPTO_CORR, True
        if rho is None:
            continue
        ps = 1 if p.get("side", "long") == "long" else -1
        if rho * cs * ps >= threshold:
            _, r = position_risk(p)
            total += r
            members.append({"symbol": p.get("symbol"), "agent": p.get("agent"), "corr": round(rho, 3), "assumed": assumed, "risk_amount": round(r, 2)})
    return {"threshold": threshold, "members": members, "existing_correlated_risk": round(total, 2)}
