"""Ledger side of the signal-driven shadow books (smr/paper/sigexit.py): marks history, the exit-watcher lease, and one
mark step per position. SIMULATION ONLY. Every function here runs INSIDE the caller's ledger transaction
(Ledger.tx(), BEGIN IMMEDIATE), so the 15-min cycle and the 1-min watcher are serialized by SQLite and each re-reads the
row inside its own transaction: an exit can never be applied twice.

Ownership: while the watcher's lease (meta 'exit_watcher_lease') is live, ONLY the watcher marks/exits the signal books;
the 15-min cycle skips them. If the watcher is dead (lease expired), the cycle applies the same step at its own cadence
(fallback, fills tagged by='cycle'). The watcher never writes to momentum / momentum_ladder / momentum_x1 rows and never
writes momentum events, so the live clip5 alerts are unchanged. The scanner book (smr/paper/scanner.py) is stepped the same way
(clip5_rug_dust) and is the one exception that writes events: PARTIAL_SELL here, SELL in engine.close_position."""
from __future__ import annotations
import json, time
from . import costs as K
from . import sigexit as SX
from .engine import SCANNER_BOOK, ALERT_SCANNER_BOOKS, close_position, iso_ct

LEASE_KEY = "exit_watcher_lease"
LEASE_TTL_S = 180
MARKS_KEEP_S = 7 * 86400

# ---- lease ------------------------------------------------------------------------------------------------------
MIN_MARK_GAP_S = 30          # a pending signal sale fills at a mark >= 30 s after the decision


def lease(led):
    r = led.one("SELECT v FROM meta WHERE k=?", (LEASE_KEY,))
    return SX.loads(r["v"], {}) if r else {}


def lease_active(led, now):
    return float(lease(led).get("until") or 0) > now


def renew_lease(led, pid, now, ttl=LEASE_TTL_S):
    led.db.execute("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)",
                   (LEASE_KEY, json.dumps({"pid": pid, "at": now, "until": now + ttl, "at_ct": iso_ct(now)})))


def release_lease(led, pid):
    cur = lease(led)
    if cur.get("pid") == pid:
        led.db.execute("DELETE FROM meta WHERE k=?", (LEASE_KEY,))


# ---- marks ------------------------------------------------------------------------------------------------------
def record_mark(led, q, now, by):
    mr = getattr(q, "mom_raw", None) or {}
    led.db.execute("INSERT OR IGNORE INTO marks (mint, at, price, liq, buys_m5, sells_m5, vol_m5, buys_h1, sells_h1, vol_h1, chg_m5, dex, pair, source, by) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (q.mint, now, q.price_usd, q.liquidity_usd, mr.get("buys_m5"), mr.get("sells_m5"), mr.get("vol_m5"), mr.get("buys_h1"),
                    mr.get("sells_h1"), mr.get("vol_h1"), mr.get("chg_m5"), q.dex, q.pair, q.source, by))


def history(led, mint, now, entry_at, entry_price):
    rows = led.q("SELECT at, price, buys_m5, sells_m5, vol_m5 FROM marks WHERE mint=? AND at>=? AND at<=? AND price>0 ORDER BY at",
                 (mint, max(entry_at, now - SX.HIST_S), now))
    if entry_at >= now - SX.HIST_S and (not rows or rows[0]["at"] > entry_at):
        rows.insert(0, {"at": entry_at, "price": entry_price, "buys_m5": None, "sells_m5": None, "vol_m5": None})
    return rows


def prune_marks(led, now):
    return led.db.execute("DELETE FROM marks WHERE at < ?", (now - MARKS_KEEP_S,)).rowcount


# ---- sells --------------------------------------------------------------------------------------------------------
def _log(p):
    return SX.loads(p.get("clip_log"), [])


def _sell(led, p, tokens, fill, liq, now, rec):
    """Sell `tokens` (never the dust) at `fill`; realize it into the book like a clip (partial_* columns)."""
    from . import fixed_fees as FF
    tokens = min(tokens, SX.tradeable(p))
    if tokens <= 0:
        return p
    t0 = p.get("tokens_initial") or p["tokens"]
    value = tokens * fill
    xc = K.exit_cost(value, liq, p["entry_cost"])
    proceeds = value * (1 - xc)  # percent-model net; fixed fees reduce PnL separately (never negative proceeds)
    frac = tokens / t0 if t0 else 0.0
    cost_basis = p["size_usd"] * frac
    fee, fee_upd = FF.apply_exit_fee(p, tradeable_tokens=tokens)
    trade_pnl = proceeds - cost_basis
    net_pnl = trade_pnl - fee
    n = int(p.get("clips_done") or 0) + 1
    log = _log(p)
    log.append({**rec, "clip": n, "fill_price_usd": fill, "tokens": tokens, "share_of_original_pct": round(frac * 100, 2),
                "exit_cost_pct": round(xc * 100, 2), "proceeds_usd": round(proceeds, 4),
                "fixed_fee_usd": round(fee, 6), "pnl_usd": round(net_pnl, 4)})
    upd = {"tokens": p["tokens"] - tokens, "tokens_initial": t0, "clips_done": n, "clip_log": json.dumps(log),
           "partial_frac": min(1.0, (p.get("partial_frac") or 0) + frac), "partial_tokens": (p.get("partial_tokens") or 0) + tokens,
           "partial_cost": xc, "partial_proceeds_usd": (p.get("partial_proceeds_usd") or 0) + proceeds,
           "partial_pnl_usd": (p.get("partial_pnl_usd") or 0) + net_pnl, **fee_upd}
    if not p.get("partial_at"):
        upd.update({"partial_at": now, "partial_price": fill})
    led.update("positions", {"id": p["id"]}, upd)
    p = {**p, **upd}
    if p.get("book") in ALERT_SCANNER_BOOKS:      # scanner + experiment100 alert (controls stay silent)
        from .scanbook import partial_event
        partial_event(led, p, {"mark_price_usd": fill, **rec}, tokens, proceeds, cost_basis, xc, now)
    return p


def _close_rest(led, p, reason, fill, liq, q, now, stats, trigger=None, rec=None):
    """Close the position: sell everything but the dust (fill None = dead token, proceeds 0). The realized PnL counts the
    dust at ZERO; the dust tokens stay on the row (tokens = dust_tokens) and keep being marked (dust_last_price)."""
    dust = p.get("dust_tokens") or 0.0
    rest = SX.tradeable(p)
    log = _log(p)
    if rec is not None:
        log.append({**rec, "clip": "close", "fill_price_usd": fill, "tokens": rest})
    led.update("positions", {"id": p["id"]}, {"clip_log": json.dumps(log)})
    close_position(led, {**p, "tokens": rest, "clip_log": json.dumps(log)}, reason, fill, liq, q, now, stats, trigger=trigger)
    upd = {"tokens": dust, "pending_sell": None, "dust_last_price": q.price_usd if (q is not None and fill) else None,
           "dust_last_at": now, "dust_liq": q.liquidity_usd if q is not None else None}
    led.update("positions", {"id": p["id"]}, upd)
    stats.setdefault("momentum", {}).setdefault("control_closed", 0)
    stats["momentum"]["control_closed"] += 1
    return {**p, **upd, "status": "closed", "exit_reason": reason}


def _fill_rec(kind, reason, intended, decided_at, fill, now, by, decided_by=None, extra=None):
    r = {"kind": kind, "reason": reason, "decided_at": decided_at, "decided_at_ct": iso_ct(decided_at), "intended_price_usd": intended,
         "fill_at": now, "fill_at_ct": iso_ct(now), "actual_fill_price_usd": fill, "delay_s": round(now - decided_at, 1),
         "fill_vs_intended_pct": round((fill / intended - 1) * 100, 2) if (fill and intended) else None,
         "decided_by": decided_by or by, "filled_by": by}
    if extra:
        r.update(extra)
    return r


def _exec_pending(led, p, q, now, by, stats, fills):
    pend = SX.loads(p.get("pending_sell"), None)
    if not pend or now - (pend.get("at") or 0) < MIN_MARK_GAP_S:      # fill at a LATER mark, never the deciding one
        return p
    price = q.price_usd
    liq = q.liquidity_usd if q.liquidity_usd is not None else p["last_liq"]
    rec = _fill_rec("signal", pend["why"], pend.get("px"), pend.get("at") or now, price, now, by, pend.get("by"),
                    {"fill_rule": "next mark after the signal", "signal": pend.get("f")})
    led.update("positions", {"id": p["id"]}, {"pending_sell": None})
    p = {**p, "pending_sell": None}
    t = SX.tradeable(p)
    if pend["frac"] >= 1 - 1e-9 or t * (1 - pend["frac"]) <= 1e-12:
        fills.append({"book": p["book"], "mint": p["mint"], **rec, "action": "close"})
        return _close_rest(led, p, pend["why"], price, liq, q, now, stats, trigger=pend.get("px"), rec=rec)
    fills.append({"book": p["book"], "mint": p["mint"], **rec, "action": "sell", "frac_of_rest": pend["frac"]})
    return _sell(led, p, t * pend["frac"], price, liq, now, rec)


def _set_pending(led, p, frac, why, price, now, by, f=None):
    pend = {"frac": frac, "why": why, "px": price, "at": now, "by": by}
    if f:
        # sighv feature keys + fade/rug audit keys (immutable observation for paper audit trail)
        keep = ("pressure", "red5", "red_src", "wick", "bigsell", "mdecay", "dd", "ext", "vol", "vol_src", "rug",
                "prev_price", "candles", "policy_version", "assumption_label", "decide_at", "decide_at_ct", "prev_at",
                "cur_price", "cur_buys_m5", "cur_sells_m5", "cur_sell_share", "prev_buys_m5", "prev_sells_m5",
                "prev_sell_share", "activity_kind", "activity_cur", "activity_prev", "activity_ratio", "thresholds",
                "source", "watcher_cadence_note", "reason")
        pend["f"] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in f.items() if k in keep}
    led.update("positions", {"id": p["id"]}, {"pending_sell": json.dumps(pend)})
    return {**p, "pending_sell": json.dumps(pend)}


# ---- one mark ---------------------------------------------------------------------------------------------------
def step(led, p, q, now, by, stats, candles=(), fills=None):
    """Mark one signal-book position and apply its exit. Call inside a ledger transaction with a FRESH row."""
    fills = fills if fills is not None else []
    name = p["exit_policy"]
    if q is None:
        led.update("positions", {"id": p["id"]}, {"last_mark_at": now})
        stats["unpriced_marks"] = stats.get("unpriced_marks", 0) + 1
        if now - (p["last_price_at"] or p["entry_at"]) >= 24 * 3600:
            _close_rest(led, p, "dead_token_no_price_24h", None, None, None, now, stats)
        return p
    record_mark(led, q, now, by)
    e = p["entry_price"]
    peak_before = max(p.get("peak_price") or e, e)
    r = q.price_usd / e - 1
    sup = led.one("SELECT supply, circ_supply FROM launches WHERE mint=?", (p["mint"],)) or {}
    from .engine import fdv_of
    upd = {"last_price": q.price_usd, "last_price_at": now, "last_mcap": fdv_of(q, sup.get("supply"), sup.get("circ_supply")),
           "last_mark_at": now, "min_ret": min(p["min_ret"] or 0, r), "max_ret": max(p["max_ret"] or 0, r),
           "peak_price": max(peak_before, q.price_usd)}
    if q.liquidity_usd is not None:
        upd["last_liq"] = q.liquidity_usd
    led.update("positions", {"id": p["id"]}, upd)
    p = {**p, **upd}
    stats["marked"] = stats.get("marked", 0) + 1
    p = _exec_pending(led, p, q, now, by, stats, fills)
    if p["status"] == "closed":
        return p
    price, liq = q.price_usd, (q.liquidity_usd if q.liquidity_usd is not None else p["last_liq"])
    hist = history(led, p["mint"], now, p["entry_at"], e)
    if name == "sighv":
        f = SX.features(hist, list(candles or []), peak_before)
        st0 = SX.loads(p.get("sig_state"), {})
        imm, pend, st = SX.decide_sighv(st0, e, p["entry_at"], price, peak_before, f, now)
        led.update("positions", {"id": p["id"]}, {"sig_state": json.dumps(st),
                                                    "stop_price": SX.stop_level(name, e, st.get("clipped"), p["peak_price"])})
        p = {**p, "sig_state": json.dumps(st)}
        if imm:
            rec = _fill_rec("stop" if imm[0] == "stop" else "max_hold", imm[1], imm[2] or price, now, price, now, by,
                            extra={"fill_rule": "the mark that crossed it (gap-through)"})
            fills.append({"book": p["book"], "mint": p["mint"], **rec, "action": "close"})
            return _close_rest(led, p, imm[1], price, liq, q, now, stats, trigger=imm[2], rec=rec)
        if pend:
            p = _set_pending(led, p, pend[0], pend[1], price, now, by, f)
        return p
    # clip5_rug_dust: live clip5 rules + rug + fade deterioration (flow data required or no fade)
    prev_mark = hist[-2] if len(hist) >= 2 and now - hist[-2]["at"] <= SX.PREV_MAX_AGE_S else None
    cur_mark = hist[-1] if hist else None
    prev = prev_mark["price"] if prev_mark else None
    acts, pend = SX.decide_clip5_rug_dust(p, price, prev, now, prev_mark=prev_mark, cur_mark=cur_mark)
    pol = SX.CLIP5_RUG_DUST
    for a in acts:
        if a[0] == "clip":
            _, n, mult, frac, tgt, fill = a
            t0 = p.get("tokens_initial") or p["tokens"]
            last = n == len(pol.rungs)
            rec = _fill_rec("rung", f"clip5_rug_dust_clip_{n}_{mult:g}x", tgt, now, fill, now, by,
                            extra={"multiple": mult, "mark_price_usd": price, "fill_rule": "rung price (mark at/above it; conservative)"})
            fills.append({"book": p["book"], "mint": p["mint"], **rec, "action": "close" if last else "sell"})
            if last:
                p = _sell(led, p, SX.tradeable(p), fill, liq, now, rec)
                return _close_rest(led, {**p, "clips_done": n}, "clip5_rug_dust_all_clips_filled", fill, liq, q, now, stats, trigger=tgt)
            p = _sell(led, p, min(t0 * frac, SX.tradeable(p)), fill, liq, now, rec)
            # clips_done follows the rung count (the rung policy reads it); signal sells never happen in this book
            led.update("positions", {"id": p["id"]}, {"clips_done": n}); p = {**p, "clips_done": n}
        else:
            rec = _fill_rec(a[0], a[1], a[2] or price, now, a[3], now, by, extra={"fill_rule": "the mark that crossed it (gap-through)"})
            fills.append({"book": p["book"], "mint": p["mint"], **rec, "action": "close"})
            return _close_rest(led, p, a[1], a[3], liq, q, now, stats, trigger=a[2], rec=rec)
    sl = SX.stop_level(name, e, int(p.get("clips_done") or 0) > 0, p["peak_price"])
    led.update("positions", {"id": p["id"]}, {"stop_price": sl})
    if pend:
        audit = pend[2] if len(pend) > 2 and isinstance(pend[2], dict) else {"rug": True, "prev_price": prev}
        if audit.get("decide_at_ct") is None and audit.get("decide_at"):
            audit = {**audit, "decide_at_ct": iso_ct(audit["decide_at"])}
        p = _set_pending(led, p, pend[0], pend[1], price, now, by, audit)
    return p


def mark_dust(led, p, q, now):
    if q is None:
        led.update("positions", {"id": p["id"]}, {"dust_last_at": now})
        return
    record_mark(led, q, now, "watcher_dust")
    led.update("positions", {"id": p["id"]}, {"dust_last_price": q.price_usd, "dust_last_at": now, "dust_liq": q.liquidity_usd})


def dust_values(p):
    """(dust tokens, value at the last price after exit costs, value at zero)."""
    dt = p.get("dust_tokens") or 0.0
    if p["status"] == "open":
        px, liq = p.get("last_price"), p.get("last_liq")
    else:
        px, liq = p.get("dust_last_price"), p.get("dust_liq")
    return dt, SX.dust_value(dt, px, liq, p["entry_cost"]), 0.0
