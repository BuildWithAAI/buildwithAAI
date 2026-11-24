"""getTransaction uses a shorter per-method HTTP timeout; a timed-out call is counted and retried, not dropped."""
import requests
from smr import config as C
from smr.cache import DiskCache
from smr.sources import rpc as R


class _Resp:
    def __init__(self, j): self._j, self.status_code, self.headers = j, 200, {}
    def json(self): return self._j


class _Sess:
    def __init__(self, answers): self.answers, self.timeouts = list(answers), []
    def post(self, url, json=None, timeout=None):
        self.timeouts.append(timeout)
        a = self.answers.pop(0)
        if a == "TIMEOUT":
            raise requests.ReadTimeout("slow")
        return _Resp(a)


def _pool(tmp_path, answers, **kw):
    eps = (C.Endpoint("only", "http://a", rps=1000, burst=100),)
    p = R.RpcPool(eps, DiskCache(str(tmp_path / "c.db")), max_attempts=4, **kw)
    p.eps[0].session = _Sess(answers)
    p.eps[0].breaker.allow = lambda: True
    return p


def test_get_transaction_uses_method_timeout(tmp_path, monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda s: None)
    p = _pool(tmp_path, [{"result": {"slot": 1}}, {"result": 5}], method_timeouts={"getTransaction": 15})
    assert p.get_transaction("S")["slot"] == 1
    assert p.call("getSlot", ttl=0) == 5
    assert p.eps[0].session.timeouts == [15, 45]


def test_timeout_is_counted_and_retried_with_same_result(tmp_path, monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda s: None)
    p = _pool(tmp_path, ["TIMEOUT", {"result": {"slot": 7}}], method_timeouts={"getTransaction": 15})
    assert p.get_transaction("S")["slot"] == 7
    assert p.stats["timeouts"] == 1 and p.snapshot()["timeouts"] == 1
    assert p.snapshot()["endpoints"]["only"]["timeouts"] == 1


def test_default_from_env_and_never_above_global(tmp_path, monkeypatch):
    monkeypatch.setenv("SMR_RPC_TX_TIMEOUT_S", "99")
    p = _pool(tmp_path, [])
    assert p._timeout_for("getTransaction") == 45
    monkeypatch.setenv("SMR_RPC_TX_TIMEOUT_S", "12")
    assert _pool(tmp_path, [])._timeout_for("getTransaction") == 12
