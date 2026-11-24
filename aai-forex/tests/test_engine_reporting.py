from __future__ import annotations

import json

from aai_fx.backtest.engine import BacktestEngine
from aai_fx.backtest.walkforward import is_oos_split, walk_forward
from aai_fx.config import WalkForwardConfig
from aai_fx.reporting.audit import AuditLog, verify_audit_log
from aai_fx.reporting.markdown import render_markdown
from aai_fx.reporting.schema import AAIReport, Metrics, StrategyResult
from aai_fx.strategies import strategy_from_config

from .conftest import synth_ohlc


def _data(freq: str, n: int):  # type: ignore[no-untyped-def]
    return {"EURUSD": synth_ohlc(n, freq=freq, seed=11), "GBPUSD": synth_ohlc(n, freq=freq, seed=12, p0=1.27),
            "USDJPY": synth_ohlc(n, freq=freq, seed=13, p0=150.0), "USDCAD": synth_ohlc(n, freq=freq, seed=14, p0=1.35)}


def test_engine_runs_and_audits_everything(cfg, tmp_path) -> None:  # type: ignore[no-untyped-def]
    p = tmp_path / "audit.jsonl"
    with AuditLog(p, "t") as a:
        r = BacktestEngine(cfg, strategy_from_config("session_breakout", cfg), audit=a).run(_data("15min", 4000))
    assert r.signals > 0 and r.metrics["trade_count"] > 0
    events = [json.loads(l)["event"] for l in p.read_text().splitlines()]
    for e in ("run_start", "signal", "risk_decision", "order_submitted", "fill", "trade_closed", "run_end"):
        assert e in events, e
    assert verify_audit_log(p)[0]
    # every closed trade's equity effect is reflected in final equity
    assert abs(r.equity.iloc[-1] - (cfg.account.starting_equity + sum(t.net_pnl for t in r.trades))) < 1e-6


def test_is_oos_and_walkforward(cfg) -> None:  # type: ignore[no-untyped-def]
    data = _data("1D", 900)
    split, r_is, r_oos = is_oos_split(cfg, "trend_swing", data, 0.3)
    assert r_is.end is not None and r_oos.start is not None
    assert r_is.end <= split < r_oos.start  # IS equity stops at the split; OOS starts after it
    assert r_is.trades and r_oos.trades
    assert all(t.entry_ts >= split for t in r_oos.trades)
    assert all(t.exit_ts <= split for t in r_is.trades)
    wf = walk_forward(cfg, "trend_swing", data, WalkForwardConfig(train_bars=300, test_bars=150,
                                                                  grid={"stop_atr": [1.5, 3.0]}), min_trades=1)
    assert len(wf.windows) >= 3
    for a, b in zip(wf.windows, wf.windows[1:]):
        assert a.test_end <= b.test_start  # non-overlapping OOS
        assert a.train_end == a.test_start


def test_report_schema_and_markdown(cfg) -> None:  # type: ignore[no-untyped-def]
    r = BacktestEngine(cfg, strategy_from_config("trend_swing", cfg)).run(_data("1D", 500))
    sr = StrategyResult(run_id=r.run_id, strategy="trend_swing", timeframe="D1", params=r.strategy["params"],
                        period_start=str(r.start), period_end=str(r.end), metrics=Metrics.model_validate(r.metrics),
                        per_pair=r.per_pair, signals=r.signals, approved_entries=r.approved,
                        rejections=r.rejections, kill_switch=r.kill_switch, spread_slippage_cost=1.0)
    rep = AAIReport(report_id="x", generated_at="now", kind="backtest", producer={}, config_fingerprint="f",
                    account={"currency": "USD", "starting_equity": 1e4}, risk_limits={}, backtests=[sr])
    js = rep.model_dump_json()
    back = AAIReport.model_validate_json(js)
    assert back.live_trading is False and back.mode == "paper"
    md = render_markdown(back)
    assert "Sharpe" in md and "Expectancy" in md
