"""Concurrent getTransaction fetches inside a wallet probe: same edges/fanout/warnings/stored probe as serial
fetching (input order kept), with more than one call in flight."""
import dataclasses, os, threading, time
from types import SimpleNamespace
from smr.batch_tracer import BatchTracer, GraphDB
from smr.sources.rpc import RpcError
from tests.helpers import default_settings

W = "FundedWallet111111111111111111111111111111"


def _tx(i, t):
    ixs = [{"program": "system", "parsed": {"type": "transfer", "info": {"source": f"Funder{i % 3}", "destination": W, "lamports": 10_000_000 * (i + 1)}}}]
    if i % 2:
        ixs.append({"program": "system", "parsed": {"type": "transfer", "info": {"source": f"Funder{i % 3}", "destination": f"Other{i}", "lamports": 5_000_000}}})
    return {"slot": 1000 + i, "blockTime": t, "meta": {"err": None, "innerInstructions": []},
            "transaction": {"message": {"instructions": ixs, "accountKeys": []}}}


class SlowRpc:
    """Complete 12-sig history; each getTransaction sleeps (later sigs return faster, to scramble completion order)."""
    def __init__(self, t_end, delay=0.05):
        self.sigs = [{"signature": f"s{i}", "blockTime": t_end - 600 * i, "err": None} for i in range(12)]
        self.delay, self.inflight, self.max_inflight = delay, 0, 0
        self._lock = threading.Lock()

    def get_signatures(self, address, limit=1000, before=None, until=None, ttl="auto"):
        i = 0 if before is None else next(k for k, x in enumerate(self.sigs) if x["signature"] == before) + 1
        return self.sigs[i:i + limit]

    def get_transaction(self, sig, block_time=None):
        with self._lock:
            self.inflight += 1; self.max_inflight = max(self.max_inflight, self.inflight)
        try:
            i = int(sig[1:])
            time.sleep(self.delay / (1 + i))
            if i == 4:
                raise RpcError("boom")
            return None if i == 6 else _tx(i, block_time)
        finally:
            with self._lock:
                self.inflight -= 1


def _run(tmp, name, conc):
    s = dataclasses.replace(default_settings(), trace_tx_concurrency=conc)
    rpc = SlowRpc(1_800_000_000)
    g = GraphDB(os.path.join(str(tmp), name))
    bt = BatchTracer(SimpleNamespace(settings=s, graph=g, rpc=rpc, labels=SimpleNamespace(get=lambda w: None)))
    row = bt.probe(W, "s0", 1_800_000_001)
    edges = g.db.execute("SELECT * FROM edges ORDER BY rowid").fetchall()
    return bt, rpc, {k: v for k, v in row.items() if k != "probed_at"}, edges, g


def test_concurrent_fetch_matches_serial(tmp_path):
    bt1, rpc1, row1, e1, g1 = _run(tmp_path, "serial.db", 1)
    bt3, rpc3, row3, e3, g3 = _run(tmp_path, "conc.db", 3)
    assert rpc1.max_inflight == 1
    assert rpc3.max_inflight > 1
    assert row1 == row3
    assert bt1.warnings == bt3.warnings and len(bt1.warnings) == 1
    assert e1 == e3
    f1 = g1.funders_of(W, 1_800_000_001, 72 * 3600, 5)
    f3 = g3.funders_of(W, 1_800_000_001, 72 * 3600, 5)
    assert f1 == f3 and len(f1) > 0


def test_fetch_txs_keeps_input_order(tmp_path):
    bt, rpc, *_ = _run(tmp_path, "o.db", 4)
    sigs = [f"s{i}" for i in range(8)]
    out = bt._fetch_txs(sigs, {})
    assert [s for s, _, _ in out] == sigs
    assert isinstance(out[4][2], RpcError) and out[6][1] is None and out[0][1]["slot"] == 1000
