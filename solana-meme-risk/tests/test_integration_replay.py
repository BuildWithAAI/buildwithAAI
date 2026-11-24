"""End-to-end replay of recorded mints: every RPC/HTTP response comes from the fixture (cache in replay mode
raises CacheMiss on anything unrecorded), so this runs offline and is deterministic."""
import pytest
from helpers import fixture, replay_context
from smr.signal_extractor import extract_signals
from smr.risk_score import score_signals
from smr import report, legacy


@pytest.mark.parametrize("name", ["tUjDS64Q.replay.json.gz", "AJZ8uaib.replay.json.gz"])
def test_replay_reproduces_recorded_report(name, tmp_path):
    fx = fixture(name)
    ctx = replay_context(fx, tmp_path)
    sig = extract_signals(ctx, fx["mint"], as_of=fx["as_of"], n_buyers=fx["settings_overrides"]["early_buyers_n"],
                          trace_limit=fx["trace_limit"], coin=fx["coin"])
    sig["token_age_s"] = sig["as_of"] - sig["create_time"]
    sc = score_signals(sig, ctx.settings, False)
    doc = report.build(sig, sc, ctx.settings, sources=ctx.source_snapshot(), generated_at=fx["as_of"], full=False)
    report.validate(doc)
    assert doc["score"] == fx["expected"]["score"]
    assert doc["recommendation"] == fx["expected"]["recommendation"]
    assert doc["hard_flags"] == fx["expected"]["hard_flags"]
    assert {r["rule"]: r["points"] for r in doc["rules"]} == fx["expected"]["rule_points"]
    assert sig["mode"] == "point_in_time" and sig["as_of"] == fx["as_of"]
    # no lookahead: nothing used by the early-buyer stage happened after as_of
    assert all(b["block_time"] <= fx["as_of"] for b in sig["early"]["buyers"])
    # the adapter-facing (v0-compatible) shape is built from the same document
    out = legacy.build(sig, sc, doc)
    for k in legacy.V0_KEYS:
        assert k in out, k
    assert out["score"] == doc["score"] and out["risk_report_v1"]["score"] == doc["score"]
