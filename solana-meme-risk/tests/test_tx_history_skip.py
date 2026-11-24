"""Endpoints with a short getTransaction history (publicnode ~2 days) are skipped when the caller knows the tx is older."""
import time
from smr import config as C
from smr.cache import DiskCache
from smr.sources import rpc as R


class _Resp:
    def __init__(self, j): self._j, self.status_code, self.headers = j, 200, {}
    def json(self): return self._j


class _Sess:
    def __init__(self, answers): self.answers, self.calls = list(answers), 0
    def post(self, url, json=None, timeout=None):
        self.calls += 1
        return _Resp(self.answers.pop(0))


def _pool(tmp_path, short, archive, hours=36.0, both_short=False):
    eps = (C.Endpoint("short", "http://s", rps=1000, burst=100, tx_history_hours=hours),
           C.Endpoint("archive", "http://a", rps=1000, burst=100, tx_history_hours=hours if both_short else None))
    p = R.RpcPool(eps, DiskCache(str(tmp_path / "c.db")), max_attempts=4)
    p.eps[0].session, p.eps[1].session = _Sess(short), _Sess(archive)
    return p


def test_old_tx_skips_short_history_endpoint(tmp_path):
    p = _pool(tmp_path, [], [{"result": {"slot": 1, "version": 0}}])
    tx = p.get_transaction("OLD", block_time=time.time() - 5 * 86400)
    assert tx["slot"] == 1
    assert p.eps[0].session.calls == 0 and p.eps[1].session.calls == 1
    assert p.stats["history_skips"] == 1 and p.stats["null_failovers"] == 0


def test_recent_or_unknown_age_still_tries_short_endpoint_first(tmp_path):
    p = _pool(tmp_path, [{"result": {"slot": 2}}, {"result": {"slot": 3}}], [])
    assert p.get_transaction("NEW", block_time=time.time() - 3600)["slot"] == 2
    assert p.get_transaction("UNK")["slot"] == 3
    assert p.eps[0].session.calls == 2 and p.eps[1].session.calls == 0
    assert p.stats["history_skips"] == 0


def test_never_skips_every_endpoint(tmp_path):
    p = _pool(tmp_path, [{"result": {"slot": 4}}], [], both_short=True)
    assert p.get_transaction("OLD", block_time=time.time() - 5 * 86400)["slot"] == 4


def test_cached_result_identical_with_or_without_hint(tmp_path):
    p = _pool(tmp_path, [], [{"result": {"slot": 5}}])
    a = p.get_transaction("X", block_time=time.time() - 5 * 86400)
    b = p.get_transaction("X")
    assert a == b and p.eps[0].session.calls == 0 and p.eps[1].session.calls == 1
