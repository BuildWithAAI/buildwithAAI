"""Payer autonomy, exact binding, uncertain outcomes, fees and replay boundaries."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from zoora_community.spending import AuthorityBook, ASSET, NETWORK, fingerprint, replay, run
from zoora_community.validation import Problem, canonical


def policy(**changes):
    return {"operator": "operator_one", "agents": ["agent_one", "agent_two"],
            "payees": ["builder", "compute_supplier"], "purposes": ["build", "compute"],
            "payment_limit": 100, "payment_budget": 150, "fee_budget": 10,
            "valid_from": 0, "expires": 20, **changes}


def quote(index=1, **changes):
    return {"purchase_id": f"{index:032x}", "invoice_id": f"{index + 100:032x}",
            "payer": "agent_one", "payee": "builder", "network": NETWORK, "asset": ASSET,
            "purpose": "build", "resource_sha256": "a" * 64, "amount": 60, "fee_cap": 4,
            "expires": 10, **changes}


def authorize(q=None, tick=0, actor=None):
    q = quote() if q is None else q
    return {"kind": "AUTHORIZE", "at_tick": tick, "actor": actor or q["payer"], "quote": q}


def action(kind, q=None, tick=1, actor=None, **extra):
    q = quote() if q is None else q
    value = {"kind": kind, "at_tick": tick, "actor": actor or q["payer"], "purchase_id": q["purchase_id"]}
    if kind in {"SUBMIT", "RESOLVE"}:
        value["binding_sha256"] = fingerprint(q)
    if kind == "RESOLVE":
        value.update(actor=actor or "fixture_adapter", receipt_id="f" * 32, outcome="SETTLED", actual_fee=2)
    return {**value, **extra}


class SpendingTests(unittest.TestCase):
    def setUp(self):
        self.book = AuthorityBook(policy())

    def apply(self, value):
        return self.book.apply(value)["outcome"]

    def refused(self, code, callback):
        with self.assertRaises(Problem) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)

    def test_authorized_agent_can_reserve_and_submit_without_further_controller_action(self):
        self.assertEqual(self.apply(authorize()), "AUTHORIZED")
        self.assertEqual(self.apply(action("SUBMIT")), "SIMULATED_SUBMISSION")
        self.assertEqual(self.book.totals()["payment_reserved"], 60)
        self.assertEqual(self.book.totals()["fee_reserved"], 4)
        self.assertEqual(self.book.totals()["payment_spent"], 0)

    def test_aliases_share_one_budget_and_cannot_submit_each_others_purchase(self):
        self.apply(authorize(quote(amount=100)))
        other = quote(2, payer="agent_two")
        self.assertEqual(self.apply(authorize(other)), "PAYMENT_BUDGET")
        self.assertEqual(self.apply(action("SUBMIT", quote(amount=100), actor="agent_two")), "ACTOR_MISMATCH")

    def test_unknown_outcome_holds_principal_and_fees_and_exact_retry_keeps_attempt(self):
        self.apply(authorize())
        self.apply(action("SUBMIT"))
        attempt = self.book.snapshot()["payments"][0]["attempt_id"]
        self.assertEqual(self.apply(action("RESOLVE", outcome="UNKNOWN", receipt_id=None, actual_fee=None)), "OUTCOME_STILL_RESERVED")
        self.assertEqual(self.apply(authorize(tick=1)), "REPLAY")
        self.assertEqual(self.apply(action("SUBMIT", tick=2)), "SAME_ATTEMPT")
        self.assertEqual(self.book.snapshot()["payments"][0]["attempt_id"], attempt)
        self.assertEqual(self.book.totals()["payment_reserved"], 60)

    def test_changed_amount_recipient_asset_network_and_resource_conflict(self):
        self.apply(authorize())
        for changes in ({"amount": 61}, {"payee": "compute_supplier"}, {"asset": "OTHER"},
                        {"network": "OTHER"}, {"resource_sha256": "b" * 64}, {"fee_cap": 5}):
            self.assertEqual(self.apply(authorize(quote(**changes))), "PURCHASE_CONFLICT")
        self.assertEqual(self.book.totals()["payment_reserved"], 60)

    def test_same_merchant_invoice_cannot_be_paid_using_another_purchase_id(self):
        self.apply(authorize())
        self.assertEqual(self.apply(authorize(quote(2, invoice_id=quote()["invoice_id"]))), "INVOICE_ALREADY_BOUND")

    def test_foreign_rails_unlisted_payees_purposes_and_actors_are_refused(self):
        for changes, reason in [({"network": "SOLANA_MAINNET"}, "RAIL_NOT_ALLOWED"),
                                ({"asset": "USDC"}, "RAIL_NOT_ALLOWED"),
                                ({"payee": "stranger"}, "PAYEE_NOT_ALLOWED"),
                                ({"purpose": "trade"}, "PURPOSE_NOT_ALLOWED"),
                                ({"payer": "stranger"}, "ACTOR_MISMATCH")]:
            self.assertEqual(self.apply(authorize(quote(**changes))), reason)
        self.assertEqual(len(self.book.records), 0)

    def test_individual_amount_and_separate_fee_budget_both_apply(self):
        self.assertEqual(self.apply(authorize(quote(amount=101))), "PAYMENT_LIMIT")
        self.assertEqual(self.apply(authorize(quote(fee_cap=11))), "FEE_BUDGET")
        self.assertEqual(self.book.totals()["payment_reserved"], 0)

    def test_unsent_cancellation_frees_budgets_but_cannot_reuse_invoice(self):
        self.apply(authorize())
        self.assertEqual(self.apply(action("CANCEL")), "CANCELLED")
        self.assertEqual(self.book.totals()["payment_remaining"], 150)
        self.assertEqual(self.apply(action("SUBMIT")), "NOT_AUTHORIZED")
        self.assertEqual(self.apply(authorize(tick=1)), "REPLAY")
        self.assertEqual(self.book.snapshot()["payments"][0]["state"], "CANCELLED")

    def test_invoice_expiry_cancels_unsent_but_never_releases_in_flight(self):
        self.apply(authorize())
        self.apply(authorize(quote(2)))
        self.apply(action("SUBMIT"))
        self.apply(action("CANCEL", quote(2), tick=10))
        records = self.book.snapshot()["payments"]
        self.assertEqual([r["state"] for r in records], ["IN_FLIGHT", "CANCELLED"])
        self.assertEqual(self.book.totals()["payment_reserved"], 60)
        self.assertEqual(self.apply(action("CANCEL", tick=11)), "CANNOT_CANCEL_SUBMITTED_PAYMENT")

    def test_revocation_only_releases_unsent_and_late_settlement_is_recordable(self):
        self.apply(authorize())
        self.apply(authorize(quote(2)))
        self.apply(action("SUBMIT"))
        self.assertEqual(self.apply({"kind": "REVOKE", "actor": "agent_one", "at_tick": 2}), "CONTROLLER_REQUIRED")
        self.apply({"kind": "REVOKE", "actor": "operator_one", "at_tick": 3})
        self.assertEqual(self.book.totals()["payment_reserved"], 60)
        self.assertEqual(self.apply(authorize(quote(3), tick=4)), "AUTHORITY_REVOKED")
        self.assertEqual(self.apply(action("RESOLVE", tick=25)), "SYNTHETIC_SETTLED")
        self.assertEqual(self.book.totals()["payment_spent"], 60)
        self.assertEqual(self.book.totals()["fee_spent"], 2)

    def test_failed_transaction_spends_its_fee_and_returns_unused_principal_budget(self):
        self.apply(authorize())
        self.apply(action("SUBMIT"))
        self.apply(action("RESOLVE", outcome="FAILED", actual_fee=3))
        self.assertEqual(self.book.totals(), {"payment_spent": 0, "fee_spent": 3, "payment_reserved": 0,
                         "fee_reserved": 0, "payment_remaining": 150, "fee_remaining": 7})

    def test_duplicate_receipt_at_later_observation_time_never_debits_twice(self):
        self.apply(authorize())
        self.apply(action("SUBMIT"))
        self.apply(action("RESOLVE"))
        self.assertEqual(self.apply(action("RESOLVE", tick=4)), "REPLAY")
        self.assertEqual(self.book.totals()["payment_spent"], 60)
        self.assertEqual(self.apply(action("RESOLVE", tick=4, actual_fee=1)), "RECEIPT_CONFLICT")

    def test_global_receipt_cannot_resolve_another_purchase(self):
        other = quote(2)
        self.apply(authorize())
        self.apply(authorize(other))
        self.apply(action("SUBMIT"))
        self.apply(action("SUBMIT", other))
        self.apply(action("RESOLVE"))
        self.assertEqual(self.apply(action("RESOLVE", other)), "RECEIPT_CONFLICT")
        self.assertEqual(self.book.totals()["payment_reserved"], 60)

    def test_unsubmitted_forged_binding_and_excess_fee_resolutions_retain_state(self):
        self.apply(authorize())
        self.assertEqual(self.apply(action("RESOLVE")), "NOT_SUBMITTED")
        self.apply(action("SUBMIT"))
        self.assertEqual(self.apply(action("RESOLVE", binding_sha256="b" * 64)), "BINDING_MISMATCH")
        self.assertEqual(self.apply(action("RESOLVE", actor="agent_one")), "FIXTURE_ADAPTER_REQUIRED")
        self.assertEqual(self.apply(action("RESOLVE", actual_fee=5)), "FEE_EXCEEDS_AUTHORIZATION")
        self.assertEqual(self.book.totals()["payment_reserved"], 60)

    def test_exact_authority_and_invoice_window_boundaries(self):
        self.book = AuthorityBook(policy(valid_from=2))
        self.assertEqual(self.apply(authorize(tick=1)), "AUTHORITY_OUTSIDE_WINDOW")
        self.assertEqual(self.apply(authorize(tick=2)), "AUTHORIZED")
        self.assertEqual(self.apply(authorize(quote(2), tick=10)), "INVOICE_EXPIRED")
        self.assertEqual(self.apply(authorize(quote(3, expires=30), tick=20)), "AUTHORITY_OUTSIDE_WINDOW")

    def test_malformed_unknown_secret_and_numeric_inputs_are_rejected(self):
        for key in ("payment_budget", "fee_budget", "expires"):
            for value in (True, -1, 1.0, "1", 10**12 + 1):
                self.refused("INVALID_SPENDING_NUMBER", lambda key=key, value=value: AuthorityBook(policy(**{key: value})))
        self.refused("INVALID_FIELDS", lambda: AuthorityBook({**policy(), "private_key": "never accept secrets"}))
        self.refused("INVALID_FIELDS", lambda: self.book.apply({**authorize(), "seed": "not accepted"}))
        self.refused("INVALID_SPENDING_NUMBER", lambda: self.apply(authorize(quote(amount=True))))
        self.refused("INVALID_SPENDING_RESOLUTION", lambda: self.apply(action("RESOLVE", outcome="UNKNOWN")))

    def test_invalid_late_action_does_not_mutate_library_book(self):
        self.apply(authorize())
        before = self.book.snapshot()
        self.refused("INVALID_FIELDS", lambda: self.apply({**action("CANCEL", tick=20), "extra": 1}))
        self.assertEqual(before, self.book.snapshot())
        self.apply(action("CANCEL", tick=2))
        before = self.book.snapshot()
        self.refused("SPENDING_CLOCK_REGRESSION", lambda: self.apply(action("CANCEL", tick=1)))
        self.assertEqual(before, self.book.snapshot())

    def test_full_report_replay_pins_synthetic_flags_and_each_state(self):
        report = run({"policy": policy(), "actions": [authorize(), action("SUBMIT"), action("RESOLVE")]})
        self.assertTrue(replay(report, report["fingerprint"])["verified"])
        self.assertFalse(report["wallet_execution"])
        bad = copy.deepcopy(report)
        bad["final_state"]["totals"]["payment_spent"] = 1
        self.refused("SPENDING_REPLAY_MISMATCH", lambda: replay(bad, report["fingerprint"]))
        bad = copy.deepcopy(report)
        bad["wallet_execution"] = True
        self.refused("SPENDING_REPLAY_MISMATCH", lambda: replay(bad, report["fingerprint"]))
        self.refused("SPENDING_REPORT_PIN_MISMATCH", lambda: replay(report, "f" * 64))

    def test_changed_input_cannot_be_presented_with_the_original_external_pin(self):
        report = run({"policy": policy(), "actions": [authorize()]})
        changed = run({"policy": policy(payment_budget=200), "actions": [authorize()]})
        self.refused("SPENDING_REPORT_PIN_MISMATCH", lambda: replay(changed, report["fingerprint"]))

    def test_record_and_action_caps_bound_retained_history(self):
        for index in range(1, 33):
            self.assertEqual(self.apply(authorize(quote(index, amount=1, fee_cap=0))), "AUTHORIZED")
        self.assertEqual(self.apply(authorize(quote(33, amount=1, fee_cap=0))), "PAYMENT_RECORD_LIMIT")
        for _ in range(256 - len(self.book.journal)):
            self.book.apply({"kind": "REVOKE", "actor": "operator_one", "at_tick": 0})
        self.refused("SPENDING_ACTION_LIMIT", lambda: self.book.apply({"kind": "REVOKE", "actor": "operator_one", "at_tick": 0}))
        self.refused("INVALID_SPENDING_ACTIONS", lambda: run({"policy": policy(), "actions": [authorize()] * 257}))

    def test_run_rejects_out_of_order_input_before_any_report(self):
        self.refused("SPENDING_CLOCK_REGRESSION", lambda: run({"policy": policy(), "actions": [authorize(tick=2), action("SUBMIT", tick=1)]}))

    def test_actual_cli_works_optimized_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, out, optimized = root / "input.json", root / "report.json", root / "optimized.json"
            source.write_text(canonical({"policy": policy(), "actions": [authorize(), action("SUBMIT"), action("RESOLVE")]}))
            base = [sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community.spending"]
            first = subprocess.run([*base, "run", "--input", str(source), "--out", str(out)], capture_output=True, text=True, timeout=10)
            self.assertEqual(first.returncode, 0, first.stderr)
            result = json.loads(first.stdout)
            second = subprocess.run([sys.executable, "-O", *base[1:], "run", "--input", str(source), "--out", str(optimized)], capture_output=True, text=True, timeout=10)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(out.read_bytes(), optimized.read_bytes())
            verified = subprocess.run([*base, "replay", "--input", str(out), "--sha256", result["fingerprint"]], capture_output=True, text=True, timeout=10)
            self.assertEqual(verified.returncode, 0, verified.stderr)
            repeated = subprocess.run([*base, "run", "--input", str(source), "--out", str(out)], capture_output=True, text=True, timeout=10)
            self.assertEqual(repeated.returncode, 1)
            self.assertIn("SPENDING_OUTPUT_REQUIRES_NEW_FILE", repeated.stderr)
