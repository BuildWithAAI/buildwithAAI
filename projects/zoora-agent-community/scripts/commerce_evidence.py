"""Actual commerce CLI acceptance and independent retained-state accounting."""

import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from zoora_community.validation import canonical  # noqa: E402

DOMAIN = b"ZOORA_AE022_COMMERCE_ROUTER_V1\0"
AUTHORITY_DOMAIN = b"ZOORA_AE021_PAYER_AUTHORITY_V1\0"


def digest(domain, value):
    return hashlib.sha256(domain + canonical(value).encode()).hexdigest()


def inspect(report):
    """Audit all retained states without importing either payment model."""
    p = report["input"]["policy"]["authority"]
    views = [event["state"] for event in report["events"]] + [report["final_state"]]
    for state in views:
        core = state["authority"]
        payments = {r["quote"]["purchase_id"]: r for r in core["payments"]}
        records = {r["request"]["quote"]["purchase_id"]: r for r in state["purchases"]}
        if set(payments) != set(records) or len(payments) != len(core["payments"]):
            raise AssertionError("Commerce/authority record mismatch")
        if len(records) != len(state["purchases"]):
            raise AssertionError("Duplicate purchase")
        spent = fees = held = fees_held = refunded = 0
        invoices, receipts, cycles, orders = set(), set(), set(), set()
        refunds = {}
        for refund in state["refunds"]:
            rid, pid = refund["receipt_id"], refund["purchase_id"]
            if rid in receipts or pid not in payments or payments[pid]["state"] != "SETTLED":
                raise AssertionError("Invalid refund identity or settlement")
            receipts.add(rid)
            refunds[pid] = refunds.get(pid, 0) + refund["amount"]
        for pid, payment in payments.items():
            record, q = records[pid], payment["quote"]
            request = record["request"]
            bound = digest(DOMAIN, request)
            effective_quote = {**request["quote"], "resource_sha256": bound}
            if q != effective_quote or record["binding_sha256"] != bound:
                raise AssertionError("Purchase terms not bound")
            if record["authority_binding_sha256"] != digest(AUTHORITY_DOMAIN, q):
                raise AssertionError("Authority binding mismatch")
            invoice = (q["payee"], q["invoice_id"])
            if invoice in invoices or q["payer"] not in p["agents"] or q["payee"] not in p["payees"]:
                raise AssertionError("Duplicate invoice or unauthorized party")
            invoices.add(invoice)
            if q["purpose"] not in p["purposes"] or q["amount"] > p["payment_limit"]:
                raise AssertionError("Purchase outside mandate")
            if q["network"] != "SIMULATED_NETWORK" or q["asset"] != "SIMULATED_UNIT":
                raise AssertionError("Unexpected economic rail")
            if request["recurring"]:
                cycle = (request["subscription_id"], request["cycle"])
                if cycle in cycles:
                    raise AssertionError("Duplicate subscription cycle")
                cycles.add(cycle)
            if payment["state"] == "SETTLED":
                spent += q["amount"]
            if payment["state"] in {"SETTLED", "FAILED"}:
                if payment["receipt_id"] in receipts or not 0 <= payment["actual_fee"] <= q["fee_cap"]:
                    raise AssertionError("Duplicate receipt or excess fee")
                receipts.add(payment["receipt_id"])
                fees += payment["actual_fee"]
            if payment["state"] in {"AUTHORIZED", "IN_FLIGHT"}:
                held += q["amount"]
                fees_held += q["fee_cap"]
            amount = refunds.get(pid, 0)
            if amount != record["refunded"] or not 0 <= amount <= q["amount"]:
                raise AssertionError("Refund total mismatch")
            refunded += amount
            order = record["fulfillment_order"]
            if order is not None:
                if order in orders or payment["state"] != "SETTLED":
                    raise AssertionError("Invalid supplier order")
                orders.add(order)
        expected = {"payment_spent": spent, "fee_spent": fees, "payment_reserved": held,
                    "fee_reserved": fees_held, "payment_remaining": p["payment_budget"] - spent - held,
                    "fee_remaining": p["fee_budget"] - fees - fees_held}
        if expected != core["totals"] or min(expected.values()) < 0:
            raise AssertionError("Budget accounting mismatch")
        accounting = {"gross_settled_principal": spent, "refunded_principal": refunded,
                      "net_settled_principal": spent - refunded, "fee_spent": fees,
                      "refunds_restore_spending_budget": False}
        if accounting != state["accounting"]:
            raise AssertionError("Commerce accounting mismatch")
    return len(views)


def run():
    checks = []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    def cli(*args, optimized=False, expected=0):
        process = subprocess.run([sys.executable, *(["-O"] if optimized else []), "-bb", "-X", "dev",
                                  "-W", "error", "-m", "zoora_community.commerce", *map(str, args)],
                                 cwd=ROOT, capture_output=True, text=True, timeout=20)
        if process.returncode != expected or "Traceback" in process.stderr:
            raise AssertionError("Unexpected commerce CLI result: " + process.stderr[-160:])
        return json.loads(process.stdout if expected == 0 else process.stderr)

    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    source = ROOT / "examples/commerce-input.json"
    reference = (ROOT / "examples/commerce-reference.json").read_bytes()
    with tempfile.TemporaryDirectory(prefix="zoora-commerce-evidence-") as name:
        root = Path(name)
        normal, optimized = root / "normal.json", root / "optimized.json"
        meta = cli("run", "--input", source, "--out", normal)
        check("normal CLI reproduces all 38 retained actions", meta["actions"] == 38)
        check("complete report matches the retained reference bytes", normal.read_bytes() == reference)
        opt = cli("run", "--input", source, "--out", optimized, optimized=True)
        check("optimized CLI preserves validation and exact report bytes", opt == meta and optimized.read_bytes() == reference)
        for mode in (False, True):
            result = cli("replay", "--input", normal, "--sha256", meta["fingerprint"], optimized=mode)
            check("external pin/full replay " + ("optimized" if mode else "normal"), result["verified"] and result["actions"] == 38)
        report = json.loads(reference)
        views = inspect(report)
        check("independent accounting and binding audit covers every retained state", views == 39)
        check("gross, refunds, net principal and fees match expected synthetic allocations",
              report["final_state"]["accounting"] == {"gross_settled_principal": 130,
                  "refunded_principal": 25, "net_settled_principal": 105, "fee_spent": 8,
                  "refunds_restore_spending_budget": False})
        outcomes = [e["outcome"] for e in report["events"]]
        check("activity/platform rules refuse prohibited and unimplemented categories",
              all(x in outcomes for x in ["PLATFORM_PROHIBITED", "SEPARATE_TRADING_AUTHORITY_REQUIRED",
                  "OWNER_ACCOUNT_SETUP_REQUIRED", "SHOPIFY_BILLING_ROUTE_UNSUPPORTED", "PRINTFUL_BILLING_ROUTE_UNSUPPORTED"]))
        check("cycle duplication, shared budget exhaustion and excess refunds are refused",
              all(x in outcomes for x in ["SUBSCRIPTION_CYCLE_ALREADY_BOUND", "PAYMENT_BUDGET", "REFUND_EXCEEDS_SETTLEMENT"]))
        check("one supplier order survives repeated fulfillment messages",
              sum(r["fulfillment_order"] is not None for r in report["final_state"]["purchases"]) == 1
              and "FULFILLMENT_ALREADY_BOUND" in outcomes)
        late = report["events"][33]["state"]["authority"]
        check("uncertain principal remains reserved after authority/route/invoice expiry and revocation",
              late["at_tick"] == 50 and late["revoked"] and late["totals"]["payment_reserved"] == 30)
        check("report makes no provider, wallet, custody, service or durable execution claim",
              report["classification"] == "SYNTHETIC" and not report["wallet_execution"]
              and not report["provider_integration"] and not report["service_integration"]
              and not report["durable_execution"] and report["provider_eligibility"] == "DECLARED_FIXTURE_ONLY")
        denied = cli("run", "--input", source, "--out", normal, expected=1)
        check("existing report cannot be overwritten", denied["error"] == "SPENDING_OUTPUT_REQUIRES_NEW_FILE"
              and normal.read_bytes() == reference)
        denied = cli("replay", "--input", normal, "--sha256", "0" * 64, expected=1)
        check("wrong external pin is refused", denied["error"] == "COMMERCE_REPORT_PIN_MISMATCH")
        bad = copy.deepcopy(report)
        bad["final_state"]["accounting"]["net_settled_principal"] = 1
        bad["fingerprint"] = digest(DOMAIN, {k: v for k, v in bad.items() if k != "fingerprint"})
        forged = root / "forged.json"
        forged.write_text(canonical(bad), encoding="utf-8")
        denied = cli("replay", "--input", forged, "--sha256", bad["fingerprint"], expected=1)
        check("rehashed fabricated accounting fails full replay", denied["error"] == "COMMERCE_REPLAY_MISMATCH")
        for mutate in ("refund", "binding", "budget"):
            bad = copy.deepcopy(report)
            state = bad["final_state"]
            if mutate == "refund":
                state["refunds"][0]["amount"] += 1
            elif mutate == "binding":
                state["purchases"][0]["request"]["method"] = "bank"
            else:
                state["authority"]["totals"]["payment_remaining"] += 1
            caught = False
            try:
                inspect(bad)
            except AssertionError:
                caught = True
            check("independent auditor rejects tampered " + mutate, caught)
        bad_source = json.loads(source.read_bytes())
        bad_source["policy"]["private_key"] = "never ingest wallet secrets"
        invalid, absent = root / "invalid.json", root / "absent.json"
        invalid.write_text(canonical(bad_source), encoding="utf-8")
        denied = cli("run", "--input", invalid, "--out", absent, expected=1)
        check("unsupported secret fields fail before output publication", denied["error"] == "INVALID_FIELDS" and not absent.exists())
        (output / "commerce-report.json").write_bytes(reference)
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "classification": "SYNTHETIC", "checks": checks, "actions": 38,
                "independently_checked_states": views, "fingerprint": meta["fingerprint"],
                "transactions_submitted": 0, "wallet_execution": False, "provider_integration": False,
                "durable_execution": False, "service_authorization": False, "public_deployment": False}
    (output / "commerce-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))


if __name__ == "__main__":
    run()
