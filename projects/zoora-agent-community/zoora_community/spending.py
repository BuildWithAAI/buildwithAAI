"""Offline delegated spending research. No keys, balances, network or signing.

Policy controllers, invoices, attempts and settlement results are SYNTHETIC
inputs. Replay checks model consistency; it does not grant real authority.
"""

import argparse
import copy
import hashlib
import os
from pathlib import Path
import re
import stat
import sys

from .validation import DIGEST, Problem, canonical, fields, identifier, matching, parse_json

MODEL = "zoora-payer-authority/0.1.0"
DOMAIN = b"ZOORA_AE021_PAYER_AUTHORITY_V1\0"
MAX_INPUT = 2 * 1024 * 1024
MAX_OUTPUT = 8 * 1024 * 1024
MAX_ACTIONS = 256
MAX_PAYMENTS = 32
NETWORK = "SIMULATED_NETWORK"
ASSET = "SIMULATED_UNIT"
LABEL = re.compile(r"[a-z][a-z0-9_]{2,31}\Z")


def number(value, minimum=0, maximum=10**12):
    if type(value) is not int or not minimum <= value <= maximum:
        raise Problem(400, "INVALID_SPENDING_NUMBER")
    return value


def label(value):
    return matching(value, LABEL, "INVALID_SPENDING_LABEL")


def labels(value):
    if type(value) is not list or not 1 <= len(value) <= 64:
        raise Problem(400, "INVALID_SPENDING_LIST")
    result = [label(item) for item in value]
    if len(set(result)) != len(result):
        raise Problem(400, "INVALID_SPENDING_LIST")
    return result


def fingerprint(value):
    return hashlib.sha256(DOMAIN + canonical(value).encode()).hexdigest()


def policy_value(value):
    fields(value, ("operator", "agents", "payees", "purposes", "payment_limit", "payment_budget",
                   "fee_budget", "valid_from", "expires"))
    result = {"operator": label(value["operator"]), "agents": labels(value["agents"]),
              "payees": labels(value["payees"]), "purposes": labels(value["purposes"])}
    for name in ("payment_limit", "payment_budget", "fee_budget", "valid_from", "expires"):
        result[name] = number(value[name])
    if result["expires"] <= result["valid_from"]:
        raise Problem(400, "INVALID_SPENDING_WINDOW")
    return result


def quote_value(value):
    fields(value, ("purchase_id", "invoice_id", "payer", "payee", "network", "asset", "purpose",
                   "resource_sha256", "amount", "fee_cap", "expires"))
    result = {name: identifier(value[name]) for name in ("purchase_id", "invoice_id")}
    result.update({name: label(value[name]) for name in ("payer", "payee", "purpose")})
    for name in ("network", "asset"):
        # Foreign rails can be represented so refusal is testable, never executed.
        result[name] = matching(value[name], re.compile(r"[A-Z][A-Z0-9_]{0,63}\Z"), "INVALID_SPENDING_RAIL")
    result["resource_sha256"] = matching(value["resource_sha256"], DIGEST, "INVALID_DIGEST")
    result.update(amount=number(value["amount"], 1), fee_cap=number(value["fee_cap"]), expires=number(value["expires"]))
    return result


class AuthorityBook:
    """One declared operator's lifetime budget shared by its listed agent aliases."""

    def __init__(self, policy):
        self.policy = policy_value(policy)
        self.records = {}
        self.invoices = {}
        self.receipts = {}
        self.revoked = False
        self.tick = 0
        self.payment_spent = 0
        self.fee_spent = 0
        self.journal = []

    def totals(self):
        live = [r for r in self.records.values() if r["state"] in {"AUTHORIZED", "IN_FLIGHT"}]
        payment_reserved = sum(r["quote"]["amount"] for r in live)
        fee_reserved = sum(r["quote"]["fee_cap"] for r in live)
        return {"payment_spent": self.payment_spent, "fee_spent": self.fee_spent,
                "payment_reserved": payment_reserved, "fee_reserved": fee_reserved,
                "payment_remaining": self.policy["payment_budget"] - self.payment_spent - payment_reserved,
                "fee_remaining": self.policy["fee_budget"] - self.fee_spent - fee_reserved}

    def snapshot(self):
        return {"at_tick": self.tick, "revoked": self.revoked, "totals": self.totals(),
                "payments": [copy.deepcopy(self.records[key]) for key in sorted(self.records)]}

    def _advance(self, tick):
        if tick < self.tick:
            raise Problem(400, "SPENDING_CLOCK_REGRESSION")
        self.tick = tick
        for record in self.records.values():
            if record["state"] == "AUTHORIZED" and (self.revoked or tick >= self.policy["expires"] or tick >= record["quote"]["expires"]):
                record["state"] = "CANCELLED"
                record["reason"] = "UNSENT_AUTHORITY_EXPIRED_OR_REVOKED"
        # In-flight outcomes stay reserved across all expiry and revocation.

    def _authorize(self, actor, quote):
        purchase = quote["purchase_id"]
        digest = fingerprint(quote)
        old = self.records.get(purchase)
        if old:
            if old["quote"]["payer"] != actor:
                return "ACTOR_MISMATCH"
            return "REPLAY" if old["binding_sha256"] == digest else "PURCHASE_CONFLICT"
        if actor != quote["payer"] or actor not in self.policy["agents"]:
            return "ACTOR_MISMATCH"
        if self.revoked:
            return "AUTHORITY_REVOKED"
        if not self.policy["valid_from"] <= self.tick < self.policy["expires"]:
            return "AUTHORITY_OUTSIDE_WINDOW"
        if self.tick >= quote["expires"]:
            return "INVOICE_EXPIRED"
        if quote["network"] != NETWORK or quote["asset"] != ASSET:
            return "RAIL_NOT_ALLOWED"
        if quote["payee"] not in self.policy["payees"]:
            return "PAYEE_NOT_ALLOWED"
        if quote["purpose"] not in self.policy["purposes"]:
            return "PURPOSE_NOT_ALLOWED"
        if (quote["payee"], quote["invoice_id"]) in self.invoices:
            return "INVOICE_ALREADY_BOUND"
        if quote["amount"] > self.policy["payment_limit"]:
            return "PAYMENT_LIMIT"
        totals = self.totals()
        if quote["amount"] > totals["payment_remaining"]:
            return "PAYMENT_BUDGET"
        if quote["fee_cap"] > totals["fee_remaining"]:
            return "FEE_BUDGET"
        if len(self.records) >= MAX_PAYMENTS:
            return "PAYMENT_RECORD_LIMIT"
        self.records[purchase] = {"quote": quote, "binding_sha256": digest, "state": "AUTHORIZED",
                                  "attempt_id": None, "receipt_id": None, "actual_fee": None, "reason": None}
        self.invoices[(quote["payee"], quote["invoice_id"])] = purchase
        return "AUTHORIZED"

    def _action(self, action):
        kind, actor = action["kind"], action["actor"]
        if kind == "AUTHORIZE":
            return self._authorize(actor, action["quote"])
        if kind == "REVOKE":
            if actor != self.policy["operator"]:
                return "CONTROLLER_REQUIRED"
            self.revoked = True
            self._advance(self.tick)
            return "REVOKED"
        record = self.records.get(action["purchase_id"])
        if record is None:
            return "PURCHASE_NOT_FOUND"
        if kind == "RESOLVE":
            if actor != "fixture_adapter":
                return "FIXTURE_ADAPTER_REQUIRED"
        elif actor != record["quote"]["payer"]:
            return "ACTOR_MISMATCH"
        if kind in {"SUBMIT", "RESOLVE"} and action["binding_sha256"] != record["binding_sha256"]:
            return "BINDING_MISMATCH"
        if kind == "CANCEL":
            if record["state"] == "CANCELLED":
                return "REPLAY"
            if record["state"] != "AUTHORIZED":
                return "CANNOT_CANCEL_SUBMITTED_PAYMENT"
            record.update(state="CANCELLED", reason="UNSENT_CANCELLED")
            return "CANCELLED"
        if kind == "SUBMIT":
            if record["attempt_id"] is not None:
                return "SAME_ATTEMPT"
            if record["state"] != "AUTHORIZED":
                return "NOT_AUTHORIZED"
            record.update(state="IN_FLIGHT", attempt_id=fingerprint({"binding": record["binding_sha256"], "policy": self.policy}))
            return "SIMULATED_SUBMISSION"
        if record["attempt_id"] is None:
            return "NOT_SUBMITTED"
        if action["outcome"] == "UNKNOWN":
            return "OUTCOME_STILL_RESERVED" if record["state"] == "IN_FLIGHT" else "ALREADY_RESOLVED"
        receipt = action["receipt_id"]
        receipt_hash = fingerprint({key: value for key, value in action.items() if key != "at_tick"})
        if receipt in self.receipts:
            old_purchase, old_hash = self.receipts[receipt]
            return "REPLAY" if old_purchase == action["purchase_id"] and old_hash == receipt_hash else "RECEIPT_CONFLICT"
        if record["state"] != "IN_FLIGHT":
            return "ALREADY_RESOLVED"
        if action["actual_fee"] > record["quote"]["fee_cap"]:
            return "FEE_EXCEEDS_AUTHORIZATION"
        if action["outcome"] == "SETTLED":
            self.payment_spent += record["quote"]["amount"]
        self.fee_spent += action["actual_fee"]
        self.receipts[receipt] = (action["purchase_id"], receipt_hash)
        record.update(state=action["outcome"], receipt_id=receipt, actual_fee=action["actual_fee"])
        return "SYNTHETIC_" + action["outcome"]

    def apply(self, action):
        action = action_value(action)
        if len(self.journal) >= MAX_ACTIONS:
            raise Problem(400, "SPENDING_ACTION_LIMIT")
        self._advance(action["at_tick"])
        outcome = self._action(action)
        totals = self.totals()
        if totals["payment_remaining"] < 0 or totals["fee_remaining"] < 0:
            raise Problem(503, "SPENDING_INVARIANT_FAILURE")
        event = {"sequence": len(self.journal), "action": action, "outcome": outcome, "state": self.snapshot()}
        self.journal.append(event)
        return copy.deepcopy(event)


def action_value(value):
    if type(value) is not dict:
        raise Problem(400, "INVALID_SPENDING_ACTION")
    kind = value.get("kind")
    extra = {"AUTHORIZE": ("quote",), "REVOKE": (), "CANCEL": ("purchase_id",),
             "SUBMIT": ("purchase_id", "binding_sha256"),
             "RESOLVE": ("purchase_id", "binding_sha256", "receipt_id", "outcome", "actual_fee")}
    if type(kind) is not str or kind not in extra:
        raise Problem(400, "INVALID_SPENDING_ACTION")
    fields(value, ("kind", "actor", "at_tick", *extra[kind]))
    result = {"kind": kind, "actor": label(value["actor"]), "at_tick": number(value["at_tick"])}
    if kind == "AUTHORIZE":
        result["quote"] = quote_value(value["quote"])
    if "purchase_id" in value:
        result["purchase_id"] = identifier(value["purchase_id"])
    if "binding_sha256" in value:
        result["binding_sha256"] = matching(value["binding_sha256"], DIGEST, "INVALID_DIGEST")
    if kind == "RESOLVE":
        outcome = value["outcome"]
        if type(outcome) is not str or outcome not in {"UNKNOWN", "SETTLED", "FAILED"}:
            raise Problem(400, "INVALID_SPENDING_RESOLUTION")
        result["outcome"] = outcome
        if outcome == "UNKNOWN":
            if value["receipt_id"] is not None or value["actual_fee"] is not None:
                raise Problem(400, "INVALID_SPENDING_RESOLUTION")
            result.update(receipt_id=None, actual_fee=None)
        else:
            result.update(receipt_id=identifier(value["receipt_id"]), actual_fee=number(value["actual_fee"]))
    return result


def run(value):
    fields(value, ("policy", "actions"))
    actions = value["actions"]
    if type(actions) is not list or not 1 <= len(actions) <= MAX_ACTIONS:
        raise Problem(400, "INVALID_SPENDING_ACTIONS")
    # Validate the whole input before changing the book, including time order.
    validated = [action_value(action) for action in actions]
    if any(b["at_tick"] < a["at_tick"] for a, b in zip(validated, validated[1:], strict=False)):
        raise Problem(400, "SPENDING_CLOCK_REGRESSION")
    book = AuthorityBook(value["policy"])
    for action in validated:
        book.apply(action)
    report = {"schema_version": 1, "model": MODEL, "classification": "SYNTHETIC",
              "unit": ASSET, "fee_unit": "SIMULATED_FEE_UNIT", "network": NETWORK,
              "controller_authentication": "UNAVAILABLE", "wallet_execution": False,
              "wallet_balances": "UNAVAILABLE", "settlement_verification": "OFFLINE_FIXTURE_ONLY",
              "input": {"policy": book.policy, "actions": validated}, "events": book.journal,
              "final_state": book.snapshot()}
    report["fingerprint"] = fingerprint(report)
    return report


def replay(report, expected):
    matching(expected, DIGEST, "INVALID_DIGEST")
    if type(report) is not dict or report.get("fingerprint") != expected:
        raise Problem(409, "SPENDING_REPORT_PIN_MISMATCH")
    try:
        actual = run(report["input"])
    except (KeyError, TypeError, ValueError, RecursionError):
        raise Problem(400, "INVALID_SPENDING_REPORT") from None
    if canonical(actual) != canonical(report):
        raise Problem(409, "SPENDING_REPLAY_MISMATCH")
    return {"verified": True, "fingerprint": expected, "scope": "SYNTHETIC_MODEL_REPLAY",
            "actions": len(actual["events"]), "wallet_execution": False}


def read_json(path, maximum):
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= maximum:
            raise Problem(400, "UNSAFE_SPENDING_FILE")
        with path.open("rb") as f:
            raw = f.read(maximum + 1)
    except OSError:
        raise Problem(400, "SPENDING_INPUT_UNAVAILABLE") from None
    return parse_json(raw, maximum)


def publish(path, value):
    raw = (canonical(value) + "\n").encode()
    if len(raw) > MAX_OUTPUT:
        raise Problem(413, "SPENDING_REPORT_TOO_LARGE")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags, 0o600)
    except OSError:
        raise Problem(409, "SPENDING_OUTPUT_REQUIRES_NEW_FILE") from None
    with os.fdopen(descriptor, "wb") as f:
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())


def main():
    parser = argparse.ArgumentParser(description="Offline SYNTHETIC payer authority; no wallet execution")
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
            print(canonical({"created": True, "fingerprint": report["fingerprint"], "classification": "SYNTHETIC",
                             "wallet_execution": False, "actions": len(report["events"])}))
        else:
            print(canonical(replay(read_json(args.input, MAX_OUTPUT), args.sha256)))
    except (Problem, ValueError, UnicodeError, RecursionError) as error:
        print(canonical({"error": error.code if isinstance(error, Problem) else "INVALID_SPENDING_INPUT"}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
