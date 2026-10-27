"""Actual API + concurrent CLI + local TLS; crashes at four cross-database handoffs."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time

from bridge_fixture import KEY, ProviderFixture, intent
from durable_commerce_evidence import policy, purchase
from fixture_signatures import address, signed_body
from integration_evidence import ROOT, Running, command
from zoora_community.client import read_credential
from zoora_community.payment_pipeline import LEASE_MS, PaymentPipeline
from zoora_community.store import Store
from zoora_community.validation import Problem, canonical


def run(after_rehearsal=None, recovery_checkpoint=None):
    checks, outputs, tokens, crash_records = [], [], [], []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    with tempfile.TemporaryDirectory(prefix="zoora-connected-payments-") as name:
        folder = Path(name)
        community_state, owner_file = folder / "community", folder / "owner.json"
        command("init", "--state", community_state, "--owner-file", owner_file)
        owner = read_credential(owner_file)
        tokens.append(owner)
        running = Running(community_state, folder)
        provider = ProviderFixture()
        try:
            operator_result = running.client.request("POST", "/v1/operators", {"handle": "pipeline_operator"}, owner)[1]
            operator, operator_id = operator_result["credential"]["token"], operator_result["operator"]["id"]
            tokens.append(operator)

            def save_credential(label, value):
                path = folder / (label + ".json")
                path.write_text(canonical(value), encoding="utf-8")
                path.chmod(0o600)
                return path

            operator_file = save_credential("operator", operator_result["credential"])
            agents, agent_files, bindings = [], [], []
            for index, alias in enumerate(("agent_one", "agent_two")):
                label = "PUBLIC-PIPELINE-FIXTURE-NEVER-FUND-" + str(index)
                challenge = running.client.request("POST", "/v1/wallet/challenges", {"handle": alias,
                    "wallet": address(label), "capabilities": ["research"]}, operator)[1]
                enrolled = running.client.request("POST", "/v1/agents", signed_body(challenge, label), operator)[1]
                agents.append(enrolled["credential"]["token"])
                tokens.append(agents[-1])
                agent_files.append(save_credential(alias, enrolled["credential"]))
                bindings.append({"alias": alias, "agent_id": enrolled["agent"]["id"]})
            config = policy()
            config["authority"].update(payment_budget=100, fee_budget=100, expires=900_000)
            config["routes"][0]["eligible_until"] = 900_000
            created = running.client.request("POST", "/v1/commerce/books", {"request_id": "a" * 32,
                "policy": config, "bindings": bindings}, operator)[1]["book"]
            route = "/v1/commerce/books/" + created["id"]
            source = running.client.request("GET", "/v1/status")[1]
            at = source["observed_at_ms"]
            pipeline_state = folder / "pipeline"
            pipeline = PaymentPipeline(pipeline_state, clock=lambda: at)
            key = folder / "sandbox-key"
            key.write_text(KEY, encoding="ascii")
            key.chmod(0o600)
            mandate = {"mandate_id": "b" * 32, "environment": "BRIDGE_SANDBOX", "real_funds_authorized": False,
                "instance_id": source["instance_id"], "operator_id": operator_id,
                "agents": [b["agent_id"] for b in bindings], "customer_id": intent()["customer_id"],
                "source_address": intent()["source_address"], "merchants": [{"merchant": "supplier",
                    "destination_address": intent()["destination_address"], "activities": ["white_label_supply"]}],
                "payment_limit_usdc": "2", "admission_budget_usdc": "14", "valid_from_ms": at - 1000,
                "expires_ms": at + 2_000_000}
            mandate_file = folder / "mandate.json"
            mandate_file.write_text(canonical(mandate), encoding="utf-8")
            mandate_file.chmod(0o600)

            with provider.serve():
                def checkpoint(label, order=None):
                    if recovery_checkpoint is not None:
                        recovery_checkpoint(label, {"folder": folder, "pipeline": pipeline, "provider": provider,
                            "at": at, "order_id": order})

                def cli(args, expected=0, crash="normal"):
                    completed = provider.pipeline_cli(pipeline_state, args, at=at, crash=crash)
                    outputs.append(completed.stdout + completed.stderr)
                    if completed.returncode != expected:
                        raise AssertionError("Unexpected connected CLI result: " + completed.stderr)
                    return json.loads(completed.stdout or completed.stderr) if completed.stdout or completed.stderr else None

                def op(name, *, agent=0, key_id=None, expected=0, crash="normal", transfer=None, limit=8, workers=4):
                    args = [name]
                    if name in {"run-one", "run-batch"}:
                        args += ["--port", running.port, "--credential-file", agent_files[agent]]
                    if name in {"run-one", "run-batch", "recover"}:
                        args += ["--key-file", key]
                    if key_id:
                        args += ["--order-id", key_id]
                    if transfer:
                        args += ["--transfer-id", transfer]
                    if name == "run-batch":
                        args += ["--limit", limit, "--workers", workers]
                    return cli(args, expected, crash)

                def new_purchase(index, amount="1", agent=0):
                    response = running.client.request("POST", route + "/actions", {"request_id": f"{index + 10000:032x}",
                        "command": purchase(index, amount=1)}, agents[agent])[1]
                    if response["outcome"] != "AUTHORIZED":
                        raise AssertionError(response["outcome"])
                    record = next(r for r in response["book"]["state"]["purchases"] if r["request"]["quote"]["purchase_id"] == f"{index:032x}")
                    envelope = {"book_id": created["id"], "purchase_id": f"{index:032x}",
                        "commerce_binding_sha256": record["binding_sha256"], "amount_usdc": amount}
                    path = folder / ("purchase-" + str(index) + ".json")
                    path.write_text(canonical(envelope), encoding="utf-8")
                    return envelope, path, agent

                def stage(item, expected=0):
                    _envelope, path, agent = item
                    return cli(["stage", "--port", running.port, "--credential-file", agent_files[agent], "--request-file", path], expected)

                initial = cli(["init", "--port", running.port, "--credential-file", operator_file, "--mandate-file", mandate_file])
                check("actual operator CLI initializes an instance-bound sandbox mandate without provider HTTP",
                      initial["instance_id"] == source["instance_id"] and initial["orders"] == [] and provider.requests == [])
                inputs = [new_purchase(i, "1.25", 1 if i == 4 else 0) for i in (1, 2, 3, 4)]
                with ThreadPoolExecutor(max_workers=4) as pool:
                    queued = list(pool.map(stage, inputs))
                check("four independent CLI processes stage two agents' purchases against one exact admission cap",
                      pipeline.show()["admitted_principal_usdc"] == "5.000000" and pipeline.audit()["orders"] == 4)
                checkpoint("before_dispatch")
                check("exact staging replay keeps the purchase identity and budget unchanged",
                      stage(inputs[0])["replayed"] and pipeline.show()["admitted_principal_usdc"] == "5.000000")
                changed = {**inputs[0][0], "amount_usdc": "1.5"}
                conflict_file = folder / "conflict.json"
                conflict_file.write_text(canonical(changed), encoding="utf-8")
                conflict = cli(["stage", "--port", running.port, "--credential-file", agent_files[0], "--request-file", conflict_file], 1)
                check("changed sandbox amount cannot create a second identity for the same source purchase", conflict["error"] == "PIPELINE_ORDER_CONFLICT")
                check("an independently priced amount above the USDC per-payment cap is refused",
                      stage(new_purchase(5, "2.000001"), 1)["error"] == "PIPELINE_PAYMENT_LIMIT")

                provider.mode = "block_reads"
                start = len(provider.requests)
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(op, "run-batch", limit=3, workers=3, crash="source-reply-drop")
                    deadline = time.monotonic() + 8
                    while len(provider.requests) - start < 3 and time.monotonic() < deadline:
                        time.sleep(0.01)
                    arrivals = len(provider.requests) - start
                    pending_methods = [r["method"] for r in provider.requests[start:]]
                    provider.release.set()
                    parallel = future.result()
                provider.mode = "ok"
                check("three workers reach actual customer HTTPS reads concurrently before any read is released",
                      arrivals == 3 and pending_methods == ["GET"] * 3)
                check("one batch advances three different authenticated purchases to three bound provider observations",
                      parallel["orders_selected"] == 3 and all(r["phase"] == "PROVIDER_OBSERVED" for r in parallel["outcomes"])
                      and len(provider.effects) == 3)
                source_reply_loss = json.loads((pipeline_state / "fixture-source-reply.json").read_text(encoding="utf-8"))
                check("discarded committed source HTTP reply is retried with the same body and returns one authenticated replay",
                      source_reply_loss["first_replayed"] is False and source_reply_loss["replay_observed"] is True
                      and source_reply_loss["first_outcome"] == source_reply_loss["replay_outcome"] == "SIMULATED_SUBMISSION"
                      and source_reply_loss["original_body_sha256"] == source_reply_loss["replay_body_sha256"])
                check("the first agent's batch leaves the second agent's purchase queued",
                      next(r for r in pipeline.show()["orders"] if r["order_id"] == queued[3]["order_id"])["phase"] == "QUEUED")
                provider.customer["status"] = "paused"
                before = len(provider.effects)
                blocked = op("run-batch", agent=1, expected=2)
                check("paused provider account blocks that agent without creating an effect or synthetic submit",
                      blocked["outcomes"][0]["phase"] == "PREFLIGHT_BLOCKED" and len(provider.effects) == before)
                provider.customer["status"] = "active"
                check("a fresh customer check permits the previously unattempted order after the signal changes",
                      op("run-batch", agent=1)["outcomes"][0]["phase"] == "PROVIDER_OBSERVED" and len(provider.effects) == 4)

                for index, kind, exit_code in ((10, "submit", 82), (11, "create", 83), (12, "fence", 84), (13, "finish", 85)):
                    key_id = stage(new_purchase(index))["order_id"]
                    before_requests, before_effects = len(provider.requests), len(provider.effects)
                    op("run-one", key_id=key_id, expected=exit_code, crash=kind)
                    interrupted = pipeline.bridge.show(key_id)
                    audit = pipeline.audit()
                    check("actual process death at " + kind + " leaves a durable unfinished queue claim",
                          next(r for r in pipeline.show()["orders"] if r["order_id"] == key_id)["phase"] == "CLAIMED_UNKNOWN"
                          and audit["unfinished_claims"] == len(crash_records) + 1)
                    before = len(provider.requests)
                    check("live lease at " + kind + " blocks a competing CLI before provider HTTP",
                          op("run-one", key_id=key_id, expected=1)["error"] == "PIPELINE_ORDER_BUSY" and len(provider.requests) == before)
                    checkpoint(kind, key_id)
                    at += LEASE_MS + 1
                    if kind == "create":
                        recovered = op("run-one", key_id=key_id, expected=2)
                        check("crash after provider acceptance recovers through bounded discovery with no replacement POST",
                              recovered["phase"] == "RECONCILIATION_REQUIRED" and len(recovered["candidate_ids"]) == 1
                              and len(provider.effects) == before_effects + 1)
                        recovered = op("recover", key_id=key_id, transfer=recovered["candidate_ids"][0])
                        op("run-one", key_id=key_id)
                    else:
                        recovered = op("run-one", key_id=key_id)
                    final = pipeline.bridge.show(key_id)
                    check("later process at " + kind + " preserves the provider key and one fixture effect",
                          recovered["phase"] == "PROVIDER_OBSERVED" and final["idempotency_key"] == interrupted["idempotency_key"]
                          and len(provider.effects) == before_effects + 1)
                    if kind in {"submit", "fence"}:
                        check("pre-provider crash at " + kind + " rolls back provider attempt while retaining conservative admission",
                              interrupted["attempts"] == 0 and final["attempts"] == 1)
                    if kind == "finish":
                        check("crash after provider persistence resumes through GET without another preflight or POST",
                              final["attempts"] == 2 and provider.requests[-1]["method"] == "GET")
                    crash_records.append({"kind": kind, "exit_code": exit_code, "order_id": key_id,
                        "request_start": before_requests, "request_end": len(provider.requests),
                        "idempotency_key_before": interrupted["idempotency_key"], "idempotency_key_after": final["idempotency_key"],
                        "attempts_at_crash": interrupted["attempts"], "attempts_after_recovery": final["attempts"]})

                race_inputs = [new_purchase(i, "2") for i in (14, 15, 16)]
                with ThreadPoolExecutor(max_workers=3) as pool:
                    def contender(item):
                        completed = provider.pipeline_cli(pipeline_state, ["stage", "--port", running.port,
                            "--credential-file", agent_files[0], "--request-file", item[1]], at=at)
                        outputs.append(completed.stdout + completed.stderr)
                        return completed.returncode, json.loads(completed.stdout or completed.stderr)
                    race = list(pool.map(contender, race_inputs))
                check("three concurrent stage processes admit only two two-USDC instructions into five remaining USDC",
                      sorted(code for code, _value in race) == [0, 0, 1]
                      and next(v for c, v in race if c == 1)["error"] == "PIPELINE_ADMISSION_BUDGET"
                      and pipeline.show()["admitted_principal_usdc"] == "13.000000")
                waiting = next(value["order_id"] for code, value in race if code == 0)
                revoked = cli(["revoke", "--port", running.port, "--credential-file", operator_file])
                before = len(provider.requests)
                stopped = op("run-one", key_id=waiting, expected=2)
                check("operator revocation blocks a queued new dispatch before any provider HTTP",
                      revoked["revoked_ms"] is not None and stopped["code"] == "PIPELINE_MANDATE_REVOKED" and len(provider.requests) == before)
                check("private-host recovery of a prior transfer remains GET-only after revocation",
                      op("recover", key_id=queued[0]["order_id"])["phase"] == "PROVIDER_OBSERVED" and provider.requests[-1]["method"] == "GET")
                status, audit = cli(["show"]), cli(["audit"])
                book = running.client.request("GET", route, token=operator)[1]
                accounting = book["state"]["accounting"]
                check("provider observations never credit synthetic settlement fees refunds or fulfillment",
                      accounting == {"gross_settled_principal": 0, "refunded_principal": 0,
                          "net_settled_principal": 0, "fee_spent": 0, "refunds_restore_spending_budget": False}
                      and all(r["fulfillment_order"] is None for r in book["state"]["purchases"]))
                check("combined status holds every admitted instruction without converting synthetic units or releasing uncertainty",
                      status["admitted_principal_usdc"] == "13.000000" and status["remaining_admission_usdc"] == "1.000000"
                      and not status["automatic_exposure_release"] and not status["synthetic_unit_conversion"])
                check("four interruptions remain historical while complete queue audit reconciles claims and dispatch fences",
                      audit["orders"] == 10 and audit["claims"] == 17 and audit["unfinished_claims"] == 4 and audit["dispatch_fences"] == 9)
                Store(community_state).audit()
                provider_audit = pipeline.bridge.audit()
                with closing(sqlite3.connect(pipeline.bridge.path)) as connection:
                    kinds = dict(connection.execute("SELECT kind,COUNT(*) FROM attempts GROUP BY kind"))
                check("independent provider SQLite inspection reconciles eight creates three polls and one explicit reconciliation",
                      kinds == {"CREATE": 8, "POLL": 3, "RECONCILE": 1} and provider_audit["journal_attempts"] == 12)
                with closing(sqlite3.connect(community_state / "community.sqlite3")) as connection:
                    dispatches = []
                    for row in connection.execute("SELECT book_id,request_id,request_json,actor_id,sequence,outcome FROM commerce_actions ORDER BY sequence"):
                        body = json.loads(row[2])
                        if "sandbox_dispatch" in body:
                            dispatches.append({"book_id": row[0], "request_id": row[1], "agent_id": row[3], "sequence": row[4],
                                "outcome": row[5], **body["sandbox_dispatch"]})
                check("source database retains eight authenticated submissions bound to exact pipeline terms and source instance",
                      len(dispatches) == 8 and all(d["instance_id"] == source["instance_id"] and d["outcome"] == "SIMULATED_SUBMISSION" for d in dispatches))
                links = []
                for row in status["orders"]:
                    try:
                        bridge = pipeline.bridge.show(row["order_id"])
                    except Problem as error:
                        if error.code != "BRIDGE_INTENT_NOT_FOUND":
                            raise
                        bridge = None
                    links.append({"order": row, "provider": bridge})
                wire = [{"method": r["method"], "path": r["path"],
                    "idempotency_key": r["headers"].get("Idempotency-Key"),
                    "body_sha256": hashlib.sha256(r["body"].encode()).hexdigest() if r["body"] is not None else None}
                    for r in provider.requests]
                check("the complete rehearsal creates eight distinct fixture transfers through exactly eight POSTs",
                      len(provider.effects) == 8 and len(wire) == 24
                      and sum(r["method"] == "POST" for r in wire) == 8
                      and len({r["idempotency_key"] for r in wire if r["method"] == "POST"}) == 8)
                check("bearer credentials and provider keys remain absent from all CLI outputs and the queue database",
                      all(all(secret not in output for secret in [KEY, *tokens]) for output in outputs)
                      and all(secret.encode() not in pipeline.path.read_bytes() for secret in [KEY, *tokens]))
                if after_rehearsal is not None:
                    after_rehearsal({"folder": folder, "pipeline": pipeline, "provider": provider, "at": at,
                        "key": key, "running": running, "agent_file": agent_files[0], "operator_file": operator_file,
                        "tokens": tokens, "source_state": book["state"], "bindings": links})
        finally:
            running.stop()
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
        "classification": "CONNECTED_LOCAL_API_CLI_HTTPS_FIXTURE", "checks": checks,
        "transport": "ACTUAL_AUTHENTICATED_LOOPBACK_HTTP_AND_VERIFIED_LOCAL_TLS",
        "clock": "PIPELINE_CLOCK_INJECTED_FOR_LEASES_COMMUNITY_SERVER_REAL_TIME", "parallel_customer_read_arrivals": arrivals,
        "mandate": mandate, "combined_status": status, "pipeline_audit": audit, "provider_audit": provider_audit,
        "provider_attempt_kinds": kinds, "source_dispatches": dispatches, "fixture_bindings": links, "crashes": crash_records,
        "source_commerce_state": book["state"], "source_commerce_policy": book["policy"],
        "source_commerce_bindings": book["bindings"], "source_commerce_state_sha256": book["state_sha256"],
        "source_book_id": book["id"],
        "source_reply_loss": source_reply_loss,
        "wire": wire, "http_requests": len(wire), "post_requests": 8, "get_requests": 16,
        "unique_fixture_transfers": 8, "synthetic_accounting": accounting,
        "admitted_principal_usdc": "13.000000", "fixture_submitted_principal_usdc": "9.000000",
        "external_bridge_requests": 0, "provider_account_acceptance": "UNVERIFIED", "real_funds_authorized": False,
        "wallet_execution": False, "transactions_submitted": 0, "settlement_accounting": "UNAVAILABLE"}
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    (output / "payment-pipeline.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))
    return evidence


if __name__ == "__main__":
    run()
