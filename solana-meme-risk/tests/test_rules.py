"""One test per rule, driven by signals recorded from real launches (tests/fixtures/*.replay.json.gz).
Each test checks the recorded outcome, then perturbs the recorded signal across the rule's threshold."""
from smr import rug_detection_rules as R
from helpers import signals, default_settings

T = default_settings().thresholds
W = R.WEIGHTS
BUNDLED = "tUjDS64Q.replay.json.gz"     # creation-slot bundle, serial deployer, fresh buyers
QUIET = "AJZ8uaib.replay.json.gz"       # no bundle, fresh deployer, creator dumped


def test_every_rule_reproduces_recorded_points():
    from helpers import fixture
    for name in (BUNDLED, QUIET):
        fx = fixture(name)
        got = {r["rule"]: r["points"] for r in R.evaluate(fx["signals"], T)}
        assert got == fx["expected"]["rule_points"], name


def test_same_slot_bundle():
    s = signals(BUNDLED)
    r = R.same_slot_bundle(s, T, W)
    assert r["triggered"] and r["points"] == W["same_slot_bundle"]
    assert s["same_slot"]["same_slot_buyer_count"] >= T.same_slot_heavy or s["same_slot"]["same_slot_supply_pct"] >= T.same_slot_supply_heavy
    q = signals(QUIET)
    assert not R.same_slot_bundle(q, T, W)["triggered"]
    q["same_slot"].update(same_slot_buyer_count=T.same_slot_min, same_slot_supply_pct=0.1)
    assert R.same_slot_bundle(q, T, W)["points"] == round(W["same_slot_bundle"] * 0.4)


def test_shared_funder_cluster():
    s = signals(QUIET)
    assert R.shared_funder_cluster(s, T, W)["points"] == 0
    s["clusters"].update(n_clusters=1, largest_cluster_supply_pct=T.cluster_supply_high + 1)
    assert R.shared_funder_cluster(s, T, W)["points"] == round(W["shared_funder_cluster"] * 0.83)
    s["clusters"].update(deployer_cluster={"size": 3}, deployer_cluster_supply_pct=T.cluster_supply_high)
    r = R.shared_funder_cluster(s, T, W)
    assert r["hard"] and r["points"] == W["shared_funder_cluster"]


def test_serial_deployer():
    s = signals(BUNDLED)
    r = R.serial_deployer(s, T, W)
    n = s["serial"]["total_created_other"]
    assert r["triggered"] and n >= T.serial_warn and r["evidence"]["prior_created"] == n
    assert "on-chain" in r["reason"]
    s["serial"]["total_created_other"] = 0; s["serial"]["outcomes"] = {}; s["funder_serial"] = None
    assert R.serial_deployer(s, T, W)["points"] == 0
    s["serial"]["total_created_other"] = None
    assert R.serial_deployer(s, T, W)["data_available"] is False


def test_creator_holds():
    s = signals(BUNDLED)
    s["holders"].update(source="as_of_replay", creator_pct_of_supply=T.creator_high)
    assert R.creator_holds(s, T, W)["points"] == W["creator_holds"]
    s["holders"]["creator_pct_of_supply"] = T.creator_warn
    assert R.creator_holds(s, T, W)["points"] == round(W["creator_holds"] * 0.5)
    s["holders"]["source"] = None
    assert R.creator_holds(s, T, W)["data_available"] is False


def test_creator_sold():
    s = signals(QUIET)
    r = R.creator_sold(s, T, W)
    assert r["points"] == W["creator_sold"] and s["creator_flow"]["sold_pct_of_bought"] >= 90
    s["creator_flow"]["sold_pct_of_bought"] = 10
    assert R.creator_sold(s, T, W)["points"] == 0


def test_early_concentration():
    s = signals(BUNDLED)
    s["holders"].update(top10_pct_of_circulating=T.top10_high, top10=[])
    s["same_slot"]["early_buyers_supply_pct"] = T.early_supply_high
    assert R.early_concentration(s, T, W)["points"] == W["early_concentration"]
    s["holders"]["top10_pct_of_circulating"] = None; s["holders"]["top10_pct_of_supply"] = None
    assert R.early_concentration(s, T, W)["data_available"] is False


def test_fresh_wallet_ratio():
    s = signals(BUNDLED)
    r = R.fresh_wallet_ratio(s, T, W)
    assert r["triggered"] and s["fresh"]["fresh_wallet_ratio"] >= T.fresh_ratio_high
    s["fresh"]["fresh_wallet_ratio"] = 0.0
    assert R.fresh_wallet_ratio(s, T, W)["points"] == 0
    s["fresh"]["fresh_wallet_ratio"] = None
    assert R.fresh_wallet_ratio(s, T, W)["data_available"] is False


def test_fresh_deployer():
    s = signals(QUIET)
    assert R.fresh_deployer(s, T, W)["points"] == W["fresh_deployer"]
    s["deployer"]["deployer_age_hours_at_create"] = T.fresh_deployer_hours + 1
    assert R.fresh_deployer(s, T, W)["points"] == 0


def test_authority_not_revoked():
    s = signals(QUIET)
    assert R.authority_not_revoked(s, T, W)["points"] == 0
    s["authorities"].update(found=True, mint_authority_revoked=False, mint_authority="X")
    r = R.authority_not_revoked(s, T, W)
    assert r["hard"] and r["points"] == W["authority_not_revoked"]


def test_broken_rule_never_crashes_scoring():
    s = signals(QUIET); del s["same_slot"]
    out = {r["rule"]: r for r in R.evaluate(s, T)}
    assert out["same_slot_bundle"]["data_available"] is False and "rule error" in out["same_slot_bundle"]["reason"]
