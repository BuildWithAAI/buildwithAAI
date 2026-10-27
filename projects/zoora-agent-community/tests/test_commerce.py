"""Commerce authority boundaries, recurring obligations, refunds and delivery evidence."""

from concurrent.futures import ThreadPoolExecutor
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from zoora_community.commerce import CommerceBook, fingerprint, replay, run
from zoora_community.spending import ASSET, NETWORK
from zoora_community.validation import Problem, canonical


def policy():
    activities = ["store_subscription", "print_on_demand", "white_label_supply", "api_service",
                  "agent_service", "collective_service", "marketing_service", "youtube_production",
                  "instagram_username_trade", "crypto_trade", "brokerage_account_setup",
                  "youtube_channel_setup", "business_account_setup", "unknown_business"]
    return {"authority": {"operator": "operator_one", "agents": ["agent_one", "agent_two"],
                          "payees": ["shopify", "printer", "supplier"], "purposes": ["operate"],
                          "payment_limit": 100, "payment_budget": 150, "fee_budget": 15,
                          "valid_from": 0, "expires": 40},
            "activities": activities,
            "merchants": [{"merchant": name, "platform": platform, "activities": activities,
                           "methods": ["bank", "stablecoin_card", "solana_pay", "x402"],
                           "recurring": True}
                          for name, platform in [("shopify", "shopify_billing"),
                                                 ("printer", "printful"), ("supplier", "generic")]],
            "routes": [{"method": name, "enabled": True, "account_owner": "operator_one",
                        "eligible_until": 40, "recurring": True}
                       for name in ["bank", "stablecoin_card", "solana_pay", "x402"]],
            "subscriptions": [{"subscription_id": "e" * 32, "merchant": "shopify",
                               "activity": "store_subscription", "method": "bank",
                               "amount_limit": 50, "fee_limit": 3, "first_tick": 0,
                               "period_ticks": 10, "max_cycles": 3}]}


def request(index=1, **changes):
    quote_changes = changes.pop("quote", {})
    return {"quote": {"purchase_id": f"{index:032x}", "invoice_id": f"{index + 100:032x}",
                      "payer": "agent_one", "payee": "supplier", "purpose": "operate",
                      "network": NETWORK, "asset": ASSET, "resource_sha256": "a" * 64,
                      "amount": 60, "fee_cap": 4, "expires": 30, **quote_changes},
            "activity": "api_service", "method": "x402", "recurring": False,
            "subscription_id": None, "cycle": None, **changes}


def subscription(index=1, cycle=0, **changes):
    return request(index, activity="store_subscription", method="bank", recurring=True,
                   subscription_id="e" * 32, cycle=cycle,
                   quote={"payee": "shopify", "amount": 40, "fee_cap": 2, **changes})


def purchase(r=None, tick=0, actor=None):
    r = request() if r is None else r
    return {"kind": "PURCHASE", "at_tick": tick, "actor": actor or r["quote"]["payer"], "request": r}


def action(kind, r=None, tick=1, **changes):
    r = request() if r is None else r
    result = {"kind": kind, "at_tick": tick, "actor": r["quote"]["payer"],
              "purchase_id": r["quote"]["purchase_id"], "binding_sha256": fingerprint(r)}
    if kind == "RESOLVE":
        result.update(actor="fixture_adapter", outcome="SETTLED", receipt_id="f" * 32, actual_fee=2)
    if kind == "REFUND":
        result.update(actor="fixture_adapter", receipt_id="d" * 32, amount=10)
    if kind == "FULFILL":
        result.update(actor="fixture_adapter", order_id="b" * 32)
    return {**result, **changes}


class CommerceTests(unittest.TestCase):
    def setUp(self):
        self.book = CommerceBook(policy())

    def apply(self, value):
        return self.book.apply(value)["outcome"]

    def error(self, code, callback):
        with self.assertRaises(Problem) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)

    def settle(self, r=None, receipt="f" * 32):
        r = request() if r is None else r
        tick = self.book.authority.tick
        self.assertEqual(self.apply(purchase(r, tick=tick)), "AUTHORIZED")
        self.assertEqual(self.apply(action("SUBMIT", r, tick=tick)), "SIMULATED_SUBMISSION")
        self.assertEqual(self.apply(action("RESOLVE", r, tick=tick, receipt_id=receipt)), "SYNTHETIC_SETTLED")

    def test_each_candidate_method_composes_with_existing_authority(self):
        for name in ("bank", "stablecoin_card", "solana_pay", "x402"):
            book = CommerceBook(policy())
            r = request(method=name)
            self.assertEqual(book.apply(purchase(r))["outcome"], "AUTHORIZED")
            self.assertEqual(book.apply(action("SUBMIT", r))["outcome"], "SIMULATED_SUBMISSION")
            self.assertEqual(book.snapshot()["authority"]["totals"]["payment_reserved"], 60)

    def test_prohibited_trading_setup_and_unknown_categories_cannot_be_allowlisted_away(self):
        cases = [("instagram_username_trade", "PLATFORM_PROHIBITED"),
                 ("crypto_trade", "SEPARATE_TRADING_AUTHORITY_REQUIRED"),
                 ("brokerage_account_setup", "OWNER_ACCOUNT_SETUP_REQUIRED"),
                 ("youtube_channel_setup", "OWNER_ACCOUNT_SETUP_REQUIRED"),
                 ("business_account_setup", "OWNER_ACCOUNT_SETUP_REQUIRED"),
                 ("unknown_business", "ACTIVITY_UNREVIEWED")]
        for activity, expected in cases:
            self.assertEqual(self.apply(purchase(request(activity=activity))), expected)
        self.assertEqual(self.book.snapshot()["authority"]["totals"]["payment_reserved"], 0)

    def test_owner_activity_merchant_and_method_permissions_all_apply(self):
        p = policy()
        p["activities"].remove("api_service")
        self.assertEqual(CommerceBook(p).apply(purchase())["outcome"], "ACTIVITY_NOT_AUTHORIZED")
        p = policy()
        p["merchants"] = p["merchants"][:2]
        self.assertEqual(CommerceBook(p).apply(purchase())["outcome"], "MERCHANT_UNREVIEWED")
        p = policy()
        p["merchants"][2]["activities"] = ["agent_service"]
        self.assertEqual(CommerceBook(p).apply(purchase())["outcome"], "MERCHANT_ACTIVITY_UNSUPPORTED")
        p = policy()
        p["merchants"][2]["methods"] = ["bank"]
        self.assertEqual(CommerceBook(p).apply(purchase())["outcome"], "MERCHANT_METHOD_UNSUPPORTED")

    def test_shopify_billing_requires_bank_route_and_explicit_recurring_terms(self):
        for name in ("stablecoin_card", "solana_pay", "x402"):
            r = subscription()
            r["method"] = name
            self.assertEqual(self.apply(purchase(r)), "SHOPIFY_BILLING_ROUTE_UNSUPPORTED")
        r = subscription()
        r.update(recurring=False, subscription_id=None, cycle=None)
        self.assertEqual(self.apply(purchase(r)), "RECURRING_DECLARATION_REQUIRED")
        self.assertEqual(self.apply(purchase(subscription())), "AUTHORIZED")

    def test_printful_cannot_be_declared_to_accept_x402_or_direct_bank_or_solana_pay(self):
        for name in ("bank", "solana_pay", "x402"):
            r = request(method=name, activity="print_on_demand", quote={"payee": "printer"})
            self.assertEqual(self.apply(purchase(r)), "PRINTFUL_BILLING_ROUTE_UNSUPPORTED")

    def test_route_missing_disabled_foreign_owner_and_exact_expiry_are_refused(self):
        for change, reason in [({"enabled": False}, "ROUTE_UNAVAILABLE"),
                               ({"account_owner": "another_owner"}, "ROUTE_OWNER_MISMATCH"),
                               ({"eligible_until": 0}, "ROUTE_ELIGIBILITY_EXPIRED")]:
            p = policy()
            p["routes"][3].update(change)
            self.assertEqual(CommerceBook(p).apply(purchase())["outcome"], reason)
        p = policy()
        p["routes"] = []
        self.assertEqual(CommerceBook(p).apply(purchase())["outcome"], "ROUTE_UNAVAILABLE")

    def test_eligibility_is_rechecked_before_first_submit_without_route_fallback(self):
        p = policy()
        p["routes"][3]["eligible_until"] = 2
        book = CommerceBook(p)
        book.apply(purchase())
        self.assertEqual(book.apply(action("SUBMIT", tick=2))["outcome"], "ROUTE_ELIGIBILITY_EXPIRED")
        self.assertEqual(book.snapshot()["authority"]["totals"]["payment_reserved"], 60)
        self.assertEqual(book.apply(action("CANCEL", tick=2))["outcome"], "CANCELLED")

    def test_request_activity_method_and_recurrence_are_bound_along_with_quote(self):
        self.apply(purchase())
        for r in [request(activity="agent_service"), request(method="bank"),
                  request(quote={"amount": 61}), request(quote={"resource_sha256": "b" * 64}),
                  request(recurring=True, subscription_id="e" * 32, cycle=0)]:
            self.assertEqual(self.apply(purchase(r)), "PURCHASE_CONFLICT")
        self.assertEqual(self.apply(action("SUBMIT", request(method="bank"))), "BINDING_MISMATCH")
        self.assertEqual(self.apply(purchase(tick=1)), "REPLAY")

    def test_underlying_invoice_dedup_and_asset_payee_purpose_rules_still_apply(self):
        self.apply(purchase())
        duplicate = request(2, quote={"invoice_id": request()["quote"]["invoice_id"]})
        self.assertEqual(self.apply(purchase(duplicate)), "INVOICE_ALREADY_BOUND")
        for changes, reason in [({"asset": "USDC"}, "RAIL_NOT_ALLOWED"),
                                 ({"network": "SOLANA_MAINNET"}, "RAIL_NOT_ALLOWED"),
                                 ({"purpose": "trade"}, "PURPOSE_NOT_ALLOWED")]:
            self.assertEqual(self.apply(purchase(request(2, quote=changes))), reason)

    def test_subscriptions_require_explicit_owner_terms_and_supported_recurrence(self):
        for change, reason in [({"subscriptions": []}, "SUBSCRIPTION_NOT_AUTHORIZED")]:
            p = policy()
            p.update(change)
            self.assertEqual(CommerceBook(p).apply(purchase(subscription()))["outcome"], reason)
        for target in ("routes", "merchants"):
            p = policy()
            p[target][0]["recurring"] = False
            self.assertEqual(CommerceBook(p).apply(purchase(subscription()))["outcome"], "RECURRING_UNSUPPORTED")
        p = policy()
        p["subscriptions"][0]["merchant"] = "supplier"
        self.assertEqual(CommerceBook(p).apply(purchase(subscription()))["outcome"], "SUBSCRIPTION_TERMS_MISMATCH")

    def test_subscription_price_fee_exclusive_windows_and_cycle_limit(self):
        self.assertEqual(self.apply(purchase(subscription(amount=51))), "SUBSCRIPTION_PRICE_LIMIT")
        self.assertEqual(self.apply(purchase(subscription(fee_cap=4))), "SUBSCRIPTION_PRICE_LIMIT")
        self.assertEqual(self.apply(purchase(subscription(cycle=1), tick=9)), "SUBSCRIPTION_OUTSIDE_WINDOW")
        self.assertEqual(self.apply(purchase(subscription(cycle=0), tick=10)), "SUBSCRIPTION_OUTSIDE_WINDOW")
        self.assertEqual(self.apply(purchase(subscription(cycle=3), tick=30)), "SUBSCRIPTION_CYCLE_LIMIT")

    def test_each_subscription_cycle_is_retained_once_even_after_cancel_or_changed_invoice(self):
        r = subscription()
        self.apply(purchase(r))
        self.apply(action("CANCEL", r))
        self.assertEqual(self.apply(purchase(subscription(2), tick=1)), "SUBSCRIPTION_CYCLE_ALREADY_BOUND")
        self.assertEqual(self.apply(purchase(r, tick=1)), "REPLAY")
        self.assertEqual(self.apply(purchase(subscription(2, cycle=1), tick=10)), "AUTHORIZED")

    def test_new_subscription_cycles_and_collective_aliases_share_the_same_total_budget(self):
        r = request(activity="collective_service", quote={"amount": 100})
        self.apply(purchase(r))
        other = request(2, activity="collective_service", quote={"payer": "agent_two"})
        self.assertEqual(self.apply(purchase(other)), "PAYMENT_BUDGET")
        self.assertEqual(self.apply(action("SUBMIT", r, actor="agent_two")), "ACTOR_MISMATCH")

    def test_concurrent_alias_purchases_cannot_both_reserve_the_remaining_budget(self):
        p = policy()
        p["authority"].update(payment_budget=100, fee_budget=100)
        book = CommerceBook(p)
        requests = [purchase(request(i, quote={"payer": "agent_two" if i % 2 else "agent_one"}))
                    for i in range(1, 9)]
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(book.apply, requests))
        self.assertEqual(sum(x["outcome"] == "AUTHORIZED" for x in results), 1)
        self.assertEqual(sum(x["outcome"] == "PAYMENT_BUDGET" for x in results), 7)
        self.assertEqual(book.snapshot()["authority"]["totals"]["payment_reserved"], 60)

    def test_unknown_outcome_survives_revocation_and_expiry_and_late_resolution(self):
        self.apply(purchase())
        self.apply(action("SUBMIT"))
        self.apply(action("RESOLVE", outcome="UNKNOWN", receipt_id=None, actual_fee=None))
        self.assertEqual(self.apply({"kind": "REVOKE", "actor": "operator_one", "at_tick": 2}), "REVOKED")
        self.assertEqual(self.apply(action("SUBMIT", tick=50)), "SAME_ATTEMPT")
        self.assertEqual(self.book.snapshot()["authority"]["totals"]["payment_reserved"], 60)
        self.assertEqual(self.apply(action("RESOLVE", tick=50)), "SYNTHETIC_SETTLED")
        self.assertEqual(self.apply(action("REFUND", tick=51)), "SYNTHETIC_REFUND_RECORDED")

    def test_revocation_stops_future_subscription_cycles_and_unauthorized_revocation_fails(self):
        r = subscription()
        self.apply(purchase(r))
        self.assertEqual(self.apply({"kind": "REVOKE", "actor": "agent_one", "at_tick": 0}), "CONTROLLER_REQUIRED")
        self.apply({"kind": "REVOKE", "actor": "operator_one", "at_tick": 1})
        self.assertEqual(self.apply(purchase(subscription(2, cycle=1), tick=10)), "AUTHORITY_REVOKED")
        self.assertEqual(self.book.snapshot()["authority"]["totals"]["payment_reserved"], 0)

    def test_failed_submission_consumes_actual_fee_and_cannot_be_refunded_or_fulfilled(self):
        r = request(activity="print_on_demand", method="stablecoin_card", quote={"payee": "printer"})
        self.apply(purchase(r))
        self.apply(action("SUBMIT", r))
        self.apply(action("RESOLVE", r, outcome="FAILED", actual_fee=3))
        self.assertEqual(self.apply(action("REFUND", r)), "PAYMENT_NOT_SETTLED")
        self.assertEqual(self.apply(action("FULFILL", r)), "PAYMENT_NOT_SETTLED")
        totals = self.book.snapshot()["authority"]["totals"]
        self.assertEqual((totals["payment_spent"], totals["fee_spent"], totals["payment_reserved"]), (0, 3, 0))

    def test_partial_and_full_refund_accounting_do_not_replenish_lifetime_budget(self):
        self.settle()
        self.assertEqual(self.apply(action("REFUND", amount=20)), "SYNTHETIC_REFUND_RECORDED")
        self.assertEqual(self.apply(action("REFUND", receipt_id="c" * 32, amount=40)), "SYNTHETIC_REFUND_RECORDED")
        self.assertEqual(self.apply(action("REFUND", receipt_id="b" * 32, amount=1)), "REFUND_EXCEEDS_SETTLEMENT")
        state = self.book.snapshot()
        self.assertEqual(state["accounting"], {"gross_settled_principal": 60, "refunded_principal": 60,
                         "net_settled_principal": 0, "fee_spent": 2, "refunds_restore_spending_budget": False})
        self.assertEqual(state["authority"]["totals"]["payment_remaining"], 90)

    def test_receipt_id_namespace_is_shared_across_settlements_and_refunds(self):
        self.settle()
        self.assertEqual(self.apply(action("REFUND", receipt_id="f" * 32)), "RECEIPT_CONFLICT")
        self.apply(action("REFUND"))
        self.assertEqual(self.apply(action("REFUND", tick=5)), "REPLAY")
        self.assertEqual(self.apply(action("REFUND", tick=5, amount=11)), "RECEIPT_CONFLICT")
        other = request(2)
        self.apply(purchase(other, tick=5))
        self.apply(action("SUBMIT", other, tick=5))
        self.assertEqual(self.apply(action("RESOLVE", other, tick=5, receipt_id="d" * 32)), "RECEIPT_CONFLICT")
        self.assertEqual(self.book.snapshot()["authority"]["totals"]["payment_reserved"], 60)

    def test_refund_and_fulfillment_require_bound_fixture_evidence(self):
        self.settle()
        self.assertEqual(self.apply(action("REFUND", actor="agent_one")), "FIXTURE_ADAPTER_REQUIRED")
        self.assertEqual(self.apply(action("REFUND", binding_sha256="0" * 64)), "BINDING_MISMATCH")
        self.assertEqual(self.apply(action("FULFILL", actor="agent_one")), "FIXTURE_ADAPTER_REQUIRED")
        self.assertEqual(self.apply(action("FULFILL")), "FULFILLMENT_NOT_APPLICABLE")

    def test_fulfillment_waits_for_settlement_and_duplicate_events_create_one_order(self):
        r = request(activity="print_on_demand", method="stablecoin_card", quote={"payee": "printer"})
        self.apply(purchase(r))
        self.assertEqual(self.apply(action("FULFILL", r)), "PAYMENT_NOT_SETTLED")
        self.apply(action("SUBMIT", r))
        self.assertEqual(self.apply(action("FULFILL", r)), "PAYMENT_NOT_SETTLED")
        self.apply(action("RESOLVE", r))
        self.assertEqual(self.apply(action("FULFILL", r)), "SYNTHETIC_FULFILLMENT_RECORDED")
        self.assertEqual(self.apply(action("FULFILL", r, tick=4)), "REPLAY")
        self.assertEqual(self.apply(action("FULFILL", r, tick=4, order_id="c" * 32)), "FULFILLMENT_ALREADY_BOUND")
        self.assertEqual(len(self.book.orders), 1)

    def test_refunded_order_cannot_start_fulfillment_and_supplier_id_cannot_be_reused(self):
        r = request(activity="white_label_supply")
        self.settle(r)
        self.apply(action("REFUND", r))
        self.assertEqual(self.apply(action("FULFILL", r)), "PAYMENT_PARTIALLY_OR_FULLY_REFUNDED")
        second = request(2, activity="white_label_supply")
        self.settle(second, receipt="c" * 32)
        self.apply(action("FULFILL", second))
        self.assertEqual(self.apply(action("FULFILL", r)), "ORDER_CONFLICT")

    def test_malformed_inputs_do_not_mutate_state_or_advance_the_clock(self):
        self.apply(purchase())
        before = self.book.snapshot()
        for bad in [{**action("SUBMIT", tick=20), "private_key": "never accept"},
                    purchase(request(recurring=1), tick=20),
                    purchase(request(cycle=0), tick=20),
                    purchase(request(quote={"amount": True}), tick=20)]:
            with self.assertRaises(Problem):
                self.apply(bad)
            self.assertEqual(before, self.book.snapshot())
        self.apply(action("SUBMIT", tick=2))
        before = self.book.snapshot()
        self.error("SPENDING_CLOCK_REGRESSION", lambda: self.apply(action("CANCEL", tick=1)))
        self.assertEqual(before, self.book.snapshot())

    def test_policy_rejects_unknown_fields_duplicates_booleans_and_oversized_schedules(self):
        p = policy()
        p["secret"] = "not permitted"
        self.error("INVALID_FIELDS", lambda: CommerceBook(p))
        for field in ("merchants", "routes", "subscriptions"):
            p = policy()
            if field == "routes":
                p[field][-1] = copy.deepcopy(p[field][0])
            else:
                p[field].append(copy.deepcopy(p[field][0]))
            self.error("DUPLICATE_COMMERCE_POLICY", lambda p=p: CommerceBook(p))
        p = policy()
        p["subscriptions"][0]["period_ticks"] = 10**12
        self.error("INVALID_SPENDING_NUMBER", lambda: CommerceBook(p))
        p = policy()
        p["routes"][0]["enabled"] = 1
        self.error("INVALID_BOOLEAN", lambda: CommerceBook(p))

    def test_complete_replay_rejects_forged_accounting_and_capability_flags(self):
        report = run({"policy": policy(), "actions": [purchase(), action("SUBMIT"), action("RESOLVE")]})
        self.assertTrue(replay(report, report["fingerprint"])["verified"])
        for key, value in (("wallet_execution", True), ("provider_integration", True)):
            bad = copy.deepcopy(report)
            bad[key] = value
            self.error("COMMERCE_REPLAY_MISMATCH", lambda bad=bad: replay(bad, report["fingerprint"]))
        bad = copy.deepcopy(report)
        bad["final_state"]["accounting"]["net_settled_principal"] = 0
        self.error("COMMERCE_REPLAY_MISMATCH", lambda: replay(bad, report["fingerprint"]))
        self.error("COMMERCE_REPORT_PIN_MISMATCH", lambda: replay(report, "0" * 64))

    def test_full_scenario_validates_bounds_and_clock_before_execution(self):
        self.error("SPENDING_CLOCK_REGRESSION", lambda: run({"policy": policy(), "actions": [purchase(tick=2), action("SUBMIT", tick=1)]}))
        self.error("INVALID_COMMERCE_ACTIONS", lambda: run({"policy": policy(), "actions": [purchase()] * 257}))
        for _ in range(256):
            self.apply({"kind": "REVOKE", "actor": "operator_one", "at_tick": 0})
        self.error("COMMERCE_ACTION_LIMIT", lambda: self.apply(purchase()))

    def test_real_cli_normal_optimized_replay_overwrite_and_secret_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, out, optimized = root / "input.json", root / "out.json", root / "optimized.json"
            source.write_text(canonical({"policy": policy(), "actions": [purchase(), action("SUBMIT"), action("RESOLVE")]}), encoding="utf-8")
            base = [sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community.commerce"]
            first = subprocess.run([*base, "run", "--input", str(source), "--out", str(out)], capture_output=True, text=True, timeout=10)
            self.assertEqual(first.returncode, 0, first.stderr)
            meta = json.loads(first.stdout)
            second = subprocess.run([sys.executable, "-O", *base[1:], "run", "--input", str(source), "--out", str(optimized)], capture_output=True, text=True, timeout=10)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(out.read_bytes(), optimized.read_bytes())
            check = subprocess.run([*base, "replay", "--input", str(out), "--sha256", meta["fingerprint"]], capture_output=True, text=True, timeout=10)
            self.assertEqual(check.returncode, 0, check.stderr)
            refused = subprocess.run([*base, "run", "--input", str(source), "--out", str(out)], capture_output=True, text=True, timeout=10)
            self.assertEqual(refused.returncode, 1)
            self.assertIn("SPENDING_OUTPUT_REQUIRES_NEW_FILE", refused.stderr)
            bad = json.loads(source.read_text())
            bad["actions"][0]["seed"] = "do not ingest wallet secrets"
            source.write_text(canonical(bad), encoding="utf-8")
            absent = root / "absent.json"
            refused = subprocess.run([*base, "run", "--input", str(source), "--out", str(absent)], capture_output=True, text=True, timeout=10)
            self.assertEqual(refused.returncode, 1)
            self.assertIn("INVALID_FIELDS", refused.stderr)
            self.assertFalse(absent.exists())
