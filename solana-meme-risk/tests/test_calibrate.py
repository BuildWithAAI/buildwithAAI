from smr.backtest.calibrate import auc, moved_subset_auc, rescore, weight_experiment


def _row(pts, bad, cs=0):
    return {"score": 99, "raw_points": pts, "label": {"bad_24h": bad},
            "rules": {"a": {"points": pts - cs}, "creator_sold": {"points": cs}}}


def test_auc_zero_points_not_replaced_by_score():
    rows = [_row(0, False), _row(10, True)]
    assert auc(rows) == 1.0


def test_rescore_and_experiment_pick_on_train():
    assert rescore(_row(20, True, cs=15), {"creator_sold": 0.0}) == 5
    tr = [_row(15, False, cs=15), _row(5, True), _row(0, False)]
    ex = weight_experiment(tr, tr)
    assert ex["picked_on_train"] in ex["variants"]
    assert ex["variants"]["creator_sold_off"]["train_auc"] == 1.0


def test_moved_subset_auc_filters_on_entry_multiple():
    rows = [dict(_row(0, False), entry_x_launch=1.0), dict(_row(50, True), entry_x_launch=1.0),
            dict(_row(10, False), entry_x_launch=2.0), dict(_row(30, True), entry_x_launch=3.0), dict(_row(5, False))]
    m = moved_subset_auc(rows)
    assert (m["n"], m["n_bad"], m["auc"]) == (2, 1, 1.0)
    assert moved_subset_auc([])["auc"] is None
