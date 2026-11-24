"""Overfitting guard in the calibrator: a fit only deploys if a fresh holdout (launches newer than every launch
used so far) also passes the AUC gate; fresh rows never enter train/test; AUC gets a bootstrap 95% range."""
import json, types
from smr.backtest import calibrate as cal


def _row(t, pts, bad):
    return {"create_time": t, "as_of": t + 300, "score": pts, "raw_points": pts, "hard_flags": [], "confidence": "high",
            "rules": {"early_concentration": {"points": pts}},
            "label": {"usable": True, "bad_24h": bad, "return_24h": -0.9 if bad else 0.5}}


def _dataset(tmp_path, n=200):
    rows = []
    for i in range(n):          # perfectly separable: bad launches score high
        bad = i % 4 == 0
        rows.append(_row(1000 + i, 60 if bad else 10 + (i % 7), bad))
    p = tmp_path / "dataset.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in rows))
    return p


def _settings(tmp_path):
    return types.SimpleNamespace(thresholds_file=str(tmp_path / "live.json"), thresholds_version="default")


def test_split_fresh_is_strict_and_disjoint():
    rows = [_row(t, 0, False) for t in (1, 2, 3, 4)]
    old, fresh = cal.split_fresh(rows, 2)
    assert [r["create_time"] for r in old] == [1, 2] and [r["create_time"] for r in fresh] == [3, 4]
    assert cal.split_fresh(rows, None) == (rows, [])


def test_auc_ci_brackets_auc():
    rows = [_row(i, (i * 37) % 50 + (30 if i % 3 == 0 else 0), i % 3 == 0) for i in range(90)]
    lo, hi = cal.auc_ci(rows)
    assert lo <= cal.auc(rows) <= hi
    assert cal.auc_ci([_row(1, 5, False)]) is None


def test_no_fresh_holdout_blocks_deploy(tmp_path, monkeypatch):
    monkeypatch.delenv("SMR_FRESH_HOLDOUT_AFTER", raising=False)
    rep = cal.main(str(_dataset(tmp_path)), str(tmp_path), _settings(tmp_path), progress=lambda *a: None)
    assert rep["auc_raw_points"]["test"] >= cal.DEPLOY_MIN_TEST_AUC
    assert rep["fresh_holdout"]["n"] == 0 and rep["fresh_holdout"]["passed"] is False
    assert rep["deployed"] is False and not (tmp_path / "live.json").exists()


def test_passing_fresh_holdout_allows_deploy_and_is_excluded_from_split(tmp_path, monkeypatch):
    monkeypatch.setenv("SMR_FRESH_HOLDOUT_AFTER", str(1000 + 139))   # last 60 launches are fresh
    rep = cal.main(str(_dataset(tmp_path)), str(tmp_path), _settings(tmp_path), progress=lambda *a: None)
    fh = rep["fresh_holdout"]
    assert fh["n"] == 60 and fh["passed"] is True and fh["auc"] == 1.0
    assert rep["split"]["train"]["n"] + rep["split"]["test"]["n"] == 140
    assert rep["auc_ci95"]["test"] is not None
    ta, live = rep["auc_raw_points"]["test"], rep["live_test_auc"]
    assert rep["deployed"] is (ta >= cal.DEPLOY_MIN_TEST_AUC and ta > live)   # fresh guard no longer the blocker
    assert (tmp_path / "live.json").exists() is rep["deployed"]


def test_too_small_fresh_holdout_blocks_deploy(tmp_path):
    rep = cal.main(str(_dataset(tmp_path)), str(tmp_path), _settings(tmp_path), progress=lambda *a: None,
                   fresh_after=1000 + 189)                          # only 10 fresh launches
    assert rep["fresh_holdout"]["n"] == 10 and rep["deployed"] is False
