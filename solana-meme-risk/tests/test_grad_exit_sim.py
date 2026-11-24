from tools.grad_exit_sim import simulate, summarize

S = 1_000_000


def _c(ts, o, h, l, c):
    return [ts, o, h, l, c, 1.0]


def test_take_profit_stop_and_tie():
    tp = simulate([_c(S, 1, 1.2, 0.9, 1.1), _c(S + 900, 1.1, 2.1, 1.0, 2.0)], S, 50000)
    assert tp["reason"] == "take_profit" and tp["exit_x"] == 2.0 and 90 < tp["pnl_pct"] < 100
    st = simulate([_c(S, 1, 1.2, 0.4, 0.5)], S, 50000)
    assert st["reason"] == "stop" and st["exit_x"] == 0.5 and st["pnl_pct"] < -50
    # gap-through: next candle opens below the stop -> fill at that open
    gap = simulate([_c(S, 1, 1.1, 0.9, 1.0), _c(S + 900, 0.2, 0.2, 0.1, 0.1)], S, 50000)
    assert gap["reason"] == "stop" and gap["exit_x"] == 0.2
    # a candle that touches both 2x and 0.5x counts as the stop
    tie = simulate([_c(S, 1, 2.5, 0.3, 1.0)], S, 50000)
    assert tie["reason"] == "stop"
    tm = simulate([_c(S, 1, 1.2, 0.9, 1.0), _c(S + 7200, 1.0, 1.3, 0.9, 1.3)], S, 50000)
    assert tm["reason"] == "time" and tm["exit_x"] == 1.3
    assert simulate([], S, 1) is None


def test_summarize():
    s = summarize([{"pnl_pct": 10, "reason": "time"}, {"pnl_pct": -60, "reason": "stop"}])
    assert s["n"] == 2 and s["wins"] == 1 and s["mean_pnl_pct"] == -25 and s["exits"]["stop"] == 1
