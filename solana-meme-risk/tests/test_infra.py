"""Resilience, cache, RPC failover, schema and output-contract tests (offline)."""
import json, os, subprocess, sys
import pytest
from smr.resilience import TokenBucket, CircuitBreaker, backoff_delays
from smr.cache import DiskCache, make_key, CacheMiss
from smr.sources import rpc as R
from smr import config as C


class FakeClock:
    def __init__(self): self.t = 0.0
    def __call__(self): return self.t
    def sleep(self, s): self.t += s


def test_token_bucket_rate_and_penalty():
    c = FakeClock(); b = TokenBucket(5, burst=2, clock=c, sleep=c.sleep)
    for _ in range(12):
        b.acquire()
    assert 1.9 <= c.t <= 2.1          # 2 burst + 10 more at 5 rps
    b.penalize(3); t0 = c.t; b.acquire()
    assert c.t - t0 >= 3


def test_circuit_breaker_opens_and_half_opens():
    c = FakeClock(); br = CircuitBreaker("x", failure_threshold=3, reset_timeout_s=10, clock=c)
    for _ in range(3):
        br.failure()
    assert br.state == "open" and not br.allow()
    c.t += 10
    assert br.allow() and br.state == "half_open"
    br.failure(); assert br.state == "open" and br.trips == 2
    c.t += 10; br.allow(); br.success(); assert br.state == "closed"


def test_backoff_is_bounded_and_growing():
    d = list(backoff_delays(6, base=0.5, cap=4, rng=lambda: 1.0))
    assert d == [0.5, 1.0, 2.0, 4.0, 4.0, 4.0]


def test_cache_is_deterministic_and_replay_strict(tmp_path):
    assert make_key("rpc", "m", [1, {"a": 1, "b": 2}]) == make_key("rpc", "m", [1, {"b": 2, "a": 1}])
    c = DiskCache(str(tmp_path / "c.db"))
    c.set("k", {"v": 1}, None)
    assert c.get("k", None) == {"v": 1}
    r = DiskCache(str(tmp_path / "c.db"), mode="replay")
    assert r.get("k", 0) == {"v": 1}       # replay ignores TTLs
    with pytest.raises(CacheMiss):
        r.get("missing", None)


class _Resp:
    def __init__(self, j, status=200): self._j, self.status_code, self.headers = j, status, {}
    def json(self): return self._j


class _Sess:
    def __init__(self, answers): self.answers, self.calls = list(answers), 0
    def post(self, url, json=None, timeout=None):
        self.calls += 1
        a = self.answers.pop(0)
        return a if isinstance(a, _Resp) else _Resp(a)


def _pool(tmp_path, a, b):
    eps = (C.Endpoint("a", "http://a", rps=1000, burst=100), C.Endpoint("b", "http://b", rps=1000, burst=100))
    p = R.RpcPool(eps, DiskCache(str(tmp_path / "c.db")), max_attempts=4)
    p.eps[0].session, p.eps[1].session = _Sess(a), _Sess(b)
    return p


def test_rpc_null_transaction_fails_over(tmp_path):
    p = _pool(tmp_path, [{"result": None}], [{"result": {"slot": 1, "version": 1}}])
    assert p.get_transaction("S")["version"] == 1
    assert p.stats["null_failovers"] == 1
    p2 = _pool(tmp_path / "x" if os.makedirs(tmp_path / "x") is None else None, [{"result": None}], [{"result": None}])
    assert p2.get_transaction("T") is None


def test_rpc_anchor_not_found_fails_over_and_429_backs_off(tmp_path):
    p = _pool(tmp_path, [{"error": {"code": -32020, "message": "Transaction X not found"}}], [{"result": [{"signature": "s"}]}])
    assert p.get_signatures("ADDR", 10, before="X") == [{"signature": "s"}]
    p = _pool(tmp_path / "y" if os.makedirs(tmp_path / "y") is None else None,
              [_Resp({}, 429), {"result": 5}], [{"result": 5}])
    assert p.call("getSlot", [], ttl=0) == 5


def test_rpc_error_recorded_for_replay(tmp_path):
    p = _pool(tmp_path, [{"error": {"code": -32602, "message": "boom"}}], [])
    p.cache.recorder = {}
    with pytest.raises(R.RpcError):
        p.call("getAccountInfo", ["Z"])
    k = make_key("rpc", "getAccountInfo", ["Z"])
    assert "__rpc_error__" in p.cache.recorder[k]


def test_labels_file_entries_have_citations():
    j = json.load(open(C.load_settings().labels_file))
    assert j["entities"]
    for addr, e in j["entities"].items():
        assert e.get("source_url", "").startswith("http") and e.get("name") and e.get("category"), addr


def test_label_classification():
    from smr.backtest.labeler import classify
    assert classify(2.0, 0.9, False)["bad"] == 1               # -55%: loss50
    c = classify(1.0, 1.0, False); assert c["bad"] == 0          # flat at launch price: not bad (needs <= -20%)
    c = classify(1.3, 1.0, False); assert c["dead"] == 1 and c["loss50"] == 0   # back to launch, -23%
    c = classify(1.3, 1.0, True); assert c["dead"] == 0          # graduated never counts as dead
    assert classify(5.0, 0.4, False)["crash"] == 1


def test_calibration_metrics():
    from smr.backtest import calibrate as K
    rows = [{"score": s, "raw_points": s, "hard_flags": [], "confidence": "high", "rules": {},
             "label": {"bad_24h": y, "return_24h": ret}} for s, y, ret in
            [(90, 1, -0.9), (70, 1, -0.6), (30, 0, 0.5), (10, 0, 1.0), (60, 0, 0.2), (20, 1, -0.7)]]
    e = K.evaluate(rows, 60, 25)
    assert e["confusion"]["SKIP"] == {"bad": 2, "ok": 1} and e["skip_precision_bad"] == round(2 / 3, 4)
    assert e["skip_recall_bad"] == round(2 / 3, 4)
    assert K.auc(rows) == round(7 / 9, 4)   # 9 bad/ok pairs, 7 ordered correctly


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_root_level_v0_module_names_still_import():
    code = ("import config, data_sources, early_buyer_extractor, batch_tracer, cluster_extractor, data_extractors, "
            "signal_extractor, rug_detection_rules, risk_score, healthcheck; "
            "assert callable(risk_score.score_mint) and callable(healthcheck.main)")
    subprocess.run([sys.executable, "-c", code], cwd=ROOT, check=True)


def test_cli_contract_parses_adapter_arguments():
    from smr import cli
    p = cli.build_parser()
    a = p.parse_args(["score", "M", "-v", "--buyers", "20", "--hops", "2", "-o", "x.json"])
    assert (a.mint, a.verbose, a.buyers, a.hops, a.output) == ("M", True, 20, 2, "x.json")
    h = p.parse_args(["health", "--quick", "--mint", "M"])
    assert h.quick and h.mint == "M"


def test_health_json_shape_matches_sample():
    j = json.load(open(os.path.join(ROOT, "samples", "healthcheck.json")))
    assert set(j) >= {"overall", "checks"} and j["overall"] in ("pass", "fail")
    for c in j["checks"]:
        assert set(c) >= {"check", "pass", "required", "ms", "detail"}
