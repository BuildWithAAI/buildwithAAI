"""Calendar countdown + event-driven intel alarms (pure functions, no DB/network).
High-impact calendar events for configured currencies raise WARN/HIGH with chime.
T12 event-driven: COT 26w extremes, funding sign flips, DVOL spikes, VIX term inversion —
each with a stable id so the HUD chimes once until the condition clears."""
from __future__ import annotations

WARN_MIN, HIGH_MIN, AFTER_MIN = 30, 5, 2
DEFAULT_COUNTRIES = ("USD", "AUD")
DVOL_CHG_SPIKE = 8.0
DVOL_LEVEL_SPIKE = 80.0
DETAIL_CAP = 180


def _sym_id(s: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in str(s or ""))[:32] or "unk"


def _cap(s: str, n: int = DETAIL_CAP) -> str:
    s = str(s or "")
    return s if len(s) <= n else s[: n - 1] + "…"


def calendar_alarms(events: list[dict], now: float, countries=DEFAULT_COUNTRIES, warn_min=WARN_MIN, high_min=HIGH_MIN) -> list[dict]:
    out = []
    for e in events or []:
        if e.get("rank") != 3 or e.get("country") not in countries or e.get("ts") is None:
            continue
        dt = e["ts"] - now
        if dt < -AFTER_MIN * 60 or dt > warn_min * 60:
            continue
        mins = max(0, int(dt // 60))
        when = "NOW" if dt <= 0 else (f"in {mins} min" if mins else f"in {int(dt)} s")
        hi = dt <= high_min * 60
        out.append({"id": f"cal_{e['id']}_{'high' if hi else 'warn'}", "sev": "high" if hi else "warn",
                    "title": f"{e['country']} {e['title']} {when}",
                    "detail": f"High-impact release · forecast {e.get('forecast') or '—'} · previous {e.get('previous') or '—'}",
                    "source": "calendar", "chime": True, "event_ts": e["ts"], "eta_sec": int(dt)})
    return out


def next_high(events: list[dict], now: float, countries=DEFAULT_COUNTRIES, n=5) -> list[dict]:
    return [e for e in sorted(events or [], key=lambda e: e.get("ts") or 0)
            if e.get("rank") == 3 and e.get("country") in countries and (e.get("ts") or 0) > now - AFTER_MIN * 60][:n]


def cot_extreme_alarms(rows: list[dict] | None) -> list[dict]:
    """Warn when a COT row's 26-week non-commercial index is exactly 0 or 100."""
    out = []
    for r in rows or []:
        raw = r.get("nc_index_26w")
        try:
            if raw is None:
                continue
            idx_f = float(raw)
        except (TypeError, ValueError):
            continue
        if idx_f not in (0.0, 100.0):
            continue
        idx = int(idx_f)
        sym = r.get("symbol") or r.get("code") or "?"
        side = "lo" if idx == 0 else "hi"
        who = "leveraged funds" if r.get("lev_net") is not None and r.get("class") != "commodity" else "non-commercials"
        label = r.get("name") or r.get("market") or sym
        extreme = "low (0)" if idx == 0 else "high (100)"
        out.append({
            "id": f"intel_cot_{_sym_id(sym)}_{side}",
            "sev": "warn",
            "title": f"COT extreme: {sym} {who} at 26w {extreme}",
            "detail": _cap(f"{label} · report {r.get('report_date') or '—'} · nc_index_26w={idx}"),
            "source": "intel",
            "chime": True,
        })
    return out


def funding_flip_alarms(current_rows: list[dict] | None, previous_rows: list[dict] | None) -> list[dict]:
    """Warn when funding_8h sign flips between two snapshots for the same (venue, symbol). Zero is not a flip."""
    prev_map = {}
    for r in previous_rows or []:
        key = (str(r.get("venue") or ""), str(r.get("symbol") or ""))
        if key[0] and key[1]:
            prev_map[key] = r
    out = []
    for r in current_rows or []:
        venue, sym = str(r.get("venue") or ""), str(r.get("symbol") or "")
        if not venue or not sym:
            continue
        prev = prev_map.get((venue, sym))
        if not prev:
            continue
        cur_f, prev_f = r.get("funding_8h"), prev.get("funding_8h")
        try:
            cur_f = float(cur_f) if cur_f is not None else None
            prev_f = float(prev_f) if prev_f is not None else None
        except (TypeError, ValueError):
            continue
        if cur_f is None or prev_f is None:
            continue
        if cur_f == 0 or prev_f == 0:
            continue
        if (prev_f > 0) == (cur_f > 0):
            continue
        direction = "pos_to_neg" if prev_f > 0 else "neg_to_pos"
        out.append({
            "id": f"intel_funding_flip_{_sym_id(venue)}_{_sym_id(sym)}_{direction}",
            "sev": "warn",
            "title": f"{sym} funding flipped {'+' if cur_f > 0 else '−'} on {venue}",
            "detail": _cap(f"funding_8h {prev_f * 100:+.4f}% → {cur_f * 100:+.4f}%/8h · sign change"),
            "source": "intel",
            "chime": True,
        })
    return out


def dvol_spike_alarms(assets: dict | None) -> list[dict]:
    """Warn on Deribit DVOL spike: |chg_24h| >= 8 pts or absolute dvol >= 80. Prefer chg-based id when both fire."""
    out = []
    for asset, v in (assets or {}).items():
        if not isinstance(v, dict):
            continue
        dvol, chg = v.get("dvol"), v.get("chg_24h")
        try:
            dvol_n = float(dvol) if dvol is not None else None
            chg_n = float(chg) if chg is not None else None
        except (TypeError, ValueError):
            continue
        chg_hit = chg_n is not None and abs(chg_n) >= DVOL_CHG_SPIKE
        level_hit = dvol_n is not None and dvol_n >= DVOL_LEVEL_SPIKE
        if not chg_hit and not level_hit:
            continue
        if chg_hit:
            tag = "up" if chg_n > 0 else "down"
        else:
            tag = "level"
        bits = []
        if dvol_n is not None:
            bits.append(f"DVOL {dvol_n:.1f}")
        if chg_n is not None:
            bits.append(f"24h {chg_n:+.1f}")
        out.append({
            "id": f"intel_dvol_spike_{_sym_id(asset)}_{tag}",
            "sev": "warn",
            "title": f"{asset} DVOL spike ({tag})",
            "detail": _cap(" · ".join(bits) or "Deribit DVOL threshold"),
            "source": "intel",
            "chime": True,
        })
    return out


def vix_term_alarms(market_rows: list[dict] | None) -> list[dict]:
    """Warn when front VIX > VIX3M (term-structure inversion). Silent if either quote is missing."""
    by = {}
    for r in market_rows or []:
        sym = r.get("symbol")
        if sym in ("VIX", "VIX3M") and r.get("last") is not None:
            try:
                by[sym] = float(r["last"])
            except (TypeError, ValueError):
                pass
    if "VIX" not in by or "VIX3M" not in by:
        return []
    vix, vix3m = by["VIX"], by["VIX3M"]
    if vix <= vix3m:
        return []
    return [{
        "id": "intel_vix_term_inv",
        "sev": "warn",
        "title": "VIX term structure inverted",
        "detail": _cap(f"VIX {vix:.2f} > VIX3M {vix3m:.2f} (near > far)"),
        "source": "intel",
        "chime": True,
    }]


def fx_bias_flip_alarms(desk_rows: list[dict] | None) -> list[dict]:
    """INFO alarm when a pair's COT specs bias (net % OI in pair terms, from fxdesk pair_pct_hist) crosses zero between
    the last two weekly reports. The id carries the report date, so it fires once per COT report and the HUD chimes once."""
    out = []
    for r in desk_rows or []:
        c = (r or {}).get("cot") or {}
        h = c.get("pair_pct_hist") or []
        if len(h) < 2:
            continue
        try:
            (d0, p0), (d1, p1) = h[-2][:2], h[-1][:2]
            p0, p1 = float(p0), float(p1)
        except (TypeError, ValueError):
            continue
        if p0 == 0 or p1 == 0 or (p0 > 0) == (p1 > 0):
            continue
        to = "long" if p1 > 0 else "short"
        pair = r.get("pair") or "?"
        out.append({
            "id": f"intel_fx_flip_{_sym_id(pair)}_{_sym_id(d1)}_{to}",
            "sev": "info",
            "title": f"COT flip: {pair} specs now net {to}",
            "detail": _cap(f"Net % OI in pair terms {p0:+.1f}% ({d0}) → {p1:+.1f}% ({d1}) · positioning context, not a signal"),
            "source": "intel",
            "chime": True,
            "pair": pair,
            "report_date": d1,
        })
    return out


SECTOR_SPREAD = 0.04  # leader minus laggard daily move that counts as a rotation day


def sector_rotation_alarms(b: dict | None, state: str = "OK") -> list[dict]:
    """INFO (soft chime, once per id) when today's sector leader/laggard spread is >= 4%, or breadth flipped from
    BROAD ADVANCE to BROAD DECLINE (or back) versus the previous session. Ids carry the New York session date, so
    each fires once per session. Built from aai/intel/breadth.py output; only fresh (OK) quotes raise it, so a stale
    snapshot never re-announces an old day. Descriptive, not a signal; no idea, ticket or order follows."""
    n = b.get("n_with_chg") if isinstance(b, dict) else None
    if not isinstance(n, int) or isinstance(n, bool) or n < 6 or str(state).upper() != "OK":
        return []
    h = b.get("history") if isinstance(b.get("history"), dict) else {}
    pts = h.get("points") or []
    day = str((pts[-1] or {}).get("day") or "") if pts else ""
    if not day:
        return []
    by = {c.get("symbol"): c for c in b.get("cells") or [] if isinstance(c, dict)}
    out = []
    sp = b.get("spread")
    if isinstance(sp, (int, float)) and sp >= SECTOR_SPREAD and b.get("leaders") and b.get("laggards"):
        lead, lag = b["leaders"][0], b["laggards"][0]
        lc, gc = (by.get(lead) or {}).get("chg"), (by.get(lag) or {}).get("chg")
        if isinstance(lc, (int, float)) and isinstance(gc, (int, float)):
            out.append({
                "id": f"intel_sector_spread_{_sym_id(day)}", "sev": "info", "chime": True,
                "title": f"Sector rotation: {lead} {lc * 100:+.1f}% vs {lag} {gc * 100:+.1f}%",
                "detail": _cap(f"Leader/laggard spread {sp * 100:.1f}% (≥ {SECTOR_SPREAD * 100:.0f}%) · "
                               f"{b.get('up')}/{b.get('n_with_chg')} sectors up · {day} · descriptive, not a signal"),
                "source": "intel", "session": day})
    prev, cur = h.get("prev_label"), b.get("label")
    flips = {("BROAD ADVANCE", "BROAD DECLINE"), ("BROAD DECLINE", "BROAD ADVANCE")}
    if (prev, cur) in flips:
        to = "decline" if cur == "BROAD DECLINE" else "advance"
        out.append({
            "id": f"intel_breadth_flip_{_sym_id(day)}_{to}", "sev": "info", "chime": True,
            "title": f"Breadth flip: {prev.lower()} → {cur.lower()}",
            "detail": _cap(f"{b.get('up')}/{b.get('n_with_chg')} sectors up today vs the previous session's "
                           f"{prev.lower()} · {day} · descriptive, not a signal"),
            "source": "intel", "session": day})
    return out


def breadth_above_cross_alarms(ah: dict | None, state: str = "OK") -> list[dict]:
    """INFO (soft chime, once per id) when the share of sectors above their close 20 sessions earlier crosses 50%
    after 5+ sessions on the other side (aai/intel/breadth.above_history `cross`). The id carries the New York session
    date and the direction, so it fires at most once per session per direction; only fresh (OK) quotes raise it, so a
    stale snapshot never re-announces an old cross. Descriptive, not a signal; no idea, ticket or order follows."""
    if not isinstance(ah, dict) or str(state).upper() != "OK":
        return []
    cr = ah.get("cross")
    if not isinstance(cr, dict):
        return []
    to, day, pct, prev = cr.get("to"), str(cr.get("day") or ""), cr.get("pct"), cr.get("prev_sessions")
    if (to not in ("above_half", "below_half") or not day or not isinstance(pct, (int, float)) or isinstance(pct, bool)
            or not 0 <= pct <= 1 or not isinstance(prev, int) or isinstance(prev, bool) or prev < 1):
        return []
    pts = ah.get("points") or []
    last = pts[-1] if pts and isinstance(pts[-1], dict) else {}
    if str(last.get("day") or "") != day:  # the cross must be today's (latest) session
        return []
    up = to == "above_half"
    cnt = (f"{last.get('above')} of {last.get('n')} sectors" if isinstance(last.get("above"), int) and isinstance(last.get("n"), int)
           else f"{pct * 100:.0f}% of sectors")
    return [{
        "id": f"intel_breadth_above20_{_sym_id(day)}_{'up' if up else 'down'}", "sev": "info", "chime": True,
        "title": f"Sector breadth crossed {'above' if up else 'below'} 50%: {pct * 100:.0f}% above 20D",
        "detail": _cap(f"{cnt} above their close 20 sessions earlier, after {'at least ' if cr.get('prev_whole_window') else ''}"
                       f"{prev} sessions {'below' if up else 'above'} half · {day} "
                       + ("(live while the session is open) · " if cr.get("live", True) else "(held at the close) · ")
                       + "descriptive, not a signal"),
        "source": "intel", "session": day, "live": bool(cr.get("live", True))}]


def breadth_above_cross_followup_alarms(ah: dict | None, state: str = "OK") -> list[dict]:
    """Silent INFO follow-up to a 50% cross of the share of sectors above 20D (aai/intel/breadth.above_history
    `recent_cross`, judged on closed sessions): HELD on the session after the cross, once the cross day has closed on
    the new side and the new bar is still on it (on the cross day itself the cross alarm already says "held at the close"), or UNWOUND on the session that went back (live note if that
    bar is still open). Ids carry the cross day + direction, so each shows once per cross; no chime (the cross itself
    already chimed). Live feed only; descriptive, not a signal; nothing creates an idea, ticket or order."""
    if not isinstance(ah, dict) or str(state).upper() != "OK":
        return []
    rc = ah.get("recent_cross")
    if not isinstance(rc, dict) or rc.get("to") not in ("above_half", "below_half"):
        return []
    day, st, since = str(rc.get("day") or ""), rc.get("status"), rc.get("sessions_since")
    closed, pct = rc.get("closed_sessions"), rc.get("pct")
    if (not day or not isinstance(since, int) or isinstance(since, bool) or since < 0 or not isinstance(closed, int)
            or not isinstance(pct, (int, float)) or isinstance(pct, bool) or not 0 <= pct <= 1):
        return []
    up = rc["to"] == "above_half"
    wd, dirn = ("above" if up else "below"), ("up" if up else "down")
    pts = ah.get("points") or []
    last = pts[-1] if pts and isinstance(pts[-1], dict) else {}
    now_pct = last.get("pct") if isinstance(last.get("pct"), (int, float)) else None
    if st == "held" and closed >= 1 and since == 1:  # cross day itself: the cross alarm says "held at the close"
        return [{
            "id": f"intel_breadth_above20_held_{_sym_id(day)}_{dirn}", "sev": "info", "chime": False,
            "title": f"Sector breadth cross held at the close: {pct * 100:.0f}% above 20D on {day[5:]}",
            "detail": _cap(f"The {day} cross {wd} 50% closed {wd} half"
                           + (f"; {now_pct * 100:.0f}% now, still {wd}" if now_pct is not None else "")
                           + " · descriptive, not a signal"),
            "source": "intel", "session": day}]
    ud = str(rc.get("unwound_day") or "")
    if st == "unwound" and ud and str(last.get("day") or "") == ud:
        return [{
            "id": f"intel_breadth_above20_unwound_{_sym_id(day)}_{dirn}", "sev": "info", "chime": False,
            "title": f"Sector breadth cross unwound: back {'below' if up else 'above'} 50% on {ud[5:]}",
            "detail": _cap(f"The {day} cross {wd} half lasted {rc.get('held_sessions')} session"
                           f"{'s' if rc.get('held_sessions') != 1 else ''}"
                           + (f"; {now_pct * 100:.0f}% above 20D now" if now_pct is not None else "")
                           + (" (today's bar is live, may still re-cross by the close)" if rc.get("unwind_live") else "")
                           + " · descriptive, not a signal"),
            "source": "intel", "session": ud}]
    return []


EARN_SOON_DAYS = 7   # an estimated earnings date this many calendar days out (or less) shows in the alarm strip
EARN_SOON_MAX = 3    # at most this many tickers at once (soonest first), so a busy season never floods the strip


def earnings_soon_alarms(earn: dict | None, now: float, days: int = EARN_SOON_DAYS, cap: int = EARN_SOON_MAX) -> list[dict]:
    """Silent INFO for watchlist tickers whose next earnings release is *estimated* within `days` calendar days
    (aai/intel/adapters/edgar.earnings_history: quarterly-looking 8-K item 2.02 cadence only; irregular cadences
    never get a date). Days are counted from today's New York date at render time, not from the fetch. The id carries
    the ticker + estimated date, so a new release (which moves the estimate) retires it. Estimates only, never a
    confirmed date; descriptive, not a signal; nothing creates an idea, ticket or order."""
    from datetime import date, datetime
    from zoneinfo import ZoneInfo
    if not isinstance(earn, dict):
        return []
    try:
        today = datetime.fromtimestamp(float(now), ZoneInfo("America/New_York")).date()
    except (TypeError, ValueError, OverflowError, OSError):
        return []
    hits = []
    for t, e in earn.items():
        if not isinstance(e, dict) or e.get("cadence") != "quarterly" or not isinstance(e.get("est_next"), str):
            continue
        try:
            d = date.fromisoformat(e["est_next"][:10])
        except ValueError:
            continue
        n = (d - today).days
        if 0 <= n <= int(days):
            hits.append((n, _sym_id(str(t).upper())[:10], d, e))
    out = []
    for n, tk, d, e in sorted(hits, key=lambda h: (h[0], h[1]))[:max(0, int(cap))]:
        reps = e.get("reports") if isinstance(e.get("reports"), list) else []
        last = str(reps[0])[:10] if reps else ""
        gap = e.get("median_gap_days")
        when = "today" if n == 0 else "tomorrow" if n == 1 else f"in {n} days"
        out.append({
            "id": f"intel_earn_est_{tk}_{d.isoformat()}", "sev": "info", "chime": False,
            "title": f"{tk} earnings est. ~{d.strftime('%m-%d')} ({when})",
            "detail": _cap("Estimated from the SEC 8-K item 2.02 cadence"
                           + (f" (last {last}" if last else " (")
                           + (f", median gap ~{gap:g} days)" if isinstance(gap, (int, float)) and not isinstance(gap, bool) else ")")
                           + " · not a confirmed date · watchlist · descriptive, not a signal"),
            "source": "intel", "ticker": tk, "est_next": d.isoformat(), "in_days": n})
    return out


FUND_RUNWAY_MONTHS = 12      # matches xbrl RUNWAY_LT_12M: an operating burn with under this many months of cash
FUND_DILUTION = 0.10         # matches xbrl DILUTION_GT_10PCT: 1Y share count growth of at least 10%
FUND_ALARM_MAX = 4           # at most this many fundamentals alarms at once, so a weak tape never floods the strip


def fundamentals_alarms(payload: dict | None, prev: dict | None = None, cap: int = FUND_ALARM_MAX,
                        quotes: dict | None = None) -> list[dict]:
    """T11c silent INFO for watchlist names whose latest SEC 10-Q/10-K (aai/intel/adapters/xbrl.snapshot) shows an
    operating burn with under 12 months of runway, or 1Y share growth of at least +10%. The id carries the ticker, the
    kind and the period end, so each condition shows once per reporting period and a new 10-Q retires it (a still-true
    condition comes back under the new period). `prev` (the previous good fundamentals payload) only words the detail
    "new this period" / "also in the period ending ..." when it holds an older period for that ticker; it never
    creates or hides an alarm. Stale periods, banks and rows without a period are skipped. Descriptive, not a signal;
    nothing creates an idea, ticket or order.
    T11e: `quotes` (the watch_quotes payload) supplies split events; a split inside the 1Y window is taken out of the
    share-count change (valuation.split_yoy), and a change that cannot be made comparable raises no dilution alarm, so
    a 10:1 split never reads as +900% dilution. Without quotes the reported change is used as before."""
    from datetime import date
    from aai.intel import valuation
    qrows = {}
    for q in ((quotes or {}).get("rows") if isinstance(quotes, dict) and isinstance(quotes.get("rows"), list) else []):
        if isinstance(q, dict) and isinstance(q.get("ticker"), str):
            qrows[q["ticker"].upper()] = q

    def adj(r):
        try:
            return valuation.split_yoy(r, qrows.get(str(r.get("ticker") or "").upper()))
        except Exception:  # noqa: BLE001 - malformed row: treat as not comparable
            return {"yoy": None, "status": "unknown", "note": ""}
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        return []
    prev_rows = {}
    for r in ((prev or {}).get("rows") if isinstance(prev, dict) and isinstance(prev.get("rows"), list) else []):
        if isinstance(r, dict) and isinstance(r.get("ticker"), str):
            prev_rows[r["ticker"].upper()] = r

    def num(v):
        return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v else None

    def money(v):
        a = abs(v)
        return f"${a / 1e9:.1f}B" if a >= 1e9 else f"${a / 1e6:.0f}M" if a >= 1e6 else f"${a:,.0f}"

    def history_note(tk, end, held):
        p = prev_rows.get(tk)
        if not isinstance(p, dict) or not isinstance(p.get("period_end"), str):
            return ""
        try:
            pe = date.fromisoformat(p["period_end"][:10])
        except ValueError:
            return ""
        if pe >= end:
            return ""
        return (f"; also in the period ending {pe.isoformat()}" if held(p) else f"; new this period (not in {pe.isoformat()})")

    def runway_held(r):
        m = num(r.get("runway_months"))
        return m is not None and m < FUND_RUNWAY_MONTHS

    def dil_held(r):
        y = num(adj(r)["yoy"])
        return y is not None and y >= FUND_DILUTION

    hits = []
    for r in payload["rows"]:
        if not isinstance(r, dict) or not isinstance(r.get("ticker"), str) or not isinstance(r.get("period_end"), str):
            continue
        flags = r.get("flags") if isinstance(r.get("flags"), list) else []
        if "STALE PERIOD" in flags or "BANK" in flags:
            continue
        try:
            end = date.fromisoformat(r["period_end"][:10])
        except ValueError:
            continue
        tk = _sym_id(r["ticker"].upper())[:10]
        form = str(r.get("form") or "filing")[:8]
        months, ocf, fcf, liq = num(r.get("runway_months")), num(r.get("ocf_ttm")), num(r.get("fcf_ttm")), num(r.get("liquidity"))
        if runway_held(r) and ocf is not None and ocf < 0 and fcf is not None and fcf < 0:
            hits.append((0, months, tk, {
                "id": f"intel_fund_runway_{tk}_{end.isoformat()}", "sev": "info", "chime": False,
                "title": f"{tk} runway about {months:.0f} months ({form} {end.strftime('%m-%d')})",
                "detail": _cap(f"Operating burn: FCF TTM {('-' if fcf < 0 else '') + money(fcf)} against "
                               + (money(liq) if liq is not None else "n/a")
                               + " cash and short-term investments, from SEC XBRL"
                               + history_note(tk, end, runway_held) + "; watchlist; descriptive, not a signal"),
                "source": "intel", "ticker": tk, "kind": "runway", "period_end": end.isoformat(),
                "runway_months": months}))
        ya = adj(r)
        yoy = num(ya["yoy"])
        if dil_held(r):
            hits.append((1, -yoy, tk, {
                "id": f"intel_fund_dilution_{tk}_{end.isoformat()}", "sev": "info", "chime": False,
                "title": f"{tk} share count {yoy * 100:+.0f}% in a year ({form} {end.strftime('%m-%d')})",
                "detail": _cap("1Y share growth of at least 10% from SEC XBRL, basis "
                               + str(r.get("shares_basis") or "share count")[:32]
                               + ("; " + str(ya.get("note") or "")[:80] if ya.get("status") == "adjusted" else "")
                               + history_note(tk, end, dil_held) + "; watchlist; descriptive, not a signal"),
                "source": "intel", "ticker": tk, "kind": "dilution", "period_end": end.isoformat(),
                "shares_yoy": yoy, "split_adjusted": ya.get("status") == "adjusted"}))
    return [h[3] for h in sorted(hits, key=lambda h: (h[0], h[1], h[2]))[:max(0, int(cap))]]
