"""Ownership, transaction failure, rollback anchors and actual process-death recovery."""
from contextlib import closing
from copy import deepcopy
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from src.ecosystem_research import controller as c
from src.solana_research import coin_evidence as ev
from test_experience_learning import case, request, rules_for

ROOT = Path(__file__).resolve().parents[1]


class ControllerRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.rows = [case(1), case(2, target=0, features=[0, 0, 0, 0]), case(3, split="holdout", group="hold")]
        self.rules = rules_for(self.rows)
        self.plan = [{"id": "first", "clock": 30, "requests": [request(self.rows[0], self.rules)]},
                     {"id": "second", "clock": 40, "requests": [request(self.rows[1], self.rules)]},
                     {"id": "duplicate", "clock": 40, "requests": [request(self.rows[0], self.rules)] * 100},
                     {"id": "quarantine", "clock": 50, "requests": [request(self.rows[2], self.rules)]}]
        self.controller = c.ControlledJournal(self.folder / "journal.sqlite3", self.rules, self.plan, "a" * 64).initialize()
        self.genesis = self.controller.snapshot()["checkpoint"]

    def apply(self, index=0):
        before = self.controller.snapshot()["checkpoint"]
        with self.controller.acquire(before) as session:
            return session.apply(index, before)

    def packet(self, index=0, expected=None, recover=False):
        value = {"database": str(self.controller.path), "rules": self.rules, "plan": self.plan,
                 "upstream_sha256": "a" * 64, "expected": self.genesis if expected is None else expected,
                 "recover": recover, "index": index}
        path = self.folder / ("packet-" + str(time.monotonic_ns()) + ".json")
        ev.write(path, value)
        return path

    def worker(self, action, **kwargs):
        result = subprocess.run([sys.executable, "-I", "-B", str(ROOT / "scripts/ecosystem_controller_worker.py"),
                                 action, str(self.packet(**kwargs))], capture_output=True, timeout=20, check=False)
        return result

    def test_cold_process_commit_and_reopen(self):
        result = self.worker("apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.controller.snapshot()["state"]["cases"]), 1)
        self.assertEqual(self.controller.snapshot()["owner"], "")

    def test_second_handle_cannot_steal_owned_controller_even_with_recovery(self):
        with self.controller.acquire(self.genesis):
            for recover in (False, True):
                with self.assertRaisesRegex(ValueError, "BUSY"):
                    self.controller.acquire(self.genesis, recover=recover)

    def test_separate_process_owner_blocks_competing_writer_and_recovery(self):
        ready = self.folder / "ready.json"
        process = subprocess.Popen([sys.executable, "-I", "-B", str(ROOT / "scripts/ecosystem_controller_worker.py"),
                                    "hold", str(self.packet()), str(ready)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 15
            while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(ready.exists(), "cold-process owner did not acquire lock")
            self.assertTrue(self.controller.snapshot()["owner"])
            for recover in (False, True):
                with self.assertRaisesRegex(ValueError, "BUSY"):
                    self.controller.acquire(self.genesis, recover=recover)
            _, error = process.communicate(b"release\n", timeout=15)
            self.assertEqual(process.returncode, 0, error)
        finally:
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=15)
        self.assertEqual(self.controller.snapshot()["owner"], "")

    def test_death_before_commit_rolls_back_events_and_checkpoint_together(self):
        result = self.worker("die-before-commit")
        self.assertEqual(result.returncode, 73, result.stderr)
        with self.assertRaisesRegex(ValueError, "RECOVERY_REQUIRED"):
            self.controller.acquire(self.genesis)
        with self.controller.acquire(self.genesis, recover=True) as session:
            snapshot = self.controller.snapshot()
            self.assertEqual(snapshot["checkpoint"], self.genesis)
            self.assertEqual(snapshot["commits"], [])
            session.apply(0, self.genesis)
        self.assertEqual(len(self.controller.snapshot()["state"]["events"]), 1)

    def test_reader_observes_only_committed_snapshot_while_writer_is_paused(self):
        ready = self.folder / "uncommitted.json"
        process = subprocess.Popen([sys.executable, "-I", "-B", str(ROOT / "scripts/ecosystem_controller_worker.py"),
                                    "hold-before-commit", str(self.packet()), str(ready)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 15
            while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(ready.exists(), "writer did not reach uncommitted transaction")
            self.assertEqual(self.controller.snapshot()["checkpoint"], self.genesis)
            self.assertEqual(self.controller.snapshot()["state"]["events"], [])
            _, error = process.communicate(b"release\n", timeout=15)
            self.assertEqual(process.returncode, 0, error)
        finally:
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=15)
        self.assertEqual(len(self.controller.snapshot()["state"]["events"]), 1)

    def test_death_after_commit_retains_exactly_once_outcome_and_retry(self):
        result = self.worker("die-after-commit")
        self.assertEqual(result.returncode, 74, result.stderr)
        latest = self.controller.snapshot()["checkpoint"]
        with self.assertRaisesRegex(ValueError, "EXPECTED_CHECKPOINT"):
            self.controller.acquire(self.genesis, recover=True)
        with self.assertRaisesRegex(ValueError, "RECOVERY_REQUIRED"):
            self.controller.acquire(latest)
        with self.controller.acquire(latest, recover=True) as session:
            result = session.apply(0, self.genesis)
            self.assertTrue(result["duplicate"])
        self.assertEqual(self.controller.snapshot()["checkpoint"], latest)
        self.assertEqual(len(self.controller.snapshot()["state"]["events"]), 1)

    def test_acquisition_epoch_increases_across_clean_sessions(self):
        with self.controller.acquire(self.genesis) as first:
            first_epoch = first.epoch
        with self.controller.acquire(self.genesis) as second:
            self.assertGreater(second.epoch, first_epoch)
        with self.assertRaisesRegex(ValueError, "STALE_SESSION"):
            first.apply(0, self.genesis)

    def test_epoch_change_fences_existing_writer(self):
        session = self.controller.acquire(self.genesis)
        with closing(sqlite3.connect(self.controller.path)) as connection, connection:
            connection.execute("UPDATE controller_owner SET epoch=epoch+1")
        try:
            with self.assertRaisesRegex(ValueError, "FENCED_SESSION"):
                session.apply(0, self.genesis)
            with self.assertRaisesRegex(ValueError, "FENCED_SESSION"):
                session.close()
        finally:
            session.lock.close()
        self.assertEqual(self.controller.snapshot()["state"]["events"], [])

    def test_incorrect_compare_and_swap_and_out_of_order_batches_make_no_change(self):
        with self.controller.acquire(self.genesis) as session:
            for index, anchor in ((1, self.genesis), (0, {**self.genesis, "sha256": "f" * 64})):
                with self.assertRaisesRegex(ValueError, "COMPARE_AND_SWAP"):
                    session.apply(index, anchor)
        self.assertEqual(self.controller.snapshot()["checkpoint"], self.genesis)

    def test_old_anchor_cannot_resume_an_advanced_database(self):
        self.apply()
        with self.assertRaisesRegex(ValueError, "EXPECTED_CHECKPOINT"):
            self.controller.acquire(self.genesis)

    def test_restored_old_database_is_rejected_by_external_latest_anchor(self):
        original = self.controller.path.read_bytes()
        self.apply()
        latest = self.controller.snapshot()["checkpoint"]
        self.controller.path.write_bytes(original)
        self.assertEqual(self.controller.snapshot()["checkpoint"], self.genesis)
        with self.assertRaisesRegex(ValueError, "EXPECTED_CHECKPOINT"):
            self.controller.acquire(latest)

    def test_rolled_back_events_without_checkpoints_are_rejected(self):
        self.apply()
        with closing(sqlite3.connect(self.controller.path)) as connection, connection:
            connection.execute("DELETE FROM events")
        with self.assertRaisesRegex(ValueError, "UNCHECKPOINTED_MEMORY"):
            self.controller.snapshot()

    def test_bypassing_controller_with_raw_journal_is_detected(self):
        self.controller.journal.admit_many(self.plan[0]["requests"], 30)
        with self.assertRaisesRegex(ValueError, "UNCHECKPOINTED_MEMORY"):
            self.controller.acquire(self.genesis)

    def test_sql_failure_after_event_insert_rolls_back_entire_batch(self):
        with closing(sqlite3.connect(self.controller.path)) as connection, connection:
            connection.execute("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON controller_commits "
                               "BEGIN SELECT RAISE(ABORT, 'checkpoint write failed'); END")
        with self.controller.acquire(self.genesis) as session:
            with self.assertRaisesRegex(sqlite3.IntegrityError, "checkpoint write failed"):
                session.apply(0, self.genesis)
        self.assertEqual(self.controller.snapshot()["checkpoint"], self.genesis)

    def test_growth_limit_failure_rolls_back_entire_batch(self):
        plan = [{"id": "large-quarantine", "clock": 30, "requests": [{"junk": "x" * 100000}]}]
        journal = c.ControlledJournal(self.folder / "large.sqlite3", self.rules, plan, "a" * 64).initialize()
        before = journal.snapshot()["checkpoint"]
        with journal.acquire(before) as session:
            with patch.object(c.x, "MAX_DATABASE_BYTES", journal.path.stat().st_size + 4096):
                with self.assertRaisesRegex(ValueError, "DATABASE_BOUND"):
                    session.apply(0, before)
        self.assertEqual(journal.snapshot()["checkpoint"], before)

    def test_batch_retry_does_not_advance_checkpoint_or_memory(self):
        first = self.apply()["commit"]
        before = self.controller.snapshot()
        with self.controller.acquire(before["checkpoint"]) as session:
            retry = session.apply(0, self.genesis)
        self.assertEqual(retry, {"commit": first, "duplicate": True})
        after = self.controller.snapshot()
        self.assertEqual(after["checkpoint"], before["checkpoint"])
        self.assertEqual(after["state"], before["state"])

    def test_retry_requires_its_original_before_checkpoint(self):
        self.apply()
        latest = self.controller.snapshot()["checkpoint"]
        with self.controller.acquire(latest) as session:
            with self.assertRaisesRegex(ValueError, "RETRY_CHECKPOINT"):
                session.apply(0, latest)

    def test_duplicate_batch_gets_checkpoint_without_inflating_training(self):
        self.apply(0)
        self.apply(1)
        before = self.controller.snapshot()
        result = self.apply(2)
        after = self.controller.snapshot()
        self.assertTrue(all(r["status"] == "DUPLICATE" for r in result["commit"]["results"]))
        self.assertEqual(before["state"], after["state"])
        self.assertEqual(after["checkpoint"]["sequence"], 2)
        self.assertNotEqual(before["checkpoint"]["sha256"], after["checkpoint"]["sha256"])

    def test_holdout_quarantine_is_committed_without_training(self):
        for index in range(4):
            self.apply(index)
        state = self.controller.snapshot()["state"]
        self.assertEqual(len(state["cases"]), 2)
        self.assertEqual(state["events"][-1]["reason"], "HOLDOUT_NOT_TRAINABLE")

    def test_rehashed_false_checkpoint_is_rejected(self):
        self.apply()
        with closing(sqlite3.connect(self.controller.path)) as connection, connection:
            raw = connection.execute("SELECT body FROM controller_commits").fetchone()[0]
            value = ev.parse(raw.encode())
            value["after"]["events"] += 1
            value["sha256"] = c.lab.digest({k: v for k, v in value.items() if k != "sha256"})
            connection.execute("UPDATE controller_commits SET body=?", (ev.canonical(value),))
        with self.assertRaisesRegex(ValueError, "CHECKPOINT_REPLAY"):
            self.controller.snapshot()

    def test_checkpoint_numeric_types_cannot_be_replaced_by_equal_booleans(self):
        self.apply()
        with closing(sqlite3.connect(self.controller.path)) as connection, connection:
            value = ev.parse(connection.execute("SELECT body FROM controller_commits").fetchone()[0].encode())
            value["sequence"] = False
            connection.execute("UPDATE controller_commits SET body=?", (ev.canonical(value),))
        with self.assertRaisesRegex(ValueError, "CHECKPOINT_REPLAY"):
            self.controller.snapshot()

    def test_caller_anchor_numeric_types_are_strict(self):
        altered = deepcopy(self.genesis)
        altered["journal"]["events"] = False
        with self.assertRaisesRegex(ValueError, "ANCHOR_TYPES"):
            self.controller.acquire(altered)

    def test_different_plan_and_upstream_cannot_reinterpret_memory(self):
        changed = deepcopy(self.plan)
        changed[0]["requests"][0]["case"]["target"] ^= 1
        for plan, upstream in ((changed, "a" * 64), (self.plan, "b" * 64)):
            other = c.ControlledJournal(self.controller.path, self.rules, plan, upstream)
            with self.assertRaisesRegex(ValueError, "BINDING_CHANGED"):
                other.snapshot()

    def test_caller_mutation_cannot_change_plan_authority(self):
        self.plan[0]["requests"][0]["case"]["target"] ^= 1
        self.apply()
        self.assertEqual(next(iter(self.controller.snapshot()["state"]["cases"].values()))["target"], 1)

    def test_read_snapshot_does_not_change_database_bytes(self):
        self.apply()
        original = self.controller.path.read_bytes()
        self.controller.snapshot()
        self.assertEqual(self.controller.path.read_bytes(), original)
        self.assertFalse(Path(str(self.controller.path) + "-wal").exists())

    def test_clean_controller_does_not_accept_crash_recovery_flag(self):
        with self.assertRaisesRegex(ValueError, "RECOVERY_NOT_REQUIRED"):
            self.controller.acquire(self.genesis, recover=True)
        self.assertEqual(self.controller.snapshot()["epoch"], 0)

    def test_initialize_never_overwrites_an_existing_database(self):
        self.apply()
        original = self.controller.path.read_bytes()
        with self.assertRaises(FileExistsError):
            self.controller.initialize()
        self.assertEqual(self.controller.path.read_bytes(), original)

    def test_lock_file_is_retained_between_sessions(self):
        path = Path(str(self.controller.path) + ".lock")
        before = path.stat().st_ino
        self.apply()
        self.assertEqual(path.stat().st_ino, before)

    @unittest.skipUnless(os.name == "posix", "Windows commonly disallows replacing an open lock file")
    def test_replaced_lock_file_fails_closed_before_commit(self):
        session = self.controller.acquire(self.genesis)
        lock = Path(str(self.controller.path) + ".lock")
        lock.unlink()
        lock.write_bytes(b"\0")
        try:
            with self.assertRaisesRegex(ValueError, "LOCK_REPLACED"):
                session.apply(0, self.genesis)
            with self.assertRaisesRegex(ValueError, "LOCK_REPLACED"):
                session.close()
        finally:
            session.lock.close()

    def test_plan_bounds_and_clock_order_are_strict(self):
        for value in ([], self.plan * 9, [{**self.plan[0], "clock": True}],
                      [self.plan[1], self.plan[0]], [self.plan[0], self.plan[0]]):
            with self.assertRaises(ValueError):
                c.validate_plan(value)


if __name__ == "__main__":
    unittest.main()
