"""Blueprint contracts against actual research resource and order semantics."""

from copy import deepcopy
import unittest

from src.ecosystem_research import blueprints as b, network as n
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
                                     b.facts_for(command, self.engine.state), self.resources.catalog)
        return result

    def publish(self, price=0, package=None):
        return self.act(st.B, "PUBLISH", service_listing_id=self.engine.listing["id"],
                        package=self.package if package is None else package, price_usd_cents=price)

    def acquire(self, listing=None):
        listing = self.publish() if listing is None else listing
        return self.act(st.A, "ACQUIRE", listing_id=listing["id"], terms_sha256=listing["terms_sha256"])

    def trial(self):
        order, sha = self.engine.delivered()
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
        order = self.engine.order()
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
        with self.assertRaisesRegex(ValueError, "TRIAL_ALREADY_USED"):
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


if __name__ == "__main__":
    unittest.main()
