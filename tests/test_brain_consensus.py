"""Adversarial orchestration tests; fixtures are not neural or financial forecasts."""

from dataclasses import asdict, replace
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from multi_brain_research.consensus import ObservationRound, PairIdentity, Receipt
from multi_brain_research.consensus_fixture import (address, events_for_scenarios, pair, pin,
                                                  policy, receipt, snapshot, unavailable_policy)
from multi_brain_research.consensus_stream import decode, parse_policy, replay_stream
from multi_brain_research.contracts import ContractError
from multi_brain_research.graph import canonical

ROOT = Path(__file__).resolve().parents[1]


def populated(config=None, observation=None, **last_changes):
    config = config or policy()
    observation = observation or snapshot(config)
    observation_round = ObservationRound(config, pair(), observation)
    for index, module in enumerate(config.modules):
        observation_round.submit(receipt(module, observation, config,
                                         **(last_changes if index == 3 else {})))
    return observation_round


class ConsensusTests(unittest.TestCase):
    def test_unanimity_is_only_a_non_executable_candidate(self):
        record = populated().finalize(1002)
        self.assertEqual(record["research_signal"], "UNANIMOUS_BUY_CANDIDATE")
        self.assertEqual((record["required_modules"], record["buy_support_count"]), (4, 4))
        self.assertEqual(record["action"], "NO_EXECUTION")
        self.assertFalse(record["execution_allowed"])
        self.assertEqual(record["risk_policy"], "NOT_EVALUATED")
        self.assertEqual(record["independence"], "NOT_ESTABLISHED")
        self.assertEqual(record["calibration"], "NOT_INDEPENDENTLY_VERIFIED")

    def test_one_dissent_is_no_buy_and_does_not_mean_sell(self):
        record = populated(score=300000).finalize(1002)
        self.assertEqual(record["research_signal"], "NO_BUY")
        self.assertEqual(record["buy_support_count"], 3)
        self.assertNotIn("SELL", json.dumps(record))

    def test_exact_threshold_and_uncertainty_boundaries(self):
        for score, uncertainty, expected in ((699999, 200000, "NO_BUY"),
                                             (700000, 200000, "UNANIMOUS_BUY_CANDIDATE"),
                                             (700000, 200001, "ABSTAIN")):
            with self.subTest(score=score, uncertainty=uncertainty):
                self.assertEqual(populated(score=score, uncertainty=uncertainty).finalize(1002)["research_signal"], expected)

    def test_each_worker_abstention_blocks_buy(self):
        for reason in ("MISSING_DATA", "UNCALIBRATED", "OUT_OF_DOMAIN", "MODULE_FAILED"):
            with self.subTest(reason=reason):
                record = populated(abstain=reason).finalize(1002)
                self.assertEqual(record["research_signal"], "ABSTAIN")
                self.assertIn(reason, [row["reason"] for row in record["modules"]])

    def test_three_of_four_waits_then_times_out_without_shrinking_roster(self):
        config = policy()
        observation = snapshot(config)
        group = ObservationRound(config, pair(), observation)
        for module in config.modules[:3]:
            group.submit(receipt(module, observation, config))
        self.assertEqual(group.status(1049)["research_signal"], "WAITING")
        with self.assertRaisesRegex(ContractError, "STILL_PENDING"):
            group.finalize(1049)
        record = group.finalize(1050)
        self.assertEqual(record["research_signal"], "ABSTAIN")
        self.assertEqual((record["required_modules"], record["received_modules"]), (4, 3))
        self.assertIn("MODULE_TIMEOUT", [row["reason"] for row in record["modules"]])

    def test_missing_encoder_is_unavailable_not_an_invented_vote(self):
        config = unavailable_policy()
        observation = snapshot(config)
        group = ObservationRound(config, pair(), observation)
        for module in config.modules[:3]:
            group.submit(receipt(module, observation, config))
        with self.assertRaisesRegex(ContractError, "PIPELINE_UNAVAILABLE"):
            group.submit(receipt(config.modules[3], observation, config))
        result = group.finalize(1002)
        self.assertEqual(result["research_signal"], "ABSTAIN")
        self.assertEqual(result["modules"][-1]["reason"], "MISSING_ENCODER")
        self.assertIsNone(result["modules"][-1]["prediction_ppm"])

    def test_late_votes_and_late_decision_cannot_create_a_candidate(self):
        late = populated(received=1051).finalize(1051)
        self.assertEqual(late["research_signal"], "ABSTAIN")
        self.assertIn("LATE_RECEIPT", [x["reason"] for x in late["modules"]])
        self.assertIn("ROUND_EXPIRED", populated().finalize(1051)["reasons"])

    def test_missing_and_newly_stale_data_block_even_unanimous_votes(self):
        observation = snapshot(missing=True)
        record = populated(observation=observation).finalize(1002)
        self.assertIn("MISSING_REQUIRED_DATA", record["reasons"])
        fresh = snapshot()
        oldest = replace(fresh.measurements[0], event_time_ms=900, observed_time_ms=900)
        record = populated(observation=replace(fresh, measurements=(oldest,))).finalize(1002)
        self.assertEqual(record["buy_support_count"], 4)
        self.assertEqual(record["research_signal"], "ABSTAIN")
        self.assertIn("OBSERVATION_STALE_AT_CLOSE", record["reasons"])

    def test_exact_pipeline_clones_cannot_be_renamed_or_recalibrated_into_votes(self):
        config = policy()
        duplicate = replace(config.modules[0], module_id="disguised_clone", source_id="another_source",
                            calibration_sha256=pin("different_calibration"))
        with self.assertRaisesRegex(ContractError, "DUPLICATE_MARKET_PIPELINE"):
            replace(config, modules=(*config.modules[:3], duplicate))

    def test_same_name_cannot_supply_duplicate_receipts(self):
        config = policy()
        observation = snapshot(config)
        group = ObservationRound(config, pair(), observation)
        record = receipt(config.modules[0], observation, config)
        group.submit(record)
        with self.assertRaisesRegex(ContractError, "DUPLICATE_MODULE_RECEIPT"):
            group.submit(record)

    def test_catching_a_bad_receipt_cannot_restore_candidate_status(self):
        config, observation = policy(), snapshot()
        group = ObservationRound(config, pair(), observation)
        original = receipt(config.modules[0], observation, config)
        bad = replace(original, output=replace(original.output, model_sha256=pin("wrong_model")))
        with self.assertRaises(ContractError):
            group.submit(bad)
        for module in config.modules:
            group.submit(receipt(module, observation, config))
        record = group.finalize(1002)
        self.assertEqual(record["buy_support_count"], 4)
        self.assertEqual(record["research_signal"], "ABSTAIN")
        self.assertIn("INVALID_WORKER_RECEIPT", record["reasons"])

    def test_round_identity_and_policy_cannot_be_reassigned(self):
        group = ObservationRound(policy(), pair(), snapshot())
        for name, value in (("policy", replace(policy(), buy_threshold_ppm=0)),
                            ("pair", replace(pair(), network="mainnet")),
                            ("snapshot", snapshot(at=2000)), ("round_id", pin("replacement"))):
            with self.subTest(name=name), self.assertRaises(AttributeError):
                setattr(group, name, value)

    def test_other_snapshot_pair_task_horizon_source_or_model_refused(self):
        config = policy()
        observation = snapshot(config)
        original = receipt(config.modules[0], observation, config)
        changes = ({"snapshot_sha256": pin("wrong_snapshot")}, {"task_sha256": pin("wrong_task")},
                   {"horizon_ms": 60001}, {"source_id": "wrong_source"},
                   {"model_sha256": pin("wrong_pipeline")}, {"graph_sha256": pin("wrong_graph")},
                   {"module_id": "unknown_worker"})
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ContractError):
                ObservationRound(config, pair(), observation).submit(replace(original, output=replace(original.output, **change)))
        for change in ({"network": "mainnet"}, {"pool_address": address(4)},
                       {"base_mint": address(4)}, {"quote_mint": address(4)}, {"venue": "other_venue"}):
            with self.subTest(change=change), self.assertRaisesRegex(ContractError, "PAIR_SNAPSHOT_MISMATCH"):
                ObservationRound(config, replace(pair(), **change), observation)

    def test_wrong_feature_version_schema_or_age_policy_refused(self):
        config = policy()
        observation = snapshot(config)
        for changed in (replace(observation, feature_set_sha256=pin("other_features")),
                        replace(observation, max_observation_age_ms=99),
                        replace(observation, measurements=(replace(observation.measurements[0], unit="other_unit"),)),
                        replace(observation, measurements=(replace(observation.measurements[0], classification="OBSERVED"),))):
            with self.assertRaises(ContractError):
                ObservationRound(config, pair(), changed)

    def test_frozen_roster_and_score_types_are_enforced(self):
        config = policy()
        for change in ({"modules": list(config.modules)}, {"modules": config.modules[:1]},
                       {"modules": (*config.modules[:3], config.modules[0])},
                       {"buy_threshold_ppm": True}, {"max_uncertainty_ppm": 1.1},
                       {"max_decision_latency_ms": 60000}, {"classification": "LIVE_EXECUTION"}):
            with self.subTest(change=change), self.assertRaises(ContractError):
                replace(config, **change)

    def test_pair_format_checks_cannot_establish_an_onchain_asset(self):
        identity = pair()
        self.assertNotEqual(identity.sha256(), replace(identity, base_mint=identity.quote_mint,
                                                     quote_mint=identity.base_mint).sha256())
        for change in ({"base_mint": "fakeSymbol"}, {"base_mint": "0" * 44},
                       {"base_mint": "1" * 33}, {"base_mint": "1" * 31},
                       {"quote_mint": identity.base_mint}, {"chain": "ethereum"}):
            with self.subTest(change=change), self.assertRaises(ContractError):
                replace(identity, **change)

    def test_receipt_and_poll_clock_order_is_explicit(self):
        config = policy()
        observation = snapshot(config)
        group = ObservationRound(config, pair(), observation)
        group.status(1010)
        with self.assertRaisesRegex(ContractError, "NONMONOTONIC_RECEIPT_TIME"):
            group.submit(receipt(config.modules[0], observation, config))
        with self.assertRaisesRegex(ContractError, "CLOCK_BEFORE_RECEIPTS"):
            group.status(1009)
        with self.assertRaisesRegex(ContractError, "RECEIPT_PRECEDES_OUTPUT"):
            receipt(config.modules[0], observation, config, received=1000)

    def test_finalization_closes_round_and_no_vote_can_be_replaced(self):
        group = populated()
        group.finalize(1002)
        for operation in (lambda: group.status(1002), lambda: group.finalize(1002),
                          lambda: group.submit(receipt(policy().modules[0], snapshot()))):
            with self.assertRaisesRegex(ContractError, "ROUND_CLOSED"):
                operation()

    def test_roster_order_does_not_change_policy_or_audit_record(self):
        config = policy()
        reordered = replace(config, modules=config.modules[::-1])
        self.assertEqual(config.sha256(), reordered.sha256())
        self.assertEqual(populated(config).finalize(1002), populated(reordered).finalize(1002))


class StreamTests(unittest.TestCase):
    def test_synthetic_scenarios_are_deterministic_and_have_explicit_outcomes(self):
        config, events, expected = events_for_scenarios()
        wire = b"".join(canonical(x) + b"\n" for x in events)
        first, second = io.BytesIO(), io.BytesIO()
        replay_stream(config, io.BytesIO(wire), first)
        replay_stream(parse_policy(canonical(asdict(config))), io.BytesIO(wire), second)
        self.assertEqual(first.getvalue(), second.getvalue())
        records = [json.loads(line)["record"] for line in first.getvalue().splitlines()
                   if json.loads(line)["event"] == "FINALIZED"]
        self.assertEqual([r["research_signal"] for r in records], [x["research_signal"] for x in expected])
        self.assertTrue(all(r["action"] == "NO_EXECUTION" and not r["execution_allowed"] for r in records))

    def test_duplicate_json_keys_nonfinite_and_huge_lines_refused(self):
        for data in (b'{"event":"OPEN","event":"EXECUTE"}', b'{"value":NaN}',
                     b"{" + b"x" * 65536, b""):
            with self.assertRaises(ContractError):
                decode(data)

    def test_policy_with_unexpected_execution_or_import_fields_refused(self):
        for key in ("execute", "private_key", "module_import", "quorum"):
            raw = {**asdict(policy()), key: "SENSITIVE_TEST_MARKER"}
            with self.assertRaises(ContractError) as exc:
                parse_policy(canonical(raw))
            self.assertNotIn("SENSITIVE_TEST_MARKER", str(exc.exception))

    def test_unknown_events_incomplete_round_and_round_replay_refused(self):
        config, events, _ = events_for_scenarios()
        for wire, reason in ((canonical({"event": "EXECUTE"}) + b"\n", "UNSUPPORTED_EVENT"),
                             (canonical(events[0]) + b"\n", "INCOMPLETE_ROUND"),
                             (b"".join(canonical(x)+b"\n" for x in [*events[:7], events[0]]), "REPLAYED_ROUND")):
            with self.subTest(reason=reason), self.assertRaisesRegex(ContractError, reason):
                replay_stream(config, io.BytesIO(wire), io.BytesIO())

    def test_wrong_round_and_extra_event_fields_refused(self):
        config, events, _ = events_for_scenarios()
        for altered in ({**events[1], "round_id": pin("another_round")},
                        {**events[1], "execute": True}):
            wire = canonical(events[0])+b"\n"+canonical(altered)+b"\n"
            with self.assertRaises(ContractError):
                replay_stream(config, io.BytesIO(wire), io.BytesIO())

    def test_input_event_and_output_budgets_are_enforced(self):
        config, events, _ = events_for_scenarios()
        wire = b"".join(canonical(x)+b"\n" for x in events)
        for name, bound in (("MAX_EVENTS", 2), ("MAX_STREAM_BYTES", 500), ("MAX_ROUNDS", 1)):
            with self.subTest(name=name), patch("multi_brain_research.consensus_stream."+name, bound):
                with self.assertRaises(ContractError):
                    replay_stream(config, io.BytesIO(wire), io.BytesIO())

    def test_cli_preserves_existing_output_and_emits_safe_errors(self):
        config, events, _ = events_for_scenarios()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config_path, events_path, output = root/"policy.json", root/"events.jsonl", root/"audit.jsonl"
            config_path.write_bytes(canonical(asdict(config)))
            events_path.write_bytes(b"".join(canonical(x)+b"\n" for x in events))
            command = [sys.executable, str(ROOT/"scripts/replay_brain_consensus.py"),
                       "--policy", str(config_path), "--events", str(events_path), "--output", str(output)]
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            before = output.read_bytes()
            again = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(again.returncode, 1)
            self.assertEqual(output.read_bytes(), before)
            self.assertNotIn(str(root), again.stderr)
            self.assertEqual(json.loads(again.stderr)["action"], "NO_EXECUTION")


if __name__ == "__main__":
    unittest.main()
