"""Learning and leakage regressions; fixtures are synthetic, never historical evidence."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from src.multi_brain_research import training_lab as lab

ROOT = Path(__file__).resolve().parents[1]


class TrainingLabTests(unittest.TestCase):
    def setUp(self):
        self.data, self.plan = lab.demo_data()

    def repin(self):
        self.plan["dataset_sha256"] = lab.digest(self.data)

    def test_exact_units_are_required_and_retained_in_model_and_public_trace(self):
        bundle = lab.raw_bundle(self.data)
        model, _ = lab.fit(self.data, self.plan, bundle)
        self.assertEqual(model["units"], self.data["units"])
        self.assertEqual(lab.public_trace(self.data, self.plan, bundle, model)["units"], self.data["units"])
        self.data["units"]["price_unit"] = "UNDECLARED_CLOSE_PRICE"
        with self.assertRaisesRegex(lab.TrainingError, "INVALID_DATASET_UNITS"):
            lab.validate_dataset(self.data)

    def test_training_changes_parameters_and_reduces_fixture_train_loss(self):
        model, report = lab.fit(self.data, self.plan, lab.raw_bundle(self.data))
        self.assertTrue(report["training_performed"])
        self.assertTrue(any(abs(value) > 1e-6 for value in model["weights"]))
        self.assertLess(report["metrics"]["train"]["log_loss"], report["initial_train_metrics"]["log_loss"])
        self.assertEqual(report["trained_components"], ["LOGISTIC_READOUT"])
        self.assertFalse(report["biological_core_weights_updated"])
        self.assertFalse(report["live_execution_allowed"])
        self.assertEqual(report["profitability"], "NOT_EVALUATED")

    def test_model_is_exactly_reproducible_for_fixed_inputs(self):
        bundle = lab.raw_bundle(self.data)
        self.assertEqual(lab.fit(self.data, self.plan, bundle), lab.fit(self.data, self.plan, bundle))

    def test_future_suffix_does_not_change_causal_feature_prefix(self):
        episode = self.data["episodes"][0]
        original = [lab.observation(episode, i, self.plan) for i in range(8)]
        for quote in episode["quotes"][8:]:
            quote["bid"] *= 3
            quote["ask"] *= 3
        self.assertEqual(original, [lab.observation(episode, i, self.plan) for i in range(8)])

    def test_model_observation_excludes_identity_labels_and_future(self):
        episode = self.data["episodes"][0]
        visible = lab.observation(episode, 0, self.plan)
        self.assertEqual(set(visible), {"alias", "sequence", "event_ms", "available_ms", "bid", "ask", "features"})
        self.assertNotIn(episode["episode_id"], lab.canonical(visible))
        self.assertNotIn(episode["asset_group_sha256"], lab.canonical(visible))
        self.assertEqual(visible["sequence"], 0)

    def test_presentation_shuffle_is_repeatable_and_preserves_each_episode_clock(self):
        bundle = lab.raw_bundle(self.data)
        first = lab.examples(self.data, self.plan, bundle)
        self.assertEqual(first, lab.examples(self.data, self.plan, bundle))
        for part in lab.PARTS:
            for key in self.plan["splits"][part]:
                indices = [r["index"] for r in first[part] if r["episode_id"] == key]
                self.assertEqual(indices, sorted(indices))
        keys = list(dict.fromkeys(r["episode_id"] for r in first["train"]))
        self.assertCountEqual(keys, self.plan["splits"]["train"])

    def test_same_asset_cannot_cross_partitions_even_under_different_names(self):
        self.data["episodes"][10]["asset_group_sha256"] = self.data["episodes"][0]["asset_group_sha256"]
        self.repin()
        with self.assertRaisesRegex(lab.TrainingError, "ASSET_GROUP_LEAKAGE"):
            lab.validate_plan(self.plan, self.data)

    def test_partitions_require_chronology_and_horizon_gap(self):
        self.plan["horizon_ms"] = 2_000_000
        with self.assertRaisesRegex(lab.TrainingError, "CHRONOLOGY_OR_HORIZON_GAP"):
            lab.validate_plan(self.plan, self.data)

    def test_every_episode_is_assigned_exactly_once(self):
        self.plan["splits"]["test"].pop()
        with self.assertRaisesRegex(lab.TrainingError, "UNASSIGNED_EPISODE"):
            lab.validate_plan(self.plan, self.data)

    def test_changed_dataset_without_repin_is_rejected(self):
        self.data["episodes"][0]["quotes"][0]["bid"] -= 1
        with self.assertRaisesRegex(lab.TrainingError, "DATASET_PIN_MISMATCH"):
            lab.validate_plan(self.plan, self.data)

    def test_bools_cannot_replace_exact_quote_values(self):
        self.data["episodes"][0]["quotes"][0]["bid"] = True
        with self.assertRaises(lab.TrainingError):
            lab.validate_dataset(self.data)

    def test_missing_or_late_quote_order_cannot_be_reinterpreted(self):
        self.data["episodes"][0]["quotes"][1]["available_ms"] = 0
        with self.assertRaisesRegex(lab.TrainingError, "NONCAUSAL_QUOTE_ORDER"):
            lab.validate_dataset(self.data)

    def test_duplicate_trajectory_is_rejected_even_with_new_asset_group(self):
        self.data["episodes"][1]["quotes"] = deepcopy(self.data["episodes"][0]["quotes"])
        with self.assertRaisesRegex(lab.TrainingError, "DUPLICATE_TRAJECTORY"):
            lab.validate_dataset(self.data)

    def test_unknown_rights_are_blocked(self):
        self.data["source"]["rights"] = "UNRESOLVED"
        with self.assertRaisesRegex(lab.TrainingError, "SOURCE_RIGHTS_UNRESOLVED"):
            lab.validate_dataset(self.data)

    def test_unknown_quote_fields_cannot_smuggle_outcome_into_observations(self):
        self.data["episodes"][0]["quotes"][0]["future_rug"] = True
        with self.assertRaisesRegex(lab.TrainingError, "INVALID_FIELDS"):
            lab.validate_dataset(self.data)

    def test_last_observation_without_horizon_has_no_invented_label(self):
        rows = lab.examples(self.data, self.plan, lab.raw_bundle(self.data))["train"]
        self.assertTrue(all(r["target_index"] > r["index"] for r in rows))
        self.assertTrue(all(r["index"] <= 13 for r in rows))  # 20ms ingestion means the next eligible event is two ticks later.
        episode = self.data["episodes"][0]
        first = next(r for r in rows if r["episode_id"] == episode["episode_id"] and r["index"] == 0)
        self.assertEqual(first["target_index"], 2)

    def test_test_and_validation_changes_cannot_update_training_weights_or_normalizer(self):
        baseline, _ = lab.fit(self.data, self.plan, lab.raw_bundle(self.data))
        for episode in self.data["episodes"][8:]:
            for quote in episode["quotes"]:
                quote["bid"] *= 2
                quote["ask"] *= 2
                quote["bid_size"] *= 8
        self.repin()
        changed, _ = lab.fit(self.data, self.plan, lab.raw_bundle(self.data))
        for key in ("weights", "bias", "means", "scales"):
            self.assertEqual(baseline[key], changed[key])

    def test_nonfinite_or_misaligned_feature_exports_are_rejected(self):
        for invalid in ("nan", "width", "row"):
            with self.subTest(invalid=invalid):
                bundle = lab.raw_bundle(self.data)
                key = self.data["episodes"][0]["episode_id"]
                if invalid == "nan":
                    bundle["features"][key][0][0] = float("nan")
                elif invalid == "width":
                    bundle["features"][key][0].pop()
                else:
                    bundle["features"][key].pop()
                with self.assertRaises(lab.TrainingError):
                    lab.fit(self.data, self.plan, bundle)

    def test_export_from_another_dataset_is_rejected(self):
        bundle = lab.raw_bundle(self.data)
        bundle["dataset_sha256"] = "f" * 64
        with self.assertRaisesRegex(lab.TrainingError, "FEATURE_DATASET_MISMATCH"):
            lab.fit(self.data, self.plan, bundle)

    def test_public_trace_releases_outcomes_only_at_later_quote_and_never_trades(self):
        bundle = lab.raw_bundle(self.data)
        model, _ = lab.fit(self.data, self.plan, bundle)
        trace = lab.public_trace(self.data, self.plan, bundle, model)
        predictions, prior = {}, "0" * 64
        for item in trace["events"]:
            self.assertEqual(item["previous_sha256"], prior)
            self.assertEqual(item["sha256"], lab.digest({"previous_sha256": prior, "event": item["event"]}))
            prior = item["sha256"]
            event = item["event"]
            if event["type"] == "PREDICTION":
                predictions[(event["alias"], event["sequence"])] = True
                self.assertEqual(event["action"], "NO_EXECUTION")
                self.assertNotIn("label", event)
            elif event["type"] == "OUTCOME":
                self.assertIn((event["alias"], event["decision_sequence"]), predictions)
                self.assertGreater(event["sequence"], event["decision_sequence"])
        self.assertEqual(prior, trace["head_sha256"])
        raw = lab.canonical(trace)
        self.assertNotIn("asset_group_sha256", raw)
        self.assertNotIn(self.data["source"]["uri"], raw)

    def test_save_reload_and_actual_retraining_verify_then_reject_changed_weight(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "trial"
            result = lab.run(self.data, self.plan, output)
            self.assertEqual(lab.verify(output)["model_sha256"], result["model_sha256"])
            model = lab.read_json(output / "model.json")
            model["weights"][0] += 0.001
            (output / "model.json").unlink()
            lab.write_json(output / "model.json", model)
            with self.assertRaisesRegex(lab.TrainingError, "TRAINING_REPLAY_MISMATCH"):
                lab.verify(output)

    def test_existing_trial_output_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "trial"
            lab.run(self.data, self.plan, output)
            original = (output / "model.json").read_bytes()
            with self.assertRaises(FileExistsError):
                lab.run(self.data, self.plan, output)
            self.assertEqual((output / "model.json").read_bytes(), original)

    def test_reader_rejects_duplicate_keys_and_nonfinite_json(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bad.json"
            for raw in ('{"x":1,"x":2}', '{"x":NaN}'):
                path.write_text(raw, encoding="utf-8")
                with self.assertRaises(lab.TrainingError):
                    lab.read_json(path)

    def test_actual_cli_demo_and_verify(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "trial"
            for args in (["demo", "--output", str(output)], ["verify", "--directory", str(output)]):
                completed = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error",
                                            str(ROOT / "scripts/train_market_readout.py"), *args],
                                           capture_output=True, text=True, timeout=60, check=False)
                self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
                self.assertFalse(json.loads(completed.stdout)["live_execution_allowed"])


if __name__ == "__main__":
    unittest.main()
