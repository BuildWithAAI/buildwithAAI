"""Pinned record transport and read-only research readiness contracts."""

from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from src.ecosystem_research import service_evidence as e, scanner_feed as f, network as n, services as s
from src.solana_research import coin_evidence as ev
from feed_fixtures import NOW, record, report, rules

CATALOG, ORDER = "c" * 64, "d" * 32


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal = f.ObservationJournal(Path(self.temp.name) / "source.sqlite3", rules()).initialize()
        self.journal.append(record(), ev.digest(rules()))
        self.head = self.journal.snapshot()["head_sha256"]
        self.export = e.Export(self.journal, self.head, ev.digest(rules()))
        self.manifest = self.export.manifest(CATALOG, ORDER)

    def validate(self, value):
        return e.validate_manifest(value, CATALOG, ORDER, self.head, ev.digest(rules()))

    def client(self, change=None):
        outer = self

        class Client:
            calls = []

            def request(self, method, route, token=None):
                self.calls.append((method, route))
                outer.assertEqual(token, "unit-test-token")
                if route.endswith("/evidence"):
                    result = deepcopy(outer.manifest)
                else:
                    digest, index = route.rsplit("/", 2)[1:]
                    result = outer.export.chunk(CATALOG, ORDER, digest, int(index))
                return 200, change(result) if change else result

        return Client()

    def receive(self, client):
        return e.receive(client, "unit-test-token", CATALOG, ORDER, self.head, ev.digest(rules()))

    def test_transfer_replays_same_journal_and_cleans_temporary_files(self):
        before = self.journal.path.read_bytes()
        with self.receive(self.client()) as (restored, receipt):
            self.assertEqual(restored.snapshot(), self.journal.snapshot())
            self.assertEqual(receipt["mode"], "AUTHENTICATED_RECORD_TRANSFER")
            self.assertFalse(receipt["independent_source_attestation"])
            path = restored.path
        self.assertFalse(path.exists())
        self.assertEqual(self.journal.path.read_bytes(), before)

    def test_manifest_rejects_changed_external_pins_and_order(self):
        for key in ("catalog_sha256", "order_id", "feed_head_sha256", "feed_policy_sha256"):
            with self.subTest(key=key):
                bad = deepcopy(self.manifest)
                bad[key] = "f" * len(bad[key])
                with self.assertRaisesRegex(ValueError, "MANIFEST_BINDING"):
                    self.validate(bad)

    def test_oversized_manifest_is_rejected_before_chunks_are_fetched(self):
        def change(value):
            value["bytes"] = e.MAX_BYTES + 1
            return value
        client = self.client(change)
        with self.assertRaisesRegex(ValueError, "INTEGER"):
            with self.receive(client):
                self.fail("oversized transfer accepted")
        self.assertEqual(len(client.calls), 1)

    def test_manifest_rejects_duplicate_missing_reordered_and_wrong_sized_chunks(self):
        for mutate in (
            lambda m: m["chunks"].append(m["chunks"][0]),
            lambda m: m["chunks"].clear(),
            lambda m: m["chunks"][0].update(index=1),
            lambda m: m["chunks"][0].update(bytes=1),
            lambda m: m.update(records=True),
        ):
            bad = deepcopy(self.manifest)
            mutate(bad)
            with self.assertRaises(ValueError):
                self.validate(bad)

    def test_chunk_rejects_wrong_order_export_index_and_bytes(self):
        original = self.export.chunk(CATALOG, ORDER, self.export.sha, 0)
        for fields in ({"order_id": "f" * 32}, {"payload_sha256": "f" * 64},
                       {"index": True}, {"bytes": 1}, {"raw_base64": "eA=="}):
            with self.subTest(fields=fields):
                with self.assertRaises(ValueError):
                    e.decode_chunk({**original, **fields}, self.manifest, 0)

    def test_authority_and_unknown_fields_are_rejected(self):
        for fields in ({"financial_settlement": True}, {"live_execution_allowed": True},
                       {"download_url": "https://untrusted.invalid/"}):
            with self.assertRaises(ValueError):
                self.validate({**self.manifest, **fields})

    def test_changed_record_with_rehashed_transport_cannot_change_anchored_head(self):
        value = ev.parse(self.export.payload)
        value["records"][0]["captured_ms"] += 1
        payload = n.raw(value)
        manifest = {**self.manifest, "bytes": len(payload), "payload_sha256": ev.sha(payload)}
        with tempfile.TemporaryDirectory() as target:
            with self.assertRaisesRegex(ValueError, "EXPECTED_HEAD"):
                e.restore(payload, manifest, target)

    def test_noncanonical_and_database_bytes_are_not_imported(self):
        for payload in (self.export.payload + b" ", b"SQLite format 3\x00"):
            manifest = {**self.manifest, "bytes": len(payload), "payload_sha256": ev.sha(payload)}
            with tempfile.TemporaryDirectory() as target:
                with self.assertRaises(ValueError):
                    e.restore(payload, manifest, target)
                self.assertFalse((Path(target) / "observations.sqlite3").exists())

    def test_duplicate_records_do_not_masquerade_as_more_observations(self):
        value = ev.parse(self.export.payload)
        value["records"].append(value["records"][0])
        payload = n.raw(value)
        manifest = {**self.manifest, "bytes": len(payload), "payload_sha256": ev.sha(payload), "records": 2}
        with tempfile.TemporaryDirectory() as target:
            with self.assertRaisesRegex(ValueError, "DUPLICATE_RECORD"):
                e.restore(payload, manifest, target)

    def test_chunked_large_record_stays_below_existing_sdk_response_bound(self):
        value = report(NOW + 1)
        value["explicit_test_padding"] = "x" * 500000
        self.journal.append(record(NOW + 1, value), self.head)
        self.head = self.journal.snapshot()["head_sha256"]
        self.export = e.Export(self.journal, self.head, ev.digest(rules()))
        self.manifest = self.export.manifest(CATALOG, ORDER)
        self.assertGreater(len(self.manifest["chunks"]), 1)
        for index in range(len(self.manifest["chunks"])):
            self.assertLess(len(n.raw(self.export.chunk(CATALOG, ORDER, self.export.sha, index))), 1048576)
        with self.receive(self.client()) as (restored, _):
            self.assertEqual(restored.snapshot(), self.journal.snapshot())

    def test_failed_connection_is_not_replaced_by_local_or_synthetic_data(self):
        class Offline:
            def request(self, *args, **kwargs):
                raise OSError("offline")
        with self.assertRaises(OSError):
            with self.receive(Offline()):
                self.fail("failure replaced with fallback")


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        self.state = {"listings": {"l": {"active": True, "expires_ms": 200}},
                      "mandates": {"m": {"revoked": False, "expires_ms": 200}}}
        self.order = {"listing_id": "l", "mandate_id": "m", "provider_id": "p", "buyer_id": "b",
                      "state": "OPEN", "start_before_ms": 150}

    def check(self, *, who="p", at=100, job=None, available=True, queue=True):
        return s.readiness(self.state, self.order, who, at, job, available, queue)

    def test_open_order_is_ready_only_for_provider_and_without_consuming_state(self):
        before = deepcopy((self.state, self.order))
        self.assertEqual(self.check()["fulfill"], [])
        self.assertIn("DELIVERY_REQUIRED", self.check(who="b")["accept"])
        self.assertIn("PROVIDER_REQUIRED", self.check(who="b")["fulfill"])
        self.assertEqual((self.state, self.order), before)

    def test_expiry_revocation_offer_and_queue_are_all_reported(self):
        self.state["mandates"]["m"]["revoked"] = True
        self.assertEqual(set(self.check(at=150, available=False, queue=False)["fulfill"]),
                         {"MANDATE_REVOKED", "START_WINDOW_EXPIRED", "OFFER_UNAVAILABLE", "DEDICATED_QUEUE_REQUIRED"})

    def test_unknown_running_expired_or_failed_job_requires_recovery(self):
        self.order["state"] = "STARTED"
        for job in (None, "RUNNING", "EXPIRED", "FAILED", "CANCELLED", "INTERRUPTED"):
            self.assertIn("OPERATOR_RECOVERY_REQUIRED", self.check(job=job)["fulfill"])

    def test_completed_job_can_be_delivered_after_mandate_expiry(self):
        self.order["state"] = "STARTED"
        self.state["mandates"]["m"]["revoked"] = True
        self.assertEqual(self.check(at=300, job="SUCCEEDED", available=False)["fulfill"], [])

    def test_delivered_and_accepted_reports_can_be_accepted_by_bound_buyer(self):
        for state in ("DELIVERED", "ACCEPTED"):
            self.order["state"] = state
            self.assertEqual(self.check(who="b", at=300, job="SUCCEEDED")["accept"], [])
            self.assertIn("BUYER_REQUIRED", self.check(job="SUCCEEDED")["accept"])

    def test_expired_failed_cancelled_or_rejected_orders_are_blocked(self):
        for state in ("EXPIRED", "FAILED", "CANCELLED", "REJECTED"):
            self.order["state"] = state
            self.assertIn("ORDER_NOT_WORKABLE", self.check()["fulfill"])
            self.assertIn("DELIVERY_REQUIRED", self.check(who="b")["accept"])


class AssignmentTests(unittest.TestCase):
    def setUp(self):
        self.who, self.other = "a" * 32, "b" * 32
        self.view = {"orders": {}}
        for i, status in enumerate(("OPEN", "DELIVERED", "STARTED", "ACCEPTED", "EXPIRED", "FAILED")):
            key = format(i, "032x")
            self.view["orders"][key] = {"id": key, "state": status, "provider_id": self.who,
                                         "buyer_id": self.who if status == "DELIVERED" else self.other}

    def test_only_new_provider_work_and_delivered_buyer_work_are_selected(self):
        result = s.assignments(self.view, self.who, "both", 4)
        self.assertEqual([r["action"] for r in result], ["fulfill", "accept"])
        self.assertEqual(len(result), 2)

    def test_mode_and_limit_do_not_expand_authority(self):
        self.assertEqual(len(s.assignments(self.view, self.who, "both", 1)), 1)
        self.assertEqual([r["action"] for r in s.assignments(self.view, self.who, "provide", 4)], ["fulfill"])
        self.assertEqual([r["action"] for r in s.assignments(self.view, self.who, "accept", 4)], ["accept"])
        self.assertEqual(s.assignments(self.view, "c" * 32, "both", 4), [])

    def test_invalid_limits_modes_and_spoofed_order_keys_are_rejected(self):
        for limit in (0, 5, True, 1.0):
            with self.assertRaises(ValueError):
                s.assignments(self.view, self.who, "both", limit)
        with self.assertRaises(ValueError):
            s.assignments(self.view, self.who, "retry", 1)
        self.view["orders"]["0" * 32]["id"] = "f" * 32
        with self.assertRaisesRegex(ValueError, "WORK_ORDER_ID"):
            s.assignments(self.view, self.who, "both", 1)

    def test_selection_is_deterministic_and_does_not_change_orders(self):
        before = deepcopy(self.view)
        expected = s.assignments(self.view, self.who, "both", 4)
        reversed_view = {"orders": dict(reversed(list(self.view["orders"].items())))}
        self.assertEqual(s.assignments(reversed_view, self.who, "both", 4), expected)
        self.assertEqual(self.view, before)


if __name__ == "__main__":
    unittest.main()
