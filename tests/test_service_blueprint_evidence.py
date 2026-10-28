"""Contract fixtures never qualify as successful agent blueprints."""

from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from src.ecosystem_research import blueprint_evidence as be, blueprints as b, network as n, services as s
from src.solana_research import coin_evidence as ev
import test_service_blueprints as bt
import test_research_services as st


class BlueprintEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bt.BlueprintTests.setUpClass()
        cls.resources = bt.BlueprintTests.resources

    @classmethod
    def tearDownClass(cls):
        bt.BlueprintTests.tearDownClass()

    def setUp(self):
        self.events, self.audit_sequence = {"BLUEPRINT": [], "SERVICE": []}, 0
        for name, module in (("BLUEPRINT", b), ("SERVICE", s)):
            original = module.apply

            def recorded(*args, kind=name, apply=original, **kwargs):
                state, result = apply(*args, **kwargs)
                self.audit_sequence += 1
                entry = {"sequence": len(self.events[kind]), "audit_sequence": self.audit_sequence,
                         "actor": deepcopy(args[1]), "command": deepcopy(args[2]), "at_ms": args[3], "result": deepcopy(result)}
                entry["sha256"] = ev.digest(entry)
                self.events[kind].append(entry)
                return state, result

            mocked = patch.object(module, "apply", recorded)
            mocked.start()
            self.addCleanup(mocked.stop)
        self.engine = bt.BlueprintTests()
        self.engine.setUp()
        self.license = self.engine.acquire()
        self.listing = self.engine.state["listings"][self.license["listing_id"]]
        self.operators = {st.A["principal_id"]: st.OP["principal_id"], st.B["principal_id"]: st.OTHER_OP["principal_id"]}

    def delivery(self):
        current = self.engine.state["licenses"][self.license["id"]]
        return {"protocol": b.PROTOCOL, "license": deepcopy(current), "listing": b.descriptor(self.listing),
                "package": deepcopy(self.listing["package"]), "financial_settlement": False,
                "live_execution_allowed": False, "verification_scope": "PACKAGE_INTEGRITY_AND_REGISTERED_RECIPE"}

    def dossier(self, license_=True):
        current = self.engine.state["licenses"][self.license["id"]] if license_ else None
        return be.dossier(self.listing, current, self.engine.engine.state, self.resources.catalog,
                          ev.digest("blueprint-test-head"), ev.digest("service-test-head"), self.operators)

    def accepted(self):
        order = self.engine.trial()
        self.engine.accept(self.license, order)
        return order

    def capsule(self):
        order = self.accepted()
        return be.replay_package(self.delivery(), self.dossier(), self.history(), order, self.engine.engine.listing, self.resources)

    def history(self):
        license_ = self.engine.state["licenses"][self.license["id"]]
        record = self.dossier()
        return be.transcript(license_, record["blueprint_head_sha256"], record["service_head_sha256"],
                             self.events["BLUEPRINT"], self.events["SERVICE"])

    def replay(self, value, controller=st.CONTROLLER):
        return be.replay(value, ev.sha(n.raw(value)), controller)

    def rehash(self, value):
        value["sha256"] = ev.digest({key: field for key, field in value.items() if key != "sha256"})
        return value

    def test_recipe_with_no_experience_is_not_a_success_blueprint(self):
        value = self.dossier()
        self.assertEqual(value["track_record"]["orders"], 0)
        self.assertFalse(value["qualification"]["marketplace_eligible"])
        self.assertIn("NO_AGENT_DERIVATION_RECORD", value["qualification"]["blockers"])
        be.validate_dossier(value, self.delivery(), self.resources.catalog)

    def test_accepted_research_work_does_not_establish_learned_strategy_or_profit(self):
        self.accepted()
        value = self.dossier()
        self.assertEqual(value["track_record"]["states"]["ACCEPTED"], 1)
        self.assertEqual(value["track_record"]["consumed_work_units"], 6)
        self.assertEqual(value["track_record"]["distinct_completed_input_sets"], 1)
        self.assertFalse(value["qualification"]["success_verified"])
        self.assertFalse(value["qualification"]["profit_verified"])
        self.assertFalse(value["track_record"]["independent_people_verified"])
        be.validate_dossier(value, self.delivery(), self.resources.catalog)

    def test_other_versions_repeated_runs_failures_and_unfinished_orders_are_counted(self):
        order = self.accepted()
        state = self.engine.engine.state
        other = {**self.engine.engine.listing, "id": "c" * 32}
        state["listings"][other["id"]] = other
        for index, status in enumerate(be.STATES):
            copy = {**order, "id": format(100 + index, "032x"), "listing_id": other["id"], "state": status}
            state["orders"][copy["id"]] = copy
        value = self.dossier()
        self.assertEqual(value["track_record"]["orders"], 9)
        self.assertEqual(value["track_record"]["states"]["FAILED"], 1)
        self.assertEqual(value["track_record"]["states"]["REJECTED"], 1)
        self.assertEqual(value["track_record"]["distinct_completed_result_sets"], 1)
        self.assertEqual(len(value["trials"]), 1)
        be.validate_dossier(value, self.delivery(), self.resources.catalog)

    def test_unrelated_projects_providers_and_resources_do_not_pad_track_record(self):
        order = self.accepted()
        state = self.engine.engine.state
        other = {**self.engine.engine.listing, "id": "c" * 32, "resource_sha256": "f" * 64}
        state["listings"][other["id"]] = other
        for index, fields in enumerate(({"provider_id": "d" * 32}, {"project_id": "e" * 32}, {"listing_id": other["id"]})):
            copy = {**order, **fields, "id": format(200 + index, "032x")}
            state["orders"][copy["id"]] = copy
        self.assertEqual(self.dossier()["track_record"]["orders"], 1)

    def test_same_operator_acceptance_is_disclosed_and_not_independent_evidence(self):
        self.accepted()
        self.operators[st.A["principal_id"]] = self.operators[st.B["principal_id"]]
        value = self.dossier()
        self.assertEqual(value["track_record"]["same_operator_acceptances"], 1)
        self.assertFalse(value["track_record"]["independent_people_verified"])

    def test_listing_disclosure_does_not_expose_other_buyer_ids_or_report_bodies(self):
        order = self.accepted()
        value = self.dossier(license_=False)
        self.assertIsNone(value["license_id"])
        self.assertEqual(value["trials"], [])
        for private in (order["id"], order["buyer_id"], order["job_id"], order["artifact_id"], order["report_sha256"]):
            self.assertNotIn(private.encode(), n.raw(value))

    def test_seller_success_flags_and_unimplemented_formats_fail_closed(self):
        for fields in ({"performance_claim": "PROFITABLE"}, {"success_verified": True}, {"protocol": "AAI_RESEARCH_BLUEPRINT_V2"}):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                be.qualification({**self.listing["package"], **fields}, self.resources.catalog)

    def test_rehashed_authority_claims_are_rejected(self):
        for change in (lambda d: d["qualification"].update(success_verified=True),
                       lambda d: d["qualification"].update(marketplace_eligible=True),
                       lambda d: d.update(financial_settlement=True),
                       lambda d: d.update(independent_execution_attestation=True)):
            value = self.dossier()
            change(value)
            with self.assertRaisesRegex(ValueError, "EVIDENCE_BINDING"):
                be.validate_dossier(self.rehash(value), self.delivery(), self.resources.catalog)

    def test_rehashed_counts_duplicates_and_trial_substitutions_are_rejected(self):
        self.accepted()
        for change in (lambda d: d["track_record"].update(orders=2),
                       lambda d: d["track_record"].update(distinct_completed_input_sets=2),
                       lambda d: d["trials"][0].update(provider_id="f" * 32),
                       lambda d: d["trials"].clear(),
                       lambda d: d["track_record"]["states"].update(ACCEPTED=True)):
            value = self.dossier()
            change(value)
            with self.assertRaises(ValueError):
                be.validate_dossier(self.rehash(value), self.delivery(), self.resources.catalog)

    def test_portable_data_reproduces_actual_report_without_changing_source_journal(self):
        before = self.resources.journal.path.read_bytes()
        value = self.capsule()
        result = self.replay(value)
        self.assertTrue(result["report_reproduced"])
        self.assertEqual(result["records"], 1)
        self.assertEqual(result["source_attestation"], "SCANNER_SERVER_DECLARATIONS_NOT_INDEPENDENT")
        self.assertFalse(result["success_verified"])
        self.assertFalse(result["instructions_executed"])
        self.assertEqual(before, self.resources.journal.path.read_bytes())

    def test_external_file_and_controller_pins_are_required(self):
        value = self.capsule()
        with self.assertRaisesRegex(ValueError, "REPLAY_PIN"):
            be.replay(value, "f" * 64, st.CONTROLLER)
        with self.assertRaises(ValueError):
            self.replay(value, "f" * 64)

    def test_changed_data_report_and_model_fail_even_with_new_file_hash(self):
        original = self.capsule()
        for change in (lambda c: c["input_data"]["records"][0].update(captured_ms=1),
                       lambda c: c["report"].update(research_signal="BUY"),
                       lambda c: c["bundle"].update(live_execution_allowed=True),
                       lambda c: c["input_manifest"].update(order_id="e" * 32)):
            value = deepcopy(original)
            change(value)
            with self.assertRaises(ValueError):
                self.replay(value)

    def test_unregistered_trial_or_foreign_service_cannot_be_reproduced(self):
        original = self.capsule()
        for change in (lambda c: c["order"].update(id="e" * 32),
                       lambda c: c["service_listing"].update(provider_id="e" * 32),
                       lambda c: c["service_listing"].update(financial_settlement=True),
                       lambda c: c["order"].update(artifact_id=None)):
            value = deepcopy(original)
            change(value)
            with self.assertRaises(ValueError):
                self.replay(value)

    def test_rejected_delivery_remains_usable_data_without_becoming_success(self):
        order = self.engine.trial(target="DELIVERED")
        self.engine.engine.advance(st.A, "REJECT", order_id=order["id"], report_sha256=order["report_sha256"])
        order = self.engine.engine.state["orders"][order["id"]]
        value = be.replay_package(self.delivery(), self.dossier(), self.history(), order, self.engine.engine.listing, self.resources)
        result = self.replay(value)
        self.assertTrue(result["report_reproduced"])
        self.assertEqual(value["evidence"]["track_record"]["states"]["REJECTED"], 1)
        self.assertFalse(result["success_verified"])

    def test_outputs_retry_exactly_and_refuse_overwrites(self):
        value = self.capsule()
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "snapshot.json"
            be.save(path, value)
            be.save(path, value)
            before = path.read_bytes()
            with self.assertRaisesRegex(ValueError, "OUTPUT_CONFLICT"):
                be.save(path, {**value, "protocol": "CHANGED"})
            self.assertEqual(path.read_bytes(), before)
            self.assertTrue(be.replay_file(path, ev.sha(before), st.CONTROLLER)["report_reproduced"])

    def test_noncanonical_json_and_duplicate_keys_are_not_imported(self):
        value = self.capsule()
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "snapshot.json"
            for payload in (n.raw(value) + b"\n", b'{"protocol":1,"protocol":2}'):
                path.write_bytes(payload)
                with self.assertRaises(ValueError):
                    be.replay_file(path, ev.sha(payload), st.CONTROLLER)

    def test_transcript_has_recorded_time_actor_trial_and_local_event_references(self):
        self.accepted()
        value = self.history()
        self.assertEqual([e["action"] for e in value["entries"]], ["PUBLISH", "ACQUIRE", "ORDER", "TRIAL", "START", "DELIVER", "ACCEPT", "ACCEPT"])
        self.assertEqual({e["at_ms"] for e in value["entries"]}, {st.NOW})
        self.assertFalse(value["onchain_recorded"])
        be.validate_transcript(value, self.delivery(), self.dossier())

    def test_reordered_deleted_origin_wrong_actor_and_onchain_claim_fail(self):
        self.accepted()
        for change in (lambda t: t["entries"].reverse(), lambda t: t["entries"].pop(0),
                       lambda t: t["entries"][0].update(actor_id="f" * 32),
                       lambda t: t.update(onchain_recorded=True),
                       lambda t: t["entries"][1].update(at_ms=st.NOW - 1)):
            value = self.history()
            change(value)
            with self.assertRaises(ValueError):
                be.validate_transcript(self.rehash(value), self.delivery(), self.dossier())

    def test_operator_recovery_is_labelled_as_operator_action(self):
        order = self.engine.trial(target="OPEN")
        self.engine.engine.advance(st.OP, "EXPIRE", at=st.NOW + 30000, order_id=order["id"])
        value = self.history()
        self.assertEqual(value["entries"][-1]["actor_role"], "OPERATOR")
        be.validate_transcript(value, self.delivery(), self.dossier())

    def test_transcript_omits_other_licenses_and_unrelated_service_events(self):
        self.accepted()
        before = self.history()
        self.engine.publish(package={**self.engine.package, "version": 2})
        self.assertEqual(self.history(), before)


if __name__ == "__main__":
    unittest.main()
