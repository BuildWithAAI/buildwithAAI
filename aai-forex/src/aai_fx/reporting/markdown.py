"""Markdown summary for AAI Terminal."""

from __future__ import annotations

from typing import Any

from .schema import AAIReport, Metrics


def _f(v: Any, nd: int = 2, suffix: str = "") -> str:
    if v is None:
        return "n/a"
    if isinstance(v, float):
        return f"{v:,.{nd}f}{suffix}"
    return f"{v}{suffix}"


METRIC_ROWS = [("Trades", "trade_count", 0, ""), ("CAGR", "cagr_pct", 2, "%"), ("Sharpe", "sharpe", 2, ""),
               ("Sortino", "sortino", 2, ""), ("Max DD", "max_drawdown_pct", 2, "%"),
               ("Win rate", "win_rate_pct", 1, "%"), ("Profit factor", "profit_factor", 2, ""),
               ("Expectancy", "expectancy_r", 3, " R"), ("Total return", "total_return_pct", 2, "%")]


def metrics_table(cols: list[tuple[str, Metrics]]) -> str:
    head = "| Metric | " + " | ".join(n for n, _ in cols) + " |\n|---|" + "---|" * len(cols) + "\n"
    rows = []
    for label, key, nd, suf in METRIC_ROWS:
        vals = [_f(m.model_dump().get(key), nd, suf) for _, m in cols]
        rows.append(f"| {label} | " + " | ".join(vals) + " |")
    return head + "\n".join(rows) + "\n"


def _cell(key: str, v: object) -> str:
    if isinstance(v, float):
        if key == "age_min":
            return f"{v:,.0f}"
        if key == "bias":
            return f"{v:+.0f}"
        return _f(v, 5)
    return "-" if v is None else str(v)


def render_markdown(r: AAIReport) -> str:
    out = [f"# AAI-FX report `{r.report_id}`", "",
           f"- Generated: {r.generated_at} (UTC)  |  kind: **{r.kind}**  |  mode: **{r.mode.upper()}**  |  "
           f"live trading: **{r.live_trading}**",
           f"- Account: {r.account.get('currency')} {r.account.get('starting_equity'):,.0f} (simulated)  |  "
           f"risk/trade {r.risk_limits.get('risk_per_trade_pct')}%  |  max open {r.risk_limits.get('max_open_risk_pct')}%"
           f"  |  daily loss limit {r.risk_limits.get('daily_loss_limit_pct')}%  |  config `{r.config_fingerprint}`", ""]
    for b in r.backtests:
        mode = " [research mode: drawdown kill disabled]" if not b.drawdown_kill_enforced else ""
        out += [f"## Backtest: {b.strategy} ({b.timeframe}){mode}", "",
                f"Period {b.period_start} -> {b.period_end}; params `{b.params}`", ""]
        cols = [("Full", b.metrics)]
        if b.is_oos:
            cols += [("In-sample", b.is_oos.in_sample), ("Out-of-sample", b.is_oos.out_of_sample)]
        if b.walk_forward:
            cols += [("Walk-fwd OOS", b.walk_forward.oos_metrics)]
        out.append(metrics_table(cols))
        if b.is_oos:
            out.append(f"IS/OOS split at {b.is_oos.split_ts}.\n")
        if b.walk_forward:
            out.append(f"Walk-forward: {len(b.walk_forward.windows)} windows, train {b.walk_forward.train_bars} / "
                       f"test {b.walk_forward.test_bars} bars, grid {b.walk_forward.grid_size}, objective "
                       f"{b.walk_forward.objective}.\n")
        if b.per_pair:
            out.append("| Pair | Trades | Win % | Exp. R | Net PnL | PF |\n|---|---|---|---|---|---|")
            for p, m in b.per_pair.items():
                out.append(f"| {p} | {m['trades']} | {_f(m['win_rate_pct'], 1)} | {_f(m['expectancy_r'], 3)} | "
                           f"{_f(m['net_pnl'])} | {_f(m.get('profit_factor'))} |")
            out.append("")
        out.append(f"Signals {b.signals}, approved entries {b.approved_entries}, risk rejections {b.rejections}, "
                   f"drawdown kill enforced: {b.drawdown_kill_enforced}, kill switch: {b.kill_switch or 'not triggered'}, "
                   f"first drawdown-limit breach: {b.first_drawdown_breach or 'none'}, modeled spread+slippage cost "
                   f"{b.spread_slippage_cost:,.2f}.\n")
        if b.data:
            out.append(f"Data: {b.data.provider} {b.data.timeframe}, {b.data.first_bar} -> {b.data.last_bar}, "
                       f"bars/pair {b.data.bars_per_pair}.\n")
    if r.scan:
        s = r.scan
        out += [f"## Scan ({s.generated_at} UTC)", "", f"Kill switch engaged: **{s.kill_switch_engaged}**", ""]
        if s.signals:
            out.append("| Pair | Strategy | Action | Bar close | Ref | Stop | Target | Risk decision |\n|---|---|---|---|---|---|---|---|")
            for g in s.signals:
                rd = g.risk or {}
                dec = (f"APPROVED {rd.get('lots')} lots ({_f(rd.get('risk_pct'))}%)" if rd.get("approved")
                       else ("; ".join(rd.get("reasons", [])) or "-"))
                out.append(f"| {g.pair} | {g.strategy} | {g.action} | {g.bar_close_ts} | {g.ref_price:.5f} | "
                           f"{_f(g.stop, 5)} | {_f(g.target, 5)} | {dec} |")
            out.append("")
        else:
            out.append("No actionable signals on the latest completed bars.\n")
        if s.market_state:
            keys = list(dict.fromkeys(k for row in s.market_state for k in row if k != "position")) + ["position"]
            out.append("| " + " | ".join(keys) + " |\n|" + "---|" * len(keys))
            for row in s.market_state:
                out.append("| " + " | ".join(_cell(k, row.get(k)) for k in keys) + " |")
            out.append("")
        for n in s.notes:
            out.append(f"- {n}")
        out.append("")
    if r.audit:
        out.append("## Audit")
        for a in r.audit:
            out.append(f"- `{a.path}`: {a.records} records, hash chain {'OK' if a.chain_ok else 'BROKEN'}"
                       + (f" ({a.message})" if a.message and a.message.lower() != "ok" else ""))
        out.append("")
    out.append("## Disclaimers")
    out += [f"- {d}" for d in r.disclaimers]
    return "\n".join(out) + "\n"
