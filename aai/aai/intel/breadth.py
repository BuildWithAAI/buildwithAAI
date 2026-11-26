"""US sector breadth from the 11 SPDR Select Sector ETFs (Yahoo daily bars via the intel `sectors` feed).

Pure functions, no I/O. Describes what the tape did — how many sectors rose today, how many are above their
level 20 sessions ago, the equal-weight average versus SPY, and the leaders / laggards. It is a descriptive
read of breadth, labelled "not a signal"; nothing here creates an idea, a ticket or an order."""
from __future__ import annotations

DISCLAIMER = "Descriptive breadth of the 11 SPDR sector ETFs — not a signal."
FLAT = 0.0005  # |chg| under 0.05% counts as flat (neither advancing nor declining)
HIST_SESSIONS = 20


def _num(x):
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and x == x else None


def _label(up: int, down: int, n: int) -> str:
    if n < 6:
        return "INSUFFICIENT DATA"
    if up >= 0.8 * n:
        return "BROAD ADVANCE"
    if down >= 0.8 * n:
        return "BROAD DECLINE"
    if up > down:
        return "MIXED, LEANING UP"
    if down > up:
        return "MIXED, LEANING DOWN"
    return "MIXED"


def _session_day(ts) -> str | None:
    """New York calendar date of a daily bar timestamp (Yahoo stamps US bars at the 09:30 ET open)."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    try:
        return datetime.fromtimestamp(float(ts), ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def session_live(day: str | None, now: float | None = None) -> bool:
    """True while `day` (a New York session date) is still forming: it is today in New York and before the 16:00 ET
    close on a weekday. A bar from an earlier date, or today's after the close, is a closed session."""
    import time as _t
    from datetime import datetime
    from zoneinfo import ZoneInfo
    if not day:
        return False
    try:
        ny = datetime.fromtimestamp(float(_t.time() if now is None else now), ZoneInfo("America/New_York"))
    except (TypeError, ValueError, OverflowError, OSError):
        return False
    return ny.strftime("%Y-%m-%d") == str(day) and ny.weekday() < 5 and ny.hour < 16


def history(rows, sessions: int = HIST_SESSIONS, now: float | None = None) -> dict:
    """Per-session advance/decline counts for the last `sessions` sessions, rebuilt from the daily closes the
    sectors feed already carries (`spark`, ~30 bars per ETF), so no extra table or fetch is needed.
    A session counts only when 6+ sectors have a close on it and on the session before (never interpolated).
    The newest point is today's live bar while the market is open. Returns oldest-first points with up/down/flat,
    net, a cumulative A/D line and the label, plus the current same-sign streak of net advancers/decliners."""
    closes: dict[str, dict[str, float]] = {}
    for r in rows or []:
        if not isinstance(r, dict) or not r.get("symbol"):
            continue
        d = {}
        for pt in r.get("spark") or []:
            try:
                t, v = pt[0], _num(pt[1])
            except (TypeError, IndexError, KeyError):
                continue
            day = _session_day(t)
            if day and v and v > 0:
                d[day] = v
        if d:
            closes[str(r["symbol"])[:8]] = d
    days = sorted({day for d in closes.values() for day in d})
    pts = []
    for i in range(1, len(days)):
        prev, day = days[i - 1], days[i]
        chg = [d[day] / d[prev] - 1 for d in closes.values() if day in d and prev in d]
        if len(chg) < 6:
            continue
        up = sum(1 for c in chg if c > FLAT)
        down = sum(1 for c in chg if c < -FLAT)
        pts.append({"day": day, "n": len(chg), "up": up, "down": down, "flat": len(chg) - up - down,
                    "net": up - down, "label": _label(up, down, len(chg))})
    pts = pts[-max(1, int(sessions)):]
    run = 0
    for p in pts:
        run += p["net"]
        p["ad"] = run
    streak = {"side": None, "n": 0}
    if pts and pts[-1]["net"]:
        side = 1 if pts[-1]["net"] > 0 else -1
        k = 0
        for p in reversed(pts):
            if p["net"] * side > 0:
                k += 1
            else:
                break
        streak = {"side": "advancers" if side > 0 else "decliners", "n": k}
    return {"sessions": len(pts), "points": pts, "streak": streak,
            "last_live": session_live(pts[-1]["day"], now) if pts else False,
            "prev_label": pts[-2]["label"] if len(pts) > 1 else None,
            "ad_change": pts[-1]["ad"] if pts else None}


CROSS_MIN = 5  # sessions on the other side of 50% before a cross of the share above 20D counts (alarm + voice)


def above_history(rows, sessions: int = HIST_SESSIONS, lookback: int = 20, now: float | None = None) -> dict:
    """How many sectors closed above their close `lookback` sessions earlier, per session, for the last `sessions`
    sessions. Uses each ETF's own bar sequence from the feed's daily closes (`spark`, ~64 bars with the 3mo range), so
    "20 sessions earlier" means 20 of that ETF's bars back, exactly like today's `chg_20d`. A session needs 6+ sectors
    with both closes or it is skipped (never interpolated). Returns oldest-first points (n / above / pct), the change
    versus 5 sessions earlier and the first session of the current side of 50% (above/below half)."""
    lookback = max(1, int(lookback))
    per_day: dict[str, list[bool]] = {}
    for r in rows or []:
        if not isinstance(r, dict) or not r.get("symbol"):
            continue
        bars: dict[str, float] = {}
        for pt in r.get("spark") or []:
            try:
                t, v = pt[0], _num(pt[1])
            except (TypeError, IndexError, KeyError):
                continue
            day = _session_day(t)
            if day and v and v > 0:
                bars[day] = v
        seq = sorted(bars.items())
        for i in range(lookback, len(seq)):
            per_day.setdefault(seq[i][0], []).append(seq[i][1] > seq[i - lookback][1])
    pts = []
    for day in sorted(per_day):
        flags = per_day[day]
        if len(flags) < 6:
            continue
        a = sum(1 for x in flags if x)
        pts.append({"day": day, "n": len(flags), "above": a, "pct": round(a / len(flags), 4)})
    pts = pts[-max(1, int(sessions)):]
    chg5 = None
    if len(pts) > 5:
        chg5 = round(pts[-1]["pct"] - pts[-6]["pct"], 4)
    side_since, side, prev_side, cross, recent = None, None, None, None, None
    live = session_live(pts[-1]["day"], now) if pts else False
    if pts:
        sides = [_half_side(p["pct"]) for p in pts]
        side = sides[-1]
        k = len(pts) - 1
        while k > 0 and sides[k - 1] == side:
            k -= 1
        side_since = {"day": pts[k]["day"], "sessions": len(pts) - k, "whole_window": k == 0}
        if k > 0:  # the run just before the current one (contiguous same side), so a fresh cross knows how long it held
            j = k - 1
            while j > 0 and sides[j - 1] == sides[k - 1]:
                j -= 1
            prev_side = {"side": sides[k - 1], "day": pts[j]["day"], "sessions": k - j, "whole_window": j == 0}
            # A cross of 50%: today is the first session on this side, directly after CROSS_MIN+ sessions on the other
            # side (a stop "at half" is not a cross). Today's point is live while the session is open.
            if (side_since["sessions"] == 1 and {side, prev_side["side"]} == {"above_half", "below_half"}
                    and prev_side["sessions"] >= CROSS_MIN):
                cross = {"day": pts[-1]["day"], "to": side, "pct": pts[-1]["pct"], "prev_sessions": prev_side["sessions"],
                         "prev_whole_window": prev_side["whole_window"], "live": live}
        recent = _recent_cross(pts, sides, live)
    return {"sessions": len(pts), "lookback": lookback, "points": pts, "change_5s": chg5, "side": side, "side_since": side_since,
            "prev_side": prev_side, "cross": cross, "recent_cross": recent, "last_live": live,
            "lo": min((p["pct"] for p in pts), default=None), "hi": max((p["pct"] for p in pts), default=None)}


def _recent_cross(pts: list[dict], sides: list[str], live: bool) -> dict | None:
    """The newest 50% cross in the window (same rule as `cross`: first session on a side directly after CROSS_MIN+
    sessions on the other side) and what happened after it, judged on closed sessions only:
      live     the cross is today's bar and the session is still open (it can still undo itself before the close);
      held     every session from the cross day to now is on the new side (the cross day itself has closed there);
      unwound  a later session went back to (or stopped at) half or the other side; `unwound_day` is the first one.
    A cross that undid itself intraday never shows up here: its closed bar is on the old side, so no cross is recorded."""
    found = None
    for i in range(len(sides) - 1, 0, -1):
        to = sides[i]
        if to not in ("above_half", "below_half") or sides[i - 1] == to:
            continue
        j = i - 1
        other = sides[j]
        if {to, other} != {"above_half", "below_half"}:
            continue
        while j > 0 and sides[j - 1] == other:
            j -= 1
        if i - j >= CROSS_MIN:
            found = (i, i - j, j == 0)
            break
    if not found:
        return None
    i, prev_n, whole = found
    after = sides[i:]
    held_n = 0
    for sd in after:
        if sd != sides[i]:
            break
        held_n += 1
    last_i = len(pts) - 1
    if i == last_i and live:
        status = "live"
    elif held_n == len(after):
        status = "held"
    else:
        status = "unwound"
    out = {"day": pts[i]["day"], "to": sides[i], "pct": pts[i]["pct"], "prev_sessions": prev_n, "prev_whole_window": whole,
           "status": status, "sessions_since": last_i - i, "held_sessions": held_n,
           "closed_sessions": held_n - (1 if live and held_n == len(after) else 0)}
    if status == "unwound":
        out["unwound_day"] = pts[i + held_n]["day"]
        out["unwind_live"] = bool(live and i + held_n == last_i)  # undone on today's still-open bar: may re-cross by the close
    return out


def _half_side(pct: float) -> str:
    return "above_half" if pct > 0.5 else "below_half" if pct < 0.5 else "at_half"


def compute(rows, spy: dict | None = None) -> dict:
    """rows: yahoo.parse() dicts for the sector ETFs. spy: the SPY row from the markets feed (optional).
    Returns counts, equal-weight averages, relative-to-SPY per sector, leaders/laggards and a plain label.
    Sectors without a daily change are listed but not counted, so a partial fetch never reads as a decline."""
    cells, chg, c20 = [], [], []
    spy_chg = _num((spy or {}).get("chg"))
    spy_20 = _num((spy or {}).get("chg_20d"))
    for r in rows or []:
        if not isinstance(r, dict) or not r.get("symbol"):
            continue
        d, m = _num(r.get("chg")), _num(r.get("chg_20d"))
        cell = {"symbol": str(r["symbol"])[:8], "name": str(r.get("name") or "")[:32], "last": _num(r.get("last")),
                "chg": d, "chg_20d": m, "ts": _num(r.get("ts")),
                "rel_spy": round(d - spy_chg, 5) if d is not None and spy_chg is not None else None,
                "rel_spy_20d": round(m - spy_20, 5) if m is not None and spy_20 is not None else None}
        cells.append(cell)
        if d is not None:
            chg.append(d)
        if m is not None:
            c20.append(m)
    up = sum(1 for d in chg if d > FLAT)
    down = sum(1 for d in chg if d < -FLAT)
    above = sum(1 for m in c20 if m > 0)
    n = len(chg)
    ew = round(sum(chg) / n, 5) if n else None
    ew20 = round(sum(c20) / len(c20), 5) if c20 else None
    ranked = sorted((c for c in cells if c["chg"] is not None), key=lambda c: c["chg"], reverse=True)
    label = _label(up, down, n)
    return {"n": len(cells), "n_with_chg": n, "up": up, "down": down, "flat": n - up - down,
            "above_20d": above, "n_with_20d": len(c20),
            "pct_up": round(up / n, 4) if n else None, "ew_chg": ew, "ew_chg_20d": ew20,
            "spy_chg": spy_chg, "spy_chg_20d": spy_20,
            "ew_vs_spy": round(ew - spy_chg, 5) if ew is not None and spy_chg is not None else None,
            "spread": round(ranked[0]["chg"] - ranked[-1]["chg"], 5) if len(ranked) > 1 else None,
            "leaders": [c["symbol"] for c in ranked[:3]], "laggards": [c["symbol"] for c in ranked[::-1][:3]] if len(ranked) > 3 else [],
            "label": label, "cells": cells, "disclaimer": DISCLAIMER}


def _pct(x, nd=1):
    return "n/a" if x is None else f"{x * 100:+.{nd}f}%"


def text(b: dict, state: str = "OK", age: str | None = None) -> str:
    """Spoken summary for the 'sectors' intent. Honest when missing or stale."""
    if not b or not b.get("n_with_chg"):
        return "Sector breadth isn't available yet: no SPDR sector ETF quotes are cached. I won't guess."
    names = {c["symbol"]: c["name"] for c in b.get("cells") or []}
    by = {c["symbol"]: c for c in b.get("cells") or []}

    def nm(s):
        return f"{names.get(s) or s} ({s} {_pct(by.get(s, {}).get('chg'))})"
    out = [f"Sector breadth: {b['label'].lower()}. {b['up']} of {b['n_with_chg']} sectors up today, {b['down']} down"
           + (f"; equal-weight {_pct(b['ew_chg'], 2)}" if b.get("ew_chg") is not None else "")
           + (f" versus SPY {_pct(b['spy_chg'], 2)}" if b.get("spy_chg") is not None else "") + "."]
    if b.get("n_with_20d"):
        out.append(f"{b['above_20d']} of {b['n_with_20d']} are above where they were 20 sessions ago.")
    if b.get("leaders"):
        out.append("Leading: " + ", ".join(nm(s) for s in b["leaders"][:2]) + ".")
    if b.get("laggards"):
        out.append("Lagging: " + ", ".join(nm(s) for s in b["laggards"][:2]) + ".")
    h = b.get("history") or {}
    sk = h.get("streak") or {}
    if h.get("sessions", 0) >= 5 and sk.get("n", 0) >= 3:
        out.append(f"{'Advancers' if sk['side'] == 'advancers' else 'Decliners'} have outnumbered "
                   f"{'decliners' if sk['side'] == 'advancers' else 'advancers'} for {sk['n']} sessions in a row.")
    elif h.get("sessions", 0) >= 5 and h.get("ad_change") is not None:
        out.append(f"Over the last {h['sessions']} sessions the advance-decline line is "
                   f"{'up' if h['ad_change'] > 0 else 'down' if h['ad_change'] < 0 else 'flat'} {abs(h['ad_change'])} net.")
    ah = b.get("above_hist") or {}
    ap = ah.get("points") or []
    if ah.get("sessions", 0) >= 6 and ah.get("change_5s") is not None:
        c = ah["change_5s"]
        trend = (f"up from {round((ap[-1]['pct'] - c) * 100)}%" if c > 0 else f"down from {round((ap[-1]['pct'] - c) * 100)}%" if c < 0
                 else "unchanged")
        ss = ah.get("side_since") or {}
        tail = ""
        if ah.get("side") in ("above_half", "below_half") and ss.get("sessions", 0) >= 2:
            tail = (f"; it has been {'above' if ah['side'] == 'above_half' else 'below'} half for "
                    + (f"all {ss['sessions']} sessions shown" if ss.get("whole_window") else f"{ss['sessions']} sessions"))
        out.append(f"The share above their 20-session level is {round(ap[-1]['pct'] * 100)}%, {trend} five sessions ago{tail}.")
        cr = ah.get("cross") or {}
        if cr.get("to") in ("above_half", "below_half") and isinstance(cr.get("prev_sessions"), int):
            out.append(f"That is a cross {'above' if cr['to'] == 'above_half' else 'below'} half today after "
                       f"{'at least ' if cr.get('prev_whole_window') else ''}{cr['prev_sessions']} sessions "
                       f"{'below' if cr['to'] == 'above_half' else 'above'} it."
                       + (" The session is still open, so it can undo itself before the close." if cr.get("live")
                          else " It held at the close."))
        else:
            rc = ah.get("recent_cross") or {}
            wd = "above" if rc.get("to") == "above_half" else "below"
            if rc.get("status") == "held" and isinstance(rc.get("closed_sessions"), int) and rc["closed_sessions"] >= 1:
                out.append(f"The {rc['day'][5:]} cross {wd} half has held at {rc['closed_sessions']} "
                           f"close{'s' if rc['closed_sessions'] != 1 else ''} so far.")
            elif rc.get("status") == "unwound" and isinstance(rc.get("sessions_since"), int) and rc["sessions_since"] <= 5:
                out.append(f"The {rc['day'][5:]} cross {wd} half unwound on {str(rc.get('unwound_day'))[5:]}"
                           + (" (today, still live)." if rc.get("unwind_live") else "."))
    if state == "STALE":
        out.append(f"Heads up: these quotes are stale{(' (' + age + ' old)') if age else ''}.")
    out.append("Descriptive only, not a signal.")
    return " ".join(out)
