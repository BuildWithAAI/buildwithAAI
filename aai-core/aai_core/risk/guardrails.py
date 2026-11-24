"""Account-level guardrails: daily-loss stop and max-drawdown de-risking (inputs from the book's account)."""
from __future__ import annotations

DEFAULT_LIMITS = {
    "max_total_risk_pct": 6.0,        # sum of open+proposed risk across ALL agents
    "max_correlated_risk_pct": 4.0,   # risk in one correlated cluster incl. the candidate
    "daily_loss_limit_pct": 3.0,      # day P&L <= -3% of day-start equity -> SKIP everything new
    "drawdown_reduce_pct": 10.0,      # equity <= peak*(1-10%) -> REDUCED
    "drawdown_halt_pct": 20.0,        # equity <= peak*(1-20%) -> SKIP
}


def limits(book: dict) -> dict:
    return {**DEFAULT_LIMITS, **{k: float(v) for k, v in (book.get("limits") or {}).items() if k in DEFAULT_LIMITS}}


def account_checks(account: dict, lim: dict) -> tuple[list[dict], dict]:
    """-> (reasons, metrics). reasons: {code, points, severity, detail, hard}."""
    out, m = [], {}
    eq, peak, day0 = account.get("equity"), account.get("equity_peak"), account.get("day_start_equity")
    if eq is not None and day0:
        day_pnl = (eq - day0) / day0 * 100
        m["day_pnl_pct"] = round(day_pnl, 4)
        if day_pnl <= -lim["daily_loss_limit_pct"]:
            out.append({"code": "daily_loss_limit", "points": 100, "severity": "hard", "hard": True,
                        "detail": f"day P&L {day_pnl:.2f}% <= -{lim['daily_loss_limit_pct']}%: no new risk today"})
    if eq is not None and peak:
        dd = (peak - eq) / peak * 100
        m["drawdown_pct"] = round(dd, 4)
        if dd >= lim["drawdown_halt_pct"]:
            out.append({"code": "max_drawdown_halt", "points": 100, "severity": "hard", "hard": True,
                        "detail": f"drawdown {dd:.2f}% >= {lim['drawdown_halt_pct']}%: halt new risk"})
        elif dd >= lim["drawdown_reduce_pct"]:
            out.append({"code": "drawdown_reduce", "points": 30, "severity": "warn", "hard": False,
                        "detail": f"drawdown {dd:.2f}% >= {lim['drawdown_reduce_pct']}%"})
    if not account:
        m["note"] = "no account state supplied (--book); guardrails not evaluated"
    return out, m
