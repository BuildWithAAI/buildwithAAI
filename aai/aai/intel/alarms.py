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
