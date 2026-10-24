"""Pinned distribution, ancestry, capability limits and actual learned-model serving."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from src.ecosystem_research import behavior as b, network as n
from src.solana_research import coin_evidence as ev

FIXTURE = Path(__file__).parent / "fixtures/ecosystem-network-bundle.json"
ANCHOR = "b521bad111dab36cc42d20bcc29d041d25b4f7f2cbcb39261bf8b65280991ecd"
BUNDLE_SHA = "535a98a58723da59f310ae94ba7eb3d501f09dc5c9456cd446a226b82f413276"


def reseal(value):
    """Recompute the whole distribution chain, leaving the external trust anchor unchanged."""
    em, cm = value["experience_manifest"], value["controller_manifest"]

    def entry(manifest, name, item):
        manifest["files"][name] = {"sha256": ev.sha(n.raw(item)), "bytes": len(n.raw(item))}

    for domain, role in n.ROLES.items():
        entry(em, role + ".json", value["reports"][domain])
    entry(em, "sessions.json", value["sessions"])
    entry(em, "public-snapshot.json", value["experience_public"])
    ep_sha = ev.sha(n.raw(value["experience_public"]))
    value["controller_public"]["experience_public_snapshot_sha256"] = ep_sha
    value["controller_upstream"]["experience_public_snapshot_sha256"] = ep_sha
    value["controller_upstream"]["experience_manifest_sha256"] = ev.sha(n.raw(em))
    entry(cm, "upstream.json", value["controller_upstream"])
    entry(cm, "public-snapshot.json", value["controller_public"])
    return ev.sha(n.raw(cm))


class NetworkModelTests(unittest.TestCase):
    def setUp(self):
        self.bundle = n.read_bundle(FIXTURE, ANCHOR)

    def test_distribution_fixture_exact_bytes_and_external_anchor(self):
        self.assertEqual(ev.sha(FIXTURE.read_bytes()), BUNDLE_SHA)
        self.assertEqual(n.raw(self.bundle), FIXTURE.read_bytes())
        self.assertEqual(ev.sha(n.raw(self.bundle["controller_manifest"])), ANCHOR)

    def test_wrong_external_anchor_rejects_otherwise_valid_distribution(self):
        with self.assertRaisesRegex(ValueError, "CONTROLLER_PIN"):
            n.validate_bundle(self.bundle, "a" * 64)

    def test_transfer_preserves_all_four_selected_models(self):
        audit = n.validate_bundle(self.bundle, ANCHOR)
        self.assertEqual(audit["accepted"], 624)
        self.assertEqual(set(self.bundle["reports"]), set(b.DOMAINS))
        for domain, report in self.bundle["reports"].items():
            self.assertEqual(n.lab.digest(report["model"]), self.bundle["controller_public"]["active_models"][domain])

    def test_actual_advisory_query_matrix_and_three_suppressed_contexts(self):
        result = n.exercise(self.bundle, ANCHOR)
        self.assertEqual(result["queries"], 568)
        self.assertEqual(sum(d["blocked_contexts_suppressed"] for d in result["domains"].values()), 3)
        self.assertEqual(sum(d["advisories"] for d in result["domains"].values()), 107)
        self.assertEqual(sum(d["abstentions"] for d in result["domains"].values()), 461)
        self.assertFalse(result["live_execution_allowed"])

    def test_transferred_contradiction_guard_suppresses_every_blocked_context(self):
        audit = n.validate_bundle(self.bundle, ANCHOR)
        for domain, blocks in audit["blocked_contexts"].items():
            for digest in blocks:
                features = self.bundle["reports"][domain]["model"]["contexts"][digest]["features"]
                result = n.prediction(self.bundle, ANCHOR, domain, features)
                self.assertEqual(result["advisory"]["action"], "ABSTAIN")
                self.assertEqual(result["advisory"]["reason"], "CONTRADICTORY_VERIFIED_OUTCOMES")
                self.assertEqual(result["execution"], "DISABLED")

    def test_known_pattern_is_advisory_and_cannot_enable_execution(self):
        model = self.bundle["reports"]["code_review"]["model"]
        features = next(v["features"] for v in model["contexts"].values() if v["one"] >= 3)
        result = n.prediction(self.bundle, ANCHOR, "code_review", features)
        self.assertIsNotNone(result["advisory"]["prediction"])
        self.assertEqual(result["research_signal"], "ABSTAIN")
        self.assertFalse(result["live_execution_allowed"])

    def test_unknown_pattern_remains_unsupported(self):
        result = n.prediction(self.bundle, ANCHOR, "code_review", [-1] * b.WIDTH["code_review"])
        self.assertEqual(result["advisory"]["action"], "ABSTAIN")
        self.assertEqual(result["advisory"]["support"], 0)

    def test_serving_never_modifies_or_refits_source_models(self):
        before = n.raw(self.bundle)
        n.exercise(self.bundle, ANCHOR)
        n.prediction(self.bundle, ANCHOR, "paper_trading", [1, 0, 0, 0])
        self.assertEqual(n.raw(self.bundle), before)

    def test_features_reject_booleans_width_errors_and_out_of_range_values(self):
        for features in ([True, 0, 0, 0], [1], [2, 0, 0, 0], "1,0,0,0"):
            with self.assertRaises(ValueError):
                n.prediction(self.bundle, ANCHOR, "paper_trading", features)

    def test_changed_model_counts_reject_even_when_bundle_hash_is_recomputed(self):
        first = next(iter(self.bundle["reports"]["paper_trading"]["model"]["contexts"].values()))
        first["one"] += 1
        self.assertNotEqual(ev.sha(n.raw(self.bundle)), BUNDLE_SHA)
        with self.assertRaisesRegex(ValueError, "FILE_BINDING"):
            n.validate_bundle(self.bundle, ANCHOR)

    def test_entire_rehashed_ancestry_still_cannot_replace_the_external_anchor(self):
        first = next(iter(self.bundle["reports"]["paper_trading"]["model"]["contexts"].values()))
        first["one"] += 1
        changed_anchor = reseal(self.bundle)
        self.assertNotEqual(changed_anchor, ANCHOR)
        with self.assertRaisesRegex(ValueError, "CONTROLLER_PIN"):
            n.validate_bundle(self.bundle, ANCHOR)

    def test_changed_guard_history_cannot_cross_manifest_boundary(self):
        self.bundle["sessions"]["checkpoints"][-1]["audit"]["blocked_contexts"]["paper_trading"] = []
        with self.assertRaisesRegex(ValueError, "FILE_BINDING:sessions.json"):
            n.validate_bundle(self.bundle, ANCHOR)

    def test_wrong_selected_version_rejects_even_with_new_owner_approved_manifest(self):
        for public in (self.bundle["controller_public"], self.bundle["experience_public"]):
            public["active_models"]["paper_trading"] = "f" * 64
        changed_anchor = reseal(self.bundle)
        with self.assertRaisesRegex(ValueError, "SELECTED_MODEL"):
            n.validate_bundle(self.bundle, changed_anchor)

    def test_live_authority_is_rejected_even_after_all_hashes_are_recomputed(self):
        self.bundle["controller_public"]["live_execution_allowed"] = True
        changed_anchor = reseal(self.bundle)
        with self.assertRaisesRegex(ValueError, "ADVISORY_AUTHORITY"):
            n.validate_bundle(self.bundle, changed_anchor)

    def test_market_qualification_cannot_be_promoted_through_transport(self):
        for public in (self.bundle["controller_public"], self.bundle["experience_public"]):
            public["real_market_qualification"] = "READY"
        changed_anchor = reseal(self.bundle)
        with self.assertRaisesRegex(ValueError, "ADVISORY_AUTHORITY"):
            n.validate_bundle(self.bundle, changed_anchor)

    def test_live_mode_and_unknown_bundle_fields_are_rejected(self):
        for field, value in (("mode", "LIVE"), ("live_execution_allowed", True), ("execute", True)):
            bundle = deepcopy(self.bundle)
            bundle[field] = value
            with self.assertRaises(ValueError):
                n.validate_bundle(bundle, ANCHOR)

    def test_bundle_objects_cannot_be_replaced_with_array_or_scalar(self):
        for field in ("controller_manifest", "experience_manifest", "reports", "sessions"):
            for value in ([], None, True):
                bundle = deepcopy(self.bundle)
                bundle[field] = value
                with self.assertRaises(ValueError):
                    n.validate_bundle(bundle, ANCHOR)

    def test_scope_does_not_accept_integer_in_place_of_false(self):
        self.bundle["live_execution_allowed"] = 0
        with self.assertRaisesRegex(ValueError, "BUNDLE_SCOPE"):
            n.validate_bundle(self.bundle, ANCHOR)

    def test_receipt_byte_count_is_checked_independently_of_hash(self):
        self.bundle["experience_manifest"]["files"]["sessions.json"]["bytes"] += 1
        changed_anchor = reseal(self.bundle)
        # Resealing updates the true session size; change just its registered size again.
        self.bundle["experience_manifest"]["files"]["sessions.json"]["bytes"] += 1
        self.bundle["controller_upstream"]["experience_manifest_sha256"] = ev.sha(n.raw(self.bundle["experience_manifest"]))
        cm = self.bundle["controller_manifest"]
        up = n.raw(self.bundle["controller_upstream"])
        cm["files"]["upstream.json"] = {"sha256": ev.sha(up), "bytes": len(up)}
        changed_anchor = ev.sha(n.raw(cm))
        with self.assertRaisesRegex(ValueError, "FILE_BINDING:sessions.json"):
            n.validate_bundle(self.bundle, changed_anchor)

    def test_canonical_file_required_and_missing_file_never_falls_back(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bundle.json"
            path.write_bytes(n.raw(self.bundle).rstrip())
            with self.assertRaisesRegex(ValueError, "NOT_CANONICAL"):
                n.read_bundle(path, ANCHOR)
            with self.assertRaisesRegex(ValueError, "BUNDLE_FILE"):
                n.read_bundle(Path(folder) / "absent.json", ANCHOR)

    def test_oversized_distribution_is_rejected_before_parsing(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "large.json"
            path.write_bytes(b" " * (n.MAX_BYTES + 1))
            with self.assertRaisesRegex(ValueError, "BUNDLE_FILE"):
                n.read_bundle(path, ANCHOR)

    def test_pins_and_ids_cannot_be_empty_or_sample_names(self):
        for value in ("", "publisher", "A" * 32, None, [], True):
            with self.assertRaises(ValueError):
                n.identity(value)
        with self.assertRaises(ValueError):
            n.validate_bundle(self.bundle, "YOUR_HASH_HERE")

    def test_old_paginated_history_does_not_block_a_dedicated_queue(self):
        project = "b" * 32
        rows = [{"id": f"{i:032x}", "project_id": project, "state": "SUCCEEDED"} for i in range(1, 102)]
        rows[-1]["state"] = "QUEUED"

        class History:
            def request(self, method, path, *, token):
                self_test.assertEqual(method, "GET")
                if "after=" not in path:
                    return 200, {"items": rows[:100], "next_after": rows[99]["id"]}
                self_test.assertTrue(path.endswith(rows[99]["id"]))
                return 200, {"items": rows[100:], "next_after": None}

        self_test = self
        self.assertEqual(n.active_jobs(History(), "not-a-real-token", project), rows[-1:])

    def test_history_cursor_cannot_inject_another_route(self):
        class InvalidHistory:
            def request(self, *_args, **_kwargs):
                return 200, {"items": [{"id": "1" * 32, "project_id": "b" * 32, "state": "SUCCEEDED"}],
                             "next_after": "../secrets"}

        with self.assertRaises(ValueError):
            n.active_jobs(InvalidHistory(), "not-a-real-token", "b" * 32)


if __name__ == "__main__":
    unittest.main()
