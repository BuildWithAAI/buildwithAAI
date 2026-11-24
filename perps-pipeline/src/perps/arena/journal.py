"""Trade journal: automatic post-mortems and human-readable per-trade records."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

CST = "America/Chicago"


def cst(ts: str | None) -> str:
    if not ts:
        return "-"
    return pd.Timestamp(ts).tz_convert(CST).strftime("%Y-%m-%d %H:%M:%S %Z")


def postmortem(t: dict[str, Any]) -> tuple[str, list[str]]:
    """Classify what happened and write a short, specific 'what went right/wrong' note."""
    tags: list[str] = []
    notes: list[str] = []
    reason = t.get("exit_reason", "")
    r = float(t.get("r_multiple") or 0.0)
    mfe, mae = float(t.get("mfe_r") or 0.0), float(t.get("mae_r") or 0.0)
    tf_min = {"1m": 1, "5m": 5, "15m": 15, "1H": 60, "4H": 240}.get(t.get("timeframe", ""), 60)
    dur = float(t.get("duration_min") or 0.0)
    fees = float(t.get("entry_fee", 0)) + float(t.get("exit_fee", 0))
    gross, funding = float(t.get("gross_pnl", 0)), float(t.get("funding", 0))
    if reason == "take_profit":
        tags.append("tp_hit")
        notes.append(f"Thesis played out: target hit for {r:+.2f}R after {dur:.0f} min; worst heat was {mae:+.2f}R.")
    elif reason == "liquidation":
        tags.append("liquidated")
        notes.append("LIQUIDATED: price gapped through the stop to the liquidation estimate. Review leverage and "
                     "stop placement versus the liquidation buffer.")
    elif reason in ("stop", "trail_stop"):
        if reason == "trail_stop" and r > 0:
            tags.append("trailed_out_in_profit")
            notes.append(f"Trailing stop locked in {r:+.2f}R (peak excursion {mfe:+.2f}R).")
        elif mfe >= 1.0:
            tags.append("gave_back_profit")
            notes.append(f"Was up {mfe:+.2f}R at best but reversed to the stop: the target ({t.get('take_profit_r')}R) "
                         f"was too far or no breakeven/trailing protection was in place.")
        elif mfe < 0.25 and dur <= 2 * tf_min:
            tags.append("immediate_adverse")
            notes.append(f"Price never moved in favour (best {mfe:+.2f}R) and hit the stop within {dur:.0f} min: "
                         f"entry timing was poor or the signal was a false break.")
        else:
            tags.append("thesis_failed")
            notes.append(f"Stopped out after {dur:.0f} min; best {mfe:+.2f}R, worst {mae:+.2f}R. The setup did not "
                         f"follow through.")
    elif reason == "time":
        tags.append("time_exit")
        notes.append(f"No follow-through within the max hold; closed at {r:+.2f}R (best {mfe:+.2f}R).")
    elif reason == "signal":
        tags.append("signal_exit")
        notes.append(f"Invalidation rule fired ({t.get('exit_detail', '')}); closed at {r:+.2f}R.")
    elif reason == "archived":
        tags.append("archived")
        notes.append(t.get("exit_detail", "Archived manually."))
    if gross > 0 and gross + funding - fees <= 0:
        tags.append("fees_ate_edge")
        notes.append(f"Gross was ${gross:+.4f} but fees ${fees:.4f} turned it into a loss.")
    elif gross != 0 and fees > 0.5 * abs(gross):
        tags.append("fee_heavy")
        notes.append(f"Fees (${fees:.4f}) were over half of the gross move (${gross:+.4f}).")
    if t.get("risk_amount") and abs(funding) >= 0.1 * float(t["risk_amount"]):
        tags.append("funding_impact")
        notes.append(f"Funding was material: ${funding:+.4f} ({funding / float(t['risk_amount']):+.2f}R).")
    ctx = t.get("exit_context") or {}
    if ctx.get("regime") and t.get("indicators", {}).get("regime") and ctx["regime"] != t["indicators"]["regime"]:
        tags.append("regime_change")
        notes.append(f"Regime changed during the trade ({t['indicators']['regime']} -> {ctx['regime']}).")
    return " ".join(notes), tags


def render_md(t: dict[str, Any]) -> str:
    side = "LONG" if t["side"] > 0 else "SHORT"
    lines = [f"# Trade #{t['id']} - {t['arm']} - {side} {t['symbol']} ({t['status']})", ""]
    lines += [
        f"- Arm / rule: `{t['arm']}` ({t.get('kind')}, {t.get('timeframe')}), params v{t.get('params_version')}",
        f"- Signal bar (open time): {cst(t.get('signal_bar'))}",
        f"- Entry: {cst(t.get('entry_time'))} @ {t['entry_price']:.6g} ({'maker limit' if t.get('maker_entry') else 'taker market'})",
        f"- Size: {t['qty']:.6g} {t['symbol'].split('-')[0]} ({t.get('contracts')} contracts), notional "
        f"${t['notional']:.2f}, implied leverage {t['implied_leverage']:.2f}x, margin ${t['margin']:.2f}",
        f"- Risk: {t.get('risk_fraction', 0):.2%} of arm equity = ${t['risk_amount']:.4f} (1R)",
        f"- Stop: initial {t['initial_stop']:.6g}, current {t['stop_price']:.6g}; take-profit "
        f"{t['take_profit']:.6g} ({t.get('take_profit_r')}R); est. liquidation {t['liquidation_price']:.6g}",
        f"- Entry fee: ${t['entry_fee']:.4f}; funding so far: ${t.get('funding', 0.0):+.4f}",
        "", "## Thesis", "", t.get("thesis", ""), "", "## Indicator values at the signal", "", "```json",
        json.dumps(t.get("indicators", {}), indent=2, default=str), "```", "",
    ]
    if t["status"] == "closed":
        lines += [
            "## Result", "",
            f"- Exit: {cst(t.get('exit_time'))} @ {t['exit_price']:.6g} - {t.get('exit_reason')}"
            + (f" ({t['exit_detail']})" if t.get("exit_detail") else ""),
            f"- PnL: gross ${t['gross_pnl']:+.4f}, fees ${t['entry_fee'] + t['exit_fee']:.4f}, funding "
            f"${t.get('funding', 0):+.4f} -> **net ${t['net_pnl']:+.4f} = {t['r_multiple']:+.2f}R**",
            f"- Duration: {t['duration_min']:.1f} min",
            f"- MAE: {t['mae_r']:+.2f}R (${t['mae_usd']:+.4f} at {t['mae_price']:.6g}); MFE: {t['mfe_r']:+.2f}R "
            f"(${t['mfe_usd']:+.4f} at {t['mfe_price']:.6g})",
            "", "## Post-mortem", "", t.get("postmortem", ""), "", f"Tags: {', '.join(t.get('tags', []))}", "",
        ]
    else:
        lines += ["## Live", "", f"- Last price: {t.get('last_price')}; unrealised ${t.get('unrealized', 0):+.4f}; "
                  f"MAE/MFE so far: {t.get('mae_price')} / {t.get('mfe_price')}", ""]
    if t.get("funding_events"):
        lines += ["## Funding settlements", ""] + [
            f"- {cst(e['time'])}: rate {e['rate']:.6f} x mark {e['mark']:.6g} -> ${e['payment']:+.4f}"
            + (" (estimated)" if e.get("estimated") else "") for e in t["funding_events"]] + [""]
    return "\n".join(lines)


def write_trade_md(t: dict[str, Any], journal_dir: Path) -> Path:
    journal_dir.mkdir(parents=True, exist_ok=True)
    p = journal_dir / f"{int(t['id']):05d}_{t['arm']}_{t['symbol']}.md"
    p.write_text(render_md(t))
    return p
