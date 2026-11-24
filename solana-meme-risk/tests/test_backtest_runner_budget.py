from types import SimpleNamespace
from smr.backtest import runner


class FakeStore:
    def __init__(self, n): self.rows = [(f"s{i}", f"mint{i:03d}", 1000 + i, i, "c", "cv", 20) for i in range(n)]
    def q(self, sql, args=()): return self.rows


def test_budget_stops_new_submissions(monkeypatch):
    t = {"now": 0.0}
    def fake_one(ctx, store, cand, delay):
        t["now"] += 10
        return cand["mint"], "NORMAL", 10, 10.0
    monkeypatch.setattr(runner, "_one", fake_one)
    ctx = SimpleNamespace(settings=SimpleNamespace(score_delay_s=300))
    msgs = []
    out = runner.run(ctx, FakeStore(10), parallel=1, budget_s=25, progress=msgs.append, clock=lambda: t["now"])
    assert out["budget_hit"] is True and out["scored"] == 3 and out["eligible"] == 10
    assert any(m.startswith("[1/10]") for m in msgs)


def test_no_budget_scores_all(monkeypatch):
    monkeypatch.setattr(runner, "_one", lambda ctx, store, c, d: (c["mint"], "SKIP", 50, 0.1))
    ctx = SimpleNamespace(settings=SimpleNamespace(score_delay_s=300))
    out = runner.run(ctx, FakeStore(7), parallel=3, progress=lambda m: None)
    assert out["scored"] == 7 and out["budget_hit"] is False


class SqlCapture(FakeStore):
    def __init__(self, n): super().__init__(n); self.sql = []
    def q(self, sql, args=()):
        self.sql.append(sql)
        return self.rows if "DESC" not in sql else list(reversed(self.rows))


def test_newest_first_orders_descending(monkeypatch):
    seen = []
    monkeypatch.setattr(runner, "_one", lambda ctx, store, c, d: (seen.append(c["mint"]) or c["mint"], "SKIP", 50, 0.1))
    ctx = SimpleNamespace(settings=SimpleNamespace(score_delay_s=300))
    st = SqlCapture(4)
    runner.run(ctx, st, parallel=1, progress=lambda m: None, newest_first=True)
    assert "ORDER BY create_time DESC" in st.sql[0] and seen == ["mint003", "mint002", "mint001", "mint000"]
    st2 = SqlCapture(4)
    runner.run(ctx, st2, parallel=1, progress=lambda m: None)
    assert "DESC" not in st2.sql[0]


def test_hard_deadline_abandons_stuck_launch(monkeypatch):
    import threading, time as _t
    release = threading.Event()
    def fake_one(ctx, store, cand, delay):
        if cand["mint"] == "mint000":
            release.wait(5)  # stuck launch
        return cand["mint"], "NORMAL", 10, 0.0
    monkeypatch.setattr(runner, "_one", fake_one)
    ctx = SimpleNamespace(settings=SimpleNamespace(score_delay_s=300))
    t0 = _t.time()
    out = runner.run(ctx, FakeStore(3), parallel=1, budget_s=0.1, hard_grace_s=0.2, progress=lambda m: None)
    release.set()
    assert out["abandoned"] == 1 and out["scored"] == 0 and out["budget_hit"] is True
    assert _t.time() - t0 < 2


def test_no_abandon_when_launches_finish(monkeypatch):
    monkeypatch.setattr(runner, "_one", lambda ctx, store, c, d: (c["mint"], "SKIP", 50, 0.1))
    ctx = SimpleNamespace(settings=SimpleNamespace(score_delay_s=300))
    out = runner.run(ctx, FakeStore(5), parallel=2, budget_s=60, progress=lambda m: None)
    assert out["abandoned"] == 0 and out["scored"] == 5
