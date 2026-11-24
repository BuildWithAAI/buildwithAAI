"""Deep-hub page skip: a wallet already proven (at an earlier anchor) to have >= pages*1000 prior signatures stops
paging once the recent funding window is in hand, and the stored probe is identical to a full scan."""
import os
from types import SimpleNamespace
from smr.batch_tracer import BatchTracer, GraphDB
from tests.helpers import default_settings

W = "HubWallet1111111111111111111111111111111111"


class FakeRpc:
    """Newest-first history of `n` sigs, one every 60 s ending at t_end."""
    def __init__(self, n, t_end):
        self.sigs = [{"signature": f"s{i}", "blockTime": t_end - 60 * i, "err": None} for i in range(n)]
        self.sig_calls, self.tx_calls = 0, []

    def get_signatures(self, address, limit=1000, before=None, until=None, ttl="auto"):
        self.sig_calls += 1
        i = 0 if before is None else next(k for k, x in enumerate(self.sigs) if x["signature"] == before) + 1
        return self.sigs[i:i + limit]

    def get_transaction(self, sig, block_time=None):
        self.tx_calls.append(sig); return None


def _tracer(tmp, rpc, name):
    s = default_settings()
    g = GraphDB(os.path.join(str(tmp), name))
    ctx = SimpleNamespace(settings=s, graph=g, rpc=rpc, labels=SimpleNamespace(get=lambda w: None))
    return BatchTracer(ctx), g


def _strip(row):
    return {k: v for k, v in row.items() if k != "probed_at"}


def test_repeat_deep_hub_skips_second_page_with_identical_probe(tmp_path):
    t_end = 1_800_000_000
    # anchor "s0": 5000 sigs before it -> two full pages, incomplete, hub
    full_rpc = FakeRpc(5000, t_end)
    full, _ = _tracer(tmp_path, full_rpc, "full.db")
    ref = full.probe(W, "s0", t_end + 1)
    assert full_rpc.sig_calls == 2 and ref["history_complete"] == 0 and ref["is_hub"] == 1

    rpc = FakeRpc(5000, t_end)
    bt, g = _tracer(tmp_path, rpc, "skip.db")
    # earlier anchor (s100) proves deep hub
    bt.probe(W, "s100", t_end - 60 * 100)
    rpc.sig_calls, rpc.tx_calls = 0, []
    got = bt.probe(W, "s0", t_end + 1)
    assert rpc.sig_calls == 1
    assert bt.stats["hub_page_skips"] == 1
    assert _strip({**got, "anchor_sig": "s0"}) == _strip(ref)
    assert sorted(rpc.tx_calls) == sorted(full_rpc.tx_calls)   # fetched concurrently since 87d8c7c: same set, order may vary


def test_no_skip_without_earlier_proof(tmp_path):
    t_end = 1_800_000_000
    rpc = FakeRpc(5000, t_end)
    bt, g = _tracer(tmp_path, rpc, "a.db")
    # a LATER-anchored probe is not proof for an earlier anchor (would be lookahead)
    bt.probe(W, "s0", t_end + 1)
    rpc.sig_calls = 0
    bt.probe(W, "s100", t_end - 60 * 100)
    assert rpc.sig_calls == 2 and "hub_page_skips" not in bt.stats


def test_no_skip_when_window_not_covered(tmp_path):
    # sparse history: 1 sig per ~day, so page 1 still reaches inside... use window larger than page span
    t_end = 1_800_000_000
    rpc = FakeRpc(5000, t_end)
    for x in rpc.sigs:
        x["err"] = "failed"          # no ok sigs in window, and page 1 ends inside the window -> must keep paging
    bt, g = _tracer(tmp_path, rpc, "b.db")
    bt.probe(W, "s100", t_end - 60 * 100)
    rpc.sig_calls = 0
    bt.probe(W, "s0", t_end + 1)
    span_h = 1000 * 60 / 3600
    if bt.s.funding_window_hours > span_h:
        assert rpc.sig_calls == 2
