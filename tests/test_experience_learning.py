"""Persistent admission, replay resistance, information availability and retention gates."""
from copy import deepcopy
from contextlib import closing
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from src.ecosystem_research import behavior as b, experience as x
from src.multi_brain_research import training_lab as lab
from src.solana_research import coin_evidence as ev


def case(index, *, target=1, features=None, split="train", observed=None, resolved=None, group="family"):
    return {"id": f"case:{group}:{index}", "domain": "paper_trading", "classification": "SYNTHETIC_BEHAVIOR_TASK",
            "split": split, "group": group, "observed_at": index * 10 if observed is None else observed,
            "resolved_at": index * 10 + 5 if resolved is None else resolved,
            "features": [1, 0, 0, 0] if features is None else features, "target": target,
            "source_sha256": lab.digest(["source", group, index]),
            "outcome_sha256": lab.digest(["outcome", group, index, target]), "oracle": "unit_test_oracle"}


def rules_for(cases):
    receipt = {"origin_evidence_sha256": "a" * 64, "project_id": "b" * 32, "agent_id": "c" * 32,
               "job_id": "d" * 32, "artifact_id": "e" * 32, "report_sha256": "f" * 64, "domain": "paper_trading"}
    return x.policy({c["id"]: {"case_sha256": lab.digest(c), "receipt": deepcopy(receipt)} for c in cases}, ["receiver"])


def request(row, rules):
    return {"case": deepcopy(row), "receipt": deepcopy(rules["registry"][row["id"]]["receipt"]), "receiver": "receiver"}


class ExperienceJournalTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "experience.sqlite3"
        self.cases = [case(1), case(2, target=0, features=[0, 0, 0, 0]),
                      case(3, split="holdout", group="held"), case(20), case(22, target=0)]
        self.rules = rules_for(self.cases)
        self.journal = x.ExperienceJournal(self.path, self.rules).initialize()

    def admit(self, index=0, clock=100):
        return self.journal.admit_many([request(self.cases[index], self.rules)], clock)[0]

    def test_reopen_preserves_admitted_experience_and_audit_chain(self):
        self.admit(clock=30)
        first = self.journal.audit()
        reopened = x.ExperienceJournal(self.path, self.rules)
        self.assertEqual(reopened.audit(), first)
        reopened.admit_many([request(self.cases[1], self.rules)], 40)
        self.assertEqual(reopened.audit()["accepted"], 2)
        self.assertNotEqual(first["head_sha256"], reopened.audit()["head_sha256"])

    def test_one_hundred_duplicate_messages_do_not_inflate_confidence_or_events(self):
        self.admit(clock=30)
        before = self.journal.audit()
        values = self.journal.admit_many([request(self.cases[0], self.rules)] * 100, 100)
        self.assertTrue(all(v["status"] == "DUPLICATE" and not v["appended"] for v in values))
        self.assertEqual(self.journal.audit(), before)

    def test_feedback_availability_uses_admission_time_as_well_as_outcome_time(self):
        self.admit(clock=30)
        self.admit(index=1, clock=100)
        self.assertEqual(self.journal.training("paper_trading", 30), self.cases[:1])
        self.assertEqual(self.journal.training("paper_trading", 100), self.cases[:2])

    def test_unresolved_outcome_can_only_train_after_later_verified_delivery(self):
        self.assertEqual(self.admit(index=3, clock=100)["reason"], "OUTCOME_NOT_RESOLVED")
        self.assertEqual(self.journal.training("paper_trading", 100), [])
        self.assertEqual(self.admit(index=3, clock=210)["status"], "ACCEPTED")
        self.assertEqual(self.journal.training("paper_trading", 100), [])
        self.assertEqual(self.journal.training("paper_trading", 210), [self.cases[3]])

    def test_verified_holdout_labels_are_never_trainable(self):
        self.assertEqual(self.admit(index=2)["reason"], "HOLDOUT_NOT_TRAINABLE")
        self.assertEqual(self.journal.audit()["accepted"], 0)

    def test_modified_label_is_quarantined_even_with_original_provenance(self):
        value = request(self.cases[0], self.rules)
        value["case"]["target"] = 0
        result = self.journal.admit_many([value], 100)[0]
        self.assertEqual(result["reason"], "ORACLE_REPLAY_MISMATCH")
        self.assertEqual(self.journal.audit()["accepted"], 0)

    def test_fake_outcome_digest_and_renamed_case_cannot_create_new_evidence(self):
        for field, value in (("outcome_sha256", "0" * 64), ("id", "case:alias"), ("source_sha256", "1" * 64)):
            changed = request(self.cases[0], self.rules)
            changed["case"][field] = value
            result = self.journal.admit_many([changed], 100)[0]
            self.assertEqual(result["reason"], "ORACLE_REPLAY_MISMATCH")

    def test_wrong_producer_project_domain_and_report_bindings_are_rejected(self):
        for field in ("agent_id", "project_id", "domain", "report_sha256", "job_id", "artifact_id"):
            value = request(self.cases[0], self.rules)
            value["receipt"][field] = "forged"
            result = self.journal.admit_many([value], 100)[0]
            self.assertEqual(result["reason"], "RECEIPT_BINDING_MISMATCH")

    def test_unregistered_receiver_is_rejected(self):
        value = request(self.cases[0], self.rules)
        value["receiver"] = "unregistered_agent"
        self.assertEqual(self.journal.admit_many([value], 100)[0]["reason"], "RECEIVER_NOT_AUTHORIZED")

    def test_malformed_or_real_market_case_is_quarantined(self):
        for change in ({"target": True}, {"classification": "RPC_CAPTURE"}, {"features": [1]}, {"split": []}):
            value = request(self.cases[0], self.rules)
            value["case"].update(change)
            self.assertEqual(self.journal.admit_many([value], 100)[0]["reason"], "INVALID_CASE")

    def test_retry_of_rejected_message_is_idempotent(self):
        self.admit(index=2)
        before = self.journal.audit()
        self.assertFalse(self.admit(index=2)["appended"])
        self.assertEqual(self.journal.audit(), before)

    def test_clock_rewind_is_rejected_without_partial_changes(self):
        self.admit()
        before = self.journal.audit()
        with self.assertRaisesRegex(ValueError, "CLOCK_REWIND"):
            self.admit(index=1, clock=99)
        self.assertEqual(self.journal.audit(), before)

    def test_unobserved_future_cutoff_is_rejected(self):
        self.admit()
        with self.assertRaisesRegex(ValueError, "UNOBSERVED_CLOCK"):
            self.journal.training("paper_trading", 101)

    def test_rules_are_frozen_against_caller_mutation(self):
        self.rules["receivers"].append("attacker")
        self.rules["registry"][self.cases[0]["id"]]["receipt"]["agent_id"] = "attacker"
        frozen = self.journal.rules
        self.assertEqual(self.journal.admit_many([request(self.cases[0], frozen)], 100)[0]["status"], "ACCEPTED")
        self.assertEqual(frozen["receivers"], ["receiver"])

    def test_policy_cannot_grant_live_execution(self):
        self.rules["live_execution_allowed"] = True
        with self.assertRaisesRegex(ValueError, "POLICY_SCOPE"):
            x.ExperienceJournal(self.path, self.rules)

    def test_readonly_replay_does_not_change_database_bytes(self):
        self.admit()
        before = self.path.read_bytes()
        self.journal.audit()
        self.journal.training("paper_trading", 100)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse(Path(str(self.path) + "-wal").exists())

    def test_tampered_chain_hash_is_rejected(self):
        self.admit()
        with closing(sqlite3.connect(self.path)) as connection, connection:
            row = ev.parse(connection.execute("SELECT body FROM events").fetchone()[0].encode())
            row["sha256"] = "0" * 64
            connection.execute("UPDATE events SET body=?", (ev.canonical(row),))
        with self.assertRaisesRegex(ValueError, "CHAIN_HASH"):
            self.journal.audit()

    def test_rehashed_false_outcome_still_fails_oracle_replay(self):
        self.admit()
        with closing(sqlite3.connect(self.path)) as connection, connection:
            row = ev.parse(connection.execute("SELECT body FROM events").fetchone()[0].encode())
            row["request"]["case"]["target"] ^= 1
            row["sha256"] = lab.digest({k: v for k, v in row.items() if k != "sha256"})
            connection.execute("UPDATE events SET body=?", (ev.canonical(row),))
        with self.assertRaisesRegex(ValueError, "ADMISSION_REPLAY"):
            self.journal.audit()

    def test_changed_database_policy_binding_is_rejected(self):
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute("UPDATE metadata SET value=?", ("0" * 64,))
        with self.assertRaisesRegex(ValueError, "POLICY_BINDING"):
            self.journal.audit()

    def test_separate_handles_deduplicate_the_same_delivery(self):
        other = x.ExperienceJournal(self.path, self.rules)
        self.admit()
        result = other.admit_many([request(self.cases[0], self.rules)], 100)[0]
        self.assertEqual(result["status"], "DUPLICATE")
        self.assertEqual(other.audit()["accepted"], 1)

    def test_new_process_sees_every_committed_session(self):
        self.admit(clock=30)
        self.admit(index=1, clock=100)
        self.admit(index=3, clock=210)
        self.admit(index=4, clock=240)
        result = subprocess.run([sys.executable, "-I", "-c",
            "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute('SELECT COUNT(*) FROM events').fetchone()[0]); c.close()",
            str(self.path)], check=True, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.stdout.strip(), "4")

    def test_batch_bound_and_boolean_clock_fail_before_mutation(self):
        for requests, clock in (([request(self.cases[0], self.rules)] * (x.MAX_EVENTS + 1), 100),
                                ([request(self.cases[0], self.rules)], True)):
            with self.assertRaises(ValueError):
                self.journal.admit_many(requests, clock)
        self.assertEqual(self.journal.audit()["events"], 0)

    def test_same_source_cannot_be_counted_again_under_a_different_valid_identity(self):
        first, other = deepcopy(self.cases[0]), deepcopy(self.cases[0])
        other.update(id="second_identity", target=0)
        rules = rules_for([first, other])
        journal = x.ExperienceJournal(Path(self.temporary.name) / "conflict.sqlite3", rules).initialize()
        values = journal.admit_many([request(first, rules), request(other, rules)], 100)
        self.assertEqual(values[1]["reason"], "CONFLICTING_SOURCE")
        self.assertEqual(journal.audit()["accepted"], 1)

    def test_verified_contradiction_suppresses_existing_high_confidence_advisory(self):
        positive = [case(i, group="positive") for i in range(1, 5)]
        counterexample = case(22, target=0)
        rules = rules_for(positive + [counterexample])
        journal = x.ExperienceJournal(Path(self.temporary.name) / "drift.sqlite3", rules).initialize()
        journal.admit_many([request(c, rules) for c in positive], 100)
        model = b.fit("paper_trading", journal.training("paper_trading", 100), 100)
        self.assertEqual(b.predict(model, positive[0]["features"])["prediction"], 1)
        journal.admit_many([request(counterexample, rules)], 300)
        result = x.guarded_predict(model, positive[0]["features"], journal.audit())
        self.assertEqual(result["reason"], "CONTRADICTORY_VERIFIED_OUTCOMES")
        self.assertIsNone(result["prediction"])
        self.assertFalse(result["live_execution_allowed"])

    def test_quarantined_false_feedback_cannot_suppress_a_context(self):
        self.admit()
        value = request(self.cases[0], self.rules)
        value["case"]["target"] = 0
        self.journal.admit_many([value], 100)
        self.assertEqual(self.journal.audit()["blocked_contexts"]["paper_trading"], [])

    def test_guard_rejects_execution_enabled_projection(self):
        self.admit()
        model = b.fit("paper_trading", self.journal.training("paper_trading", 100), 100)
        audit = self.journal.audit()
        audit["live_execution_allowed"] = True
        with self.assertRaisesRegex(ValueError, "GUARD_SCOPE"):
            x.guarded_predict(model, [1, 0, 0, 0], audit)


def qualification_fixture():
    old = [case(i, target=i % 2, features=[i % 2, 0, 0, 0], group="old_train") for i in range(40)]
    retention = [case(1000 + i, target=i % 2, features=[i % 2, 0, 0, 0], split="holdout", group="retention") for i in range(20)]
    new = [case(2000 + i, target=i % 2, features=[i % 2, 1, 0, 0], group="new_train") for i in range(40)]
    future = [case(3000 + i, target=i % 2, features=[i % 2, 1, 0, 0], split="holdout", group="future") for i in range(20)]
    incumbent = b.fit("paper_trading", old, 9999)
    candidate = b.fit("paper_trading", old + new, 25000)
    return incumbent, candidate, old + new, retention, future


class ExperienceQualificationTests(unittest.TestCase):
    def test_new_contexts_improve_without_forgetting_prior_holdouts(self):
        value = x.evaluate(*qualification_fixture())
        self.assertTrue(value["eligible"])
        self.assertEqual(value["scores"]["baseline"]["future"]["balanced_accuracy_ppm"], 0)
        self.assertEqual(value["scores"]["candidate"]["future"]["balanced_accuracy_ppm"], 1000000)
        self.assertEqual(value["scores"]["candidate"]["retention"]["balanced_accuracy_ppm"], 1000000)

    def test_future_improvement_cannot_override_catastrophic_forgetting(self):
        incumbent, _, training, retention, future = qualification_fixture()
        old = training[:40]
        changed = [case(2000 + i, target=1 - i % 2, features=[i % 2, 0, 0, 0], group="changed_regime") for i in range(120)]
        for row in future:
            row["features"], row["target"] = [row["target"], 0, 0, 0], 1 - row["target"]
        candidate = b.fit("paper_trading", old + changed, 25000)
        value = x.evaluate(incumbent, candidate, old + changed, retention, future)
        self.assertEqual(value["candidate"]["balanced_accuracy_ppm"], 1000000)
        self.assertIn("RETENTION_REGRESSION", value["reasons"])
        self.assertFalse(value["eligible"])

    def test_forged_counts_are_rejected_even_when_training_digest_matches(self):
        values = list(qualification_fixture())
        for context in values[1]["contexts"].values():
            context["zero"], context["one"] = context["one"], context["zero"]
        with self.assertRaisesRegex(ValueError, "MODEL_RECONSTRUCTION"):
            x.evaluate(*values)

    def test_historical_holdout_reuse_is_rejected(self):
        values = list(qualification_fixture())
        values[4][0]["source_sha256"] = values[3][0]["source_sha256"]
        with self.assertRaisesRegex(ValueError, "EVALUATION_LEAKAGE"):
            x.evaluate(*values)

    def test_group_overlap_with_training_is_rejected(self):
        values = list(qualification_fixture())
        values[4][0]["group"] = values[2][0]["group"]
        with self.assertRaisesRegex(ValueError, "EVALUATION_LEAKAGE"):
            x.evaluate(*values)

    def test_candidate_cannot_have_seen_future_evaluation_time(self):
        values = list(qualification_fixture())
        values[1]["cutoff"] = 40000
        with self.assertRaisesRegex(ValueError, "EVALUATION_TIME"):
            x.evaluate(*values)

    def test_no_improvement_or_missing_classes_prevent_selection(self):
        values = list(qualification_fixture())
        for row in values[4]:
            row["features"] = [row["target"], 0, 0, 0]
        result = x.evaluate(*values)
        self.assertIn("NO_NEW_TASK_IMPROVEMENT", result["reasons"])
        values = list(qualification_fixture())
        for row in values[4]:
            row["target"] = 0
        self.assertIn("FUTURE_CLASS_SUPPORT", x.evaluate(*values)["reasons"])


if __name__ == "__main__":
    unittest.main()
