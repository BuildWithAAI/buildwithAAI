"""Actual agent/job CLI and local TLS; SYNTHETIC model protocol, no real inference."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time

from agent_payment_fixture import private_json, scope_file, setup_payments
from bridge_fixture import KEY, ProviderFixture
from fixture_signatures import address, signed_body
from integration_evidence import ROOT, Running, command
from model_fixture import ModelFixture
from zoora_community.client import read_credential
from zoora_community.payment_recovery import audit, create_backup
from zoora_community.validation import canonical


def run():
    checks, cases, outputs, reports = [], [], [], []

    def check(label, condition):
        if not condition:
            raise AssertionError(label)
        checks.append(label)

    with tempfile.TemporaryDirectory(prefix="zoora-agent-payments-") as name:
        folder = Path(name)
        community, owner_file = folder / "community", folder / "owner.json"
        command("init", "--state", community, "--owner-file", owner_file)
        owner = read_credential(owner_file)
        running = Running(community, folder)
        provider = ProviderFixture()
        try:
            enrolled_operator = running.client.request("POST", "/v1/operators", {"handle": "agent_payment_operator"}, owner)[1]
            operator = enrolled_operator["credential"]["token"]
            agents, agent_files = [], []
            for index, handle in enumerate(("payment_agent_one", "payment_agent_two")):
                label = "PUBLIC-AGENT-PAYMENT-FIXTURE-NEVER-FUND-" + str(index)
                challenge = running.client.request("POST", "/v1/wallet/challenges", {"handle": handle,
                    "wallet": address(label), "capabilities": ["development"]}, operator)[1]
                agent = running.client.request("POST", "/v1/agents", signed_body(challenge, label), operator)[1]["credential"]
                agents.append(agent)
                agent_files.append(private_json(folder / ("agent-" + str(index) + ".json"), agent))
            project = running.client.request("POST", "/v1/projects", {"title": "Agent sandbox payment rehearsal",
                "summary": "Synthetic model/provider fixtures; zero real payments or revenue"}, agents[0]["token"])[1]
            setup = setup_payments(running.client, folder, operator, agents, [0, 0, 0, 0, 0, 0, 1])
            pipeline, orders = setup["pipeline"], [r["order_id"] for r in setup["orders"]]
            scopes = []
            with provider.serve():
                def actions(key, *, status=True):
                    return ([{"action": "sandbox_payment_status", "arguments": {}}] if status else []) + [
                        {"action": "sandbox_payment_advance", "arguments": {"order_id": key}},
                        {"action": "finish", "arguments": {"output": "Sandbox instruction only; settlement unavailable."}}]

                def run_model(label, key, *, enabled=True, allowed=None, scripted=None, queued=False,
                              expected=0, crash=False, steps=4, scope_expiry=None, prepare_only=False):
                    allowed = allowed or [key]
                    scope = scope_file(folder, setup, agents[0], allowed, expires=scope_expiry)
                    scopes.append(json.loads(scope.read_bytes()))
                    model = ModelFixture(actions=scripted or actions(key)).start()
                    token, credential = agents[0]["token"], agent_files[0]
                    job = None
                    if queued:
                        job = running.client.request("POST", "/v1/jobs", {"request_id": f"{len(cases) + 1:032x}",
                            "title": label, "prompt": "Use only the host-selected sandbox instruction; report uncertainty.",
                            "max_steps": steps, "timeout_seconds": 60, "project_id": project["id"]}, token)[1]["job"]
                        report_folder = folder / (label + "-reports")
                        arguments = ["work-jobs", "--out-dir", report_folder]
                        target = report_folder / "pending"
                    else:
                        task = private_json(folder / (label + "-task.json"), {"prompt": "Use the selected sandbox order; never infer settlement."})
                        target = folder / (label + "-report.json")
                        arguments = ["run-agent", "--task-file", task, "--out", target]
                    arguments += ["--credential-file", credential, "--model", "synthetic-fixture",
                        "--model-port", model.port, "--port", running.port, "--max-steps", steps, "--timeout", 60]
                    if enabled:
                        arguments += ["--payment-state", pipeline.state, "--sandbox-key-file", setup["key_file"], "--payment-scope-file", scope]
                    if prepare_only:
                        return {"model": model, "arguments": arguments, "job": job, "folder": report_folder, "label": label}
                    start = len(provider.requests)
                    try:
                        result = provider.agent_cli(arguments, crash=crash)
                        outputs.append(result.stdout + result.stderr)
                        if result.returncode != expected:
                            raise AssertionError("unexpected agent CLI outcome: " + result.stderr)
                        raw = next(report_folder.glob("*.json")).read_bytes() if queued else target.read_bytes() if target.exists() else b""
                        report = json.loads(raw) if raw else None
                        value = json.loads(result.stdout or result.stderr) if result.stdout or result.stderr else None
                        if report is not None:
                            reports.append({"label": label, "report": report, "report_sha256": hashlib.sha256(raw).hexdigest()})
                        record = {"label": label, "order_id": key, "exit_code": result.returncode,
                            "model_requests": model.requests, "report": report, "cli_result": value,
                            "request_start": start, "request_end": len(provider.requests), "job": job}
                        if job:
                            record["terminal_job"] = running.client.request("GET", "/v1/jobs/" + job["id"], token=token)[1]
                        cases.append(record)
                        return record
                    finally:
                        model.stop()

                disabled = run_model("disabled", orders[0], enabled=False, expected=1)
                check("default runner rejects payment tools and sends no provider request",
                      disabled["cli_result"]["error"] == "TOOL_NOT_ALLOWED" and provider.requests == [])
                check("default model receives exactly the four original tool schemas",
                      len(disabled["model_requests"][1][1]["tools"]) == 4)
                direct = run_model("direct", orders[0])
                check("actual direct runner executes status advance and finish through host opt-in tools",
                      direct["report"]["state"] == "AVAILABLE" and len(direct["report"]["steps"]) == 3
                      and direct["report"]["sandbox_payments"]["advances_attempted"] == 1)
                check("enabled model receives only six finite tool schemas and a selected sandbox order",
                      len(direct["model_requests"][1][1]["tools"]) == 6
                      and direct["report"]["steps"][0]["tool_result"]["orders"][0]["order_id"] == orders[0])
                check("actual saved report bytes match the CLI digest",
                      direct["cli_result"]["report_sha256"] == reports[-1]["report_sha256"])
                queued = run_model("queued", orders[1], queued=True)
                observed = queued["report"]["sandbox_payments"]["outcomes"][0]
                check("durable queued task binds payment receipt to its exact job and attempt",
                      queued["terminal_job"]["state"] == "SUCCEEDED" and observed["order_id"] == orders[1]
                      and queued["report"]["job"] == {"job_id": queued["job"]["id"], "attempt_id": queued["terminal_job"]["attempt_id"]})
                artifact = running.client.request("GET", "/v1/projects/" + project["id"] + "/artifacts")[1]["items"][0]
                check("job completion atomically publishes only the private report digest",
                      artifact["digest"] == reports[-1]["report_sha256"] == queued["terminal_job"]["report_sha256"])
                idle = provider.agent_cli(["work-jobs", "--credential-file", agent_files[0], "--out-dir", folder / "idle",
                    "--model", "synthetic-fixture", "--port", running.port])
                check("an empty durable queue does not repeat inference or payment work",
                      idle.returncode == 0 and json.loads(idle.stdout)["processed"] == 0 and len(provider.effects) == 2)
                provider.mode = "drop"
                unknown = run_model("unknown", orders[2], queued=True)
                provider.mode = "ok"
                check("accepted but lost provider reply fails the queued task and retains uncertainty",
                      unknown["terminal_job"]["state"] == "FAILED" and unknown["terminal_job"]["artifact_id"] is None
                      and unknown["report"]["sandbox_payments"]["outcomes"][0]["phase"] == "PROVIDER_UNKNOWN")
                again = run_model("unknown-again", orders[2], expected=1)
                check("another explicit model run discovers an unknown attempt without another POST or automatic ID binding",
                      again["report"]["sandbox_payments"]["outcomes"][0]["phase"] == "RECONCILIATION_REQUIRED"
                      and again["report"]["sandbox_payments"]["outcomes"][0]["candidate_count"] == 1
                      and len(provider.effects) == 3 and provider.requests[-1]["method"] == "GET")
                key = pipeline.bridge.show(orders[2])["idempotency_key"]
                target_id = provider.effects[key]["id"]
                reconciled = provider.pipeline_cli(pipeline.state, ["recover", "--order-id", orders[2], "--key-file", setup["key_file"],
                    "--transfer-id", target_id], at=time.time_ns() // 1_000_000)
                check("private explicit-ID recovery remains a separate operator operation",
                      reconciled.returncode == 0 and json.loads(reconciled.stdout)["transfer_id"] == target_id)
                resumed = run_model("known-again", orders[2])
                check("model continuation of a reconciled order uses its original exact transfer GET",
                      resumed["report"]["sandbox_payments"]["outcomes"][0]["phase"] == "PROVIDER_OBSERVED"
                      and provider.requests[-1]["path"] == "/v0/transfers/" + target_id)
                foreign = run_model("foreign", orders[6], expected=1)
                check("foreign-agent host scope fails before model inspection and before provider HTTP",
                      foreign["model_requests"] == [] and foreign["cli_result"]["error"] == "AGENT_PAYMENT_ORDER_NOT_AUTHORIZED"
                      and foreign["request_start"] == foreign["request_end"])
                scripted = actions(orders[4])
                scripted[1]["arguments"]["amount_usdc"] = "1000"
                forged = run_model("forged", orders[4], scripted=scripted, expected=1)
                check("model cannot substitute an amount for an immutable staged instruction",
                      forged["report"]["state"] == "FAILED" and forged["request_start"] == forged["request_end"])
                outside = run_model("outside", orders[4], allowed=[orders[0]], expected=1)
                check("an owned order outside the selected host list remains inaccessible",
                      outside["cli_result"]["error"] == "AGENT_PAYMENT_ORDER_NOT_AUTHORIZED" and outside["request_start"] == outside["request_end"])
                scripted = actions(orders[0], status=False)[:1] + actions(orders[4], status=False)
                limited = run_model("limited", orders[0], allowed=[orders[0], orders[4]], scripted=scripted, expected=1)
                check("per-run allowance is consumed before work and blocks a second advance",
                      limited["cli_result"]["error"] == "AGENT_PAYMENT_ADVANCE_LIMIT"
                      and limited["report"]["sandbox_payments"]["advances_attempted"] == 1
                      and limited["request_end"] == limited["request_start"] + 1)
                bounded = run_model("last-step", orders[4], steps=2, expected=1)
                check("the last model step cannot dispatch a payment tool",
                      bounded["cli_result"]["error"] == "RUN_STEP_LIMIT" and bounded["request_start"] == bounded["request_end"])
                expired = run_model("expired", orders[4], scope_expiry=setup["at"] - 1, expected=1)
                check("expired host scope is refused before any model inspection",
                      expired["cli_result"]["error"] == "AGENT_PAYMENT_SCOPE_EXPIRED" and expired["model_requests"] == [])
                provider.customer["status"] = "paused"
                paused = run_model("paused", orders[4], expected=1)
                provider.customer["status"] = "active"
                check("negative provider signals fail the model run without issuing a create",
                      paused["report"]["sandbox_payments"]["outcomes"][0]["phase"] == "PREFLIGHT_BLOCKED"
                      and paused["request_end"] == paused["request_start"] + 1)
                crashed = run_model("crashed", orders[3], crash=True, expected=88)
                before_view = pipeline.bridge.show(orders[3])
                check("actual exit 88 after the durable payment tool leaves no claimed report success",
                      crashed["report"] is None and before_view["attempts"] == 1 and len(provider.effects) == 4)
                restarted = run_model("restarted", orders[3])
                check("explicit restart after report loss preserves the original key and polls without another create",
                      pipeline.bridge.show(orders[3])["idempotency_key"] == before_view["idempotency_key"]
                      and restarted["request_end"] == restarted["request_start"] + 1 and provider.requests[-1]["method"] == "GET")

                stop = run_model("stop", orders[5], queued=True, prepare_only=True)
                provider.mode = "block"
                provider.entered.clear()
                provider.release.clear()
                first = len(provider.requests)
                try:
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(provider.agent_cli, stop["arguments"])
                        if not provider.entered.wait(10):
                            raise AssertionError("provider preflight boundary not reached")
                        running.client.request("POST", "/v1/jobs/" + stop["job"]["id"] + "/stop", {}, agents[0]["token"])
                        provider.release.set()
                        result = future.result(timeout=30)
                    outputs.append(result.stdout + result.stderr)
                finally:
                    provider.mode = "ok"
                    provider.release.set()
                    stop["model"].stop()
                stop_report = json.loads(next(stop["folder"].glob("*.json")).read_bytes())
                stop_job = running.client.request("GET", "/v1/jobs/" + stop["job"]["id"], token=agents[0]["token"])[1]
                check("task stop during preflight is rechecked immediately before provider create HTTP",
                      result.returncode == 0 and stop_job["state"] == "CANCELLED" and stop_job["artifact_id"] is None
                      and len(provider.requests) == first + 1 and provider.requests[-1]["method"] == "GET")
                check("a cancelled worker retains the conservative provider claim and its private diagnostic receipt",
                      stop_report["error"] == "JOB_STOPPED" and stop_report["sandbox_payments"]["outcomes"][0]["phase"] == "PROVIDER_UNKNOWN"
                      and pipeline.bridge.show(orders[5])["last_attempt_error"] == "BRIDGE_HOST_GUARD_REJECTED")
                combined = audit(pipeline)
                check("joint audit still conserves every admitted amount claim fence and provider binding",
                      combined["orders"] == 7 and combined["claims"] == 11 and combined["dispatch_fences"] == 5
                      and combined["provider"]["journal_intents"] == 6 and combined["provider"]["journal_attempts"] == 9
                      and combined["admitted_principal_usdc"] == "8.750000")
                book = running.client.request("GET", "/v1/commerce/books/" + setup["book"]["id"], token=operator)[1]
                check("provider instruction and computational job success never create settlement revenue fees or fulfillment",
                      book["state"]["accounting"] == {"gross_settled_principal": 0, "refunded_principal": 0,
                          "net_settled_principal": 0, "fee_spent": 0, "refunds_restore_spending_budget": False}
                      and all(r["fulfillment_order"] is None for r in book["state"]["purchases"]))
                with closing(sqlite3.connect(pipeline.bridge.path)) as connection:
                    kinds = dict(connection.execute("SELECT kind,COUNT(*) FROM attempts GROUP BY kind"))
                check("claimed attempts remain distinct from four actual provider create requests",
                      kinds == {"CREATE": 5, "POLL": 3, "RECONCILE": 1})
                wire = [{"method": r["method"], "path": r["path"], "idempotency_key": r["headers"].get("Idempotency-Key"),
                    "body_sha256": hashlib.sha256(r["body"].encode()).hexdigest() if r["body"] is not None else None} for r in provider.requests]
                check("complete local wire has fifteen requests four unique POSTs and eleven GETs",
                      len(wire) == 15 and sum(w["method"] == "POST" for w in wire) == 4
                      and len({w["idempotency_key"] for w in wire if w["method"] == "POST"}) == 4)
                secrets = [KEY, owner, operator, *[a["token"] for a in agents]]
                check("model contexts report files and CLI output exclude all bearer credentials and provider keys",
                      all(s not in canonical(cases) + canonical(reports) + canonical(stop_report) + "".join(outputs) for s in secrets))
                output = ROOT / "evidence-output"
                output.mkdir(exist_ok=True)
                package = output / "agent-payment-fixture.zip"
                if package.exists():
                    package.unlink()
                saved = create_backup(pipeline, package)
                check("actual queue/provider fixture package is pinned for independent verification",
                      saved["backup_sha256"] == hashlib.sha256(package.read_bytes()).hexdigest())
                evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                    "classification": "AGENT_PAYMENT_TOOLS_ACTUAL_CLI_SYNTHETIC_MODEL_LOCAL_TLS", "real_model_verified": False,
                    "checks": checks, "cases": cases, "reports": reports, "scopes": scopes,
                    "stop_report": stop_report, "stop_job": stop_job, "source_book": book, "audit": combined,
                    "provider_attempt_kinds": kinds, "wire": wire, "package_sha256": saved["backup_sha256"],
                    "package_audit": saved["audit"], "actual_process_death_exit": 88,
                    "admitted_principal_usdc": "8.750000", "fixture_submitted_principal_usdc": "5.000000",
                    "unique_fixture_transfers": len(provider.effects), "external_bridge_requests": 0,
                    "real_funds_authorized": False, "wallet_execution": False, "settlement_accounting": "UNAVAILABLE"}
        finally:
            running.stop()
    (ROOT / "evidence-output/agent-payments.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    checked = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "scripts/agent_payments_audit.py",
        "--report", "evidence-output/agent-payments.json", "--fixture", "evidence-output/agent-payment-fixture.zip",
        "--source-sha", evidence["source_head_sha"], "--self-test"], cwd=ROOT, capture_output=True, text=True, timeout=30)
    if checked.returncode != 0:
        raise AssertionError("Independent agent-payment audit failed: " + checked.stderr)
    evidence["independent_audit"] = json.loads(checked.stdout)
    (ROOT / "evidence-output/agent-payments.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))


if __name__ == "__main__":
    run()
