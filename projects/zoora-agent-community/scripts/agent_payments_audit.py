"""Independent fixture/report audit; no application imports or model execution."""

import argparse
from collections import Counter
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import zipfile

from payment_recovery_audit import check_package, database, digest, encoded, require


def verify(report, package, source):
    require(report["source_head_sha"] == source, "source head")
    require(report["classification"] == "AGENT_PAYMENT_TOOLS_ACTUAL_CLI_SYNTHETIC_MODEL_LOCAL_TLS"
            and report["real_model_verified"] is False, "model classification")
    require(len(report["checks"]) == len(set(report["checks"])) == 29, "acceptance check count")
    require(report["external_bridge_requests"] == 0 and report["real_funds_authorized"] is False
            and report["wallet_execution"] is False and report["settlement_accounting"] == "UNAVAILABLE", "execution boundary")
    require("sk-test" not in encoded(report).decode() and "za1_" not in encoded(report).decode(), "credential redaction")
    require(report["admitted_principal_usdc"] == "8.750000" and report["fixture_submitted_principal_usdc"] == "5.000000"
            and report["unique_fixture_transfers"] == 4, "principal quantities")
    book = report["source_book"]
    state = book["state"]
    require(hashlib.sha256(b"ZOORA_AE022_COMMERCE_ROUTER_V1\0" + encoded(state)).hexdigest() == book["state_sha256"], "source state hash")
    require(state["accounting"] == {"gross_settled_principal": 0, "refunded_principal": 0, "net_settled_principal": 0,
        "fee_spent": 0, "refunds_restore_spending_budget": False}, "zero source settlement")
    require(state["authority"]["totals"] == {"payment_remaining": 93, "payment_reserved": 7, "payment_spent": 0,
        "fee_remaining": 79, "fee_reserved": 21, "fee_spent": 0}, "separate synthetic source reservations")
    require(Counter(p["state"] for p in state["authority"]["payments"]) == {"IN_FLIGHT": 5, "AUTHORIZED": 2}, "source payment states")
    require(all(p["fulfillment_order"] is None for p in state["purchases"]), "no paid fulfillment")
    require(report["package_audit"] == report["audit"], "snapshot audit identity")
    package = Path(package)
    with zipfile.ZipFile(package) as archive, tempfile.TemporaryDirectory(prefix="independent-agent-orders-") as name:
        queue = database(archive.read("payment-pipeline.sqlite3"), Path(name) / "queue.sqlite3",
            {"control": "id", "pipeline_recovery": "id", "orders": "id", "claims": "order_id,sequence"}, 2)
        mandate = json.loads(queue["control"][0]["mandate_json"])
    require(book["operator_id"] == mandate["operator_id"], "source operator")
    aliases = {b["alias"]: b["agent_id"] for b in book["bindings"]}
    purchases = {p["request"]["quote"]["purchase_id"]: p for p in state["purchases"]}
    inventory = {r["order_id"]: r for r in report["audit"]["inventory"]}
    links = {}
    for order in queue["orders"]:
        saved = json.loads(order["terms_json"])
        e = saved["envelope"]
        purchase = purchases[e["purchase_id"]]
        request = purchase["request"]
        merchant = next(m for m in mandate["merchants"] if m["merchant"] == request["quote"]["payee"])
        expected = {"envelope": {"book_id": book["id"], "purchase_id": e["purchase_id"],
            "commerce_binding_sha256": purchase["binding_sha256"], "amount_usdc": "1.250000"},
            "agent_id": aliases[request["quote"]["payer"]], "commerce_request": request,
            "intent": {"request_id": order["id"], "customer_id": mandate["customer_id"],
                "source_address": mandate["source_address"], "destination_address": merchant["destination_address"],
                "amount_usdc": "1.250000"}}
        require(saved == expected, "actual source-to-queue terms")
        links[order["id"]] = {"order": {"terms": expected}}
    require(check_package(package, report["package_sha256"], report["package_audit"], links) == 7, "seven actual database bindings")
    audit = report["audit"]
    require(audit["claims"] == 11 and audit["dispatch_fences"] == 5 and audit["unfinished_claims"] == 0
            and audit["provider"]["journal_intents"] == 6 and audit["provider"]["journal_attempts"] == 9, "queue/provider history counts")
    require(report["provider_attempt_kinds"] == {"CREATE": 5, "POLL": 3, "RECONCILE": 1}, "conservative guard attempt")
    wire = report["wire"]
    require(len(wire) == 15 and Counter(r["method"] for r in wire) == {"POST": 4, "GET": 11}, "wire counts")
    posts = [w for w in wire if w["method"] == "POST"]
    require(len({w["idempotency_key"] for w in posts}) == 4, "unique create keys")
    for post in posts:
        item = next(r for r in inventory.values() if r["idempotency_key"] == post["idempotency_key"])
        require(post["body_sha256"] == item["provider_body_sha256"] and item["known_transfer_id"] is not None, "wire-to-journal body")
    require(all(w["body_sha256"] is None and w["idempotency_key"] is None for w in wire if w["method"] == "GET"), "read-only request shape")
    cases = {c["label"]: c for c in report["cases"]}
    require(len(cases) == len(report["cases"]) == 15 and len(report["reports"]) == 14, "retained case count")
    for retained in report["reports"]:
        raw = encoded(retained["report"]) + b"\n"
        require(hashlib.sha256(raw).hexdigest() == retained["report_sha256"], "private report digest")
        require(retained["report"] == cases[retained["label"]]["report"], "case/report correlation")
    require(len(cases["disabled"]["model_requests"][1][1]["tools"]) == 4
            and cases["disabled"]["cli_result"]["error"] == "TOOL_NOT_ALLOWED", "default-deny registry")
    require(len(cases["direct"]["model_requests"][1][1]["tools"]) == 6, "explicit registry")
    for case in cases.values():
        data = case["report"]
        if data is None or "sandbox_payments" not in data:
            continue
        payment = data["sandbox_payments"]
        require(payment["scope_sha256"] == digest(payment["scope"]), "host scope hash")
        require(payment["scope"]["agent_id"] == data["agent_id"]
                and payment["scope"]["instance_id"] == audit["source_instance_id"], "host scope identity")
        require(0 <= payment["advances_attempted"] <= payment["scope"]["max_advances"] <= 2, "run bound")
        for outcome in payment["outcomes"]:
            key = outcome["order_id"]
            require(key in payment["scope"]["order_ids"] and links[key]["order"]["terms"]["agent_id"] == data["agent_id"], "selected order receipt")
            require(outcome["wallet_execution"] is False and outcome["real_funds_authorized"] is False
                    and outcome["settlement_accounting"] == "UNAVAILABLE", "receipt boundary")
    queued = cases["queued"]
    require(queued["terminal_job"]["state"] == "SUCCEEDED" and queued["report"]["job"] == {
        "job_id": queued["job"]["id"], "attempt_id": queued["terminal_job"]["attempt_id"]}, "durable job binding")
    require(cases["unknown"]["terminal_job"]["state"] == "FAILED"
            and cases["unknown"]["terminal_job"]["artifact_id"] is None, "uncertain task failure")
    require(cases["unknown-again"]["report"]["sandbox_payments"]["outcomes"][0]["candidate_count"] == 1
            and cases["unknown-again"]["report"]["sandbox_payments"]["outcomes"][0]["phase"] == "RECONCILIATION_REQUIRED", "manual recovery boundary")
    for label in ("foreign", "forged", "outside", "last-step", "expired"):
        require(cases[label]["request_start"] == cases[label]["request_end"], "denied action before provider HTTP")
    require(cases["foreign"]["model_requests"] == [] and cases["expired"]["model_requests"] == [], "pre-inference denial")
    require(cases["limited"]["cli_result"]["error"] == "AGENT_PAYMENT_ADVANCE_LIMIT", "advance bound")
    require(report["actual_process_death_exit"] == cases["crashed"]["exit_code"] == 88
            and cases["crashed"]["report"] is None, "process death boundary")
    require(cases["restarted"]["request_end"] == cases["restarted"]["request_start"] + 1
            and wire[cases["restarted"]["request_start"]]["method"] == "GET", "GET-only explicit restart")
    require(report["stop_job"]["state"] == "CANCELLED" and report["stop_job"]["artifact_id"] is None
            and report["stop_report"]["error"] == "JOB_STOPPED", "task stop")
    require(report["stop_report"]["sandbox_payments"]["outcomes"][0]["phase"] == "PROVIDER_UNKNOWN", "conservative stopped receipt")
    return {"verified": True, "source_sha": source, "cases": 15, "report_digests": 14,
        "database_order_bindings": 7, "post_requests": 4, "get_requests": 11, "external_attestation": "UNAVAILABLE"}


def mutation_checks(report, package, source):
    mutations = [lambda d: d.update(source_head_sha="0" * 40), lambda d: d.update(external_bridge_requests=1),
        lambda d: d.update(real_model_verified=True), lambda d: d.update(admitted_principal_usdc="8.750001"),
        lambda d: d.update(package_sha256="0" * 64), lambda d: d["wire"][1].update(idempotency_key="wrong"),
        lambda d: d["cases"][4]["report"]["sandbox_payments"]["outcomes"][0].update(candidate_count=2),
        lambda d: d["cases"][1]["report"]["sandbox_payments"]["scope"].update(agent_id="f" * 32),
        lambda d: d["reports"][0].update(report_sha256="0" * 64),
        lambda d: d["stop_job"].update(state="SUCCEEDED"),
        lambda d: d["stop_report"]["sandbox_payments"]["outcomes"][0].update(phase="PROVIDER_OBSERVED"),
        lambda d: d.update(actual_process_death_exit=87),
        lambda d: d["source_book"]["state"]["accounting"].update(net_settled_principal=1),
        lambda d: d["provider_attempt_kinds"].update(CREATE=4)]
    for mutate in mutations:
        changed = copy.deepcopy(report)
        mutate(changed)
        require(encoded(changed) != encoded(report), "mutation must change data")
        try:
            verify(changed, package, source)
        except (ValueError, KeyError, StopIteration):
            continue
        raise ValueError("altered agent evidence accepted")
    return len(mutations)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    report = json.loads(args.report.read_bytes())
    result = verify(report, args.fixture, args.source_sha)
    if args.self_test:
        result["deliberate_alterations_rejected"] = mutation_checks(report, args.fixture, args.source_sha)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
