import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import closing
from unittest.mock import patch

from helpers import Fixture, signed_body
from zoora_community import research
from zoora_community.research_identity import fingerprint, verify_snapshot
from zoora_community.store import LIMITS, Store
from zoora_community.validation import Problem, canonical

ROOT = Path(__file__).resolve().parents[1]


class ResearchIdentityTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.ops = [self.f.operator("research_operator_" + str(i)) for i in range(5)]
        self.ids, self.tokens = [], []
        for i, op in enumerate([0, 1, 2, 3, 4, 0, 1, 0]):
            agent, token = self.f.agent(self.ops[op][1], "research_agent_" + str(i))
            self.ids.append(agent)
            self.tokens.append(token)

    def snapshot(self):
        return self.f.store.call(
            "POST", "/v1/research/ownership-snapshots", {"agents": self.ids}, self.f.owner
        )[1]

    def refused(self, code, call):
        with self.assertRaises(Problem) as error:
            call()
        self.assertEqual(error.exception.code, code)

    def template(self):
        return dict(
            config=dict(
                payment_caps=[100, 300, 1000], recovery=dict(trust=dict(operators=list(range(8))))
            ),
            policy="OWNER_RISK",
            actions=[],
        )

    def test_owner_export_verifies_operator_signatures_and_derives_mapping(self):
        s = self.snapshot()
        mapping = verify_snapshot(s, s["fingerprint"])
        self.assertEqual(mapping[0], mapping[5])
        self.assertEqual(mapping[0], mapping[7])
        self.assertNotEqual(mapping[0], mapping[1])
        self.assertEqual(len(s["operators"]), 5)
        self.assertEqual([r["agent_id"] for r in s["agents"]], self.ids)
        self.assertLess(len(canonical(s)), 512 * 1024)
        self.f.store.audit()

    def test_only_active_owner_can_export(self):
        for token, code in [
            (None, "UNAUTHORIZED"),
            (self.ops[0][1], "FORBIDDEN"),
            (self.tokens[0], "FORBIDDEN"),
        ]:
            self.refused(
                code,
                lambda token=token: self.f.store.call(
                    "POST", "/v1/research/ownership-snapshots", {"agents": self.ids}, token
                ),
            )

    def test_selection_bounds_duplicates_and_caller_supplied_owners_fail(self):
        values = [
            {"agents": self.ids[:7]},
            {"agents": self.ids * 9},
            {"agents": [self.ids[0]] * 8},
            {"agents": ["bad"] * 8},
            {"agents": self.ids, "operators": [0] * 8},
            {"agents": "all"},
        ]
        for value in values:
            with self.subTest(value=value):
                with self.assertRaises(Problem):
                    self.f.store.call(
                        "POST", "/v1/research/ownership-snapshots", value, self.f.owner
                    )

    def test_inactive_profile_is_not_exported(self):
        self.f.store.call("PATCH", "/v1/agents/" + self.ids[0], {"active": False}, self.ops[0][1])
        self.refused("AGENT_INACTIVE", self.snapshot)

    def test_suspension_blocks_new_export_without_rewriting_historical_snapshot(self):
        s = self.snapshot()
        self.f.store.call(
            "POST",
            "/v1/operators/" + self.ops[0][0] + "/suspend",
            {"reason": "Test hold"},
            self.f.owner,
        )
        self.refused("ACCESS_SUSPENDED", self.snapshot)
        self.assertEqual(verify_snapshot(s, s["fingerprint"])[0], s["operator_indices"][0])

    def test_historical_operator_proof_survives_credential_rotation(self):
        before = self.snapshot()
        self.f.store.call("POST", "/v1/credentials/rotate", {}, self.ops[0][1])
        after = self.snapshot()
        self.assertEqual(
            before["agents"][0]["affiliation_proof"], after["agents"][0]["affiliation_proof"]
        )
        verify_snapshot(after)

    def test_rename_does_not_rewrite_signed_original_handle(self):
        self.f.store.call(
            "PATCH", "/v1/agents/" + self.ids[0], {"handle": "research_renamed"}, self.tokens[0]
        )
        record = self.snapshot()["agents"][0]
        self.assertEqual(record["handle"], "research_renamed")
        self.assertEqual(record["affiliation_proof"]["profile"]["handle"], "research_agent_0")

    def test_agent_reproof_does_not_replace_operator_affiliation(self):
        before = self.snapshot()["agents"][0]["affiliation_proof"]["proof_id"]
        self.f.at += 1
        route = "/v1/agents/" + self.ids[0]
        challenge = self.f.store.call("POST", route + "/wallet-challenges", {}, self.tokens[0])[1]
        latest = self.f.store.call(
            "POST",
            route + "/wallet-proof",
            signed_body(challenge, "research_agent_0"),
            self.tokens[0],
        )[1]
        self.assertNotEqual(latest["proof_id"], before)
        self.assertEqual(self.snapshot()["agents"][0]["affiliation_proof"]["proof_id"], before)

    def test_missing_operator_proof_cannot_be_substituted_by_agent_proof(self):
        # A unit fixture emulates a legacy row with only an agent-authored proof.
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as c:
            c.execute(
                "UPDATE wallet_challenges SET consumed=0 WHERE id IN (SELECT challenge_id FROM wallet_proofs WHERE agent_id=?)",
                (self.ids[0],),
            )
            c.execute("DELETE FROM wallet_proofs WHERE agent_id=?", (self.ids[0],))
        route = "/v1/agents/" + self.ids[0]
        challenge = self.f.store.call("POST", route + "/wallet-challenges", {}, self.tokens[0])[1]
        self.f.store.call(
            "POST",
            route + "/wallet-proof",
            signed_body(challenge, "research_agent_0"),
            self.tokens[0],
        )
        self.refused("OPERATOR_SIGNED_AFFILIATION_REQUIRED", self.snapshot)

    def test_operator_reproof_binds_existing_agent_identifier(self):
        self.f.at += 1
        route = "/v1/agents/" + self.ids[0]
        challenge = self.f.store.call("POST", route + "/wallet-challenges", {}, self.ops[0][1])[1]
        self.f.store.call(
            "POST",
            route + "/wallet-proof",
            signed_body(challenge, "research_agent_0"),
            self.ops[0][1],
        )
        s = self.snapshot()
        self.assertEqual(s["agents"][0]["affiliation_proof"]["agent_binding"], self.ids[0])
        verify_snapshot(s)

    def test_rehashed_owner_and_instance_reassignment_break_signed_affiliation(self):
        original = self.snapshot()
        for label in [
            "owner",
            "instance",
            "credential",
            "nonce",
            "message",
            "signature",
            "proof-hash",
        ]:
            f = copy.deepcopy(original)
            p = f["agents"][0]["affiliation_proof"]
            if label == "owner":
                f["agents"][0]["operator_id"] = self.ops[1][0]
            elif label == "instance":
                f["instance_id"] = "a" * 32
            elif label == "credential":
                p["credential_id"] = "b" * 32
            elif label == "nonce":
                p["nonce"] = "c" * 64
            elif label == "message":
                p["message"] += " changed"
            elif label == "signature":
                p["signature"] = "A" * 88
            else:
                p["proof_sha256"] = "d" * 64
            f["fingerprint"] = fingerprint(f)
            with self.subTest(label=label), self.assertRaises(Problem):
                verify_snapshot(f, f["fingerprint"])

    def test_external_pin_protects_server_assigned_ids_not_in_enrollment_signature(self):
        s = self.snapshot()
        f = copy.deepcopy(s)
        f["agents"][0]["agent_id"] = "a" * 32
        f["fingerprint"] = fingerprint(f)
        # REGISTER_AGENT signed NEW, before the server allocated the UUID.
        verify_snapshot(f)
        self.refused("RESEARCH_SNAPSHOT_PIN_MISMATCH", lambda: verify_snapshot(f, s["fingerprint"]))

    def test_mapping_reordering_duplicate_wallet_and_unknown_fields_fail(self):
        s = self.snapshot()
        for label in ["mapping", "operators", "duplicate-wallet", "field", "slot", "time", "bound"]:
            f = copy.deepcopy(s)
            if label == "mapping":
                f["operator_indices"][0] = 99
            elif label == "operators":
                f["operators"].reverse()
            elif label == "duplicate-wallet":
                f["agents"][1] = copy.deepcopy(f["agents"][0])
                f["agents"][1].update(slot=1, agent_id="e" * 32)
            elif label == "field":
                f["agents"][0]["verified_person"] = True
            elif label == "slot":
                f["agents"][0]["slot"] = False
            elif label == "time":
                f["agents"][0]["affiliation_proof"]["verified_at_ms"] = f["exported_at_ms"] + 1
            else:
                f["agents"] *= 9
            f["fingerprint"] = fingerprint(f)
            with self.subTest(label=label), self.assertRaises(Problem):
                verify_snapshot(f)

    def test_selected_source_tampering_is_refused(self):
        s = self.snapshot()
        cred = s["agents"][0]["affiliation_proof"]["credential_id"]
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as c:
            c.execute("UPDATE credentials SET principal_id=? WHERE id=?", (self.ops[1][0], cred))
        self.refused("RESEARCH_SOURCE_CONSISTENCY_FAILURE", self.snapshot)

    def test_failed_audit_write_rolls_back_export(self):
        before = self.f.store.audit()
        with patch.object(self.f.store, "_event", side_effect=RuntimeError("injected")):
            with self.assertRaises(RuntimeError):
                self.snapshot()
        self.assertEqual(before, self.f.store.audit())

    def test_export_at_audit_capacity_is_refused(self):
        count = self.f.store.audit()["audit_events"]
        with patch.dict(LIMITS, audit=count):
            with self.assertRaises(Problem):
                self.snapshot()
        self.assertEqual(self.f.store.audit()["audit_events"], count)

    def test_concurrent_exports_keep_consistent_prefixes(self):
        results, errors = [], []

        def export():
            try:
                results.append(self.snapshot())
            except Exception as error:
                errors.append(error)

        threads = [threading.Thread(target=export) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)
        self.assertFalse(any(t.is_alive() for t in threads))
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        prefixes = sorted(s["audit_prefix"]["events"] for s in results)
        self.assertEqual(prefixes[1], prefixes[0] + 1)
        self.assertEqual(results[0]["operator_indices"], results[1]["operator_indices"])
        for s in results:
            verify_snapshot(s)
        self.f.store.audit()

    def test_restart_retains_same_affiliations(self):
        before = self.snapshot()
        self.f.store = Store(self.f.state, clock=lambda: self.f.at)
        after = self.snapshot()
        self.assertEqual(before["agents"], after["agents"])
        self.assertEqual(before["operator_indices"], after["operator_indices"])
        self.assertNotEqual(before["fingerprint"], after["fingerprint"])

    def test_snapshot_contains_no_raw_api_credentials(self):
        raw = canonical(self.snapshot())
        for token in [self.f.owner, *self.tokens, *(op[1] for op in self.ops)]:
            self.assertNotIn(token, raw)

    def test_bind_changes_only_owner_mapping_then_run_validation_requires_it(self):
        s, template = self.snapshot(), self.template()
        result = research.bind_input(s, template, replace=True)
        self.assertEqual(template["config"]["recovery"]["trust"]["operators"], list(range(8)))
        self.assertEqual(result["config"]["recovery"]["trust"]["operators"], s["operator_indices"])
        self.assertEqual(result["actions"], template["actions"])
        self.assertEqual(research.bind_input(s, result), result)
        self.refused(
            "RESEARCH_INPUT_OWNER_MAPPING_MISMATCH", lambda: research.bind_input(s, template)
        )

    def test_invalid_input_policy_actions_and_mapping_are_clean_errors(self):
        s = self.snapshot()
        good = research.bind_input(s, self.template(), replace=True)
        for label in ["policy", "actions", "mapping", "config", "field"]:
            value = copy.deepcopy(good)
            if label == "policy":
                value["policy"] = []
            elif label == "actions":
                value["actions"] = [{}] * 2049
            elif label == "mapping":
                value["config"]["recovery"]["trust"]["operators"][0] = True
            elif label == "config":
                value["config"]["recovery"] = None
            else:
                value["override"] = True
            with self.subTest(label=label), self.assertRaises(Problem):
                research.bind_input(s, value)

    def test_bind_cli_requires_pinned_snapshot_and_exclusive_output(self):
        folder = self.f.root
        s = self.snapshot()
        snapshot, source, output = (
            folder / "snapshot.json",
            folder / "input.json",
            folder / "bound.json",
        )
        research.publish(snapshot, s)
        research.publish(source, self.template())
        args = [
            sys.executable,
            "-m",
            "zoora_community.research",
            "bind",
            "--snapshot-file",
            str(snapshot),
            "--snapshot-fingerprint",
            s["fingerprint"],
            "--input-file",
            str(source),
            "--out",
            str(output),
        ]
        p = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=15)
        self.assertEqual(p.returncode, 0, p.stderr)
        raw = output.read_bytes()
        self.assertEqual(
            json.loads(raw)["config"]["recovery"]["trust"]["operators"], s["operator_indices"]
        )
        p = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=15)
        self.assertEqual(p.returncode, 1)
        self.assertNotIn("Traceback", p.stderr)
        self.assertEqual(raw, output.read_bytes())

    def bundle_fixture(self):
        snapshot = self.snapshot()
        value = research.bind_input(snapshot, self.template(), replace=True)
        bundle = dict(
            schema_version=1,
            model=research.MODEL,
            classification=research.CLASSIFICATION,
            snapshot=snapshot,
            input_sha256=hashlib.sha256(
                research.INPUT_DOMAIN + canonical(value).encode()
            ).hexdigest(),
            engine_sha256="1" * 64,
            run=dict(input=value),
        )
        bundle["fingerprint"] = fingerprint(bundle, research.BUNDLE_DOMAIN)
        return bundle

    def test_bundle_external_pin_prevents_rehashed_producer_metadata_change(self):
        bundle = self.bundle_fixture()
        original = bundle["fingerprint"]
        bundle["engine_sha256"] = "3" * 64
        bundle["fingerprint"] = fingerprint(bundle, research.BUNDLE_DOMAIN)
        with patch.object(research, "check_run") as native:
            self.refused(
                "RESEARCH_BUNDLE_PIN_MISMATCH",
                lambda: research.replay_bundle(
                    bundle, bundle["snapshot"]["fingerprint"], Path("unused"), "2" * 64, original
                ),
            )
            native.assert_not_called()

    def test_replay_can_use_a_different_separately_pinned_platform_binary(self):
        bundle = self.bundle_fixture()
        with patch.object(research, "check_run") as native:
            research.replay_bundle(
                bundle,
                bundle["snapshot"]["fingerprint"],
                Path("unused"),
                "2" * 64,
                bundle["fingerprint"],
            )
            native.assert_called_once()


class ResearchFileAndEngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def test_duplicate_json_and_non_regular_or_oversized_files_fail(self):
        path = self.folder / "input.json"
        path.write_bytes(b'{"a":1,"a":2}')
        with self.assertRaises(Problem):
            research.read_json(path, 32)
        with self.assertRaises(Problem):
            research.read_bytes(self.folder, 32)
        with self.assertRaises(Problem):
            research.read_bytes(path, 1)
        if sys.platform != "win32":
            link = self.folder / "link"
            link.symlink_to(path)
            with self.assertRaises(Problem):
                research.read_bytes(link, 32)

    def test_engine_requires_exact_trusted_digest(self):
        path = self.folder / "engine"
        path.write_bytes(b"known fixture binary bytes")
        with self.assertRaises(Problem):
            research.engine_path(path, "0" * 64)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(research.engine_path(path, digest), path)

    def test_failed_engine_timeout_and_os_error_are_clean_errors(self):
        for outcome in [
            subprocess.CompletedProcess([], 1),
            subprocess.TimeoutExpired([], 120),
            OSError("private detail"),
        ]:
            with self.subTest(outcome=type(outcome).__name__):
                kwargs = (
                    {"side_effect": outcome}
                    if isinstance(outcome, Exception)
                    else {"return_value": outcome}
                )
                with patch.object(research.subprocess, "run", **kwargs), self.assertRaises(Problem):
                    research.invoke(Path("test engine"), "owner-run", "input", "output")

    def test_invocation_uses_argument_list_without_shell_or_output_capture(self):
        with patch.object(
            research.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)
        ) as call:
            research.invoke(Path("engine with spaces"), "replay-owner", "file with spaces.json")
        args, kwargs = call.call_args
        self.assertEqual(args[0], ["engine with spaces", "replay-owner", "file with spaces.json"])
        self.assertNotIn("shell", kwargs)
        self.assertEqual(kwargs["stdout"], subprocess.DEVNULL)

    def test_unknown_bundle_schema_rejected_before_native_replay(self):
        with self.assertRaises(Problem):
            research.replay_bundle(
                {"schema_version": 2}, "0" * 64, Path("unused"), "0" * 64, "0" * 64
            )

    def test_output_bound_does_not_create_file(self):
        path = self.folder / "output.json"
        with self.assertRaises(Problem):
            research.publish(path, {"value": "x" * 32}, 8)
        self.assertFalse(path.exists())
