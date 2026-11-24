"""Today's paper-signal candidates, sized for an EXAMPLE equity (signals.notional_equity)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from ..config import Settings
from ..execution import Order
from ..market.data import MarketData
from ..models import Signal
from ..risk import OpenRisk, RiskEngine, rolling_corr
from ..strategy import EventCalendar, FilterContext, build_setups


def _status(setup, h1: pd.DataFrame, cfg, now: datetime) -> tuple[str, str | None]:
    bars = h1[(h1.index >= pd.Timestamp(setup.valid_from)) & (h1.index + pd.Timedelta(hours=1) <= now)]
    d = 1 if setup.side == "long" else -1
    count, touched = 0, False
    prev_fav = None
    for ts, b in bars.iterrows():
        if ts >= pd.Timestamp(setup.valid_until):
            return "expired", None
        if setup.kind == "breakout":
            count = count + 1 if d * (b.close - setup.level) > 0 else 0
            if count >= cfg.n_hold:
                return "triggered", (ts + pd.Timedelta(hours=1)).isoformat()
        else:
            if d * ((b.low if d == 1 else b.high) - setup.level * (1 + d * cfg.retest_tol_pct / 100)) <= 0:
                touched = True
            if touched and prev_fav is not None and d * (b.close - setup.level) > 0 and d * (b.close - prev_fav) > 0:
                return "triggered", (ts + pd.Timedelta(hours=1)).isoformat()
        prev_fav = b.high if d == 1 else b.low
    if now >= setup.valid_until:
        return "expired", None
    return "waiting", None


def build_candidates(signals: list[Signal], md: MarketData, settings: Settings, cal: EventCalendar,
                     now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    cfg, eq = settings.strategy, settings.signals.notional_equity
    recent = [s for s in signals if now - timedelta(hours=settings.signals.lookback_hours) <= s.post_ts <= now]
    # BTC context needs all BTC history, so pass all signals but keep only recent setups
    ctx = FilterContext()
    setups = [u for u in build_setups(signals, cfg, md.h1, md.d1.get("BTC"), ctx)
              if u.signal.post_ts >= now - timedelta(hours=settings.signals.lookback_hours)]
    risk = RiskEngine(settings.risk)
    corr = rolling_corr({a: md.d1[a]["close"] for a in md.d1}, now, settings.risk.corr_lookback_days)
    opens: list[OpenRisk] = []
    cands = []
    for u in sorted(setups, key=lambda x: (not x.confirmed, x.signal.post_ts)):
        h1 = md.h1[u.asset]
        closed = h1[h1.index + pd.Timedelta(hours=1) <= now]
        if closed.empty:
            continue
        price, atr = float(closed.close.iloc[-1]), float(closed.atr.iloc[-1])
        d = 1 if u.side == "long" else -1
        status, trig_ts = _status(u, h1, cfg, now)
        stop = u.level - d * cfg.stop_atr_mult * atr
        entry = u.level if status == "waiting" else price
        notes = []
        if status == "triggered" and d * (price - u.level) / u.level * 100 > cfg.max_chase_pct:
            notes.append("price already beyond max_chase_pct: do not chase")
        if d * (entry - stop) <= 0:
            notes.append("price on the wrong side of stop")
        tgt = u.target if (u.target is not None and d * (u.target - entry) > 0) else None
        per_unit = d * (entry - stop)
        if tgt is None and per_unit > 0:
            tgt = entry + d * cfg.fallback_target_r * per_unit
        ev = cal.upcoming(now, 24)
        # two-sided posts produce OCO pairs: size each leg against OTHER assets' risk only
        others = [o for o in opens if o.asset != u.asset]
        dec = risk.size(ts=now, equity=eq, asset=u.asset, side=u.side, entry=entry, stop=stop,
                        confirmed=u.confirmed, open_positions=others, corr=corr) \
            if (per_unit > 0 and status != "expired" and not notes) else None
        actionable = dec is not None and dec.approved
        if actionable and not any(o.asset == u.asset for o in opens):
            opens.append(OpenRisk(u.asset, u.side, dec.risk_usd, dec.notional_usd))
        cands.append({
            "asset": u.asset, "side": u.side, "rule": u.rule, "status": status, "triggered_at": trig_ts,
            "post_ts": u.signal.post_ts.isoformat(), "url": u.signal.url, "close_label": u.signal.close_label,
            "trigger_level": u.level, "last_price": price, "entry_ref": round(entry, 6),
            "stop": round(stop, 6), "target": None if tgt is None else round(tgt, 6),
            "rr": None if (tgt is None or per_unit <= 0) else round(d * (tgt - entry) / per_unit, 2),
            "tier": "confirmed" if u.confirmed else "base",
            "risk_pct": None if not dec or not dec.approved else round(dec.risk_pct, 3),
            "risk_usd": None if not dec or not dec.approved else round(dec.risk_usd, 2),
            "qty": None if not dec or not dec.approved else float(np.round(dec.qty, 6)),
            "notional_usd": None if not dec or not dec.approved else round(dec.notional_usd, 2),
            "rejected": None if dec is None or dec.approved else dec.reason,
            "notes": notes, "actionable": actionable,
            "events_next_24h": [f"{n} {t.isoformat()}" for t, n in ev],
            "sentence": u.scenario.sentence,
        })
    per_asset: dict[str, float] = {}
    for c in cands:
        if c["actionable"]:
            per_asset[c["asset"]] = max(per_asset.get(c["asset"], 0.0), c["risk_pct"] or 0.0)
    total_risk = sum(per_asset.values())  # OCO legs on one asset counted once (the larger)
    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "EXAMPLE_ONLY": f"Sizes use an EXAMPLE equity of ${eq:,.0f}. Paper signals, not advice, no orders sent.",
        "equity_example": eq,
        "posts_considered": len(recent),
        "candidates": cands,
        "total_open_risk_pct_if_all_filled": round(total_risk, 3),
        "filter_rejections": ctx.rejections,
    }


def to_orders(payload: dict) -> list[Order]:
    out = []
    for c in payload["candidates"]:
        if not c["actionable"]:
            continue
        out.append(Order(asset=c["asset"], side=c["side"],
                         order_type="stop_entry" if c["status"] == "waiting" else "market",
                         qty=c["qty"], entry=c["entry_ref"], stop=c["stop"], target=c["target"],
                         risk_usd=c["risk_usd"], risk_pct=c["risk_pct"], tier=c["tier"],
                         post_id=c["url"].rsplit("/", 1)[-1], url=c["url"]))
    return out


def render_markdown(payload: dict) -> str:
    L = [f"# Billy paper signals — {payload['generated_at']}", "",
         f"> **EXAMPLE ONLY.** {payload['EXAMPLE_ONLY']}", "",
         f"Posts in lookback window: {payload['posts_considered']}. "
         f"Total risk if every actionable candidate fills: {payload['total_open_risk_pct_if_all_filled']}% "
         "(cap 3%; OCO legs of a two-sided post counted once).", ""]
    if not payload["candidates"]:
        L.append("_No candidates passed the filters._")
        return "\n".join(L)
    L += ["| Asset | Side | Rule | Status | Trigger | Last | Stop | Target | R:R | Tier | Risk % | Qty | Notional $ | Post |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for c in payload["candidates"]:
        flag = "" if c["actionable"] else " (not actionable: " + ("; ".join(c["notes"]) or c["rejected"] or c["status"]) + ")"
        L.append(f"| {c['asset']} | {c['side']} | {c['rule']} | {c['status']}{flag} | {c['trigger_level']:g} | "
                 f"{c['last_price']:g} | {c['stop']:g} | {c['target'] if c['target'] is not None else '—'} | "
                 f"{c['rr'] if c['rr'] is not None else '—'} | {c['tier']} | {c['risk_pct'] or '—'} | "
                 f"{c['qty'] or '—'} | {c['notional_usd'] or '—'} | [link]({c['url']}) |")
    ev = sorted({e for c in payload["candidates"] for e in c["events_next_24h"]})
    if ev:
        L += ["", "**Macro events next 24h:** " + ", ".join(ev)]
    return "\n".join(L)
