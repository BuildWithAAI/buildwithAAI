"""Event fields for the scanner book (SIMULATION ONLY). The scanner book uses the momentum_clip5_rug_dust exit
(sigexit.CLIP5_RUG_DUST: live clip5 rungs on the non-dust tokens + the 1-min rug rule + a permanent 5% dust bag), applied by
the 1-min exit watcher through sigbooks.step. Unlike the silent control books it alerts: BUY (scanner.py), PARTIAL_SELL
(one per sale, seq = sale number) and SELL (engine.close_position), all tagged book='scanner'."""
from __future__ import annotations
import json
from . import exits as X
from . import sigexit as SX
from .engine import SCANNER_BOOK, ALERT_SCANNER_BOOKS, book_state, iso_ct

POLICY = SX.CLIP5_RUG_DUST


def _log(pos):
    try:
        return json.loads(pos.get("clip_log") or "[]")
    except ValueError:
        return []


def clip_fields(pos, final_proceeds=None, last=None):
    """Clips filled, share sold / remaining (of all tokens; the 5% dust is never sold), profit locked, current stop, next rung, dust bag."""
    done = int(pos.get("clips_done") or 0)
    dust = pos.get("dust_frac") or SX.DUST_FRAC
    sold = min(X.sold_frac(POLICY, done), 1 - dust)          # rungs sell 20% of ALL tokens; the 5% dust is never sold
    e = pos["entry_price"]
    stop = pos.get("stop_price")
    if stop is None:
        stop = SX.stop_level(POLICY.name, e, done > 0, pos.get("peak_price") or e)
    pp = pos.get("partial_proceeds_usd")
    out = {"exit_policy": POLICY.name, "exit_policy_rule": SX.describe(POLICY.name), "clips_done": done, "clips_total": len(POLICY.rungs),
           "sold_pct_of_original": round(sold * 100, 1), "remaining_pct_of_original": round((1 - sold) * 100, 1),
           "cash_recovered_usd": None if pp is None else round(pp, 2), "profit_locked_usd": round(pos.get("partial_pnl_usd") or 0.0, 2),
           "stop_level_usd": stop, "stop_vs_entry_pct": None if not stop else round((stop / e - 1) * 100, 1),
           "stop_rule": X.stop_rule_text(POLICY, done), "next_rung": X.next_rung(POLICY, done, e), "peak_price_usd": pos.get("peak_price"),
           "dust_tokens": pos.get("dust_tokens"), "dust_pct": round(dust * 100, 1),
           "clip_fills": _log(pos)}
    if last is not None:
        out.update(last)
    if final_proceeds is not None:
        out["final_sale_proceeds_usd"] = round(final_proceeds, 2)
        if pos.get("exit_trigger_price") is not None:
            out["exit_trigger_price_usd"] = pos["exit_trigger_price"]
        out["exit_mark_price_usd"] = pos.get("exit_price")
    return out


def partial_event(led, p, rec, tokens, proceeds, cost_basis, xc, now):
    """PARTIAL_SELL event for one scanner sale (inside the caller's transaction). seq = sale number (unique per position)."""
    if p.get("book") not in ALERT_SCANNER_BOOKS:
        return
    buy = led.one("SELECT payload FROM events WHERE position_id=? AND kind='BUY'", (p["id"],))
    bp = json.loads(buy["payload"]) if buy else {"book": p.get("book") or SCANNER_BOOK, "mint": p["mint"], "position_id": p["id"],
                                                 "dexscreener_url": f"https://dexscreener.com/solana/{p['mint']}", "decision": p.get("decision"),
                                                 "score": p.get("score"), "size_usd": p.get("size_usd"), "entry_price_usd": p.get("entry_price")}
    n = int(p.get("clips_done") or 0)
    mult = rec.get("multiple")
    t0 = p.get("tokens_initial") or tokens
    last = {"clip_no": n, "clip_label": f"clip {n}/{len(POLICY.rungs)}" if mult is not None else f"sale {n} ({rec.get('reason')})",
            "clip_multiple": mult, "clip_trigger_price_usd": rec.get("intended_price_usd"), "clip_mark_price_usd": rec.get("mark_price_usd"),
            "clip_fill_price_usd": rec.get("actual_fill_price_usd"), "clip_share_sold_pct": round(tokens / t0 * 100, 1) if t0 else None,
            "clip_proceeds_usd": round(proceeds, 2), "clip_pnl_usd": round(proceeds - cost_basis, 2), "clip_at_ct": iso_ct(now),
            "clip_exit_cost_pct": round(xc * 100, 2), "clip_reason": rec.get("reason"), "fill_rule": rec.get("fill_rule")}
    payload = {**bp, "kind": "PARTIAL_SELL", "partial_reason": rec.get("reason"), "observed_price_usd": rec.get("mark_price_usd"),
               "hold_hours": round((now - p["entry_at"]) / 3600, 2), "bankroll_after": round(book_state(led, p["book"])["bankroll"], 2),
               **clip_fields(p, last=last), "simulated": True}
    led.insert("events", {"created_at": now, "book": p["book"], "kind": "PARTIAL_SELL", "position_id": p["id"], "mint": p["mint"],
                          "seq": n, "payload": payload}, mode="INSERT OR IGNORE")
