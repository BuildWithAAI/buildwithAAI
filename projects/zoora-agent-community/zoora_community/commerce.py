"""Offline commerce routing composed with AE-021 payer authority.

All merchant, account, actor, eligibility and provider outcomes are fixtures.
There are no provider clients, keys, balances or network operations here.
"""

import argparse
import copy
import hashlib
from pathlib import Path
import sys
import threading

from .spending import (
    MAX_ACTIONS, MAX_INPUT, MAX_OUTPUT, AuthorityBook, action_value as spending_action,
    fingerprint as spending_fingerprint, label, labels, number, policy_value, publish,
    quote_value, read_json,
)
from .validation import DIGEST, Problem, boolean, canonical, fields, identifier, matching

MODEL = "zoora-commerce-router/0.1.0"
DOMAIN = b"ZOORA_AE022_COMMERCE_ROUTER_V1\0"
METHODS = {"bank", "stablecoin_card", "solana_pay", "x402"}
PROVIDERS = {"bank": "OFFRAMP_BANK_CANDIDATE", "stablecoin_card": "BRIDGE_STRIPE_CANDIDATE",
             "solana_pay": "MOONPAY_COMMERCE_CANDIDATE", "x402": "CDP_CANDIDATE"}
PURCHASE_ACTIVITIES = {
    "store_subscription", "print_on_demand", "white_label_supply", "marketing_service",
    "api_service", "agent_service", "youtube_production", "collective_service",
}
ACTIVITY_REFUSALS = {
    "instagram_username_trade": "PLATFORM_PROHIBITED",
    "crypto_trade": "SEPARATE_TRADING_AUTHORITY_REQUIRED",
    "brokerage_account_setup": "OWNER_ACCOUNT_SETUP_REQUIRED",
    "youtube_channel_setup": "OWNER_ACCOUNT_SETUP_REQUIRED",
    "business_account_setup": "OWNER_ACCOUNT_SETUP_REQUIRED",
}
PLATFORMS = {"generic", "shopify_billing", "printful"}


def fingerprint(value):
    return hashlib.sha256(DOMAIN + canonical(value).encode()).hexdigest()


def method(value):
    if type(value) is not str or value not in METHODS:
        raise Problem(400, "INVALID_COMMERCE_METHOD")
    return value


def objects(value, maximum):
    if type(value) is not list or not 0 <= len(value) <= maximum:
        raise Problem(400, "INVALID_COMMERCE_LIST")
    return value


def unique(items, key):
    if len({item[key] for item in items}) != len(items):
        raise Problem(400, "DUPLICATE_COMMERCE_POLICY")
    return items


def policy(value):
    fields(value, ("authority", "activities", "merchants", "routes", "subscriptions"))
    merchants, routes, subscriptions = [], [], []
    for item in objects(value["merchants"], 64):
        fields(item, ("merchant", "platform", "activities", "methods", "recurring"))
        platform = item["platform"]
        if type(platform) is not str or platform not in PLATFORMS:
            raise Problem(400, "INVALID_COMMERCE_PLATFORM")
        methods = [method(x) for x in objects(item["methods"], 4)]
        if len(methods) != len(set(methods)):
            raise Problem(400, "DUPLICATE_COMMERCE_POLICY")
        merchants.append({"merchant": label(item["merchant"]), "platform": platform,
                          "activities": labels(item["activities"]), "methods": methods,
                          "recurring": boolean(item["recurring"])})
    for item in objects(value["routes"], 4):
        fields(item, ("method", "enabled", "account_owner", "eligible_until", "recurring"))
        routes.append({"method": method(item["method"]), "enabled": boolean(item["enabled"]),
                       "account_owner": label(item["account_owner"]),
                       "eligible_until": number(item["eligible_until"]),
                       "recurring": boolean(item["recurring"])})
    for item in objects(value["subscriptions"], 32):
        fields(item, ("subscription_id", "merchant", "activity", "method", "amount_limit",
                      "fee_limit", "first_tick", "period_ticks", "max_cycles"))
        schedule = {"subscription_id": identifier(item["subscription_id"]),
                    "merchant": label(item["merchant"]), "activity": label(item["activity"]),
                    "method": method(item["method"]), "amount_limit": number(item["amount_limit"], 1),
                    "fee_limit": number(item["fee_limit"]), "first_tick": number(item["first_tick"]),
                    "period_ticks": number(item["period_ticks"], 1),
                    "max_cycles": number(item["max_cycles"], 1, MAX_ACTIONS)}
        number(schedule["first_tick"] + schedule["period_ticks"] * schedule["max_cycles"])
        subscriptions.append(schedule)
    return {"authority": policy_value(value["authority"]), "activities": labels(value["activities"]),
            "merchants": unique(merchants, "merchant"), "routes": unique(routes, "method"),
            "subscriptions": unique(subscriptions, "subscription_id")}


def request_value(value):
    fields(value, ("quote", "activity", "method", "recurring", "subscription_id", "cycle"))
    result = {"quote": quote_value(value["quote"]), "activity": label(value["activity"]),
              "method": method(value["method"]), "recurring": boolean(value["recurring"])}
    if result["recurring"]:
        result.update(subscription_id=identifier(value["subscription_id"]), cycle=number(value["cycle"]))
    else:
        if value["subscription_id"] is not None or value["cycle"] is not None:
            raise Problem(400, "INVALID_COMMERCE_RECURRENCE")
        result.update(subscription_id=None, cycle=None)
    return result


def action_value(value):
    if type(value) is not dict or type(value.get("kind")) is not str:
        raise Problem(400, "INVALID_COMMERCE_ACTION")
    kind = value["kind"]
    if kind == "PURCHASE":
        fields(value, ("kind", "actor", "at_tick", "request"))
        return {"kind": kind, "actor": label(value["actor"]), "at_tick": number(value["at_tick"]),
                "request": request_value(value["request"])}
    if kind in {"REVOKE", "SUBMIT", "RESOLVE"}:
        return spending_action(value)
    if kind not in {"CANCEL", "REFUND", "FULFILL"}:
        raise Problem(400, "INVALID_COMMERCE_ACTION")
    extra = {"CANCEL": (), "REFUND": ("receipt_id", "amount"), "FULFILL": ("order_id",)}[kind]
    fields(value, ("kind", "actor", "at_tick", "purchase_id", "binding_sha256", *extra))
    result = {"kind": kind, "actor": label(value["actor"]), "at_tick": number(value["at_tick"]),
              "purchase_id": identifier(value["purchase_id"]),
              "binding_sha256": matching(value["binding_sha256"], DIGEST, "INVALID_DIGEST")}
    if kind == "REFUND":
        result.update(receipt_id=identifier(value["receipt_id"]), amount=number(value["amount"], 1))
    if kind == "FULFILL":
        result["order_id"] = identifier(value["order_id"])
    return result


class CommerceBook:
    """Serialized, in-memory synthetic book; not a durable payment worker."""

    def __init__(self, value):
        self.policy = policy(value)
        self.authority = AuthorityBook(self.policy["authority"])
        self.merchants = {x["merchant"]: x for x in self.policy["merchants"]}
        self.routes = {x["method"]: x for x in self.policy["routes"]}
        self.subscriptions = {x["subscription_id"]: x for x in self.policy["subscriptions"]}
        self.records = {}
        self.cycles = {}
        self.refunds = {}
        self.orders = {}
        self.journal = []
        self._lock = threading.RLock()

    def snapshot(self):
        with self._lock:
            refunded = sum(x["refunded"] for x in self.records.values())
            spent = self.authority.totals()["payment_spent"]
            return {"authority": self.authority.snapshot(),
                    "purchases": [copy.deepcopy(self.records[k]) for k in sorted(self.records)],
                    "refunds": [copy.deepcopy(self.refunds[k]) for k in sorted(self.refunds)],
                    "accounting": {"gross_settled_principal": spent, "refunded_principal": refunded,
                                   "net_settled_principal": spent - refunded,
                                   "fee_spent": self.authority.totals()["fee_spent"],
                                   "refunds_restore_spending_budget": False}}

    def _eligibility(self, request):
        activity, route_name, q = request["activity"], request["method"], request["quote"]
        if activity in ACTIVITY_REFUSALS:
            return ACTIVITY_REFUSALS[activity]
        if activity not in PURCHASE_ACTIVITIES:
            return "ACTIVITY_UNREVIEWED"
        if activity not in self.policy["activities"]:
            return "ACTIVITY_NOT_AUTHORIZED"
        if activity == "store_subscription" and not request["recurring"]:
            return "RECURRING_DECLARATION_REQUIRED"
        merchant = self.merchants.get(q["payee"])
        if merchant is None:
            return "MERCHANT_UNREVIEWED"
        if activity not in merchant["activities"]:
            return "MERCHANT_ACTIVITY_UNSUPPORTED"
        # This candidate card route models virtual credit credentials, not every card type.
        if merchant["platform"] == "shopify_billing" and route_name != "bank":
            return "SHOPIFY_BILLING_ROUTE_UNSUPPORTED"
        if merchant["platform"] == "printful" and route_name != "stablecoin_card":
            return "PRINTFUL_BILLING_ROUTE_UNSUPPORTED"
        if route_name not in merchant["methods"]:
            return "MERCHANT_METHOD_UNSUPPORTED"
        route = self.routes.get(route_name)
        if route is None or not route["enabled"]:
            return "ROUTE_UNAVAILABLE"
        if route["account_owner"] != self.policy["authority"]["operator"]:
            return "ROUTE_OWNER_MISMATCH"
        tick = self.authority.tick
        if tick >= route["eligible_until"]:
            return "ROUTE_ELIGIBILITY_EXPIRED"
        if request["recurring"]:
            if not route["recurring"] or not merchant["recurring"]:
                return "RECURRING_UNSUPPORTED"
            schedule = self.subscriptions.get(request["subscription_id"])
            if schedule is None:
                return "SUBSCRIPTION_NOT_AUTHORIZED"
            if any(schedule[k] != v for k, v in (("merchant", q["payee"]),
                   ("activity", activity), ("method", route_name))):
                return "SUBSCRIPTION_TERMS_MISMATCH"
            cycle = request["cycle"]
            if cycle >= schedule["max_cycles"]:
                return "SUBSCRIPTION_CYCLE_LIMIT"
            due = schedule["first_tick"] + cycle * schedule["period_ticks"]
            if not due <= tick < due + schedule["period_ticks"]:
                return "SUBSCRIPTION_OUTSIDE_WINDOW"
            if q["amount"] > schedule["amount_limit"] or q["fee_cap"] > schedule["fee_limit"]:
                return "SUBSCRIPTION_PRICE_LIMIT"
        return None

    def _purchase(self, action):
        request, actor = action["request"], action["actor"]
        q = request["quote"]
        purchase = q["purchase_id"]
        if actor != q["payer"] or actor not in self.policy["authority"]["agents"]:
            return "ACTOR_MISMATCH"
        old = self.records.get(purchase)
        if old:
            if old["request"]["quote"]["payer"] != actor:
                return "ACTOR_MISMATCH"
            return "REPLAY" if old["binding_sha256"] == fingerprint(request) else "PURCHASE_CONFLICT"
        refusal = self._eligibility(request)
        if refusal:
            return refusal
        cycle = (request["subscription_id"], request["cycle"])
        if request["recurring"] and cycle in self.cycles:
            return "SUBSCRIPTION_CYCLE_ALREADY_BOUND"
        effective_quote = {**q, "resource_sha256": fingerprint(request)}
        result = self.authority.apply({"kind": "AUTHORIZE", "actor": actor,
                                       "at_tick": action["at_tick"], "quote": effective_quote})
        if result["outcome"] != "AUTHORIZED":
            return result["outcome"]
        self.records[purchase] = {"request": copy.deepcopy(request),
                                  "binding_sha256": fingerprint(request),
                                  "authority_binding_sha256": spending_fingerprint(effective_quote),
                                  "provider_candidate": PROVIDERS[request["method"]],
                                  "refunded": 0, "fulfillment_order": None}
        if request["recurring"]:
            self.cycles[cycle] = purchase
        return "AUTHORIZED"

    def _refund(self, action, record):
        if action["actor"] != "fixture_adapter":
            return "FIXTURE_ADAPTER_REQUIRED"
        receipt = action["receipt_id"]
        digest = fingerprint({k: v for k, v in action.items() if k != "at_tick"})
        old = self.refunds.get(receipt)
        if old:
            return "REPLAY" if old["binding_sha256"] == digest else "RECEIPT_CONFLICT"
        if receipt in self.authority.receipts:
            return "RECEIPT_CONFLICT"
        paid = self.authority.records[action["purchase_id"]]
        if paid["state"] != "SETTLED":
            return "PAYMENT_NOT_SETTLED"
        if action["amount"] > record["request"]["quote"]["amount"] - record["refunded"]:
            return "REFUND_EXCEEDS_SETTLEMENT"
        record["refunded"] += action["amount"]
        self.refunds[receipt] = {"receipt_id": receipt, "purchase_id": action["purchase_id"],
                                 "amount": action["amount"], "binding_sha256": digest}
        return "SYNTHETIC_REFUND_RECORDED"

    def _fulfill(self, action, record):
        if action["actor"] != "fixture_adapter":
            return "FIXTURE_ADAPTER_REQUIRED"
        old = self.orders.get(action["order_id"])
        if old is not None:
            return "REPLAY" if old == action["purchase_id"] else "ORDER_CONFLICT"
        if record["fulfillment_order"] is not None:
            return "FULFILLMENT_ALREADY_BOUND"
        if record["request"]["activity"] not in {"print_on_demand", "white_label_supply"}:
            return "FULFILLMENT_NOT_APPLICABLE"
        if self.authority.records[action["purchase_id"]]["state"] != "SETTLED":
            return "PAYMENT_NOT_SETTLED"
        if record["refunded"]:
            return "PAYMENT_PARTIALLY_OR_FULLY_REFUNDED"
        self.orders[action["order_id"]] = action["purchase_id"]
        record["fulfillment_order"] = action["order_id"]
        return "SYNTHETIC_FULFILLMENT_RECORDED"

    def _action(self, action):
        kind = action["kind"]
        if kind == "PURCHASE":
            return self._purchase(action)
        if kind == "REVOKE":
            return self.authority.apply(action)["outcome"]
        record = self.records.get(action["purchase_id"])
        if record is None:
            return "PURCHASE_NOT_FOUND"
        if action["binding_sha256"] != record["binding_sha256"]:
            return "BINDING_MISMATCH"
        if kind == "REFUND":
            return self._refund(action, record)
        if kind == "FULFILL":
            return self._fulfill(action, record)
        if kind == "SUBMIT":
            if action["actor"] != record["request"]["quote"]["payer"]:
                return "ACTOR_MISMATCH"
            # Reconcile existing attempts even after eligibility expires or the mandate is revoked.
            if self.authority.records[action["purchase_id"]]["attempt_id"] is None:
                refusal = self._eligibility(record["request"])
                if refusal:
                    return refusal
        if kind == "RESOLVE" and action["receipt_id"] in self.refunds:
            return "RECEIPT_CONFLICT"
        forwarded = {**action, "binding_sha256": record["authority_binding_sha256"]}
        if kind == "CANCEL":
            del forwarded["binding_sha256"]
        return self.authority.apply(forwarded)["outcome"]

    def apply(self, value):
        action = action_value(value)
        with self._lock:
            if len(self.journal) >= MAX_ACTIONS:
                raise Problem(400, "COMMERCE_ACTION_LIMIT")
            # Reuse AE-021 expiry semantics even when the commerce gate refuses a purchase.
            # Invalid inputs/clock regression are rejected before mutating either layer.
            self.authority._advance(action["at_tick"])
            outcome = self._action(action)
            state = self.snapshot()
            event = {"sequence": len(self.journal), "action": action, "outcome": outcome, "state": state}
            self.journal.append(event)
            return copy.deepcopy(event)


def run(value):
    fields(value, ("policy", "actions"))
    if type(value["actions"]) is not list or not 1 <= len(value["actions"]) <= MAX_ACTIONS:
        raise Problem(400, "INVALID_COMMERCE_ACTIONS")
    actions = [action_value(x) for x in value["actions"]]
    if any(b["at_tick"] < a["at_tick"] for a, b in zip(actions, actions[1:], strict=False)):
        raise Problem(400, "SPENDING_CLOCK_REGRESSION")
    book = CommerceBook(value["policy"])
    for action in actions:
        book.apply(action)
    report = {"schema_version": 1, "model": MODEL, "classification": "SYNTHETIC",
              "activity_rules_version": "AE022_2026_10_15", "wallet_execution": False,
              "provider_integration": False, "provider_eligibility": "DECLARED_FIXTURE_ONLY",
              "controller_authentication": "UNAVAILABLE", "settlement_verification": "OFFLINE_FIXTURE_ONLY",
              "service_integration": False, "durable_execution": False,
              "unit": "SIMULATED_UNIT", "fee_unit": "SIMULATED_FEE_UNIT",
              "input": {"policy": book.policy, "actions": actions},
              "events": book.journal, "final_state": book.snapshot()}
    report["fingerprint"] = fingerprint(report)
    return report


def replay(report, expected):
    matching(expected, DIGEST, "INVALID_DIGEST")
    if type(report) is not dict or report.get("fingerprint") != expected:
        raise Problem(409, "COMMERCE_REPORT_PIN_MISMATCH")
    try:
        actual = run(report["input"])
    except (KeyError, TypeError, ValueError, RecursionError):
        raise Problem(400, "INVALID_COMMERCE_REPORT") from None
    if canonical(actual) != canonical(report):
        raise Problem(409, "COMMERCE_REPLAY_MISMATCH")
    return {"verified": True, "fingerprint": expected, "scope": "SYNTHETIC_MODEL_REPLAY",
            "actions": len(actual["events"]), "wallet_execution": False}


def main():
    parser = argparse.ArgumentParser(description="Offline SYNTHETIC commerce routing; no provider execution")
    commands = parser.add_subparsers(dest="command", required=True)
    execute = commands.add_parser("run")
    execute.add_argument("--input", type=Path, required=True)
    execute.add_argument("--out", type=Path, required=True)
    verify = commands.add_parser("replay")
    verify.add_argument("--input", type=Path, required=True)
    verify.add_argument("--sha256", required=True)
    args = parser.parse_args()
    try:
        if args.command == "run":
            report = run(read_json(args.input, MAX_INPUT))
            publish(args.out, report)
            print(canonical({"created": True, "fingerprint": report["fingerprint"],
                             "classification": "SYNTHETIC", "wallet_execution": False,
                             "actions": len(report["events"])}))
        else:
            print(canonical(replay(read_json(args.input, MAX_OUTPUT), args.sha256)))
    except (Problem, ValueError, UnicodeError, RecursionError) as error:
        print(canonical({"error": error.code if isinstance(error, Problem) else "INVALID_COMMERCE_INPUT"}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
