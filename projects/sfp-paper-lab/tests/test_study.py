"""Chronological boundaries, controls, loss accounting and evidence failure tests."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from helpers import dataset, prefix, value

from zoora_sfp.data import HOUR, Config, D, ResearchError, canonical, digest
from zoora_sfp.reports import publish
from zoora_sfp.study import (
    coverage,
    known_prefix,
    make_plan,
    minimum_embargo,
    parse_plan,
    random_plans,
    run_study,
    select_training,
)
from zoora_sfp.study_reports import dashboard, render_study, verify_study

ROOT = Path(__file__).resolve().parents[1]


def fast_plan(ds=None):
    return make_plan(dataset() if ds is None else ds, Config(hold_bars=12), warmup_hours=24,
                     train_hours=236, test_hours=24, folds=2, seeds=(11, 23), min_train_trades=1)


def reseal(plan):
    plan.pop("plan_sha256")
    plan["plan_sha256"] = digest(plan)
    return plan


class StudyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ds = dataset()
        cls.plan = fast_plan(cls.ds)
        cls.report = run_study(cls.ds, cls.plan)

    def test_plan_freezes_rules_seeds_costs_and_embargo(self):
        self.assertEqual(parse_plan(self.plan), Config(hold_bars=12))
        self.assertGreaterEqual(self.plan["embargo_hours"], minimum_embargo(Config(hold_bars=12)))
        invalids = {"folds": True, "seeds": [[]], "selection": "USE_TEST_WINNER", "embargo_hours": 0,
                    "test_hours": 0, "warmup_hours": 0, "scenarios": ["BASE"]}
        for key, val in invalids.items():
            with self.subTest(key=key), self.assertRaises(ResearchError):
                parse_plan(reseal(dict(deepcopy(self.plan), **{key: val})))

    def test_plan_hash_and_unselected_funding_are_enforced(self):
        altered = deepcopy(self.plan)
        altered["min_test_trades"] = 1
        with self.assertRaisesRegex(ResearchError, "HASH_MISMATCH"):
            parse_plan(altered)
        with self.assertRaisesRegex(ResearchError, "FOLD_PROFITS"):
            make_plan(self.ds, Config(buy_burn_scenario_bps=3000))
        with self.assertRaises(ResearchError):
            make_plan(self.ds, Config(fee_bps=600))

    def test_frozen_training_prices_cannot_be_replaced(self):
        changed = value()
        for key in ["open", "high", "low", "close"]:
            changed["bars"][200][key] = str(D(changed["bars"][200][key]) * 2)
        with self.assertRaisesRegex(ResearchError, "FROZEN_TRAINING_HISTORY_CHANGED"):
            run_study(dataset(changed), self.plan)

    def test_future_price_changes_do_not_select_the_first_fold(self):
        changed = value()
        for b in changed["bars"][277:]:
            for key in ["open", "high", "low", "close"]:
                b[key] = str(D(b[key]) * 2)
        other = run_study(dataset(changed), self.plan)
        first = [t for t in self.report["trials"] if t["fold"] == 0 and t["phase"] == "TRAIN"]
        second = [t for t in other["trials"] if t["fold"] == 0 and t["phase"] == "TRAIN"]
        self.assertEqual(first, second)
        self.assertEqual(self.report["folds"][0]["selected_variant"], other["folds"][0]["selected_variant"])
        self.assertEqual(self.report["folds"][0]["random_rate_bps"], other["folds"][0]["random_rate_bps"])
        self.assertNotEqual(self.report["run_id"], other["run_id"])

    def test_history_append_and_incomplete_future_are_supported(self):
        report = run_study(dataset(prefix(260)), self.plan)
        self.assertTrue(all(f["test_coverage"]["status"] == "INCOMPLETE" for f in report["folds"]))
        self.assertFalse(any(t["phase"] == "TEST" for t in report["trials"]))
        self.assertTrue(all(s["evaluated_folds"] == 0 for s in report["summary"]))
        self.assertEqual(report["folds"][0]["selected_variant"], self.report["folds"][0]["selected_variant"])

    def test_gaps_do_not_compress_evaluation_time(self):
        changed = value()
        del changed["bars"][281]
        report = run_study(dataset(changed), self.plan)
        fold = report["folds"][0]
        self.assertEqual(fold["test_end_ms"] - fold["test_start_ms"], 24 * HOUR)
        self.assertEqual(fold["test_coverage"]["missing_bars"], 1)
        self.assertFalse(any(t["phase"] == "TEST" and t["fold"] == 0 for t in report["trials"]))
        self.assertTrue(all("INCOMPLETE_FOLDS" in s["screen_reasons"] for s in report["summary"]))

    def test_late_receipts_are_excluded_at_the_cutoff(self):
        raw = value()
        for b in raw["bars"]:
            b["available_ms"] += 1
        raw["captured_ms"] += 1
        ds = dataset(raw)
        cutoff = raw["bars"][259]["close_ms"]
        known = known_prefix(ds, cutoff)
        self.assertEqual(len(known.bars), 259)
        self.assertEqual(coverage(known, self.plan["start_ms"], cutoff, 24)["status"], "INCOMPLETE")

    def test_every_trade_follows_its_phase_and_availability(self):
        for trial in self.report["trials"]:
            start, end = trial["window"]
            for t in trial["trades"]:
                self.assertGreaterEqual(t["entry_open_ms"], start)
                self.assertLess(t["entry_open_ms"], end)
                self.assertLessEqual(t["decision_available_ms"], t["entry_open_ms"])
                self.assertLessEqual(t["exit_bar_available_ms"], end)
        for fold in self.report["folds"]:
            self.assertEqual(fold["test_start_ms"] - fold["train_end_ms"], self.plan["embargo_hours"] * HOUR)

    def test_full_trial_matrix_retains_controls_and_stresses(self):
        self.assertEqual(len(self.report["trials"]), 42)
        for f in range(2):
            tests = [t for t in self.report["trials"] if t["fold"] == f and t["phase"] == "TEST"]
            self.assertEqual(len(tests), 18)
            self.assertEqual({t["scenario"] for t in tests}, {"BASE", "DOUBLE_COST", "ONE_HOUR_DELAY"})
            self.assertEqual({t["seed"] for t in tests if t["variant"] == "RANDOM_TIME"}, {11, 23})
            self.assertEqual(sum(t["variant"] == "BUY_HOLD" for t in tests), 1)

    def test_random_clock_is_seeded_causal_and_does_not_use_test_event_counts(self):
        cfg = Config(hold_bars=12)
        known = known_prefix(self.ds, self.ds.bars[299].close_ms)
        prefix_plans = random_plans(known, cfg, 11, 10000)
        full_plans = [p for p in random_plans(self.ds, cfg, 11, 10000) if p.index < 300]
        self.assertEqual(prefix_plans, full_plans)
        self.assertEqual(random_plans(self.ds, cfg, 11, 0), [])
        self.assertNotEqual(random_plans(self.ds, cfg, 11, 5000), random_plans(self.ds, cfg, 23, 5000))

    def test_open_training_results_and_losses_cannot_become_winners(self):
        training = [deepcopy(t) for t in self.report["trials"] if t["phase"] == "TRAIN" and t["fold"] == 0]
        for t in training:
            t["metrics"]["open_position"] = {"status": "OPEN_UNRESOLVED"}
            t["metrics"]["completed_trade_net"] = "999999"
        self.assertEqual(select_training(training, 1, True)[0], "NO_TRADE")
        for t in training:
            t["metrics"]["open_position"] = None
            t["metrics"]["completed_trade_net"] = "-1"
        self.assertEqual(select_training(training, 1, True)[0], "NO_TRADE")
        for t in training:
            t["metrics"]["completed_trade_net"] = "1"
        self.assertEqual(select_training(training, 1, True)[0], "A")

    def test_buy_hold_is_marked_inventory_and_never_realized_profit(self):
        for t in [t for t in self.report["trials"] if t["variant"] == "BUY_HOLD"]:
            m = t["metrics"]
            self.assertEqual(m["completed_trade_net"], "0")
            self.assertLess(D(m["realized_net_including_open_entry_costs"]), 0)
            self.assertIsNotNone(m["open_position"])
            self.assertEqual(m["completed_trades"], 0)

    def test_metrics_do_not_invent_infinite_profit_factors(self):
        training = next(t for t in self.report["trials"] if t["phase"] == "TRAIN")
        self.assertEqual(training["metrics"]["losses"], 0)
        self.assertIsNone(training["metrics"]["profit_factor"])
        self.assertEqual(training["metrics"]["profit_factor_status"], "NO_LOSSES_UNDEFINED")

    def test_numeric_screens_are_not_execution_permission_or_pooled_money(self):
        self.assertEqual(self.report["readiness"], "BLOCKED_NOT_A_FUNDED_STRATEGY")
        self.assertEqual(self.report["account_policy"], "INDEPENDENT_FOLD_ACCOUNTS_NOT_A_COMPOUNDED_TREASURY")
        self.assertEqual(self.report["unseen_status"], "CHRONOLOGICAL_WINDOWS_NOT_ATTESTED_UNSEEN")
        for k in ["funds_transferred", "tokens_purchased", "tokens_burned"]:
            self.assertEqual(self.report[k], "0")

    def test_a_passing_research_screen_still_blocks_funded_trading(self):
        plan = make_plan(self.ds, Config(hold_bars=12), warmup_hours=24, train_hours=193,
                         test_hours=24, folds=1, seeds=(11,), min_train_trades=1,
                         min_test_trades=1, max_drawdown_bps=10000)
        report = run_study(self.ds, plan)
        self.assertTrue(any(s["numeric_screen"] == "PASS_RESEARCH_SCREEN_ONLY" for s in report["summary"]))
        self.assertEqual(report["readiness"], "BLOCKED_NOT_A_FUNDED_STRATEGY")
        self.assertEqual(report["source_verification"], "UNAVAILABLE")
        self.assertEqual(report["tokens_burned"], "0")

    def test_source_market_and_invalid_source_head_fail(self):
        changed = value()
        changed["market"]["venue"] = "OTHER"
        with self.assertRaisesRegex(ResearchError, "CONTRACT_MISMATCH"):
            run_study(dataset(changed), self.plan)
        with self.assertRaises(ResearchError):
            run_study(self.ds, self.plan, "no")

    def test_repeated_study_and_all_exports_are_deterministic(self):
        other = run_study(self.ds, self.plan)
        self.assertEqual(render_study(self.report, self.plan), render_study(other, self.plan))

    def test_publish_complete_study_verifies_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "report"
            payload = render_study(self.report, self.plan)
            publish(out, payload)
            self.assertEqual(verify_study(out)["members_verified"], 6)
            with self.assertRaisesRegex(ResearchError, "OUTPUT_ALREADY_EXISTS"):
                publish(out, payload)
            self.assertEqual((out / "study.html").read_bytes(), payload["study.html"])

    def test_all_export_members_are_hash_bound(self):
        for name in ["plan.json", "folds.csv", "trials.csv", "study.html", "COMMUNITY_UPDATE.md"]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                out = Path(temp) / "report"
                publish(out, render_study(self.report, self.plan))
                with (out / name).open("ab") as f:
                    f.write(b"tampered")
                with self.assertRaisesRegex(ResearchError, "EVIDENCE_HASH"):
                    verify_study(out)

    def test_rehashed_false_claims_schedule_and_selection_are_rejected(self):
        for case in ["burn", "source", "nav", "selection", "schedule", "missing_trial", "summary"]:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temp:
                out = Path(temp) / "report"
                publish(out, render_study(self.report, self.plan))
                r = deepcopy(self.report)
                if case == "burn":
                    r["tokens_burned"] = "1"
                elif case == "source":
                    r["source_verification"] = "VERIFIED"
                elif case == "nav":
                    r["trials"][0]["metrics"]["ending_marked_nav"] = "NaN"
                elif case == "selection":
                    r["folds"][0]["selected_variant"] = "A"
                elif case == "schedule":
                    r["folds"][0]["test_start_ms"] -= HOUR
                elif case == "missing_trial":
                    r["trials"].pop()
                else:
                    r["summary"][0]["mean_marked_return"] = "999"
                raw = canonical(r) + b"\n"
                (out / "study.json").write_bytes(raw)
                manifest = json.loads((out / "manifest.json").read_bytes())
                manifest["members"]["study.json"] = {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
                manifest.pop("manifest_sha256")
                manifest["manifest_sha256"] = digest(manifest)
                (out / "manifest.json").write_bytes(canonical(manifest) + b"\n")
                with self.assertRaises(ResearchError):
                    verify_study(out)

    def test_dashboard_escapes_text_and_contains_no_network_or_script(self):
        r = deepcopy(self.report)
        r["price_classification"] = '<script>alert("x")</script>'
        page = dashboard(r).decode()
        self.assertIn("&lt;script&gt;", page)
        self.assertNotIn("<script>", page)
        self.assertNotIn("https://", page)
        self.assertIn("default-src 'none'", page)
        self.assertIn('name="viewport"', page)


class StudyCLITests(unittest.TestCase):
    def cli(self, *args, optimized=False):
        command = [sys.executable, "-bb", "-X", "dev", "-W", "error"]
        if optimized:
            command.append("-O")
        return subprocess.run([*command, "-m", "zoora_sfp", *map(str, args)], cwd=ROOT, capture_output=True,
                              text=True, timeout=30, check=False,
                              env={k: v for k, v in os.environ.items() if k != "SOURCE_HEAD_SHA"})

    def test_actual_prepare_study_verify_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            plan, out = Path(temp) / "plan.json", Path(temp) / "report"
            args = ["prepare-study", "--dataset", "fixtures/demo.json", "--out", plan,
                    "--warmup-hours", 24, "--train-hours", 236, "--test-hours", 24,
                    "--folds", 2, "--hold-bars", 12, "--min-train-trades", 1, "--seeds", 11, 23]
            r = self.cli(*args)
            self.assertEqual(r.returncode, 0, r.stderr)
            before = plan.read_bytes()
            self.assertEqual(self.cli(*args).returncode, 2)
            self.assertEqual(plan.read_bytes(), before)
            r = self.cli("study", "--dataset", "fixtures/demo.json", "--plan", plan, "--out", out)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(r.stdout)["trials"], 42)
            r = self.cli("verify", "--report-dir", out)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(r.stdout)["members_verified"], 6)

    def test_optimized_study_cannot_disable_plan_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "plan.json"
            invalid = fast_plan()
            invalid["embargo_hours"] = 0
            path.write_bytes(canonical(reseal(invalid)))
            out = Path(temp) / "report"
            r = self.cli("study", "--dataset", "fixtures/demo.json", "--plan", path, "--out", out, optimized=True)
            self.assertEqual(r.returncode, 2)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
