import threading, time
from aai.health_cache import HealthReportCache


class Clock:
    def __init__(self): self.t = 1000.0
    def __call__(self): return self.t


def wait_idle(c, net=True):
    for _ in range(200):
        with c.lock:
            if net not in c.running:
                return
        time.sleep(0.01)
    raise AssertionError("refresh never finished")


def test_first_call_sync_then_cached():
    calls = []
    clk = Clock()
    c = HealthReportCache(lambda n: calls.append(n) or {"overall": "pass", "n": len(calls)}, ttl=60, clock=clk)
    a = c.get(True)
    assert a["report"]["n"] == 1 and a["cache"]["source"] == "fresh" and not a["cache"]["stale"]
    clk.t += 30
    b = c.get(True)
    assert b["report"]["n"] == 1 and b["cache"]["source"] == "cache" and b["cache"]["age_sec"] == 30.0
    assert calls == [True]


def test_stale_serves_old_and_refreshes_in_background():
    gate = threading.Event()
    n = {"i": 0}

    def run(net):
        n["i"] += 1
        if n["i"] > 1:
            gate.wait(2)
        return {"overall": "fail", "i": n["i"]}
    clk = Clock()
    c = HealthReportCache(run, ttl=60, clock=clk)
    c.get(True)
    clk.t += 61
    s = c.get(True)
    assert s["report"]["i"] == 1 and s["cache"]["stale"] and s["cache"]["refreshing"]
    assert c.kick(True) is False  # single-flight
    gate.set(); wait_idle(c)
    assert c.get(True)["report"]["i"] == 2


def test_fresh_forces_run_and_errors_keep_last_good():
    n = {"i": 0}

    def run(net):
        n["i"] += 1
        if n["i"] == 3:
            raise ValueError("boom")
        return {"overall": "pass", "i": n["i"]}
    c = HealthReportCache(run, ttl=60, clock=Clock())
    c.get(False)
    assert c.get(False, fresh=True)["report"]["i"] == 2
    r = c.get(False, fresh=True)
    assert r["report"]["i"] == 2 and "boom" in r["cache"]["last_refresh_error"]


def test_put_and_network_keys_separate():
    c = HealthReportCache(lambda n: {"overall": "pass", "net": n}, ttl=60, clock=Clock())
    c.put(True, {"overall": "fail", "net": "intent"})
    assert c.get(True)["report"]["net"] == "intent"
    assert c.get(False)["report"]["net"] is False


def test_peek_never_runs():
    calls = []
    clk = Clock()
    c = HealthReportCache(lambda n: calls.append(n) or {"overall": "pass"}, ttl=60, clock=clk)
    assert c.peek(True) is None
    c.put(True, {"overall": "fail", "n": 1})
    peeked = c.peek(True)
    assert peeked["report"]["n"] == 1 and peeked["cache"]["source"] == "cache" and peeked["cache"]["age_sec"] == 0.0
    clk.t += 90
    peeked = c.peek(True)
    assert peeked["cache"]["stale"] and peeked["cache"]["age_sec"] == 90.0
    assert calls == []  # peek never runs the runner
