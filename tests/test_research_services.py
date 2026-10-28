"""Research orders, scarce work allowances and immutable evidence contracts."""

from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from src.ecosystem_research import services as s, scanner_feed as f, network as n
from src.solana_research import coin_evidence as ev
from feed_fixtures import NOW, record, rules

CONTROLLER = "b521bad111dab36cc42d20bcc29d041d25b4f7f2cbcb39261bf8b65280991ecd"
A = {"role": "AGENT", "principal_id": "a" * 32, "credential_id": "1" * 32}
B = {"role": "AGENT", "principal_id": "b" * 32, "credential_id": "2" * 32}
OP = {"role": "OPERATOR", "principal_id": "c" * 32, "credential_id": "3" * 32}
OTHER_OP = {"role": "OPERATOR", "principal_id": "d" * 32, "credential_id": "4" * 32}
OWNER = {"role": "OWNER", "principal_id": "owner", "credential_id": "5" * 32}


class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.journal = f.ObservationJournal(
            Path(cls.temp.name) / "feed.sqlite3", rules()
        ).initialize()
        cls.journal.append(record(), cls.journal.snapshot()["head_sha256"])
        bundle = ev.read(
            Path(__file__).parent / "fixtures/ecosystem-network-bundle.json"
        )
        cls.resources = s.Resources(
            bundle,
            CONTROLLER,
            cls.journal,
            cls.journal.snapshot()["head_sha256"],
            ev.digest(rules()),
        )

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.state, self.sequence = s.empty(), 0
        self.mandate = self.advance(
            OP,
            "MANDATE",
            {"operator_id": OP["principal_id"]},
            buyer_id=A["principal_id"],
            limit=10,
            expires_ms=NOW + 60000,
            services=sorted(s.KINDS),
        )
        self.listing = self.advance(
            B,
            "OFFER",
            {"provider_id": B["principal_id"], "project_id": "6" * 32},
            community_offer_id="7" * 32,
            service=s.KINDS[0],
            resource_sha256=self.resources.resource_id(s.KINDS[0]),
            work_units=6,
            expires_ms=NOW + 60000,
        )

    def command(self, kind, **fields):
        self.sequence += 1
        return {"request_id": format(self.sequence, "032x"), "kind": kind, **fields}

    def advance(self, actor, kind, facts=None, at=NOW, **fields):
        self.state, result = s.apply(
            self.state,
            actor,
            self.command(kind, **fields),
            at,
            {} if facts is None else facts,
            self.resources.catalog,
        )
        return result

    def order(self, **fields):
        return self.advance(
            A,
            "ORDER",
            mandate_id=self.mandate["id"],
            listing_id=self.listing["id"],
            terms_sha256=self.listing["terms_sha256"],
            start_before_ms=NOW + 30000,
            **fields,
        )

    def delivered(self):
        order = self.order()
        self.advance(B, "START", {"job_id": "8" * 32}, order_id=order["id"])
        report = self.resources.report(order, self.listing)
        sha = ev.sha(n.raw(report))
        self.advance(
            B,
            "DELIVER",
            {"artifact_id": "9" * 32},
            order_id=order["id"],
            report_sha256=sha,
        )
        return order, sha

    def accounting(self):
        return s.balance(self.state, self.state["mandates"][self.mandate["id"]])

    def test_order_reserves_without_claiming_payment(self):
        self.order()
        self.assertEqual(self.accounting()["reserved"], 6)
        self.assertEqual(self.accounting()["available"], 4)
        self.assertFalse(self.accounting()["financial_settlement"])
        self.assertEqual(self.accounting()["unit"], "NONMONETARY_WORK_UNITS")

    def test_second_order_cannot_oversubscribe_remaining_allowance(self):
        self.order()
        before = deepcopy(self.state)
        with self.assertRaisesRegex(ValueError, "ALLOWANCE_EXHAUSTED"):
            self.order()
        self.assertEqual(self.state, before)

    def test_start_and_delivery_keep_the_reservation(self):
        self.delivered()
        self.assertEqual(self.accounting()["reserved"], 6)
        self.assertEqual(self.accounting()["consumed"], 0)

    def test_acceptance_consumes_exactly_the_reserved_work(self):
        order, sha = self.delivered()
        self.advance(A, "ACCEPT", order_id=order["id"], report_sha256=sha)
        self.assertEqual(
            (
                self.accounting()["reserved"],
                self.accounting()["consumed"],
                self.accounting()["available"],
            ),
            (0, 6, 4),
        )

    def test_rejection_releases_allowance_but_retains_delivery(self):
        order, sha = self.delivered()
        self.advance(A, "REJECT", order_id=order["id"], report_sha256=sha)
        self.assertEqual(self.accounting()["available"], 10)
        self.assertEqual(self.state["orders"][order["id"]]["report_sha256"], sha)

    def test_provider_cannot_accept_its_own_delivery(self):
        order, sha = self.delivered()
        with self.assertRaisesRegex(ValueError, "ACTOR_FORBIDDEN"):
            self.advance(B, "ACCEPT", order_id=order["id"], report_sha256=sha)

    def test_changed_digest_cannot_accept_different_content(self):
        order, _ = self.delivered()
        with self.assertRaisesRegex(ValueError, "ACCEPTANCE_BINDING"):
            self.advance(A, "ACCEPT", order_id=order["id"], report_sha256="f" * 64)

    def test_acceptance_cannot_be_charged_twice(self):
        order, sha = self.delivered()
        self.advance(A, "ACCEPT", order_id=order["id"], report_sha256=sha)
        with self.assertRaisesRegex(ValueError, "ACCEPTANCE_BINDING"):
            self.advance(A, "ACCEPT", order_id=order["id"], report_sha256=sha)
        self.assertEqual(self.accounting()["consumed"], 6)

    def test_cancel_only_before_start(self):
        order = self.order()
        self.advance(A, "CANCEL", order_id=order["id"])
        self.assertEqual(self.accounting()["available"], 10)
        order = self.order()
        self.advance(B, "START", {"job_id": "8" * 32}, order_id=order["id"])
        with self.assertRaisesRegex(ValueError, "RESERVATION_HELD"):
            self.advance(A, "CANCEL", order_id=order["id"])

    def test_unknown_or_successful_job_is_not_a_failed_reservation(self):
        order = self.order()
        self.advance(B, "START", {"job_id": "8" * 32}, order_id=order["id"])
        for status in ("RUNNING", "SUCCEEDED", "UNKNOWN"):
            with self.assertRaisesRegex(ValueError, "RESERVATION_HELD"):
                self.advance(
                    A,
                    "ABORT_FAILED",
                    {"terminal_job_state": status},
                    order_id=order["id"],
                )

    def test_terminal_failure_releases_without_erasing_the_order(self):
        order = self.order()
        self.advance(B, "START", {"job_id": "8" * 32}, order_id=order["id"])
        self.advance(
            A,
            "ABORT_FAILED",
            {"terminal_job_state": "INTERRUPTED"},
            order_id=order["id"],
        )
        self.assertEqual(self.accounting()["available"], 10)
        self.assertEqual(self.state["orders"][order["id"]]["state"], "FAILED")

    def test_revoked_mandate_cannot_start_reserved_work(self):
        order = self.order()
        self.advance(OP, "REVOKE", mandate_id=self.mandate["id"])
        with self.assertRaisesRegex(ValueError, "START_NOT_AUTHORIZED"):
            self.advance(B, "START", {"job_id": "8" * 32}, order_id=order["id"])
        self.assertEqual(self.accounting()["reserved"], 6)

    def test_platform_owner_can_pause_but_not_impersonate_an_agent(self):
        self.advance(OWNER, "REVOKE", mandate_id=self.mandate["id"])
        with self.assertRaisesRegex(ValueError, "ACTOR_FORBIDDEN"):
            self.advance(
                OWNER,
                "ORDER",
                mandate_id=self.mandate["id"],
                listing_id=self.listing["id"],
                terms_sha256=self.listing["terms_sha256"],
                start_before_ms=NOW + 1000,
            )

    def test_foreign_operator_cannot_revoke_a_mandate(self):
        with self.assertRaisesRegex(ValueError, "ACTOR_FORBIDDEN"):
            self.advance(OTHER_OP, "REVOKE", mandate_id=self.mandate["id"])

    def test_expired_offer_and_mandate_do_not_admit_an_order(self):
        with self.assertRaisesRegex(ValueError, "AUTHORIZATION_EXPIRED"):
            self.advance(
                A,
                "ORDER",
                at=NOW + 60000,
                mandate_id=self.mandate["id"],
                listing_id=self.listing["id"],
                terms_sha256=self.listing["terms_sha256"],
                start_before_ms=NOW + 61000,
            )

    def test_expired_start_window_does_not_start_a_job(self):
        order = self.order()
        with self.assertRaisesRegex(ValueError, "START_NOT_AUTHORIZED"):
            self.advance(
                B, "START", {"job_id": "8" * 32}, at=NOW + 30000, order_id=order["id"]
            )

    def test_expiry_releases_at_exact_deadline_for_each_bound_party(self):
        initial = deepcopy(self.state)
        for actor in (A, B, OP):
            with self.subTest(role=actor["role"], who=actor["principal_id"]):
                self.state = deepcopy(initial)
                order = self.order()
                result = self.advance(
                    actor, "EXPIRE", at=NOW + 30000, order_id=order["id"]
                )
                self.assertEqual(result["state"], "EXPIRED")
                self.assertIsNone(result["job_id"])
                self.assertEqual(self.accounting()["available"], 10)
                self.assertEqual(self.accounting()["reserved"], 0)
                self.assertEqual(self.accounting()["consumed"], 0)

    def test_early_expiry_does_not_release_reserved_work(self):
        order = self.order()
        before = deepcopy(self.state)
        with self.assertRaisesRegex(ValueError, "EXPIRY_NOT_AUTHORIZED"):
            self.advance(A, "EXPIRE", at=NOW + 29999, order_id=order["id"])
        self.assertEqual(self.state, before)

    def test_expiry_forbids_owner_and_unrelated_agents_or_operators(self):
        order = self.order()
        stranger = {**A, "principal_id": "e" * 32}
        for actor in (OWNER, OTHER_OP, stranger):
            with self.subTest(actor=actor):
                before = deepcopy(self.state)
                with self.assertRaisesRegex(ValueError, "ACTOR_FORBIDDEN"):
                    self.advance(actor, "EXPIRE", at=NOW + 30000, order_id=order["id"])
                self.assertEqual(self.state, before)

    def test_expiry_never_releases_a_started_or_delivered_job(self):
        order, _ = self.delivered()
        delivered = deepcopy(self.state)
        for status in ("STARTED", "DELIVERED", "ACCEPTED", "REJECTED", "FAILED"):
            with self.subTest(status=status):
                self.state = deepcopy(delivered)
                self.state["orders"][order["id"]]["state"] = status
                before = deepcopy(self.state)
                with self.assertRaisesRegex(ValueError, "EXPIRY_NOT_AUTHORIZED"):
                    self.advance(OP, "EXPIRE", at=NOW + 60001, order_id=order["id"])
                self.assertEqual(self.state, before)

    def test_revocation_and_closed_offer_do_not_prevent_unused_expiry(self):
        order = self.order()
        self.advance(OP, "REVOKE", mandate_id=self.mandate["id"])
        self.advance(B, "CLOSE", listing_id=self.listing["id"])
        self.advance(OP, "EXPIRE", at=NOW + 60001, order_id=order["id"])
        self.assertEqual(self.accounting()["available"], 10)

    def test_expired_order_cannot_restart_or_release_twice(self):
        order = self.order()
        self.advance(B, "EXPIRE", at=NOW + 30000, order_id=order["id"])
        before = deepcopy(self.state)
        with self.assertRaisesRegex(ValueError, "START_NOT_AUTHORIZED"):
            self.advance(B, "START", {"job_id": "8" * 32}, at=NOW + 30000, order_id=order["id"])
        with self.assertRaisesRegex(ValueError, "EXPIRY_NOT_AUTHORIZED"):
            self.advance(A, "EXPIRE", at=NOW + 30001, order_id=order["id"])
        self.assertEqual(self.state, before)

    def test_closed_listing_is_not_reactivated_by_an_order(self):
        self.advance(B, "CLOSE", listing_id=self.listing["id"])
        with self.assertRaisesRegex(ValueError, "EXPIRED_OR_REVOKED"):
            self.order()

    def test_service_scope_and_quoted_terms_are_required(self):
        with self.assertRaisesRegex(ValueError, "TERMS_OR_SCOPE"):
            self.advance(
                A,
                "ORDER",
                mandate_id=self.mandate["id"],
                listing_id=self.listing["id"],
                terms_sha256="f" * 64,
                start_before_ms=NOW + 1000,
            )

    def test_boolean_prices_and_unbounded_lifetimes_fail(self):
        for units, expiry in ((True, NOW + 1000), (1, NOW + s.MAX_LIFETIME_MS + 1)):
            with self.assertRaises(ValueError):
                self.advance(
                    B,
                    "OFFER",
                    {"provider_id": B["principal_id"], "project_id": "6" * 32},
                    community_offer_id="f" * 32,
                    service=s.KINDS[0],
                    resource_sha256=self.resources.resource_id(s.KINDS[0]),
                    work_units=units,
                    expires_ms=expiry,
                )

    def test_malformed_commands_and_injected_identity_are_rejected(self):
        for value in (
            None,
            {"kind": []},
            {"kind": "CANCEL", "request_id": "1" * 32, "order_id": []},
            {
                "kind": "CANCEL",
                "request_id": "1" * 32,
                "order_id": "2" * 32,
                "actor": A,
            },
        ):
            with self.assertRaises(ValueError):
                s.command_value(value)

    def test_per_mandate_order_count_bounds_cancel_reuse(self):
        for _ in range(8):
            order = self.order()
            self.advance(A, "CANCEL", order_id=order["id"])
        with self.assertRaisesRegex(ValueError, "ORDER_BOUND"):
            self.order()

    def test_reports_and_job_requests_are_unique_per_order(self):
        order = self.order()
        first = self.resources.report(order, self.listing)
        self.advance(A, "CANCEL", order_id=order["id"])
        second_order = self.order()
        second = self.resources.report(second_order, self.listing)
        self.assertNotEqual(ev.sha(n.raw(first)), ev.sha(n.raw(second)))
        self.assertNotEqual(
            s.job_request(order, self.listing, self.resources)["request_id"],
            s.job_request(second_order, self.listing, self.resources)["request_id"],
        )
        self.assertFalse(first["current_market_claim"])
        self.assertFalse(first["financial_settlement"])

    def test_actual_guard_exercise_and_historical_scanner_report_have_distinct_scopes(
        self,
    ):
        model = self.resources.compute(s.KINDS[1])
        scanner = self.resources.compute(s.KINDS[0])
        self.assertEqual(model["queries"], 568)
        self.assertEqual(
            sum(v["blocked_contexts_suppressed"] for v in model["domains"].values()), 3
        )
        self.assertFalse(scanner["model_inference_performed"])
        self.assertFalse(scanner["training_performed"])
        self.assertEqual(scanner["evaluated_as_of_ms"], NOW)

    def test_resource_pins_and_empty_feeds_are_not_invented(self):
        with self.assertRaisesRegex(ValueError, "POLICY_PIN"):
            s.Resources(
                self.resources.bundle,
                CONTROLLER,
                self.journal,
                self.resources.head,
                "f" * 64,
            )
        with tempfile.TemporaryDirectory() as temporary:
            journal = f.ObservationJournal(
                Path(temporary) / "empty.sqlite3", rules()
            ).initialize()
            with self.assertRaisesRegex(ValueError, "EMPTY_FEED"):
                s.Resources(
                    self.resources.bundle,
                    CONTROLLER,
                    journal,
                    journal.snapshot()["head_sha256"],
                    ev.digest(rules()),
                )

    def test_changed_computation_cannot_silently_change_a_release(self):
        order = self.order()
        changed = deepcopy(self.resources.results[s.KINDS[0]])
        changed["live_execution_allowed"] = True
        with patch.object(self.resources, "compute", return_value=changed):
            with self.assertRaisesRegex(ValueError, "RESOURCE_CHANGED"):
                self.resources.report(order, self.listing)


if __name__ == "__main__":
    unittest.main()
