from smr.backtest import calibrate as c


def _row(t, cs, bad, other=10):
    return {"create_time": t, "score": 0, "raw_points": 0, "hard_flags": [],
            "rules": {"creator_sold": {"points": 10 if cs else 0, "triggered": cs},
                      "early_concentration": {"points": other, "triggered": True}},
            "label": {"bad_24h": bad}}


def test_report_only_variants_measured_but_never_picked():
    rows = [_row(i, cs=(i % 3 != 0), bad=int(i % 3 == 0)) for i in range(30)]
    w = c.weight_experiment(rows[:18], rows[18:])
    assert set(w["report_only"]) == set(c.REPORT_ONLY_VARIANTS)
    assert w["picked_on_train"] in c.WEIGHT_VARIANTS
    assert w["report_only"]["creator_sold_inverted"]["train_auc"] == 1.0
    assert all(v >= 0 for sc in c.WEIGHT_VARIANTS.values() for v in sc.values())
