from types import SimpleNamespace
from smr.backtest import runner
from tests.test_backtest_runner_budget import FakeStore


def test_add_tracer_stats_sums_numeric_only():
    tot = {}
    runner.add_tracer_stats(tot, {"probes": 5, "hub_page_skips": 2, "flag": True, "note": "x"})
    runner.add_tracer_stats(tot, {"probes": 3, "history_skips": 1})
    runner.add_tracer_stats(tot, None)
    assert tot == {"probes": 8, "hub_page_skips": 2, "history_skips": 1}


def test_run_summary_includes_tracer_totals(monkeypatch):
    def fake_one(ctx, store, c, d):
        return c["mint"], "SKIP", 50, 0.1, {"probes": 10, "probe_cache_hits": 1, "hub_page_skips": 2}
    monkeypatch.setattr(runner, "_one", fake_one)
    ctx = SimpleNamespace(settings=SimpleNamespace(score_delay_s=300))
    out = runner.run(ctx, FakeStore(4), parallel=2, progress=lambda m: None)
    assert out["scored"] == 4
    assert out["tracer"] == {"probes": 40, "probe_cache_hits": 4, "hub_page_skips": 8}


def test_old_four_tuple_still_works(monkeypatch):
    monkeypatch.setattr(runner, "_one", lambda ctx, store, c, d: (c["mint"], "ERROR", "boom", 0.1))
    ctx = SimpleNamespace(settings=SimpleNamespace(score_delay_s=300))
    out = runner.run(ctx, FakeStore(2), parallel=1, progress=lambda m: None)
    assert out["scored"] == 2 and out["tracer"] == {}
