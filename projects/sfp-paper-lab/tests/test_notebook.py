"""Persistence, input lineage, concurrency, rollback and complete research-history checks."""

import base64
import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from helpers import csv_bytes, dataset, prefix, value
from test_study import fast_plan

from zoora_sfp.data import D, ResearchError, canonical, digest
from zoora_sfp.notebook import (
    _append,
    capture_csv,
    evaluate_notebook,
    load_notebook,
    notebook_status,
    open_notebook,
)
from zoora_sfp.notebook_reports import (
    history_rows,
    render_notebook,
    restore,
    snapshot,
    verify_notebook_export,
)
from zoora_sfp.reports import publish


class NotebookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bt007-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / "research.sqlite3"
        self.initial = prefix(260)
        self.plan = fast_plan(dataset(self.initial))
        self.opened = open_notebook(self.path, canonical(self.initial), self.plan)

    def append(self, end=305, start=259, changed=None):
        source = value() if changed is None else deepcopy(changed)
        source["bars"] = source["bars"][start:end]
        captured = source["bars"][-1]["available_ms"]
        return capture_csv(self.path, csv_bytes(source), captured)

    def test_open_retains_frozen_plan_and_original_bytes(self):
        state = load_notebook(self.path, self.opened["head_sha256"])
        self.assertEqual(state["artifacts"], [canonical(self.initial)])
        self.assertEqual(state["plan"], self.plan)
        self.assertEqual(notebook_status(state)["evaluation_status"], "REQUIRED")
        self.assertEqual(notebook_status(state)["evaluation_bars_already_present_at_open"], 0)
        if os.name != "nt":
            self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_existing_file_is_not_replaced(self):
        before = self.path.read_bytes()
        with self.assertRaisesRegex(ResearchError, "ALREADY_EXISTS"):
            open_notebook(self.path, canonical(self.initial), self.plan)
        self.assertEqual(before, self.path.read_bytes())

    def test_baseline_must_match_plan_and_availability_contract(self):
        with self.assertRaisesRegex(ResearchError, "BASELINE_MISMATCH"):
            open_notebook(self.root / "wrong.sqlite3", canonical(prefix(261)), self.plan)
        with self.assertRaisesRegex(ResearchError, "DECLARED_RECONSTRUCTION_DELAY"):
            open_notebook(self.root / "wrong.sqlite3", canonical(self.initial), self.plan, 1)
        changed = deepcopy(self.initial)
        changed["availability"] = "SOURCE_ASSERTED_RECEIPT"
        with self.assertRaisesRegex(ResearchError, "DECLARED_RECONSTRUCTION_DELAY"):
            open_notebook(self.root / "wrong.sqlite3", canonical(changed), self.plan)

    def test_capture_retains_raw_bytes_normalizes_prices_and_builds_lineage(self):
        result = self.append()
        state = load_notebook(self.path)
        receipt = result["receipt"]
        self.assertEqual((receipt["added_bars"], receipt["overlap_bars"], receipt["total_bars"]), (45, 1, 305))
        self.assertEqual(state["captures"][0]["raw_csv_bytes"], len(state["artifacts"][1]))
        self.assertEqual(state["dataset"].bars[:260], dataset(self.initial).bars)
        self.assertEqual(receipt["source_verification"], "UNAVAILABLE")
        self.assertNotEqual(state["dataset"].source_sha256, dataset(self.initial).source_sha256)

    def test_old_price_revision_is_rejected_without_an_event(self):
        changed = value()
        for key in ["open", "high", "low", "close"]:
            changed["bars"][259][key] = str(D(changed["bars"][259][key]) * 2)
        with self.assertRaisesRegex(ResearchError, "HISTORICAL_REVISION"):
            self.append(changed=changed)
        self.assertEqual(load_notebook(self.path)["head_sha256"], self.opened["head_sha256"])

    def test_missing_last_bar_overlap_is_rejected(self):
        with self.assertRaisesRegex(ResearchError, "LAST_BAR_OVERLAP"):
            self.append(start=260)

    def test_duplicate_capture_does_not_change_history(self):
        first = self.append()
        with self.assertRaisesRegex(ResearchError, "DUPLICATE_CAPTURE"):
            self.append()
        self.assertEqual(first["head_sha256"], load_notebook(self.path)["head_sha256"])

    def test_capture_time_must_advance_and_not_exceed_host_record_time(self):
        raw = csv_bytes(value())
        for stamp in [self.initial["captured_ms"], 253_402_300_799_000]:
            with self.subTest(stamp=stamp), self.assertRaisesRegex(ResearchError, "FUTURE_CAPTURE"):
                capture_csv(self.path, raw, stamp)

    def test_no_new_completed_bars_are_not_a_capture(self):
        with self.assertRaisesRegex(ResearchError, "NO_NEW_COMPLETED_BARS"):
            capture_csv(self.path, csv_bytes(self.initial), self.initial["captured_ms"] + 1)

    def test_unfinished_csv_rows_are_counted_and_excluded(self):
        source = value()
        source["bars"] = source["bars"][259:306]
        result = capture_csv(self.path, csv_bytes(source), source["bars"][-2]["available_ms"])
        self.assertEqual(result["receipt"]["unfinished_rows_excluded"], 1)
        self.assertEqual(result["receipt"]["total_bars"], 305)

    def test_gaps_stay_visible_and_later_backfills_are_rejected(self):
        changed = value()
        del changed["bars"][281]
        result = self.append(changed=changed, end=304)
        self.assertEqual(len(result["receipt"]["coverage_gaps"]), 1)
        source = value()
        source["bars"] = [source["bars"][281], source["bars"][304], source["bars"][305]]
        with self.assertRaisesRegex(ResearchError, "HISTORY_BACKFILL"):
            capture_csv(self.path, csv_bytes(source), source["bars"][-1]["available_ms"])
        evaluate_notebook(self.path)
        report = load_notebook(self.path)["evaluations"][-1]["report"]
        self.assertEqual(report["folds"][0]["test_coverage"]["status"], "INCOMPLETE")

    def test_failed_and_pending_results_survive_later_evaluations(self):
        evaluate_notebook(self.path)
        self.append()
        evaluate_notebook(self.path)
        before = load_notebook(self.path)
        first_completed = [t for t in before["evaluations"][-1]["report"]["trials"]
                           if t["fold"] == 0 and t["phase"] == "TEST"]
        self.append(end=380, start=304)
        evaluate_notebook(self.path)
        state = load_notebook(self.path, rerun=True)
        rows = history_rows(state)
        self.assertEqual([r["complete_folds"] for r in rows], [0, 1, 2])
        self.assertEqual([r["trials"] for r in rows], [6, 24, 42])
        self.assertTrue(all(r["failed_screens"] > 0 for r in rows))
        self.assertEqual(first_completed, [t for t in state["evaluations"][-1]["report"]["trials"]
                                          if t["fold"] == 0 and t["phase"] == "TEST"])
        self.assertEqual(notebook_status(state)["evaluation_status"], "CURRENT")
        self.assertEqual(state["plan"], self.plan)

    def test_same_evaluation_is_idempotent(self):
        result = evaluate_notebook(self.path)
        again = evaluate_notebook(self.path)
        self.assertEqual(again["status"], "EVALUATION_ALREADY_RECORDED")
        self.assertEqual(result["head_sha256"], again["head_sha256"])
        self.assertEqual(len(load_notebook(self.path)["events"]), 2)

    def test_stale_report_export_is_blocked_after_capture(self):
        evaluate_notebook(self.path)
        self.append()
        with self.assertRaisesRegex(ResearchError, "LATEST_DATA_NOT_EVALUATED"):
            render_notebook(load_notebook(self.path))

    def test_expected_head_detects_valid_but_truncated_notebook(self):
        self.append()
        head = load_notebook(self.path)["head_sha256"]
        with closing(sqlite3.connect(self.path)) as con, con:
            con.execute("DELETE FROM events WHERE seq=2")
        self.assertEqual(len(load_notebook(self.path)["events"]), 1)
        with self.assertRaisesRegex(ResearchError, "EXPECTED_HEAD_MISMATCH"):
            load_notebook(self.path, head)

    def test_raw_byte_and_row_deletion_tampering_are_detected(self):
        self.append()
        with closing(sqlite3.connect(self.path)) as con, con:
            con.execute("UPDATE events SET artifact=? WHERE seq=2", (b"edited",))
        with self.assertRaisesRegex(ResearchError, "EVENT_HASH"):
            load_notebook(self.path)

    def test_snapshot_rehash_does_not_bypass_input_or_accounting_checks(self):
        evaluate_notebook(self.path)
        state = load_notebook(self.path)
        snap = snapshot(state)
        report = json.loads(state["artifacts"][-1])
        report["funds_transferred"] = "1"
        raw = canonical(report)
        snap["artifacts_base64"][-1] = base64.b64encode(raw).decode()
        from zoora_sfp.notebook import event_record
        old = snap["events"][-1]
        snap["events"][-1] = event_record(old["seq"], old["kind"], old["recorded_ms"],
                                         old["previous_sha256"], old["metadata"], raw)
        with self.assertRaisesRegex(ResearchError, "UNSUPPORTED_FINANCIAL"):
            restore(snap)

    def test_concurrent_append_uses_a_checkpoint_compare_and_swap(self):
        state = load_notebook(self.path)
        self.append()
        with self.assertRaisesRegex(ResearchError, "EXPECTED_HEAD_MISMATCH"):
            # A valid stale proposal still cannot replace a more recent committed capture.
            _append(self.path, state, "CAPTURE", load_notebook(self.path)["events"][1]["metadata"],
                    load_notebook(self.path)["artifacts"][1])
        self.assertEqual(len(load_notebook(self.path)["events"]), 2)

    def test_sqlite_write_failure_rolls_back(self):
        with (patch("zoora_sfp.notebook._insert", side_effect=sqlite3.OperationalError("fault")),
              self.assertRaisesRegex(ResearchError, "SQLITE_OPERATION")):
            self.append()
        self.assertEqual(load_notebook(self.path)["head_sha256"], self.opened["head_sha256"])

    def test_clock_rollback_is_not_silently_relabelled(self):
        stamp = load_notebook(self.path)["events"][0]["recorded_ms"] - 1
        with (patch("zoora_sfp.notebook._clock", return_value=stamp),
              self.assertRaisesRegex(ResearchError, "LOCAL_CLOCK_MOVED_BACKWARDS")):
            self.append()

    def test_full_export_keeps_raw_history_and_verifies_independently_of_sqlite(self):
        evaluate_notebook(self.path)
        self.append(end=380)
        evaluate_notebook(self.path)
        state = load_notebook(self.path)
        folder = self.root / "export"
        publish(folder, render_notebook(state))
        result = verify_notebook_export(folder, state["head_sha256"], rerun=True)
        self.assertEqual((result["members_verified"], result["evaluations_verified"]), (9, 2))
        self.path.unlink()
        self.assertEqual(result, verify_notebook_export(folder, state["head_sha256"], rerun=True))
        self.assertIn("Event 2", (folder / "COMMUNITY_UPDATE.md").read_text())

    def test_export_hash_and_checkpoint_tampering_are_detected(self):
        evaluate_notebook(self.path)
        folder = self.root / "export"
        publish(folder, render_notebook(load_notebook(self.path)))
        with self.assertRaisesRegex(ResearchError, "EXPECTED_HEAD"):
            verify_notebook_export(folder, "0" * 64)
        with (folder / "audit.html").open("ab") as stream:
            stream.write(b"edited")
        with self.assertRaisesRegex(ResearchError, "EVIDENCE_HASH"):
            verify_notebook_export(folder)

    def test_semantic_export_mismatch_is_rejected_even_with_rehashed_manifest(self):
        evaluate_notebook(self.path)
        folder = self.root / "export"
        publish(folder, render_notebook(load_notebook(self.path)))
        raw = canonical(prefix(261))
        (folder / "dataset.json").write_bytes(raw)
        manifest = json.loads((folder / "manifest.json").read_bytes())
        from zoora_sfp.notebook import sha
        manifest["members"]["dataset.json"] = {"sha256": sha(raw), "bytes": len(raw)}
        manifest.pop("manifest_sha256")
        manifest["manifest_sha256"] = digest(manifest)
        (folder / "manifest.json").write_bytes(canonical(manifest))
        with self.assertRaisesRegex(ResearchError, "NOTEBOOK_EXPORT_MISMATCH"):
            verify_notebook_export(folder)

    def test_malformed_snapshot_schema_and_database_fail_closed(self):
        for bad in [None, {}, {"protocol": "fake", "events": [], "artifacts_base64": []}]:
            with self.subTest(value=bad), self.assertRaises(ResearchError):
                restore(bad)
        with closing(sqlite3.connect(self.path)) as con, con:
            con.execute("CREATE TABLE unwanted(value)")
        with self.assertRaisesRegex(ResearchError, "INVALID_NOTEBOOK_SCHEMA"):
            load_notebook(self.path)

    def test_symlink_notebook_is_rejected(self):
        link = self.root / "link.sqlite3"
        try:
            link.symlink_to(self.path)
        except OSError:
            self.skipTest("Host does not grant symbolic-link privileges")
        with self.assertRaisesRegex(ResearchError, "INVALID_NOTEBOOK_FILE"):
            load_notebook(link)

    def test_replay_requires_original_engine_fingerprint(self):
        evaluate_notebook(self.path)
        with (patch("zoora_sfp.notebook.code_fingerprint", return_value={"sha256": "0" * 64}),
              self.assertRaisesRegex(ResearchError, "REPLAY_ENGINE_BYTES_DIFFER")):
            load_notebook(self.path, rerun=True)

    def test_history_already_present_at_open_is_counted(self):
        complete = value()
        other = self.root / "already-present.sqlite3"
        open_notebook(other, canonical(complete), fast_plan(dataset(complete)))
        self.assertEqual(notebook_status(load_notebook(other))["evaluation_bars_already_present_at_open"], 103)

    def test_user_asserted_prices_do_not_become_verified_or_synthetic(self):
        observed = deepcopy(self.initial)
        observed["classification"] = "SOURCE_ASSERTED_OBSERVATIONS"
        observed["purpose"] = "USER_SUPPLIED_HISTORY_NOT_INDEPENDENTLY_VERIFIED"
        other = self.root / "asserted.sqlite3"
        open_notebook(other, canonical(observed), fast_plan(dataset(observed)))
        capture_csv(other, csv_bytes(value()), value()["captured_ms"])
        evaluate_notebook(other)
        status = notebook_status(load_notebook(other, rerun=True))
        self.assertEqual(status["classification"], "SOURCE_ASSERTED_OBSERVATIONS")
        self.assertEqual(status["source_verification"], "UNAVAILABLE")
        self.assertEqual(status["unseen_status"], "NOT_INDEPENDENTLY_ATTESTED")

    def test_actual_writer_lock_causes_a_clean_retriable_failure(self):
        with closing(sqlite3.connect(self.path)) as con:
            con.execute("BEGIN IMMEDIATE")
            with self.assertRaisesRegex(ResearchError, "SQLITE_OPERATION"):
                self.append()
            con.rollback()
        self.assertEqual(load_notebook(self.path)["head_sha256"], self.opened["head_sha256"])

    def test_event_and_stored_size_limits_fail_without_appending(self):
        with patch("zoora_sfp.notebook.MAX_EVENTS", 1), self.assertRaises(ResearchError):
            self.append()
        with (patch("zoora_sfp.notebook.MAX_STORED", 1),
              self.assertRaisesRegex(ResearchError, "NOTEBOOK_STORAGE_LIMIT")):
            load_notebook(self.path)
        self.assertEqual(load_notebook(self.path)["head_sha256"], self.opened["head_sha256"])

    def test_non_sqlite_file_is_a_bounded_error(self):
        bad = self.root / "bad.sqlite3"
        bad.write_bytes(b"not a database")
        with self.assertRaisesRegex(ResearchError, "SQLITE_OPERATION"):
            load_notebook(bad)

    def test_snapshot_does_not_confuse_boolean_and_integer_event_numbers(self):
        snap = snapshot(load_notebook(self.path))
        snap["events"][0]["seq"] = True
        with self.assertRaisesRegex(ResearchError, "EVENT_CHAIN"):
            restore(snap)

    def test_nonobject_export_manifest_is_a_bounded_error(self):
        evaluate_notebook(self.path)
        folder = self.root / "export"
        publish(folder, render_notebook(load_notebook(self.path)))
        for bad in [None, [], 7]:
            (folder / "manifest.json").write_bytes(canonical(bad))
            with self.subTest(value=bad), self.assertRaisesRegex(ResearchError, "INVALID_MANIFEST"):
                verify_notebook_export(folder)


if __name__ == "__main__":
    unittest.main()
