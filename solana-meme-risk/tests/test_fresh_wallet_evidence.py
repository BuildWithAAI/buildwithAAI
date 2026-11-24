from smr import rug_detection_rules as R
W = {"fresh_wallet_ratio": 20}


def _sig(ratio, count, known, pct):
    return {"fresh": {"fresh_wallet_ratio": ratio, "fresh_wallet_count": count, "buyers_with_history": known,
                      "fresh_supply_pct": pct, "fresh_hours": 48.0,
                      "fresh_wallets": [{"wallet": f"W{i}", "pct_supply_bought": 1.0} for i in range(count)]}}


def test_fresh_wallet_rule_keeps_raw_inputs_in_evidence():
    out = R.fresh_wallet_ratio(_sig(0.75, 6, 8, 12.5), _thresholds(), W)
    ev = out["evidence"]
    assert ev["fresh_wallet_ratio"] == 0.75
    assert ev["fresh_wallet_count"] == 6 and ev["buyers_with_history"] == 8
    assert ev["fresh_supply_pct"] == 12.5
    assert len(ev["fresh_wallets"]) == 6


def _thresholds():
    class T:
        fresh_ratio_high = 0.5
        fresh_ratio_warn = 0.25
    return T()


def test_fresh_wallet_scoring_unchanged():
    T = _thresholds()
    assert R.fresh_wallet_ratio(_sig(0.75, 6, 8, 1.0), T, W)["points"] == 20
    assert R.fresh_wallet_ratio(_sig(0.3, 3, 10, 1.0), T, W)["points"] == 10
    assert R.fresh_wallet_ratio(_sig(0.1, 1, 10, 1.0), T, W)["points"] == 0
