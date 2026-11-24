"""`paper report` and `paper events`: read-only views of data/paper.db."""
from __future__ import annotations
import json, re, time
from . import costs as K
from . import exits as X
from . import sigexit as SX
from .engine import BOOKS, ALL_BOOKS, MOMENTUM_BOOK, CONTROL_BOOKS, SIGNAL_BOOKS, EVENT_BOOKS, SCANNER_BOOK, EXPERIMENT100_BOOK, ALERT_SCANNER_BOOKS, START_BANKROLL, start_bankroll_for, TAKE_PROFIT, STOP_LOSS, TIME_EXIT_S, DUMP_THRESHOLD, iso_ct, fmt_usd, fmt_px, dex_url, liquidation_value


def _max_drawdown(series, start=None):
    peak, mdd = (START_BANKROLL if start is None else start), 0.0
    for v in series:
        peak = max(peak, v)
        if peak > 0:
            mdd = max(mdd, (peak - v) / peak)
    return round(mdd * 100, 2)


def book_report(led, book):
    closed = led.q("SELECT * FROM positions WHERE book=? AND status='closed' AND void_reason IS NULL ORDER BY exit_at", (book,))
    opn = led.q("SELECT * FROM positions WHERE book=? AND status='open' AND void_reason IS NULL ORDER BY entry_at", (book,))
    # moon-bag partial sells (momentum book) are realized on the sold fraction; NULL (0) for the other books
    start = start_bankroll_for(book)
    realized = sum(p["pnl_usd"] for p in closed) + sum(p.get("partial_pnl_usd") or 0 for p in opn)
    bankroll = start + realized
    unreal = sum(liquidation_value(p) - p["size_usd"] * (1 - (p.get("partial_frac") or 0)) for p in opn)
    wins = [p for p in closed if p["pnl_usd"] > 0]
    losses = [p for p in closed if p["pnl_usd"] <= 0]
    # drawdown over realized steps + per-cycle mark-to-market snapshots
    pts = []
    run = start
    for p in closed:
        run += p["pnl_usd"]; pts.append((p["exit_at"], run))
    pts += [(e["at"], e["mtm"]) for e in led.q("SELECT at, mtm FROM equity WHERE book=? AND void_reason IS NULL", (book,))]
    pts.sort()
    by_dec = {}
    for p in closed + opn:
        d = by_dec.setdefault(p["decision"], {"trades": 0, "open": 0, "closed": 0, "pnl_usd": 0.0, "wins": 0})
        d["trades"] += 1
        if p["status"] == "open":
            d["open"] += 1
        else:
            d["closed"] += 1; d["pnl_usd"] = round(d["pnl_usd"] + p["pnl_usd"], 2); d["wins"] += int(p["pnl_usd"] > 0)
    reasons = {}
    for p in closed:
        reasons[p["exit_reason"]] = reasons.get(p["exit_reason"], 0) + 1
    misses = led.one("SELECT COUNT(*) AS n FROM misses WHERE book=? AND void_reason IS NULL", (book,))["n"]
    return {
        "book": book, "starting_bankroll": start, "bankroll_realized": round(bankroll, 2),
        "equity_mark_to_market": round(bankroll + unreal, 2), "realized_pnl_usd": round(realized, 2), "unrealized_pnl_usd": round(unreal, 2),
        "return_pct_realized": round((bankroll - start) / start * 100, 2) if start else 0.0,
        "return_pct_mtm": round((bankroll + unreal - start) / start * 100, 2) if start else 0.0,
        "trades_total": len(closed) + len(opn), "trades_closed": len(closed), "trades_open": len(opn),
        "win_rate_pct": round(len(wins) / len(closed) * 100, 1) if closed else None,
        "avg_win_usd": round(sum(p["pnl_usd"] for p in wins) / len(wins), 2) if wins else None,
        "avg_win_pct": round(sum(p["pnl_pct"] for p in wins) / len(wins) * 100, 1) if wins else None,
        "avg_loss_usd": round(sum(p["pnl_usd"] for p in losses) / len(losses), 2) if losses else None,
        "avg_loss_pct": round(sum(p["pnl_pct"] for p in losses) / len(losses) * 100, 1) if losses else None,
        "max_drawdown_pct": _max_drawdown([v for _, v in pts], start=start), "by_decision": by_dec, "exit_reasons": reasons,
        "missed_no_cash": misses, "open_exposure_usd": round(sum(p["size_usd"] * (1 - (p.get("partial_frac") or 0)) for p in opn), 2),
    }


def momentum_section(led):
    """Momentum-book specifics: themes traded, partial (2x) sells, moon bags, last cycle's hot themes. Unproven."""
    ps = led.q("SELECT p.*, l.symbol FROM positions p LEFT JOIN launches l ON l.mint=p.mint WHERE p.book=? AND p.void_reason IS NULL ORDER BY p.entry_at",
               (MOMENTUM_BOOK,))
    themes = {}
    for p in ps:
        t = themes.setdefault(p["theme"] or "(none)", {"trades": 0, "closed_pnl_usd": 0.0, "partials": 0})
        t["trades"] += 1; t["partials"] += int(bool(p["partial_at"]))
        if p["status"] == "closed":
            t["closed_pnl_usd"] = round(t["closed_pnl_usd"] + p["pnl_usd"], 2)
    st = {r["s"]: r["n"] for r in led.q("SELECT momentum_status AS s, COUNT(*) AS n FROM launches WHERE void_reason IS NULL AND momentum_status IS NOT NULL GROUP BY s")}
    hot, hot_at = [], None
    for c in led.q("SELECT stats, finished_at FROM cycles WHERE finished_at IS NOT NULL AND stats LIKE '%hot_themes%' ORDER BY id DESC LIMIT 12"):
        try:
            hot = (json.loads(c["stats"]).get("momentum") or {}).get("hot_themes") or []
        except ValueError:
            hot = []
        if hot:
            hot_at = iso_ct(c["finished_at"]); break
    riding = [p for p in ps if p["status"] == "open" and p["partial_at"]]
    now = time.time()
    return {"note": "momentum + narrative selection with moon-bag exits: UNPROVEN, no claimed edge until paper results come in",
            "launch_status": st, "themes_traded": themes, "partial_sells": sum(1 for p in ps if p["partial_at"]),
            # legacy moon bag: proceeds of the 2x partial minus the whole stake; rung policies (clip5): realized PnL on the sold share
            "profit_locked_usd": round(sum(((p["partial_pnl_usd"] or 0) if p.get("exit_policy") else (p["partial_proceeds_usd"] or 0) - p["size_usd"])
                                           for p in ps if p["partial_at"]), 2),
            "exit_policy_counts": {k: sum(1 for p in ps if (p.get("exit_policy") or "moon_bag_legacy") == k)
                                   for k in sorted({p.get("exit_policy") or "moon_bag_legacy" for p in ps})},
            "clips_filled": sum(int(p.get("clips_done") or 0) for p in ps),
            "moon_bags_riding": [{"mint": p["mint"], "symbol": p["symbol"], "theme": p["theme"], "peak_price": p["peak_price"],
                                  "last_price": p["last_price"], "partial_proceeds_usd": round(p["partial_proceeds_usd"] or 0, 2),
                                  "age_h": round((now - p["entry_at"]) / 3600, 2), "dexscreener_url": dex_url(p["mint"])} for p in riding],
            "open_positions": [{"mint": p["mint"], "symbol": p["symbol"], "theme": p["theme"], "momentum_score": p["mom_score"],
                                "narrative_score": p["narr_score"], "combined": p["mom_combined"], "size_usd": p["size_usd"],
                                "ret_pct": round((p["last_price"] / p["entry_price"] - 1) * 100, 1) if p["last_price"] else None,
                                "moon_bag": p["moon_bag"] or "none", "exit_policy": p.get("exit_policy") or "moon_bag_legacy",
                                "clips_done": p.get("clips_done"), "stop_level_usd": p.get("stop_price"),
                                "dexscreener_url": dex_url(p["mint"])} for p in ps if p["status"] == "open"],
            "hot_themes_last_cycle": hot, "hot_themes_at_ct": hot_at}


def exit_comparison(led, books):
    """clip5 momentum book vs its shadow controls (same entries, exit differs) + fill/slippage measurement:
    clips record the rung (trigger) and the mark (the fill is the rung, conservative); stops record the stop level
    and the mark they filled at (gap-through)."""
    rows = {}
    for book, pol in ((MOMENTUM_BOOK, None), *CONTROL_BOOKS.items()):
        ps = led.q("SELECT * FROM positions WHERE book=? AND void_reason IS NULL", (book,))
        b = books.get(book) or book_report(led, book)
        pols = sorted({p.get("exit_policy") or "moon_bag_legacy" for p in ps}) or [pol or "clip5"]
        clips, stops = [], []
        for p in ps:
            try:
                clips += json.loads(p.get("clip_log") or "[]")
            except ValueError:
                pass
            if p["status"] == "closed" and p.get("exit_trigger_price") and p.get("exit_price") and "stop" in (p["exit_reason"] or ""):
                stops.append(p["exit_price"] / p["exit_trigger_price"] - 1)
        clips = [c for c in clips if c.get("clip") != "close"]          # signal books log their closing sale too
        rungs = [c for c in clips if c.get("multiple") is not None]
        mvt = [c["mark_vs_trigger_pct"] for c in clips if c.get("mark_vs_trigger_pct") is not None]
        rule = SX.describe(pols[0]) or (X.get(pols[0]).describe() if X.get(pols[0]) else "original moon bag")
        rows[book] = {"policy": "+".join(pols), "rule": rule,
                      "alerts": book == MOMENTUM_BOOK,
                      "equity_mark_to_market": b["equity_mark_to_market"], "return_pct_mtm": b["return_pct_mtm"],
                      "bankroll_realized": b["bankroll_realized"], "trades_closed": b["trades_closed"], "trades_open": b["trades_open"],
                      "win_rate_pct": b["win_rate_pct"], "exit_reasons": b["exit_reasons"], "clips_filled": len(clips),
                      "clips_by_multiple": {f"{m:g}x": sum(1 for c in rungs if c["multiple"] == m) for m in sorted({c["multiple"] for c in rungs})},
                      "clip_mark_over_trigger_mean_pct": round(sum(mvt) / len(mvt), 2) if mvt else None,
                      "stops_filled": len(stops),
                      "stop_mark_vs_trigger_mean_pct": round(sum(stops) / len(stops) * 100, 2) if stops else None,
                      "stop_mark_vs_trigger_worst_pct": round(min(stops) * 100, 2) if stops else None}
        if book in SIGNAL_BOOKS:
            rows[book].update(_signal_book_extra(ps, b))
    return {"note": "same momentum entries; only the exit differs. Controls: own notional $1,000, never cash-limited, no alerts. "
                    "Clip fills = rung price (mark at/above it, conservative); stop fills = the mark (gap-through). "
                    "Signal books (clip5_rug_dust, sighv) are marked every ~60 s by the exit watcher; their signal sales fill at the NEXT "
                    "mark (intended vs actual logged); 5% of tokens is kept as dust: realized PnL counts it at zero, equity is shown "
                    "with the dust at its last price and at zero.",
            "books": rows}


def scanner_section(led):
    """Silent `scanner` book (smr/paper/scanner.py): whole-market 5-min scan, clip5 + rug rule + 5% dust exits (1-min watcher)."""
    b = book_report(led, SCANNER_BOOK)
    ps = led.q("SELECT * FROM positions WHERE book=? AND void_reason IS NULL", (SCANNER_BOOK,))
    cyc = led.one("SELECT COUNT(*) AS n, MAX(finished_at) AS last FROM scanner_cycles WHERE finished_at IS NOT NULL") or {}
    last = led.one("SELECT stats FROM scanner_cycles WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1")
    try:
        ls = json.loads(last["stats"]) if last else {}
    except ValueError:
        ls = {}
    cand = led.one("SELECT COUNT(*) AS n, COUNT(DISTINCT mint) AS mints, SUM(runner_score IS NOT NULL) AS scored FROM scanner_candidates") or {}
    return {"note": "silent paper book (events tagged [PAPER scanner]); runner score = logged ranking of current acceleration, not a prediction of a 100x",
            "book": b, **_signal_book_extra(ps, b),
            "cycles": cyc.get("n") or 0, "last_cycle_at_ct": iso_ct(cyc["last"]) if cyc.get("last") else None,
            "last_cycle": {k: ls.get(k) for k in ("candidates", "quoted", "prefilter_pass", "runner_scored", "risk", "blocked", "entries")} if ls else None,
            "candidates_logged": cand.get("n") or 0, "candidate_mints": cand.get("mints") or 0,
            "open_positions": [{"mint": p["mint"], "runner_score": p.get("runner_score"), "decision": p["decision"], "size_usd": p["size_usd"],
                                "ret_pct": round((p["last_price"] / p["entry_price"] - 1) * 100, 1) if p["last_price"] else None,
                                "clips_done": p.get("clips_done"), "dexscreener_url": dex_url(p["mint"])} for p in ps if p["status"] == "open"]}


def _signal_book_extra(ps, b):
    """Dust bag both ways, signal fills (intended = deciding mark vs actual = next mark), who marked (watcher vs cycle)."""
    from .sigbooks import dust_values
    d_open = d_closed = 0.0
    n_dust = 0
    sig, by, reasons = [], {}, {}
    for p in ps:
        dt, v, _ = dust_values(p)
        if dt:
            n_dust += 1
            if p["status"] == "open":
                d_open += v
            else:
                d_closed += v
        try:
            log = json.loads(p.get("clip_log") or "[]")
        except ValueError:
            log = []
        for c in log:
            if c.get("filled_by"):
                by[c["filled_by"]] = by.get(c["filled_by"], 0) + 1
            if c.get("kind") == "signal":
                if c.get("fill_vs_intended_pct") is not None:
                    sig.append(c["fill_vs_intended_pct"])
                k = re.sub(r"_\d+(\.\d+)?$", "", str(c.get("reason") or ""))
                reasons[k] = reasons.get(k, 0) + 1
    eq = b["equity_mark_to_market"]
    start = b.get("starting_bankroll") or start_bankroll_for(b["book"])
    return {"dust_frac_pct": SX.DUST_FRAC * 100, "positions_with_dust": n_dust,
            "dust_value_open_usd": round(d_open, 2), "dust_value_closed_at_last_price_usd": round(d_closed, 2),
            "equity_dust_at_last_price": round(eq + d_closed, 2), "equity_dust_at_zero": round(eq - d_open, 2),
            "return_pct_dust_at_last_price": round((eq + d_closed) / start * 100 - 100, 2) if start else 0.0,
            "return_pct_dust_at_zero": round((eq - d_open) / start * 100 - 100, 2) if start else 0.0,
            "signal_fills": len(sig), "signal_fill_vs_intended_mean_pct": round(sum(sig) / len(sig), 2) if sig else None,
            "signal_fill_vs_intended_worst_pct": round(min(sig), 2) if sig else None, "signal_reasons": reasons, "fills_by": by}


def alive_split(launches):
    """Split resolved launches into 'alive at entry' (curve price at or above launch price, and a sane quote:
    liquidity >= gates.MIN_LIQ_TO_MCAP of market cap) vs 'already dead or bad quote'. About 1 in 4 benchmark entries
    is a coin that was already drained before the ~10-15 min entry (s48), which inflates the SKIP dump rate; this
    split shows the dump rate on live coins only."""
    from smr.paper.gates import MIN_LIQ_TO_MCAP
    def alive(l):
        pvl, liq, mc = l.get("price_vs_launch"), l.get("entry_liq"), l.get("entry_mcap")
        if pvl is None or pvl < 1.0:
            return False
        return not (liq is not None and mc and liq < MIN_LIQ_TO_MCAP * mc)
    done = [dict(l) for l in launches if l["track_done"] or l["dumped50"]]
    live = [l for l in done if alive(l)]
    dumped = [l for l in live if l["dumped50"]]
    return {"resolved_alive_at_entry": len(live), "dumped_50pct_alive": len(dumped),
            "dump_rate_alive_pct": round(len(dumped) / len(live) * 100, 1) if live else None,
            "resolved_dead_or_bad_quote_at_entry": len(done) - len(live)}


def tier_outcomes(led):
    """Per decision tier, every scored + priced launch (shadow book: fixed $10, no cash limit, same exits and costs) and
    the 24 h price path (min/max return on market price, no costs)."""
    out = {}
    for dec in ("SKIP", "REDUCED", "NORMAL"):
        ls = led.q("SELECT * FROM launches WHERE decision=? AND entry_status='priced' AND void_reason IS NULL", (dec,))
        done = [l for l in ls if l["track_done"] or l["dumped50"]]
        dumped = [l for l in ls if l["dumped50"]]
        sh = led.q("SELECT * FROM positions WHERE book='shadow' AND decision=? AND status='closed' AND void_reason IS NULL", (dec,))
        out[dec] = {"scored_and_priced": len(ls), "resolved": len(done), "dumped_50pct": len(dumped),
                    "dump_rate_pct": round(len(dumped) / len(done) * 100, 1) if done else None,
                    "shadow_closed": len(sh), "shadow_mean_return_pct": round(sum(p["pnl_pct"] for p in sh) / len(sh) * 100, 2) if sh else None,
                    **alive_split(ls),
                    "shadow_win_rate_pct": round(sum(1 for p in sh if p["pnl_usd"] > 0) / len(sh) * 100, 1) if sh else None}
    return out


def mayhem_section(led):
    """Mayhem vs non-Mayhem (smr/mayhem.py). The strategy + momentum books never enter Mayhem or unknown-status coins
    (Zoorped 2026-11-03); the benchmark books ('all', 'shadow') still buy them, so their rows compare the two groups."""
    def grp(m):
        cond = "l.mayhem IS NULL" if m is None else f"l.mayhem={m}"
        ls = led.q(f"SELECT l.* FROM launches l WHERE l.status='scored' AND l.entry_status='priced' AND l.void_reason IS NULL AND {cond}")
        done = [l for l in ls if l["track_done"] or l["dumped50"]]
        dumped = [l for l in done if l["dumped50"]]
        out = {"scored_and_priced": len(ls), "resolved": len(done), "dumped_50pct": len(dumped),
               "dump_rate_pct": round(len(dumped) / len(done) * 100, 1) if done else None}
        for b in ("shadow", "all"):
            ps = led.q(f"SELECT p.pnl_usd, p.pnl_pct FROM positions p JOIN launches l ON l.mint=p.mint WHERE p.book=? AND p.status='closed' "
                       f"AND p.void_reason IS NULL AND {cond}", (b,))
            out[f"{b}_closed"] = len(ps)
            out[f"{b}_mean_return_pct"] = round(sum(p["pnl_pct"] for p in ps) / len(ps) * 100, 2) if ps else None
        return out
    blocked = led.one("""SELECT SUM(strategy_status='skip_mayhem') AS strategy, SUM(momentum_status='skip_mayhem') AS momentum,
                         SUM((strategy_status='skip_mayhem' OR momentum_status='skip_mayhem') AND mayhem IS NULL) AS unknown
                         FROM launches WHERE void_reason IS NULL""")
    waiting_unknown = led.one("SELECT COUNT(*) AS n FROM launches WHERE void_reason IS NULL AND mayhem IS NULL AND "
                              "(strategy_status='filtered_mcap' OR momentum_status='watching')")["n"]
    held = led.q("""SELECT p.book, p.mint, l.symbol, p.status, p.entry_at FROM positions p JOIN launches l ON l.mint=p.mint
                    WHERE p.book IN ('strategy', 'momentum') AND p.void_reason IS NULL AND l.mayhem=1 ORDER BY p.entry_at""")
    return {"rule": "strategy + momentum books: no entry into Mayhem-mode coins; unknown status = no entry (conservative); "
                    "'all'/'shadow' benchmark books unchanged",
            "mayhem": grp(1), "not_mayhem": grp(0), "unknown": grp(None),
            "blocked_entries": {k: (v or 0) for k, v in blocked.items()}, "waiting_or_watching_unknown": waiting_unknown,
            "alerted_positions_in_mayhem_coins": [{"book": h["book"], "mint": h["mint"], "symbol": h["symbol"], "status": h["status"],
                                                   "entered_at_ct": iso_ct(h["entry_at"]), "note": "entered before the Mayhem gate; runs to its normal exit"}
                                                  for h in held]}


def edge_section(led):
    """Edge features (smr/paper/edge.py; strategy + momentum only): bundle skips, smart-money lifts/boosts, X heat, pullbacks."""
    st = led.one("""SELECT SUM(strategy_status='skip_bundle') AS strategy, SUM(momentum_status='skip_bundle') AS momentum,
                    SUM(bundle_pct IS NOT NULL) AS with_bundle_data, SUM(bundle_pct >= 20) AS bundle_ge20,
                    SUM(smart_money LIKE '%"lifted": true%') AS smart_lifts,
                    SUM(smart_money IS NOT NULL) AS smart_checked FROM launches WHERE void_reason IS NULL""")
    pos = led.q("SELECT book, edge, status, pnl_usd, entry_trigger FROM positions WHERE book IN ('strategy','momentum') AND void_reason IS NULL AND edge IS NOT NULL")
    boosted = heat = 0
    for p in pos:
        try:
            e = json.loads(p["edge"])
        except (TypeError, ValueError):
            continue
        boosted += int(((e.get("smart_money") or {}).get("net_buyers") or 0) > 0)
        heat += int((e.get("x_heat") or {}).get("points") not in (None, 0))
    out = {"bundle_gate": {"skipped": {"strategy": st["strategy"] or 0, "momentum": st["momentum"] or 0},
                           "launches_with_bundle_data": st["with_bundle_data"] or 0, "launches_same_slot_ge_20pct": st["bundle_ge20"] or 0},
           "smart_money": {"strategy_lifts_reduced_to_normal": st["smart_lifts"] or 0, "launches_checked": st["smart_checked"] or 0,
                           "alerted_positions_with_net_smart_buyers": boosted},
           "x_heat": {"alerted_positions_with_heat_points": heat}}
    hl = led.q("SELECT holders_live FROM launches WHERE void_reason IS NULL AND holders_live IS NOT NULL")
    hv = [json.loads(r["holders_live"]) for r in hl]
    out["holders_live"] = {"launches_with_live_holders": len(hv), "vetoed": sum(bool(h.get("veto")) for h in hv),
                           "changed_vs_benchmark": sum(h.get("decision") != h.get("benchmark_decision") for h in hv),
                           "by_decision": {d: sum(h.get("decision") == d for h in hv) for d in ("NORMAL", "REDUCED", "SKIP")}}
    if led.one("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='watchlist'"):
        w = {r["status"]: r["n"] for r in led.q("SELECT status, COUNT(*) AS n FROM watchlist GROUP BY status")}
        pb = led.q("SELECT book, status, pnl_usd FROM positions WHERE entry_trigger='pullback' AND void_reason IS NULL")
        out["pullback"] = {"watchlist": w, "entered": len(pb), "closed": sum(p["status"] == "closed" for p in pb),
                           "realized_pnl_usd": round(sum(p["pnl_usd"] or 0 for p in pb if p["status"] == "closed"), 2)}
    return out


def build(led):
    books = {b: book_report(led, b) for b in ALL_BOOKS}
    cyc = led.q("SELECT * FROM cycles WHERE finished_at IS NOT NULL ORDER BY id")
    els = sorted(c["elapsed_s"] for c in cyc if c["elapsed_s"] is not None)
    counts = led.one("""SELECT COUNT(*) AS scored_or_attempted, SUM(status='scored') AS scored, SUM(status='error') AS errors,
                        SUM(status='timeout') AS timeouts, SUM(entry_status='priced') AS priced, SUM(entry_status='pending') AS pending_entry,
                        SUM(entry_status='unfilled') AS unfilled FROM launches WHERE void_reason IS NULL""")
    dec = {r["decision"]: r["n"] for r in led.q("SELECT decision, COUNT(*) AS n FROM launches WHERE status='scored' AND void_reason IS NULL GROUP BY decision")}
    asof = {r["d"]: r["n"] for r in led.q("SELECT COALESCE(asof_decision, decision) AS d, COUNT(*) AS n FROM launches WHERE status='scored' AND void_reason IS NULL GROUP BY d")}
    voided = {r["void_reason"]: {"launches": r["n"]} for r in led.q("SELECT void_reason, COUNT(*) AS n FROM launches WHERE void_reason IS NOT NULL GROUP BY void_reason")}
    for r in led.q("SELECT void_reason, COUNT(*) AS n FROM positions WHERE void_reason IS NOT NULL GROUP BY void_reason"):
        voided.setdefault(r["void_reason"], {})["positions"] = r["n"]
    mf = {r["s"]: r["n"] for r in led.q("SELECT strategy_status AS s, COUNT(*) AS n FROM launches WHERE void_reason IS NULL AND strategy_status IS NOT NULL GROUP BY s")}
    chk = led.one("SELECT COUNT(*) AS checked, SUM(eligible) AS eligible FROM checked")
    tiers = tier_outcomes(led)
    s, a = books["strategy"], books["all"]
    skip = tiers["SKIP"]
    nonskip_done = (tiers["REDUCED"]["resolved"] or 0) + (tiers["NORMAL"]["resolved"] or 0)
    nonskip_dump = (tiers["REDUCED"]["dumped_50pct"] or 0) + (tiers["NORMAL"]["dumped_50pct"] or 0)
    opn = led.q("""SELECT p.*, l.symbol, l.name FROM positions p LEFT JOIN launches l ON l.mint=p.mint
                   WHERE p.book='strategy' AND p.status='open' AND p.void_reason IS NULL ORDER BY p.entry_at""")
    now = time.time()
    return {
        "generated_at": now, "generated_at_ct": iso_ct(now), "simulated": True,
        "period": "2026-11-03 .. 2026-11-10 (America/Chicago)",
        "launches": {**{k: (v or 0) for k, v in counts.items()}, "decisions": dec, "decisions_before_entry_gates": asof, "prefilter_checked": chk["checked"] or 0,
                     "prefilter_eligible": chk["eligible"] or 0},
        "books": books,
        "voided": voided,
        "mcap_filter": {"min_entry_mcap_usd": (led.one("SELECT min_entry_mcap FROM launches WHERE min_entry_mcap IS NOT NULL ORDER BY rowid DESC LIMIT 1") or {}).get("min_entry_mcap"),
                        "applies_to": "strategy book only (buy-everything and shadow buy at the first price)",
                        "entered_at_first_price": mf.get("entered", 0), "filtered_waiting": mf.get("filtered_mcap", 0),
                        "entered_on_cross": mf.get("entered_on_cross", 0), "expired_24h": mf.get("expired_mcap", 0), "skip": mf.get("skip", 0), "voided": mf.get("voided", 0)},
        "filter_value": {"strategy_minus_all_mtm_usd": round(s["equity_mark_to_market"] - a["equity_mark_to_market"], 2),
                         "strategy_minus_all_realized_usd": round(s["bankroll_realized"] - a["bankroll_realized"], 2)},
        "momentum_vs_strategy": {"momentum_minus_strategy_mtm_usd": round(books[MOMENTUM_BOOK]["equity_mark_to_market"] - s["equity_mark_to_market"], 2),
                                 "momentum_minus_strategy_realized_usd": round(books[MOMENTUM_BOOK]["bankroll_realized"] - s["bankroll_realized"], 2)},
        "momentum": momentum_section(led),
        "momentum_exits": exit_comparison(led, books),
        "mayhem": mayhem_section(led),
        "edge": edge_section(led),
        "scanner": scanner_section(led),
        "skip_hit_rate": {"skips_resolved": skip["resolved"], "skips_dumped_50pct": skip["dumped_50pct"], "rate_pct": skip["dump_rate_pct"],
                          "non_skip_dump_rate_pct": round(nonskip_dump / nonskip_done * 100, 1) if nonskip_done else None,
                          "alive_at_entry": {d: {k: tiers[d][k] for k in ("resolved_alive_at_entry", "dumped_50pct_alive", "dump_rate_alive_pct",
                                                                          "resolved_dead_or_bad_quote_at_entry")} for d in ("SKIP", "REDUCED", "NORMAL")},
                          "definition": "price fell >= 50% below entry within 24 h of entry (or no price for 24 h)"},
        "tiers": tiers,
        "open_positions": [{"mint": p["mint"], "symbol": p["symbol"], "decision": p["decision"], "score": p["score"],
                            "size_usd": p["size_usd"], "entry_price": p["entry_price"], "last_price": p["last_price"],
                            "ret_pct": round((p["last_price"] / p["entry_price"] - 1) * 100, 1) if p["last_price"] else None,
                            "age_h": round((now - p["entry_at"]) / 3600, 2), "dexscreener_url": dex_url(p["mint"])} for p in opn],
        "cycles": {"count": len(cyc), "last_elapsed_s": cyc[-1]["elapsed_s"] if cyc else None,
                   "p50_elapsed_s": els[len(els) // 2] if els else None, "max_elapsed_s": els[-1] if els else None,
                   "last_at_ct": iso_ct(cyc[-1]["finished_at"]) if cyc else None},
        "assumptions": {**K.assumptions(), "take_profit_pct": TAKE_PROFIT * 100, "stop_loss_pct": STOP_LOSS * 100,
                        "time_exit_h": TIME_EXIT_S / 3600, "dead_token": "no valid price for 24 h -> -100%",
                        "sizing": {**{b: v[0] for b, v in BOOKS.items()}, MOMENTUM_BOOK: "by combined momentum+narrative score (smr/momentum.py size_tiers), REDUCED capped"},
                        "momentum_exits": {"clip5 (momentum book; positions opened with exit_policy=clip5)": X.POLICIES["clip5"].describe(),
                                           "ladder (control book momentum_ladder)": X.POLICIES["ladder"].describe() + " (trail 20% if graduated at launch, else 40%)",
                                           "x1 (control book momentum_x1)": X.POLICIES["x1"].describe(),
                                           "clip5_rug_dust (control book momentum_clip5_rug_dust, 1-min watcher)": SX.describe("clip5_rug_dust"),
                                           "sighv (control book momentum_sighv, 1-min watcher)": SX.describe("sighv"),
                                           "legacy moon bag (momentum positions opened before clip5)": "2x -> sell ~50-60% to recover stake + fees, rest rides a trailing stop 40% off its peak, max 48 h; before 2x: -50% stop, 24 h time exit",
                                           "fills": "rungs at the rung price when a 15-min mark is at/above it; stops and max hold at the mark"}},
    }


def summary_text(r):
    s, a = r["books"]["strategy"], r["books"]["all"]
    L = r["launches"]; k = r["skip_hit_rate"]
    def wr(b):
        return "n/a" if b["win_rate_pct"] is None else f"{b['win_rate_pct']}%"
    lines = [
        f"Paper trading (simulated money only), as of {r['generated_at_ct']}.",
        f"Scored {L.get('scored', 0)} launches (SKIP {L['decisions'].get('SKIP', 0)}, REDUCED {L['decisions'].get('REDUCED', 0)}, "
        f"NORMAL {L['decisions'].get('NORMAL', 0)}) over {r['cycles']['count']} cycles.",
        f"Strategy book: {fmt_usd(s['equity_mark_to_market'])} marked to market ({s['return_pct_mtm']:+.2f}%), realized bankroll "
        f"{fmt_usd(s['bankroll_realized'])}; {s['trades_closed']} closed / {s['trades_open']} open trades, win rate {wr(s)}, "
        f"max drawdown {s['max_drawdown_pct']}%.",
        f"Buy-everything book: {fmt_usd(a['equity_mark_to_market'])} ({a['return_pct_mtm']:+.2f}%); {a['trades_closed']} closed / "
        f"{a['trades_open']} open, win rate {wr(a)}, max drawdown {a['max_drawdown_pct']}%.",
        f"The filter is {'ahead' if r['filter_value']['strategy_minus_all_mtm_usd'] >= 0 else 'behind'} by "
        f"{fmt_usd(abs(r['filter_value']['strategy_minus_all_mtm_usd']))} so far.",
    ]
    bg = L.get("decisions_before_entry_gates") or {}
    if bg and bg != L["decisions"]:
        lines.append(f"Before the entry-time market gates: SKIP {bg.get('SKIP', 0)}, REDUCED {bg.get('REDUCED', 0)}, NORMAL {bg.get('NORMAL', 0)}.")
    mf = r.get("mcap_filter") or {}
    if mf.get("min_entry_mcap_usd"):
        lines.append(f"Market-cap floor {fmt_usd(mf['min_entry_mcap_usd'], 0)} (strategy book counts; the momentum book uses the same floor): {mf['entered_at_first_price']} bought at first price, "
                     f"{mf['entered_on_cross']} bought on crossing, {mf['filtered_waiting']} waiting, {mf['expired_24h']} never crossed in 24 h.")
    for why, v in (r.get("voided") or {}).items():
        lines.append(f"Voided ({why}): {v.get('launches', 0)} launches / {v.get('positions', 0)} positions, excluded from PnL and stats.")
    if k["skips_resolved"]:
        lines.append(f"SKIP hit rate: {k['skips_dumped_50pct']}/{k['skips_resolved']} resolved SKIPs dumped 50%+ ({k['rate_pct']}%), "
                     f"vs {k['non_skip_dump_rate_pct'] if k['non_skip_dump_rate_pct'] is not None else 'n/a'}% for non-SKIPs.")
    else:
        lines.append("SKIP hit rate: no SKIP has resolved yet (needs a 50% dump or 24 h).")
    mh = r.get("mayhem") or {}
    if mh:
        y, n, u = mh["mayhem"], mh["not_mayhem"], mh["unknown"]
        def dr(g):
            return f"{g['dumped_50pct']}/{g['resolved']} dumped" if g["resolved"] else "none resolved"
        lines.append(f"Mayhem gate (strategy + momentum skip Mayhem and unknown): {y['scored_and_priced']} Mayhem / {n['scored_and_priced']} not / "
                     f"{u['scored_and_priced']} unknown priced launches; blocked strategy {mh['blocked_entries']['strategy']}, momentum "
                     f"{mh['blocked_entries']['momentum']} ({mh['blocked_entries']['unknown']} for unknown status). Benchmark outcomes: "
                     f"Mayhem {dr(y)}, non-Mayhem {dr(n)}.")
    mb = r["books"].get(MOMENTUM_BOOK)
    if mb:
        mo = r.get("momentum") or {}
        lines.append(f"Momentum book (unproven A/B: momentum + narrative picks, clip5 exits): {fmt_usd(mb['equity_mark_to_market'])} "
                     f"({mb['return_pct_mtm']:+.2f}%); {mb['trades_closed']} closed / {mb['trades_open']} open, win rate {wr(mb)}, "
                     f"{mo.get('clips_filled', 0)} clips filled, {len(mo.get('moon_bags_riding') or [])} positions riding after a clip; "
                     f"{'ahead of' if r['momentum_vs_strategy']['momentum_minus_strategy_mtm_usd'] >= 0 else 'behind'} strategy by "
                     f"{fmt_usd(abs(r['momentum_vs_strategy']['momentum_minus_strategy_mtm_usd']))}.")
        mx = (r.get("momentum_exits") or {}).get("books") or {}
        if mx:
            def one(b, label):
                x = mx.get(b)
                if not x:
                    return None
                return (f"{label} {fmt_usd(x['equity_mark_to_market'])} ({x['return_pct_mtm']:+.2f}%), {x['trades_closed']} closed / "
                        f"{x['trades_open']} open, {x['clips_filled']} clips")
            def dusty(b, label):
                x = mx.get(b)
                if not x:
                    return None
                return (f"{label} {fmt_usd(x['equity_dust_at_last_price'])} with dust at last price / {fmt_usd(x['equity_dust_at_zero'])} "
                        f"at zero ({x['return_pct_dust_at_last_price']:+.2f}% / {x['return_pct_dust_at_zero']:+.2f}%), {x['trades_closed']} closed / "
                        f"{x['trades_open']} open, {x['clips_filled']} sells")
            parts = [t for t in (one(MOMENTUM_BOOK, "clip5 (alerted)"), one("momentum_ladder", "ladder E"), one("momentum_x1", "x1"),
                                 dusty("momentum_clip5_rug_dust", "clip5+rug+5% dust"), dusty("momentum_sighv", "SIG-HV")) if t]
            lines.append("Momentum exits side by side (same entries, only the exit differs): " + "; ".join(parts) + ".")
        hot = [h["theme"] for h in (mo.get("hot_themes_last_cycle") or []) if not h.get("fading")][:5]
        if hot:
            lines.append("Hot themes last cycle: " + ", ".join(hot) + ".")
    eg = r.get("edge") or {}
    if eg:
        b, sm = eg["bundle_gate"], eg["smart_money"]
        pb = eg.get("pullback")
        lines.append(f"Edge features: bundle gate skipped strategy {b['skipped']['strategy']} / momentum {b['skipped']['momentum']} "
                     f"({b['launches_same_slot_ge_20pct']} of {b['launches_with_bundle_data']} launches with bundle data had >= 20% same-slot supply); "
                     f"smart money lifted {sm['strategy_lifts_reduced_to_normal']} strategy entries REDUCED -> NORMAL, "
                     f"{sm['alerted_positions_with_net_smart_buyers']} alerted positions had net smart buyers; "
                     f"{eg['x_heat']['alerted_positions_with_heat_points']} had X heat points"
                     + (f"; pullback entries {pb['entered']} ({pb['closed']} closed, {fmt_usd(pb['realized_pnl_usd'])} realized), watchlist "
                        + ", ".join(f"{k} {v}" for k, v in sorted(pb['watchlist'].items())) if pb else "") + ".")
    sc = r.get("scanner") or {}
    if sc and (sc.get("cycles") or sc["book"]["trades_open"] or sc["book"]["trades_closed"]):
        x = sc
        lines.append(f"Scanner book (silent; whole-market 5-min scan, clip5 + rug rule + 5% dust): {fmt_usd(x['equity_dust_at_last_price'])} with dust at "
                     f"last price / {fmt_usd(x['equity_dust_at_zero'])} at zero ({x['return_pct_dust_at_last_price']:+.2f}% / "
                     f"{x['return_pct_dust_at_zero']:+.2f}%), {x['book']['trades_closed']} closed / {x['book']['trades_open']} open; "
                     f"{x['cycles']} scans, {x['candidate_mints']} candidate coins logged.")
    if r["cycles"]["count"] < 96 * 3:
        lines.append("Early days: far too few closed trades to tell whether the scores make money.")
    return "\n".join(lines)


# ---- events -------------------------------------------------------------------------------------------------
def event_text(p):
    sym = p.get("symbol") or p["mint"][:8]
    reasons = "; ".join(p.get("top_reasons") or []) or "none"
    gate = ""
    if p.get("asof_decision") and p["asof_decision"] != p["decision"]:
        gate = f" | downgraded from {p['asof_decision']} by entry gates: " + ("; ".join(p.get("gate_reasons") or []) or "?")
    elif p.get("gate_reasons"):
        gate = " | entry gates: " + "; ".join(p["gate_reasons"])
    head = (f"[PAPER] {p['kind']} {sym} ({p.get('name') or '?'}) {p['mint']} {p['dexscreener_url']} | {p['decision']} score={p['score']} | "
            f"reasons: {reasons}{gate} | entry {p.get('entry_at_ct')} price {fmt_px(p.get('entry_price_usd'))} mcap {fmt_usd(p.get('entry_mcap_usd'), 0)} | "
            f"size {fmt_usd(p.get('size_usd'))} ({p.get('size_pct_of_bankroll')}% of {fmt_usd(p.get('bankroll_at_entry'))}) | "
            f"liquidity {fmt_usd(p.get('liquidity_usd'), 0)} | holders {p.get('holder_count') if p.get('holder_count') is not None else 'unknown'}"
            + (" (as of create+5min)" if p.get("holder_source") == "as_of_reconstruction" else
               " (live, StalkChain)" if p.get("holder_source") == "stalkchain_live" else ""))
    if p.get("entry_trigger") == "mcap_cross":
        head += (f" | entered on crossing the {fmt_usd(p.get('min_entry_mcap_usd'), 0)} market-cap floor at {fmt_usd(p.get('mcap_at_cross_usd'), 0)}"
                 f" ({p.get('minutes_after_launch')} min after launch; first priced at {fmt_usd(p.get('first_priced_mcap_usd'), 0)})")
    if p.get("book") == MOMENTUM_BOOK:
        head = head.replace("[PAPER] ", "[PAPER momentum] ", 1)
        ms = (p.get("momentum") or {}).get("signals") or {}
        nr = p.get("narrative") or {}
        head += (f" | theme {p.get('theme') or 'none'}" + (" (fading)" if nr.get("fading") else "") + (" late copycat" if nr.get("late_copycat") else "")
                 + f" | momentum {p.get('momentum_score')} narrative {p.get('narrative_score')} combined {p.get('combined_score')}"
                 + f" (vol 5m {fmt_usd(ms.get('vol_m5_usd'), 0)}, 1h {fmt_usd(ms.get('vol_h1_usd'), 0)}, accel {ms.get('vol_accel_x')}x, "
                 f"buys {ms.get('buy_ratio_m5')}, 5m {ms.get('chg_m5_pct')}%, 1h {ms.get('chg_h1_pct')}%, buyers 5m {ms.get('unique_buyers_m5')}, "
                 f"{ms.get('peak_state')})")
        if p.get("exit_policy"):
            head += clip_text(p)
        elif p["kind"] == "PARTIAL_SELL":
            head += (f" | 2x PARTIAL {p.get('partial_at_ct')}: sold {p.get('partial_sold_pct')}% at {fmt_px(p.get('partial_fill_price_usd'))} for "
                     f"{fmt_usd(p.get('partial_proceeds_usd'))} (stake {fmt_usd(p.get('size_usd'))}, profit locked {fmt_usd(p.get('profit_locked_usd'))}) | "
                     f"moon bag riding: {p.get('moon_bag_rule')}")
        elif p["kind"] == "SELL" and p.get("partial_sold"):
            head += (f" | earlier 2x partial {fmt_usd(p.get('partial_proceeds_usd'))} ({p.get('partial_sold_pct')}%), moon bag sold for "
                     f"{fmt_usd(p.get('moon_bag_proceeds_usd'))}, peak {fmt_px(p.get('peak_price_usd'))}")
    elif p.get("book") in ALERT_SCANNER_BOOKS:
        tag = "experiment100" if p.get("book") == EXPERIMENT100_BOOK else "scanner"
        head = head.replace("[PAPER] ", f"[PAPER {tag}] ", 1)
        rs = (p.get("runner") or {}).get("signals") or {}
        head += (f" | runner score {p.get('runner_score')} (vol 5m {fmt_usd(rs.get('vol_m5_usd'), 0)}, 1h {fmt_usd(rs.get('vol_h1_usd'), 0)}, accel "
                 f"{rs.get('vol_accel_x')}x, buys {rs.get('buy_ratio_m5')}, buyer growth {rs.get('buyer_growth_x')}x, age {rs.get('age_h')}h; "
                 f"ranking only, not a 100x prediction) | momentum {p.get('momentum_score')} combined {p.get('combined_score')}")
        if p["kind"] == "BUY" and p.get("entry_fill"):
            f = p["entry_fill"]
            head += (f" | fill {fmt_px(f.get('fill_price_usd'))} = max(quote {fmt_px(f.get('decision_quote_usd'))}, entry-minute close "
                     f"{fmt_px(f.get('entry_minute_close_usd'))})")
        if p["kind"] == "PARTIAL_SELL" and p.get("clip_multiple") is None:
            head += (f" | PARTIAL SELL {p.get('clip_label')} ({p.get('clip_at_ct')}): sold {p.get('clip_share_sold_pct')}% at "
                     f"{fmt_px(p.get('clip_fill_price_usd'))} for {fmt_usd(p.get('clip_proceeds_usd'))} | remaining {p.get('remaining_pct_of_original')}%")
        elif p.get("exit_policy"):
            head += clip_text(p)
        if p["kind"] == "SELL" and p.get("dust_tokens"):
            head += f" | {p.get('dust_pct')}% dust kept (never sold; counted at zero in realized PnL)"
    head += edge_text(p)
    if p["kind"] == "SELL":
        head += (f" | EXIT {p.get('exit_reason')} {p.get('exit_at_ct')} price {fmt_px(p.get('exit_price_usd'))} "
                 f"(fill {fmt_px(p.get('exit_fill_price_usd'))}) mcap {fmt_usd(p.get('exit_mcap_usd'), 0)} | held {p.get('hold_hours')}h | "
                 f"PnL {fmt_usd(p.get('pnl_usd'))} ({p.get('pnl_pct'):+.1f}%) after costs | bankroll {fmt_usd(p.get('bankroll_after'))}")
    return head


def clip_text(p):
    """clip5 alert fields: clip n/5, share sold, profit locked, remaining share, current stop level."""
    stop = (f"stop now {fmt_px(p.get('stop_level_usd'))} ({p.get('stop_vs_entry_pct'):+.1f}% vs entry; {p.get('stop_rule')})"
            if p.get("stop_level_usd") else "stop n/a")
    nxt = p.get("next_rung")
    nxt_t = f"next clip at {nxt['multiple']:g}x {fmt_px(nxt['price_usd'])}" if nxt else "no rungs left"
    if p["kind"] == "PARTIAL_SELL":
        return (f" | PARTIAL SELL {p.get('clip_label')} at {p.get('clip_multiple'):g}x ({p.get('clip_at_ct')}): sold {p.get('clip_share_sold_pct')}% of the original "
                f"position at {fmt_px(p.get('clip_fill_price_usd'))} (target {fmt_px(p.get('clip_trigger_price_usd'))}, mark {fmt_px(p.get('clip_mark_price_usd'))}) "
                f"for {fmt_usd(p.get('clip_proceeds_usd'))} | profit locked {fmt_usd(p.get('profit_locked_usd'))} on {p.get('sold_pct_of_original')}% sold "
                f"(cash back {fmt_usd(p.get('cash_recovered_usd'))} of {fmt_usd(p.get('size_usd'))} stake) | remaining {p.get('remaining_pct_of_original')}% | "
                f"{stop} | {nxt_t}")
    if p["kind"] == "SELL":
        trig = p.get("exit_trigger_price_usd")
        return (f" | {p.get('exit_policy')}: {p.get('clips_done')}/{p.get('clips_total')} clips filled, profit locked {fmt_usd(p.get('profit_locked_usd'))}"
                + (f", last {100 - (p.get('sold_pct_of_original') or 0):.0f}% sold for {fmt_usd(p.get('final_sale_proceeds_usd'))}" if (p.get('sold_pct_of_original') or 0) < 100 else "")
                + (f" | trigger {fmt_px(trig)} vs mark {fmt_px(p.get('exit_mark_price_usd'))}" if trig else ""))
    return f" | exit {p.get('exit_policy')}: {p.get('exit_policy_rule')} | {stop}"


def edge_text(p):
    """Edge facts on strategy/momentum alerts: smart-money count, X heat, bundle %, pullback depth (numbers only)."""
    if p.get("book") not in ("strategy", "momentum") or not isinstance(p.get("edge"), dict):
        return ""                                    # events from before the edge features keep their old text
    e = p.get("edge") or {}
    bits = []
    sm = e.get("smart_money")
    if sm:
        bits.append(f"smart money {sm.get('count', 0)} tracked traders (net buyers {sm.get('net_buyers', 0)}"
                    + ("" if sm.get("feed_fresh") else ", feed stale") + ")"
                    + (" lifted REDUCED->NORMAL" if sm.get("lifted_to_normal") else ""))
    xh = e.get("x_heat")
    if xh:
        if xh.get("fresh"):
            bits.append(f"X heat {xh.get('term')}: {xh.get('posts_1h')} posts last 1h, {xh.get('accel_x')}x vs prior hours, "
                        f"{xh.get('authors')} authors, {xh.get('engagement')} engagement ({xh.get('points', 0):+} theme pts)")
        else:
            bits.append("X heat neutral (" + str(xh.get("why") or "no fresh data") + ")")
    bp = p.get("bundle_pct", e.get("bundle_pct"))
    bits.append(f"bundle {bp:.1f}% same-slot supply" if isinstance(bp, (int, float)) else "bundle unknown")
    pb = e.get("pullback")
    if pb:
        bits.append(f"pullback entry {pb.get('depth_pct')}% under the post-qualify high {fmt_px(pb.get('high_price'))} "
                    f"(qualified {fmt_px(pb.get('qualify_price'))} {pb.get('qualified_ago_min')} min earlier)")
    return " | edge: " + "; ".join(bits)


def unreported(led, book="strategy"):
    """book: one name, a comma-separated list, or a list (CLI default 'strategy,momentum')."""
    books = [b.strip() for b in (book.split(",") if isinstance(book, str) else book) if b and b.strip()]
    # silent control books never alert, even if asked for by name (they write no events; this is a second guard)
    books = [b for b in books if b in EVENT_BOOKS] or ["__none__"]
    ph = ",".join("?" * len(books))
    rows = led.q(f"SELECT * FROM events WHERE reported_at IS NULL AND void_reason IS NULL AND book IN ({ph}) ORDER BY id", tuple(books))
    out = []
    for r in rows:
        p = json.loads(r["payload"])
        p["event_id"] = r["id"]
        p["text"] = event_text(p)
        out.append(p)
    return out


def mark_reported(led, ids, now=None):
    now = now or time.time()
    with led.tx():
        n = 0
        for i in ids:
            n += led.db.execute("UPDATE events SET reported_at=? WHERE id=? AND reported_at IS NULL", (now, int(i))).rowcount
    return n
