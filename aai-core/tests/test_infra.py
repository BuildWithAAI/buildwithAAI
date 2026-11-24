import json, logging, os, gzip
import pytest
import requests
from aai_core.infra.resilience import TokenBucket, CircuitBreaker, backoff_delays
from aai_core.infra.cache import DiskCache, CacheMiss, make_key
from aai_core.infra.http import HttpSource, SourceBlocked, SourceError, SourceNotFound, CircuitOpenError
from aai_core.infra.health import Health, validate_shape, SkipCheck
from aai_core.infra import logging as L
from aai_core.infra.replay import save_fixture, replay_cache


class FakeClock:
    def __init__(self): self.t = 0.0
    def __call__(self): return self.t
    def sleep(self, s): self.t += s


def test_token_bucket_rate():
    c = FakeClock()
    b = TokenBucket(2.0, burst=1, clock=c, sleep=c.sleep)
    for _ in range(5):
        b.acquire()
    assert c.t == pytest.approx(2.0)          # 1 free + 4 at 0.5 s each


def test_token_bucket_penalty():
    c = FakeClock()
    b = TokenBucket(100.0, burst=1, clock=c, sleep=c.sleep)
    b.acquire(); b.penalize(5)
    b.acquire()
    assert c.t >= 5


def test_circuit_breaker_open_halfopen_close():
    c = FakeClock()
    br = CircuitBreaker("x", failure_threshold=2, reset_timeout_s=10, clock=c)
    br.failure(); assert br.allow()
    br.failure(); assert br.state == "open" and not br.allow()
    c.t = 11; assert br.allow() and br.state == "half_open"
    br.failure(); assert br.state == "open" and br.trips == 2
    c.t = 30; br.allow(); br.success(); assert br.state == "closed"


def test_backoff_bounded():
    d = list(backoff_delays(6, base=0.5, cap=4, rng=lambda: 1.0))
    assert d == [0.5, 1, 2, 4, 4, 4]


def test_cache_ttl_and_replay(tmp_path):
    p = str(tmp_path / "c.db")
    c = DiskCache(p)
    k = make_key("a", 1)
    c.set(k, {"v": 1}, 60)
    assert c.get(k, 60) == {"v": 1}
    assert c.get(k, 0) is None                 # ttl 0 never reads in readwrite
    r = DiskCache(p, "replay")
    assert r.get(k, 0) == {"v": 1}             # replay ignores TTL
    with pytest.raises(CacheMiss):
        r.get(make_key("missing"), 60)
    assert make_key("a", {"x": 1, "y": 2}) == make_key("a", {"y": 2, "x": 1})


class Resp:
    def __init__(self, code, body=None, headers=None, text=""):
        self.status_code, self._b, self.headers, self.text = code, body, headers or {}, text or json.dumps(body)
    def json(self): return self._b
    def raise_for_status(self):
        if self.status_code >= 400: raise requests.HTTPError(str(self.status_code))


class Sess:
    def __init__(self, seq): self.seq, self.calls, self.headers = list(seq), 0, {}
    def get(self, url, params=None, timeout=None):
        self.calls += 1
        r = self.seq.pop(0)
        if isinstance(r, Exception): raise r
        return r


def _src(tmp_path, seq, **kw):
    c = FakeClock()
    s = HttpSource("t", "https://x", 1000, DiskCache(str(tmp_path / "h.db")), session=Sess(seq), sleep=c.sleep, **kw)
    s.bucket = TokenBucket(1000, 5, clock=c, sleep=c.sleep)
    return s


def test_http_retry_then_ok_and_cache(tmp_path):
    s = _src(tmp_path, [Resp(500), Resp(429, headers={"Retry-After": "1"}), Resp(200, {"ok": 1})])
    assert s.get("/a", {"q": 1}) == {"ok": 1}
    assert s.stats["rate_limited"] == 1 and s.stats["errors"] == 1
    assert s.get("/a", {"q": 1}) == {"ok": 1} and s.stats["cache_hits"] == 1 and s.s.calls == 3


def test_http_blocked_not_retried(tmp_path):
    s = _src(tmp_path, [Resp(403, text="blocked from your country")])
    with pytest.raises(SourceBlocked):
        s.get("/a")
    assert s.s.calls == 1


def test_http_404_and_exhaustion(tmp_path):
    s = _src(tmp_path, [Resp(404)])
    with pytest.raises(SourceNotFound):
        s.get("/a")
    s = _src(tmp_path, [requests.ConnectionError("x")] * 3, max_attempts=3)
    with pytest.raises(SourceError):
        s.get("/b")
    assert s.s.calls == 3


def test_http_circuit_opens(tmp_path):
    s = _src(tmp_path, [Resp(500)] * 6, max_attempts=6)
    with pytest.raises(SourceError):
        s.get("/a")
    with pytest.raises(CircuitOpenError):
        s.get("/b")


def test_recorded_errors_replay(tmp_path):
    s = _src(tmp_path, [Resp(451, text="restricted")])
    s.cache.recorder = {}
    with pytest.raises(SourceBlocked):
        s.get("/x")
    fx = str(tmp_path / "f.json.gz")
    save_fixture(s.cache.recorder, fx, {"a": 1})
    rc, meta = replay_cache(fx, str(tmp_path))
    s2 = HttpSource("t", "https://x", 1000, rc, session=Sess([]))
    with pytest.raises(SourceBlocked):
        s2.get("/x")
    assert meta == {"a": 1}


def test_log_redaction():
    f = L.JsonFormatter()
    r = logging.LogRecord("aai.t", logging.INFO, "", 0, "GET https://x?api-key=SECRET&a=1", None, None)
    r.fields = {"api_key": "SECRET", "url": "https://x?token=abc"}
    out = f.format(r)
    assert "SECRET" not in out and "abc" not in out and json.loads(out)["api_key"] == "***"


def test_health_shape():
    h = Health("p")
    h.run("ok", lambda: {"a": 1})
    h.run("bad_optional", lambda: 1 / 0, required=False)
    h.run("tuple_fail", lambda: (False, "nope"))
    h.run("skip", lambda: (_ for _ in ()).throw(SkipCheck("x")))
    r = h.result()
    assert validate_shape(r) == []
    assert r["overall"] == "fail"
    assert [c["pass"] for c in r["checks"]] == [True, False, False, True]


def test_health_shape_matches_smr_sample():
    p = "/workspace/solana-meme-risk/samples/healthcheck.json"
    if not os.path.exists(p):
        pytest.skip("smr not present")
    assert validate_shape(json.load(open(p))) == []
