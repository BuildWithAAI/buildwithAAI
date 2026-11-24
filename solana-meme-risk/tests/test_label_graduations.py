from tools.label_graduations import compute_label, main

S = 1_000_000


def _c(ts, o, h, l, c):
    return [ts, o, h, l, c, 1.0]


def test_bad_and_hit_2x():
    candles = [_c(S + 86400 - 900, 0.4, 0.4, 0.3, 0.3), _c(S - 300, 1.0, 1.2, 0.9, 1.1),
               _c(S + 3600, 1.1, 2.5, 1.0, 2.0)]
    lab = compute_label(candles, S)
    assert lab["p0_usd"] == 1.0 and lab["p24_usd"] == 0.3
    assert lab["bad_24h"] is True and lab["hit_2x"] is True and lab["max_x"] == 2.5


def test_good_and_unlabelable():
    good = compute_label([_c(S, 1.0, 1.0, 1.0, 1.0), _c(S + 86000, 1, 1, 0.8, 0.9)], S)
    assert good["bad_24h"] is False and good["hit_2x"] is False
    # no trades within an hour of +24 h -> refuse to label
    assert compute_label([_c(S, 1, 1, 1, 1), _c(S + 3600, 1, 1, 1, 1)], S) is None
    assert compute_label([["x"], None], S) is None


def test_main_skips_not_yet_due(tmp_path):
    import json, time
    src = tmp_path / "g.jsonl"
    out = tmp_path / "l.jsonl"
    src.write_text(json.dumps({"pool": "P", "seen_at": int(time.time())}) + "\n")
    assert main(str(src), str(out)) == 0
    assert out.read_text() == ""


def test_last_trade_fallback_and_priority():
    from tools.label_graduations import compute_last_trade, priority
    # trades stop 2 h after first sight at 0.2x -> fallback records it, no bad_24h key
    fb = compute_last_trade([_c(S, 1.0, 1.5, 1.0, 1.2), _c(S + 6300, 0.3, 0.3, 0.2, 0.2)], S)
    assert fb["ratio_last"] == 0.2 and fb["last_trade_h"] == 2.0 and "bad_24h" not in fb
    assert fb["max_x"] == 1.5 and fb["n_candles"] == 2
    assert compute_last_trade([], S) is None
    rows = [{"mint": "Abc", "fdv_usd": 90000, "seen_at": 1},
            {"mint": "Xpump", "fdv_usd": 10000, "seen_at": 2},
            {"mint": "Ypump", "fdv_usd": 40000, "seen_at": 3}]
    assert [r["mint"] for r in sorted(rows, key=priority)] == ["Ypump", "Xpump", "Abc"]
