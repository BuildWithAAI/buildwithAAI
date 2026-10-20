"""Adversarial school admission and independent paper-accounting checks."""
import json
import subprocess
import sys
import tempfile
import unittest
from dataclasses import asdict, replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.consensus_fixture import pair, policy, receipt, snapshot
from multi_brain_research.contracts import ContractError
from multi_brain_research.education import (
    Answer,
    Curriculum,
    EvaluationPlan,
    Learner,
    SchoolObservationRound,
    assess,
    parse_attempt,
    parse_json,
    verify_assessment,
)
from multi_brain_research.graph import canonical
from multi_brain_research.paper_school import replay_paper
from multi_brain_research.school_fixture import paper_fixture, synthetic_attempt


class SchoolTests(unittest.TestCase):
    def setUp(self):
        self.curriculum = Curriculum.load()
        self.attempt = synthetic_attempt(self.curriculum)
        self.now = self.attempt.completed_ms

    def test_track_inventory_and_classification(self):
        data = self.curriculum.data()
        self.assertEqual((len(data["lessons"]), len(data["cases"]), len(data["tracks"])), (21, 51, 7))
        self.assertEqual({row["track_id"] for row in data["tracks"]},
                         {"crypto_general", "solana", "ethereum", "bnb_smart_chain", "sui", "rh_unresolved", "xauusd"})
        for row in data["tracks"]:
            with self.subTest(track=row["track_id"]):
                attempt = synthetic_attempt(self.curriculum, track=row["track_id"])
                report = assess(self.curriculum, attempt, self.now)
                self.assertEqual(report["status"], "PRACTICE_COMPLETE")
                self.assertFalse(report["live_execution_allowed"])
                self.assertEqual(report["model_training"], "NOT_PERFORMED")

    def test_unknown_rh_and_broker_contract_remain_blocked_despite_perfect_answers(self):
        for track, reason in (("rh_unresolved", "RH_PLATFORM_UNRESOLVED"), ("xauusd", "BROKER_AND_CONTRACT_SPECIFICATION_REQUIRED")):
            with self.subTest(track=track):
                report = assess(self.curriculum, synthetic_attempt(self.curriculum, track=track), self.now)
                self.assertEqual(report["score_ppm"], 1_000_000)
                self.assertFalse(report["paper_lab_allowed"])
                self.assertIn(reason, report["paper_lab_blockers"])

    def test_empty_and_missing_answers_cannot_pass(self):
        for answers in ((), self.attempt.answers[:-1]):
            report = assess(self.curriculum, replace(self.attempt, answers=answers), self.now)
            self.assertEqual(report["status"], "INCOMPLETE")
            self.assertFalse(report["paper_lab_allowed"])

    def test_critical_mistake_blocks_even_above_overall_threshold(self):
        cases = {case["case_id"]: case for case in self.curriculum.cases("solana")}
        key = next(key for key, row in cases.items() if row["safety_critical"])
        bad = tuple(replace(answer, choice=next(choice for choice in cases[key]["choices"] if choice != answer.choice))
                    if answer.case_id == key else answer for answer in self.attempt.answers)
        report = assess(self.curriculum, replace(self.attempt, answers=bad), self.now)
        self.assertGreater(report["score_ppm"], 900_000)
        self.assertEqual(report["failed_safety_cases"], [key])
        self.assertFalse(report["paper_lab_allowed"])

    def test_answer_order_is_not_a_new_attempt_identity(self):
        reordered = replace(self.attempt, answers=tuple(reversed(self.attempt.answers)))
        self.assertEqual(reordered.sha256(), self.attempt.sha256())
        self.assertEqual(assess(self.curriculum, reordered, self.now), assess(self.curriculum, self.attempt, self.now))

    def test_duplicate_unknown_out_of_track_and_invalid_choices(self):
        with self.assertRaisesRegex(ContractError, "DUPLICATE_ANSWER"):
            replace(self.attempt, answers=self.attempt.answers + (self.attempt.answers[0],))
        for answer in (Answer("unknown_case", "NO"), Answer("gold_contract_lot", "NO")):
            with self.subTest(answer=answer), self.assertRaisesRegex(ContractError, "OUTSIDE_TRACK"):
                assess(self.curriculum, replace(self.attempt, answers=(answer,)), self.now)
        with self.assertRaisesRegex(ContractError, "INVALID_ANSWER_CHOICE"):
            assess(self.curriculum, replace(self.attempt, answers=(replace(self.attempt.answers[0], choice="INVENTED"),)), self.now)

    def test_curriculum_hash_freezes_content_and_invalidates_old_attempts(self):
        original = self.curriculum.sha256()
        data = self.curriculum.data()
        data["lessons"][0]["study_notes"] += " Revised lesson."
        self.assertEqual(self.curriculum.sha256(), original)
        revised = Curriculum(canonical(data))
        self.assertNotEqual(revised.sha256(), original)
        with self.assertRaisesRegex(ContractError, "CURRICULUM_CHANGED"):
            assess(revised, self.attempt, self.now)

    def test_future_attempt_clock_and_review_expiry(self):
        with self.assertRaisesRegex(ContractError, "FUTURE_ATTEMPT"):
            assess(self.curriculum, self.attempt, self.now - 1)
        with self.assertRaisesRegex(ContractError, "INVALID_TIME"):
            assess(self.curriculum, self.attempt, True)
        report = assess(self.curriculum, self.attempt, self.curriculum.data()["review_valid_until_ms"])
        self.assertFalse(report["paper_lab_allowed"])
        self.assertIn("CURRICULUM_REVIEW_EXPIRED", report["paper_lab_blockers"])

    def test_tampered_assessment_flag_and_recomputed_expiry(self):
        report = assess(self.curriculum, self.attempt, self.now)
        for forged in (dict(report, live_execution_allowed=True), dict(report, schema_version=True)):
            with self.subTest(forged=forged["schema_version"]), self.assertRaisesRegex(ContractError, "ASSESSMENT_RECORD_MISMATCH"):
                verify_assessment(self.curriculum, self.attempt, forged, self.now)
        expired = verify_assessment(self.curriculum, self.attempt, report, report["expires_at_ms"])
        self.assertFalse(expired["paper_lab_allowed"])

    def test_json_duplicate_nonfinite_and_unknown_fields_are_refused(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'null', b'{'):
            with self.subTest(raw=raw):
                if raw == b'null':
                    with self.assertRaises(ContractError):
                        parse_attempt(parse_json(raw))
                else:
                    with self.assertRaises(ContractError):
                        parse_json(raw)
        value = parse_json(canonical(asdict(self.attempt)))
        value["graduated"] = True
        with self.assertRaisesRegex(ContractError, "INVALID_FIELDS"):
            parse_attempt(value)

    def test_curriculum_duplicate_ids_unknown_sources_and_empty_choices(self):
        for fault in ("duplicate", "source", "choices"):
            value = self.curriculum.data()
            if fault == "duplicate":
                value["tracks"].append(value["tracks"][0])
            elif fault == "source":
                value["lessons"][0]["sources"] = ["invented_source"]
            else:
                value["cases"][0]["choices"] = []
            with self.subTest(fault=fault), self.assertRaises(ContractError):
                Curriculum(canonical(value))

    def test_evaluation_plan_requires_gaps_and_pinned_artifacts(self):
        plan = EvaluationPlan(0, 1000, 1100, 2000, 2100, 3000, 3100, 100, 100,
                              "1" * 64, "2" * 64, "3" * 64, "4" * 64)
        self.assertEqual(len(plan.sha256()), 64)
        for changed in ({"test_start_ms": 1999}, {"embargo_ms": 99}, {"train_end_ms": 0},
                        {"dataset_manifest_sha256": "0" * 64}, {"horizon_ms": True}):
            with self.subTest(changed=changed), self.assertRaises(ContractError):
                replace(plan, **changed)


class SchoolCoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.curriculum = Curriculum.load()
        self.config = policy()
        self.at = self.curriculum.data()["reviewed_at_ms"] + 50_000
        self.snapshot = snapshot(self.config, at=self.at)
        self.attempts = tuple(synthetic_attempt(self.curriculum, Learner(spec.module_id, spec.pipeline_sha256(), spec.calibration_sha256), at=self.at-10)
                              for spec in self.config.modules)

    def group(self, **kwargs):
        return SchoolObservationRound(kwargs.get("policy", self.config), pair(), self.snapshot,
                                      self.curriculum, kwargs.get("attempts", self.attempts))

    def test_practice_then_unanimity_still_cannot_execute(self):
        group = self.group()
        for spec in self.config.modules:
            group.submit(receipt(spec, self.snapshot, self.config))
        result = group.finalize(self.at + 2)
        self.assertEqual(result["consensus"]["research_signal"], "UNANIMOUS_BUY_CANDIDATE")
        self.assertEqual(len(result["practice_assessments"]), 4)
        self.assertFalse(result["live_execution_allowed"])
        self.assertFalse(result["consensus"]["execution_allowed"])

    def test_missing_duplicate_or_incomplete_student_blocks_whole_roster(self):
        for attempts in (self.attempts[:-1], self.attempts[:-1] + (self.attempts[0],),
                         (replace(self.attempts[0], answers=()),) + self.attempts[1:]):
            with self.subTest(attempts=len(attempts)), self.assertRaises(ContractError):
                self.group(attempts=attempts)

    def test_another_pipeline_or_chain_cannot_reuse_assessment(self):
        for attempt in (replace(self.attempts[0], learner=replace(self.attempts[0].learner, pipeline_sha256="e" * 64)),
                        replace(self.attempts[0], track_id="ethereum")):
            with self.subTest(attempt=attempt.track_id), self.assertRaises(ContractError):
                self.group(attempts=(attempt,) + self.attempts[1:])

    def test_synthetic_practice_cannot_claim_operator_model_evidence(self):
        with self.assertRaisesRegex(ContractError, "SYNTHETIC_PRACTICE"):
            self.group(policy=replace(self.config, classification="UNVALIDATED_RESEARCH"))

    def test_calibration_change_invalidates_the_previous_practice_binding(self):
        changed = replace(self.attempts[0], learner=replace(self.attempts[0].learner, calibration_sha256="f" * 64))
        with self.assertRaisesRegex(ContractError, "EDUCATION_PIPELINE_CHANGED"):
            self.group(attempts=(changed,) + self.attempts[1:])

    def test_expiry_is_checked_again_at_round_close(self):
        end = self.curriculum.data()["review_valid_until_ms"]
        observation = snapshot(self.config, at=end - 1)
        group = SchoolObservationRound(self.config, pair(), observation, self.curriculum, self.attempts)
        with self.assertRaisesRegex(ContractError, "PRACTICE_EXPIRED"):
            group.finalize(end)


class PaperSchoolTests(unittest.TestCase):
    def setUp(self):
        self.curriculum, self.attempt, self.market, self.policy, self.quotes, self.decisions = paper_fixture()

    def run_lab(self, **changed):
        return replay_paper(self.curriculum, changed.get("attempt", self.attempt), changed.get("market", self.market),
                            changed.get("policy", self.policy), changed.get("quotes", self.quotes),
                            changed.get("decisions", self.decisions))

    def test_exact_accounting_matches_independent_hand_calculation(self):
        result = self.run_lab()
        # Buy 100 at 102; sell 100 at 111. Fees 102+111; gas 5+5.
        self.assertEqual(result["net_marked_pnl"], 100 * (111 - 102) - 102 - 111 - 5 - 5)
        self.assertEqual((result["ending_cash"], result["ending_base_units"]), (1_000_677, 0))
        self.assertEqual(result["max_marked_drawdown_ppm"], 207)
        self.assertEqual(result["paid_fees"], 213)
        self.assertEqual(result["paid_gas_quote"], 10)
        self.assertFalse(result["live_execution_allowed"])

    def test_fill_is_later_than_decision_and_uses_executable_side(self):
        result = self.run_lab()
        self.assertEqual([event["fill"]["price"] for event in result["events"]], [102, 111])
        self.assertTrue(all(event["fill"]["at_ms"] > event["decision"]["at_ms"] for event in result["events"]))

    def test_fractional_base_units_round_debits_up_and_credits_down(self):
        market = replace(self.market, base_scale=100)
        quotes = tuple(replace(quote, market_sha256=market.sha256()) for quote in self.quotes)
        decisions = tuple(replace(decision, quantity=150) for decision in self.decisions)
        result = self.run_lab(market=market, quotes=quotes, decisions=decisions)
        # 1.5*102 = 153 debit; floor(1.5*111) = 166 credit.
        # Both 1% fees round to 2 atoms; both gas charges are 5 atoms.
        self.assertEqual((result["paid_fees"], result["net_marked_pnl"]), (4, -1))
        self.assertEqual(result["ending_base_units"], 0)

    def test_missing_or_future_visible_data_cannot_fill(self):
        delayed = tuple(replace(quote, available_ms=quote.available_ms + 100) for quote in self.quotes)
        result = self.run_lab(quotes=delayed)
        self.assertEqual(result["fills"], 0)
        self.assertTrue(all(event["reason"] == "NO_VISIBLE_QUOTE" for event in result["events"]))
        future_reference = replace(self.decisions[0], reference_quote_id=self.quotes[-1].quote_id)
        result = self.run_lab(decisions=(future_reference,))
        self.assertEqual(result["events"][0]["reason"], "REFERENCE_NOT_LATEST_VISIBLE")

    def test_stale_quotes_closed_market_and_kill_switch(self):
        scenarios = ((replace(self.policy, kill_switch=True), self.quotes, "KILL_SWITCH"),
                     (replace(self.policy, max_quote_age_ms=1), self.quotes, "STALE_REFERENCE"),
                     (self.policy, tuple(replace(quote, market_open=False) for quote in self.quotes), "MARKET_CLOSED"))
        decision = replace(self.decisions[0], at_ms=self.decisions[0].at_ms+2)
        for config, quotes, reason in scenarios:
            with self.subTest(reason=reason):
                result = self.run_lab(policy=config, quotes=quotes, decisions=(decision,))
                self.assertEqual(result["events"][0]["reason"], reason)
                self.assertEqual(result["fills"], 0)

    def test_cash_exposure_and_order_limits_include_costs(self):
        for config, reason in ((replace(self.policy, initial_cash=10_200), "INSUFFICIENT_CASH_WITH_COSTS"),
                               (replace(self.policy, max_position_quote=10_000), "POSITION_LIMIT"),
                               (replace(self.policy, max_order_quote=10_000), "ORDER_LIMIT")):
            with self.subTest(reason=reason):
                result = self.run_lab(policy=config, decisions=self.decisions[:1])
                self.assertEqual(result["events"][0]["reason"], reason)
                self.assertEqual(result["fills"], 0)

    def test_first_future_quote_cannot_be_replaced_by_a_more_favorable_one(self):
        result = self.run_lab(policy=replace(self.policy, max_slippage_ppm=100), decisions=self.decisions[:1])
        self.assertEqual(result["events"][0]["reason"], "SLIPPAGE_LIMIT")
        self.assertEqual(result["fills"], 0)

    def test_depth_and_no_short_selling(self):
        quotes = tuple(replace(quote, ask_size=99) for quote in self.quotes)
        self.assertEqual(self.run_lab(quotes=quotes)["events"][0]["reason"], "INSUFFICIENT_DEPTH")
        result = self.run_lab(decisions=(replace(self.decisions[0], side="SELL"),))
        self.assertEqual(result["events"][0]["reason"], "INSUFFICIENT_POSITION")

    def test_drawdown_guard_uses_intermediate_quotes_not_only_decision_prices(self):
        quotes = self.quotes[:2] + (replace(self.quotes[2], bid=50, ask=51),) + self.quotes[3:]
        second = replace(self.decisions[1], side="BUY")
        result = self.run_lab(quotes=quotes, policy=replace(self.policy, max_drawdown_ppm=1000), decisions=(self.decisions[0], second))
        self.assertEqual(result["events"][1]["reason"], "DRAWDOWN_HALT")
        self.assertGreater(result["max_marked_drawdown_ppm"], 1000)

    def test_paper_lab_requires_matching_complete_education(self):
        for attempt in (replace(self.attempt, answers=()), replace(self.attempt, track_id="ethereum")):
            with self.subTest(track=attempt.track_id), self.assertRaises(ContractError):
                self.run_lab(attempt=attempt)

    def test_market_identity_ordering_and_duplicate_events(self):
        cases = (self.quotes[::-1], (self.quotes[0], self.quotes[0]) + self.quotes[2:],
                 (replace(self.quotes[0], market_sha256="e" * 64),) + self.quotes[1:])
        for quotes in cases:
            with self.subTest(quotes=quotes[0].quote_id), self.assertRaises(ContractError):
                self.run_lab(quotes=quotes)
        with self.assertRaisesRegex(ContractError, "DECISION_PRECEDES_PRIOR_FILL"):
            self.run_lab(decisions=(self.decisions[0], replace(self.decisions[1], at_ms=self.decisions[0].at_ms+1)))

    def test_invalid_types_and_unsupported_gold_adapter(self):
        for changed in ({"fee_ppm": True}, {"initial_cash": 1.5}, {"latency_ms": 0}, {"kill_switch": 1}):
            with self.subTest(changed=changed), self.assertRaises(ContractError):
                replace(self.policy, **changed)
        with self.assertRaisesRegex(ContractError, "PAPER_TRACK_NOT_IMPLEMENTED"):
            replace(self.market, track_id="xauusd")
        with self.assertRaises(ContractError):
            replace(self.decisions[0], quantity=-1)

    def test_record_is_reproducible_and_binds_cost_model(self):
        first = self.run_lab()
        self.assertEqual(first, self.run_lab())
        changed = self.run_lab(policy=replace(self.policy, fee_ppm=20_000))
        self.assertNotEqual(first["policy_sha256"], changed["policy_sha256"])
        self.assertNotEqual(first["record_sha256"], changed["record_sha256"])
        self.assertLess(changed["net_marked_pnl"], first["net_marked_pnl"])


class SchoolCLITests(unittest.TestCase):
    def command(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "scripts/trading_school.py"), *map(str, args)],
                              check=False, capture_output=True, text=True, timeout=30)

    def test_cli_demo_replay_tamper_detection_and_exclusive_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            generated = root / "demo"
            result = self.command("demo", "--output", generated)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((generated / "report.json").read_bytes())
            self.assertTrue(report["cli_and_in_process_bytes_identical"])
            self.assertTrue(report["rh_blocked"] and report["xauusd_blocked"])
            self.assertFalse(report["live_execution_allowed"])
            self.assertEqual((generated / "paper-cli.json").read_bytes(), (generated / "paper-in-process.json").read_bytes())
            paper = json.loads((generated / "paper-cli.json").read_bytes())
            paper["ending_cash"] += 1
            (root / "forged.json").write_bytes(canonical(paper))
            result = self.command("verify-paper", "--input", generated / "paper-input.json", "--record", root / "forged.json", "--output", root / "refused.json")
            self.assertEqual(result.returncode, 2)
            self.assertIn("PAPER_RECORD_MISMATCH", result.stderr)
            self.assertFalse((root / "refused.json").exists())
            before = (generated / "paper-cli.json").read_bytes()
            result = self.command("paper", "--input", generated / "paper-input.json", "--output", generated / "paper-cli.json")
            self.assertEqual(result.returncode, 2)
            self.assertEqual((generated / "paper-cli.json").read_bytes(), before)

    def test_study_packet_and_assessment_do_not_grant_execution(self):
        curriculum = Curriculum.load()
        attempt = synthetic_attempt(curriculum)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            result = self.command("study", "--track", "sui", "--output", root / "study.json")
            self.assertEqual(result.returncode, 0, result.stderr)
            packet = json.loads((root / "study.json").read_bytes())
            self.assertTrue(all("expected" not in row for row in packet["practice_cases"]))
            self.assertFalse(packet["live_execution_allowed"])
            self.assertEqual([row["lesson_id"] for row in packet["lessons"]], packet["track"]["lessons"])
            (root / "attempt.json").write_bytes(canonical(asdict(attempt)))
            result = self.command("assess", "--attempt", root / "attempt.json", "--now-ms", attempt.completed_ms, "--output", root / "assessment.json")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(json.loads((root / "assessment.json").read_bytes())["live_execution_allowed"])


if __name__ == "__main__":
    unittest.main()
