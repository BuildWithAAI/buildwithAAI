"""Blueprint contracts against actual research resource and order semantics."""

from copy import deepcopy
import unittest

from src.ecosystem_research import blueprints as b, network as n, services as s
from src.multi_brain_research import training_lab as lab
from src.solana_research import coin_evidence as ev
import test_research_services as st


class BlueprintTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        st.ServiceTests.setUpClass()
        cls.resources = st.ServiceTests.resources

    @classmethod
    def tearDownClass(cls):
        st.ServiceTests.tearDownClass()

    def setUp(self):
        self.engine = st.ServiceTests()
        self.engine.setUp()
        self.state, self.serial = b.empty(), 0
        self.package = {
            "protocol": b.PACKAGE, "slug": "historical-scanner-review", "version": 1,
            "title": "Historical scanner review", "summary": "Replay a pinned research capture.",
            "instructions": "Run the registered scanner replay audit; preserve untrusted classifications.",
            "license_text": "Research use by the acquiring agent. No redistribution.",
            "recipe": {"service": self.engine.listing["service"],
                       "resource_sha256": self.engine.listing["resource_sha256"],
                       "catalog_sha256": self.resources.digest}, "performance_claim": "NONE",
        }

    def command(self, kind, **fields):
        self.serial += 1
        return {"kind": kind, "request_id": format(self.serial, "032x"), **fields}

    def act(self, actor, kind, **fields):
        command = self.command(kind, **fields)
        self.state, result = b.apply(self.state, actor, command, st.NOW,
                                     b.facts_for(command, self.engine.state, self.state), self.resources.catalog)
        return result

    def publish(self, price=0, package=None):
        return self.act(st.B, "PUBLISH", service_listing_id=self.engine.listing["id"],
                        package=self.package if package is None else package, price_usd_cents=price)

    def acquire(self, listing=None):
        listing = self.publish() if listing is None else listing
        return self.act(st.A, "ACQUIRE", listing_id=listing["id"], terms_sha256=listing["terms_sha256"])

    def trial(self, license_=None, target="ACCEPTED"):
        license_ = license_ or next(iter(self.state["licenses"].values()))
        current = self.state["licenses"][license_["id"]]
        command = self.command("TRIAL", license_id=license_["id"], package_sha256=license_["package_sha256"],
                               attempt=len(current["trial_orders"]) + 1, mandate_id=self.engine.mandate["id"], start_before_ms=st.NOW + 30000)
        request = b.trial_request(self.state, st.A["principal_id"], command, self.engine.state)
        self.engine.state, order = s.apply(self.engine.state, st.A, request, st.NOW, {}, self.resources.catalog)
        self.state, _ = b.apply(self.state, st.A, command, st.NOW,
                                b.facts_for(command, self.engine.state, self.state), self.resources.catalog)
        if target == "OPEN":
            return order
        self.engine.advance(st.B, "START", {"job_id": lab.digest(order["id"])[:32]}, order_id=order["id"])
        sha = ev.sha(n.raw(self.resources.report(order, self.engine.listing)))
        self.engine.advance(st.B, "DELIVER", {"artifact_id": lab.digest([order["id"], "artifact"])[:32]}, order_id=order["id"], report_sha256=sha)
        if target == "ACCEPTED":
            self.engine.advance(st.A, "ACCEPT", order_id=order["id"], report_sha256=sha)
        return self.engine.state["orders"][order["id"]]

    def accept(self, license_, trial):
        return self.act(st.A, "ACCEPT", license_id=license_["id"],
                        package_sha256=license_["package_sha256"], trial_order_id=trial["id"])

    def delivery(self):
        license_ = self.acquire()
        listing = self.state["listings"][license_["listing_id"]]
        return {"protocol": b.PROTOCOL, "license": license_, "listing": b.descriptor(listing),
                "package": deepcopy(self.package), "financial_settlement": False,
                "live_execution_allowed": False, "verification_scope": "PACKAGE_INTEGRITY_AND_REGISTERED_RECIPE"}

    def test_free_acquisition_then_actual_recipe_trial_acceptance(self):
        license_ = self.acquire()
        result = self.accept(license_, self.trial())
        self.assertEqual(result["state"], "ACCEPTED")
        self.assertFalse(result["financial_settlement"])
        self.assertEqual(self.engine.accounting()["consumed"], 6)

    def test_zero_one_and_five_thousand_dollar_quotes_are_exact(self):
        for version, cents in enumerate((0, 100, 500000), 1):
            listing = self.publish(cents, {**self.package, "version": version})
            self.assertEqual(listing["terms"]["price_usd_cents"], cents)
            self.assertEqual(listing["terms"]["settlement"], "FREE" if cents == 0 else "UNAVAILABLE")

    def test_paid_acquisition_does_not_create_license_or_reserve_work(self):
        listing = self.publish(500000)
        before, accounting = deepcopy(self.state), self.engine.accounting()
        with self.assertRaisesRegex(ValueError, "PAID_SETTLEMENT_UNAVAILABLE"):
            self.acquire(listing)
        self.assertEqual(self.state, before)
        self.assertEqual(self.engine.accounting(), accounting)

    def test_float_negative_boolean_and_unbounded_prices_fail(self):
        for price in (True, False, 1.5, -1, 10**12 + 1, "100"):
            with self.subTest(price=price), self.assertRaisesRegex(ValueError, "BLUEPRINT_INTEGER"):
                self.publish(price)

    def test_same_seller_cannot_replace_an_existing_version(self):
        self.publish()
        with self.assertRaisesRegex(ValueError, "VERSION_EXISTS"):
            self.publish(package={**self.package, "instructions": "Changed"})

    def test_new_version_and_price_preserve_existing_terms(self):
        license_ = self.acquire()
        original = deepcopy(self.state["listings"][license_["listing_id"]])
        newer = self.publish(500000, {**self.package, "version": 2})
        self.assertNotEqual(newer["terms_sha256"], license_["terms_sha256"])
        self.assertEqual(self.state["listings"][license_["listing_id"]], original)

    def test_discovery_omits_package_bodies(self):
        listing = self.publish()
        self.assertNotIn("package", listing)
        self.assertNotIn("instructions", listing)
        self.assertNotIn("license_text", listing)

    def test_seller_cannot_self_acquire(self):
        listing = self.publish()
        with self.assertRaisesRegex(ValueError, "SELF_ACQUISITION"):
            self.act(st.B, "ACQUIRE", listing_id=listing["id"], terms_sha256=listing["terms_sha256"])

    def test_duplicate_acquisition_is_not_another_customer(self):
        listing = self.publish()
        self.acquire(listing)
        with self.assertRaisesRegex(ValueError, "ALREADY_ACQUIRED"):
            self.acquire(listing)

    def test_close_blocks_new_acquisition_but_preserves_existing_license(self):
        listing = self.publish()
        license_ = self.acquire(listing)
        self.act(st.B, "CLOSE", listing_id=listing["id"])
        with self.assertRaisesRegex(ValueError, "LISTING_CLOSED"):
            self.acquire(listing)
        self.assertEqual(self.accept(license_, self.trial())["state"], "ACCEPTED")

    def test_other_agent_cannot_publish_someone_elses_service_or_close_listing(self):
        with self.assertRaisesRegex(ValueError, "PROVIDER_REQUIRED"):
            self.act(st.A, "PUBLISH", service_listing_id=self.engine.listing["id"], package=self.package, price_usd_cents=0)
        listing = self.publish()
        with self.assertRaisesRegex(ValueError, "PROVIDER_REQUIRED"):
            self.act(st.A, "CLOSE", listing_id=listing["id"])

    def test_owner_and_operator_cannot_impersonate_agents(self):
        for actor in (st.OP, st.OWNER):
            with self.subTest(actor=actor["role"]), self.assertRaisesRegex(ValueError, "AGENT_REQUIRED"):
                self.act(actor, "PUBLISH", service_listing_id=self.engine.listing["id"], package=self.package, price_usd_cents=0)

    def test_changed_terms_and_package_hash_are_rejected(self):
        listing = self.publish()
        with self.assertRaisesRegex(ValueError, "TERMS_CHANGED"):
            self.act(st.A, "ACQUIRE", listing_id=listing["id"], terms_sha256="f" * 64)
        license_, trial = self.acquire(listing), self.trial()
        with self.assertRaisesRegex(ValueError, "PACKAGE_CHANGED"):
            self.act(st.A, "ACCEPT", license_id=license_["id"], package_sha256="f" * 64, trial_order_id=trial["id"])

    def test_open_and_delivered_orders_do_not_establish_accepted_trial(self):
        license_ = self.acquire()
        order = self.trial(target="OPEN")
        with self.assertRaisesRegex(ValueError, "TRIAL_BINDING"):
            self.accept(license_, order)
        self.engine.state["orders"][order["id"]]["state"] = "DELIVERED"
        with self.assertRaisesRegex(ValueError, "TRIAL_BINDING"):
            self.accept(license_, order)

    def test_foreign_buyer_provider_project_and_listing_trials_fail(self):
        license_, trial = self.acquire(), self.trial()
        for field in ("buyer_id", "provider_id", "project_id", "listing_id"):
            saved = self.engine.state["orders"][trial["id"]][field]
            self.engine.state["orders"][trial["id"]][field] = "f" * 32
            command = self.command("ACCEPT", license_id=license_["id"], package_sha256=license_["package_sha256"], trial_order_id=trial["id"])
            facts = {"order": deepcopy(self.engine.state["orders"][trial["id"]]), "service_listing": self.engine.listing}
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "TRIAL_BINDING"):
                b.apply(self.state, st.A, command, st.NOW, facts, self.resources.catalog)
            self.engine.state["orders"][trial["id"]][field] = saved

    def test_one_trial_cannot_certify_multiple_versions(self):
        first, trial = self.acquire(), self.trial()
        self.accept(first, trial)
        second = self.acquire(self.publish(package={**self.package, "version": 2}))
        with self.assertRaisesRegex(ValueError, "TRIAL_NOT_REGISTERED"):
            self.accept(second, trial)

    def test_rejection_retains_license_and_cannot_later_accept(self):
        license_ = self.acquire()
        result = self.act(st.A, "REJECT", license_id=license_["id"])
        self.assertEqual(result["state"], "REJECTED")
        with self.assertRaisesRegex(ValueError, "ALREADY_DECIDED"):
            self.accept(license_, self.trial())

    def test_seller_cannot_accept_buyers_license(self):
        license_, trial = self.acquire(), self.trial()
        with self.assertRaisesRegex(ValueError, "BUYER_REQUIRED"):
            self.act(st.B, "ACCEPT", license_id=license_["id"], package_sha256=license_["package_sha256"], trial_order_id=trial["id"])

    def test_arbitrary_code_tools_and_claims_are_not_package_fields(self):
        for field in ("code", "tools", "profit", "credentials", "financial_settlement"):
            with self.subTest(field=field), self.assertRaises(ValueError):
                b.validate_package({**self.package, field: "injected"}, self.resources.catalog)
        with self.assertRaisesRegex(ValueError, "PACKAGE_SCOPE"):
            b.validate_package({**self.package, "performance_claim": "PROFITABLE"}, self.resources.catalog)

    def test_unknown_handler_and_wrong_resource_pins_fail(self):
        for field, value in (("service", "run-python"), ("resource_sha256", "f" * 64), ("catalog_sha256", "f" * 64)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                b.validate_package({**self.package, "recipe": {**self.package["recipe"], field: value}}, self.resources.catalog)

    def test_package_size_controls_and_slug_paths_fail(self):
        for field, value in (("instructions", "x" * 5001), ("license_text", "x" * 2001), ("title", "a\x00b"),
                             ("slug", "../../run"), ("slug", "HTTP://server"), ("version", True), ("version", 0)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                b.validate_package({**self.package, field: value}, self.resources.catalog)

    def test_delivery_verifies_exact_bytes_terms_and_buyer(self):
        value = self.delivery()
        license_ = value["license"]
        receipt = b.verify_delivery(value, license_["id"], st.A["principal_id"], license_["package_sha256"],
                                     license_["terms_sha256"], self.resources.catalog)
        self.assertEqual(receipt["bytes"], len(n.raw(self.package)))
        self.assertFalse(receipt["instructions_executed"])
        self.assertFalse(receipt["profit_verified"])

    def test_tampered_delivery_and_injected_authority_fail(self):
        original = self.delivery()
        license_ = original["license"]
        mutations = (("package", "instructions", "Changed"), ("package", "license_text", "Changed"),
                     ("license", "buyer_id", "f" * 32), ("listing", "provider_id", "f" * 32),
                     ("license", "live_execution_allowed", True), ("listing", "extra", True))
        for section, field, value in mutations:
            changed = deepcopy(original)
            changed[section][field] = value
            with self.subTest(section=section, field=field), self.assertRaises(ValueError):
                b.verify_delivery(changed, license_["id"], st.A["principal_id"], license_["package_sha256"],
                                  license_["terms_sha256"], self.resources.catalog)

    def test_rehashing_changed_payload_cannot_replace_external_pin(self):
        value = self.delivery()
        license_ = deepcopy(value["license"])
        value["package"]["instructions"] = "Changed"
        listing = value["listing"]
        listing["terms"] = b.terms(value["package"], listing["provider_id"], listing["project_id"], listing["service_listing_id"], 0)
        listing["terms_sha256"] = lab.digest(listing["terms"])
        value["license"]["package_sha256"] = ev.sha(n.raw(value["package"]))
        value["license"]["terms_sha256"] = listing["terms_sha256"]
        with self.assertRaisesRegex(ValueError, "DELIVERY_HASH"):
            b.verify_delivery(value, license_["id"], st.A["principal_id"], license_["package_sha256"],
                              license_["terms_sha256"], self.resources.catalog)

    def test_unknown_command_and_identity_injection_fail(self):
        for command in ({"kind": "PAY", "request_id": "a" * 32},
                        {"kind": "CLOSE", "request_id": "a" * 32, "listing_id": "b" * 32, "buyer_id": "c" * 32}):
            with self.assertRaises(ValueError):
                b.command_value(command)

    def next_request(self, license_, **changes):
        current = self.state["licenses"][license_["id"]]
        return self.command("TRIAL", **{
            "license_id": license_["id"], "package_sha256": license_["package_sha256"],
            "attempt": len(current["trial_orders"]) + 1, "mandate_id": self.engine.mandate["id"],
            "start_before_ms": st.NOW + 30000, **changes})

    def test_three_cancelled_trials_exhaust_lifetime_attempt_limit(self):
        license_ = self.acquire()
        for _ in range(3):
            order = self.trial(license_, "OPEN")
            self.engine.advance(st.A, "CANCEL", order_id=order["id"])
        with self.assertRaisesRegex(ValueError, "BLUEPRINT_INTEGER"):
            self.trial(license_, "OPEN")
        current = self.state["licenses"][license_["id"]]
        self.assertEqual(len(set(current["trial_orders"])), 3)
        self.assertEqual(self.engine.accounting()["available"], 10)
        self.assertEqual(b.trial_status(current, self.engine.state, {}, st.NOW)["phase"], "ATTEMPT_LIMIT_REACHED")

    def test_open_started_delivered_and_accepted_trials_block_another_attempt(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        for state in ("OPEN", "STARTED", "DELIVERED", "ACCEPTED"):
            self.engine.state["orders"][order["id"]]["state"] = state
            with self.subTest(state=state), self.assertRaisesRegex(ValueError, "PRIOR_TRIAL_UNRESOLVED"):
                b.trial_request(self.state, st.A["principal_id"], self.next_request(license_), self.engine.state)

    def test_only_released_terminal_orders_allow_an_explicit_retry(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        for state in b.RETRYABLE:
            self.engine.state["orders"][order["id"]]["state"] = state
            request = b.trial_request(self.state, st.A["principal_id"], self.next_request(license_), self.engine.state)
            self.assertEqual(request["mandate_id"], self.engine.mandate["id"])

    def test_attempt_numbers_cannot_skip_or_rewind(self):
        license_ = self.acquire()
        for attempt in (0, True, 2, 3, 4):
            with self.subTest(attempt=attempt), self.assertRaises(ValueError):
                b.trial_request(self.state, st.A["principal_id"], self.next_request(license_, attempt=attempt), self.engine.state)

    def test_trial_request_rejects_foreign_buyer_and_changed_package(self):
        license_ = self.acquire()
        with self.assertRaisesRegex(ValueError, "BUYER_REQUIRED"):
            b.trial_request(self.state, st.B["principal_id"], self.next_request(license_), self.engine.state)
        with self.assertRaisesRegex(ValueError, "PACKAGE_CHANGED"):
            b.trial_request(self.state, st.A["principal_id"], self.next_request(license_, package_sha256="f" * 64), self.engine.state)

    def test_decided_license_cannot_create_more_work(self):
        license_ = self.acquire()
        for state in ("REJECTED", "ACCEPTED"):
            self.state["licenses"][license_["id"]]["state"] = state
            with self.subTest(state=state), self.assertRaisesRegex(ValueError, "ALREADY_DECIDED"):
                b.trial_request(self.state, st.A["principal_id"], self.next_request(license_), self.engine.state)

    def test_stable_trial_command_binds_deadline_mandate_and_attempt(self):
        license_ = self.acquire()
        first = b.trial_request(self.state, st.A["principal_id"], self.next_request(license_), self.engine.state)
        other = b.trial_request(self.state, st.A["principal_id"], self.next_request(license_), self.engine.state)
        self.assertEqual(first, other)
        changed = b.trial_request(self.state, st.A["principal_id"], self.next_request(license_, start_before_ms=st.NOW + 20000), self.engine.state)
        self.assertEqual(first["request_id"], changed["request_id"])
        self.assertNotEqual(first, changed)  # Existing service idempotency rejects the changed body.

    def test_unregistered_accepted_service_order_cannot_accept_a_blueprint(self):
        license_ = self.acquire()
        order, sha = self.engine.delivered()
        self.engine.advance(st.A, "ACCEPT", order_id=order["id"], report_sha256=sha)
        with self.assertRaisesRegex(ValueError, "TRIAL_NOT_REGISTERED"):
            self.accept(license_, order)

    def test_delivery_rejects_duplicate_oversized_and_unbound_trial_history(self):
        original = self.delivery()
        license_ = original["license"]
        for trials in (["a" * 32] * 2, [format(i, "032x") for i in range(4)], ["invalid"]):
            value = deepcopy(original)
            value["license"]["trial_orders"] = trials
            with self.assertRaises(ValueError):
                b.verify_delivery(value, license_["id"], st.A["principal_id"], license_["package_sha256"], license_["terms_sha256"], self.resources.catalog)

    def test_readiness_distinguishes_request_wait_and_expiry_without_mutation(self):
        license_ = self.acquire()
        self.assertEqual(b.trial_status(license_, self.engine.state, {}, st.NOW)["phase"], "READY_TO_REQUEST")
        order = self.trial(license_, "OPEN")
        current = self.state["licenses"][license_["id"]]
        before = deepcopy(self.engine.state)
        waiting = b.trial_status(current, self.engine.state, {}, st.NOW)
        expired = b.trial_status(current, self.engine.state, {}, order["start_before_ms"])
        self.assertEqual(waiting["phase"], "WAITING_FOR_PROVIDER")
        self.assertEqual(expired["phase"], "EXPIRE_UNUSED_ORDER")
        self.assertEqual(waiting["reserved_work_units"], 6)
        self.assertFalse(waiting["authorization_granted"])
        self.assertFalse(waiting["automatic_retry"])
        self.assertEqual(self.engine.state, before)

    def test_started_job_status_does_not_release_uncertain_work(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        self.engine.state["orders"][order["id"]]["state"] = "STARTED"
        current = self.state["licenses"][license_["id"]]
        for job, phase in (("RUNNING", "WAITING_FOR_JOB"), ("QUEUED", "WAITING_FOR_JOB"),
                           ("SUCCEEDED", "PROVIDER_DELIVERY_RECOVERY"), ("FAILED", "RELEASE_FAILED_ORDER"),
                           ("EXPIRED", "RELEASE_FAILED_ORDER")):
            status = b.trial_status(current, self.engine.state, {order["id"]: job}, st.NOW)
            self.assertEqual(status["phase"], phase)
            self.assertEqual(status["reserved_work_units"], 6)

    def test_rejected_blueprint_still_exposes_outstanding_trial_allowance(self):
        license_ = self.acquire()
        self.trial(license_, "OPEN")
        rejected = self.act(st.A, "REJECT", license_id=license_["id"])
        status = b.trial_status(rejected, self.engine.state, {}, st.NOW)
        self.assertEqual(status["phase"], "REJECTED")
        self.assertEqual(status["reserved_work_units"], 6)

    def test_accepted_status_reports_actual_consumed_work_only(self):
        license_ = self.acquire()
        accepted = self.accept(license_, self.trial())
        status = b.trial_status(accepted, self.engine.state, {}, st.NOW)
        self.assertEqual(status["phase"], "ACCEPTED")
        self.assertEqual(status["consumed_work_units"], 6)
        self.assertEqual(status["reserved_work_units"], 0)

    def test_retry_keeps_the_same_existing_allowance_authority(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        self.engine.advance(st.A, "CANCEL", order_id=order["id"])
        self.engine.advance(st.OP, "REVOKE", mandate_id=self.engine.mandate["id"])
        with self.assertRaisesRegex(ValueError, "SERVICE_AUTHORIZATION_EXPIRED_OR_REVOKED"):
            self.trial(license_, "OPEN")
        self.assertEqual(len(self.state["licenses"][license_["id"]]["trial_orders"]), 1)

    def test_forged_order_identity_cannot_register_a_trial(self):
        license_ = self.acquire()
        command = self.next_request(license_)
        request = b.trial_request(self.state, st.A["principal_id"], command, self.engine.state)
        self.engine.state, _ = s.apply(self.engine.state, st.A, request, st.NOW, {}, self.resources.catalog)
        facts = b.facts_for(command, self.engine.state, self.state)
        facts["order"]["id"] = "f" * 32
        with self.assertRaisesRegex(ValueError, "TRIAL_BINDING"):
            b.apply(self.state, st.A, command, st.NOW, facts, self.resources.catalog)

    def test_accepted_delivery_requires_last_registered_trial(self):
        value = self.delivery()
        license_ = value["license"]
        accepted = self.accept(license_, self.trial())
        value["license"] = {**accepted, "trial_order_id": "f" * 32}
        with self.assertRaisesRegex(ValueError, "TRIAL_HISTORY"):
            b.verify_delivery(value, license_["id"], st.A["principal_id"], license_["package_sha256"],
                              license_["terms_sha256"], self.resources.catalog)

    def withdrawal(self, license_, order, resolution="CANCEL_UNUSED", **changes):
        return self.command("WITHDRAW", **{
            "license_id": license_["id"], "package_sha256": license_["package_sha256"],
            "trial_order_id": order["id"], "resolution": resolution,
            "delivery_sha256": order["report_sha256"] if resolution == "REJECT_DELIVERY" else None, **changes})

    def withdraw(self, command, terminal=None):
        prior = deepcopy(self.engine.state)
        request = b.withdrawal_request(self.state, st.A["principal_id"], command, prior)
        self.engine.state, _ = s.apply(prior, st.A, request, st.NOW,
            {"terminal_job_state": terminal} if terminal else {}, self.resources.catalog)
        facts = b.facts_for(command, self.engine.state, self.state, prior)
        self.state, result = b.apply(self.state, st.A, command, st.NOW + 1, facts, self.resources.catalog)
        return result, facts

    def test_withdraw_unused_trial_releases_work_and_rejects_license(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        result, facts = self.withdraw(self.withdrawal(license_, order))
        self.assertEqual(result["state"], "REJECTED")
        self.assertEqual(result["trial_orders"], [order["id"]])
        self.assertEqual(facts["order"]["state"], "CANCELLED")
        self.assertIsNone(facts["order"]["job_id"])
        self.assertEqual(self.engine.accounting()["reserved"], 0)
        self.assertEqual(self.engine.accounting()["consumed"], 0)

    def test_withdraw_delivered_trial_preserves_report_and_artifact(self):
        license_ = self.acquire()
        order = self.trial(license_, "DELIVERED")
        _, facts = self.withdraw(self.withdrawal(license_, order, "REJECT_DELIVERY"))
        self.assertEqual(facts["order"]["state"], "REJECTED")
        for key in ("artifact_id", "job_id", "report_sha256"):
            self.assertEqual(order[key], facts["order"][key])
        self.assertEqual(self.engine.accounting()["consumed"], 0)

    def test_withdraw_verified_failed_trial_preserves_prior_rejection_time(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        self.engine.advance(st.B, "START", {"job_id": "d" * 32}, order_id=order["id"])
        rejected = self.act(st.A, "REJECT", license_id=license_["id"])
        self.assertEqual(self.engine.accounting()["reserved"], order["work_units"])
        result, facts = self.withdraw(self.withdrawal(license_, order, "RELEASE_FAILED"), "CANCELLED")
        self.assertEqual(result["decided_ms"], rejected["decided_ms"])
        self.assertEqual(facts["order"]["terminal_job_state"], "CANCELLED")
        self.assertEqual(self.engine.accounting()["reserved"], 0)

    def test_withdraw_cannot_release_uncertain_or_successful_job(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        self.engine.advance(st.B, "START", {"job_id": "d" * 32}, order_id=order["id"])
        command = self.withdrawal(license_, order, "RELEASE_FAILED")
        before = deepcopy((self.state, self.engine.state))
        request = b.withdrawal_request(self.state, st.A["principal_id"], command, self.engine.state)
        for terminal in ("QUEUED", "RUNNING", "SUCCEEDED", "UNKNOWN", None):
            with self.subTest(terminal=terminal), self.assertRaises(ValueError):
                s.apply(self.engine.state, st.A, request, st.NOW, {"terminal_job_state": terminal}, self.resources.catalog)
        self.assertEqual(before, (self.state, self.engine.state))

    def test_withdraw_rejects_stale_trial_after_retry(self):
        license_ = self.acquire()
        old = self.trial(license_, "OPEN")
        self.engine.advance(st.A, "CANCEL", order_id=old["id"])
        self.trial(license_, "OPEN")
        with self.assertRaisesRegex(ValueError, "TRIAL_NOT_REGISTERED"):
            b.withdrawal_request(self.state, st.A["principal_id"], self.withdrawal(license_, old), self.engine.state)

    def test_withdraw_requires_exact_buyer_and_package(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        command = self.withdrawal(license_, order)
        with self.assertRaisesRegex(ValueError, "BUYER_REQUIRED"):
            b.withdrawal_request(self.state, st.B["principal_id"], command, self.engine.state)
        with self.assertRaisesRegex(ValueError, "PACKAGE_CHANGED"):
            b.withdrawal_request(self.state, st.A["principal_id"], {**command, "package_sha256": "f" * 64}, self.engine.state)

    def test_withdraw_unknown_resolution_and_inappropriate_report_pin_fail(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        command = self.withdrawal(license_, order)
        for value in (None, True, "REFUND", "STOP_JOB", [], {}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                b.command_value({**command, "resolution": value})
        with self.assertRaisesRegex(ValueError, "WITHDRAWAL_REPORT"):
            b.command_value({**command, "delivery_sha256": "f" * 64})

    def test_withdraw_delivery_requires_pinned_report(self):
        license_ = self.acquire()
        order = self.trial(license_, "DELIVERED")
        command = self.withdrawal(license_, order, "REJECT_DELIVERY")
        for pin in (None, "bad", "f" * 64):
            with self.subTest(pin=pin), self.assertRaises(ValueError):
                b.withdrawal_request(self.state, st.A["principal_id"], {**command, "delivery_sha256": pin}, self.engine.state)

    def test_withdraw_cannot_refund_accepted_work(self):
        license_ = self.acquire()
        order = self.trial(license_, "ACCEPTED")
        command = self.withdrawal(license_, order, "REJECT_DELIVERY")
        with self.assertRaisesRegex(ValueError, "WITHDRAWAL_STATE"):
            b.withdrawal_request(self.state, st.A["principal_id"], command, self.engine.state)
        self.accept(license_, order)
        with self.assertRaisesRegex(ValueError, "ALREADY_DECIDED"):
            b.withdrawal_request(self.state, st.A["principal_id"], command, self.engine.state)
        self.assertEqual(self.engine.accounting()["consumed"], order["work_units"])

    def test_withdraw_is_not_an_unbounded_new_request_noop(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        self.withdraw(self.withdrawal(license_, order))
        with self.assertRaisesRegex(ValueError, "WITHDRAWAL_STATE"):
            b.withdrawal_request(self.state, st.A["principal_id"], self.withdrawal(license_, order), self.engine.state)

    def test_withdraw_result_cannot_change_cost_identity_or_job(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        command = self.withdrawal(license_, order)
        original = deepcopy(self.state)
        _, facts = self.withdraw(command)
        for field, value in (("work_units", 0), ("id", "f" * 32), ("provider_id", "f" * 32), ("job_id", "f" * 32)):
            changed = deepcopy(facts)
            changed["order"][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "WITHDRAWAL_RESULT"):
                b.apply(original, st.A, command, st.NOW, changed, self.resources.catalog)

    def test_withdraw_forged_service_binding_is_rejected(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        command = self.withdrawal(license_, order)
        original = deepcopy(self.state)
        _, facts = self.withdraw(command)
        changed = deepcopy(facts)
        changed["service_listing"]["id"] = "f" * 32
        changed["prior_order"]["listing_id"] = changed["order"]["listing_id"] = "f" * 32
        with self.assertRaisesRegex(ValueError, "TRIAL_BINDING"):
            b.apply(original, st.A, command, st.NOW, changed, self.resources.catalog)

    def test_withdraw_missing_prior_history_and_unregistered_order_fail(self):
        license_ = self.acquire()
        order = self.engine.order()
        command = self.withdrawal(license_, order)
        with self.assertRaisesRegex(ValueError, "TRIAL_NOT_REGISTERED"):
            b.withdrawal_request(self.state, st.A["principal_id"], command, self.engine.state)
        with self.assertRaisesRegex(ValueError, "WITHDRAWAL_HISTORY"):
            b.facts_for(command, self.engine.state, self.state)

    def test_withdrawal_request_identity_is_bound_to_trial_and_resolution(self):
        license_ = self.acquire()
        order = self.trial(license_, "OPEN")
        command = self.withdrawal(license_, order)
        request = b.withdrawal_request(self.state, st.A["principal_id"], command, self.engine.state)
        same = b.withdrawal_request(self.state, st.A["principal_id"], {**command, "request_id": "f" * 32}, self.engine.state)
        self.assertEqual(request, same)
        self.assertEqual(request["kind"], "CANCEL")
        self.assertNotIn("report_sha256", request)

    def test_withdrawal_retains_delivery_and_blocks_new_trial(self):
        value = self.delivery()
        license_ = value["license"]
        order = self.trial(license_, "OPEN")
        result, _ = self.withdraw(self.withdrawal(license_, order))
        value["license"] = result
        receipt = b.verify_delivery(value, license_["id"], st.A["principal_id"], license_["package_sha256"],
                                    license_["terms_sha256"], self.resources.catalog)
        self.assertFalse(receipt["profit_verified"])
        with self.assertRaisesRegex(ValueError, "ALREADY_DECIDED"):
            b.trial_request(self.state, st.A["principal_id"], self.next_request(license_), self.engine.state)


if __name__ == "__main__":
    unittest.main()
