from tools.check_entry_fills import compare_fill

M = 1_000_020  # entry 20 s into minute 1_000_020 // 60 * 60


def test_stale_low_entry_inside_pump_minute():
    m = M // 60 * 60
    r = compare_fill(4.7e-5, M, [[m, 4.1e-5, 1.07e-4, 3.9e-5, 1.06e-4, 1], [m - 60, 1, 1, 1, 1, 1]])
    assert r["candle"] and r["in_range"] and r["entry_vs_close"] < 0.5 and r["minute_range_x"] > 2.5


def test_missing_or_bad_candle():
    assert compare_fill(1.0, M, []) == {"candle": False}
    assert compare_fill(1.0, M, [["x"], None]) == {"candle": False}
    m = M // 60 * 60
    r = compare_fill(5.0, M, [[m, 1, 1.1, 0.9, 1.0, 1]])
    assert r["in_range"] is False and r["entry_vs_close"] == 5.0
