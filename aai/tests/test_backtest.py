import pytest
from aai.backtest import metrics, walk_forward_splits, simulate_bracket


def test_metrics_known_values():
    m = metrics([2, -1, -1, 2], risk_frac=0.01)
    assert m["n"] == 4 and m["hit_rate"] == 0.5 and m["expectancy_R"] == 0.5
    assert m["profit_factor"] == 2.0
    # equity path 1.02, 1.0098, 0.999702 -> dd = (1.02-0.999702)/1.02
    assert m["max_drawdown"] == pytest.approx((1.02 - 1.02 * .99 * .99) / 1.02)
    assert m["small_sample_warning"] is True


def test_metrics_empty():
    assert metrics([])["n"] == 0


def test_walk_forward_no_lookahead():
    splits = list(walk_forward_splits(100, 40, 20))
    assert len(splits) == 3
    for tr, te in splits:
        assert max(tr) < min(te)
    tests = [set(te) for _, te in splits]
    assert all(not (a & b) for i, a in enumerate(tests) for b in tests[i + 1:])
    anch = list(walk_forward_splits(100, 40, 20, anchored=True))
    assert all(tr.start == 0 for tr, _ in anch)


def test_bracket_same_candle_is_stop_first():
    c = [{"h": 111, "l": 94, "c": 100}]
    r = simulate_bracket(c, "long", 100, 95, 110)
    assert r["outcome"] == "stop" and r["ambiguous"]
    assert simulate_bracket([{"h": 111, "l": 99, "c": 110}], "long", 100, 95, 110)["R"] == 2.0
