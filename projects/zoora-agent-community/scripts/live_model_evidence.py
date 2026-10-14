"""Strict REAL local-model -> allowed tool -> private report -> HTTP artifact -> restart evidence."""

import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from integration_evidence import ROOT, Running, command
from fixture_signatures import address, signed_body
from model_diagnostics import capture
from zoora_community.client import read_credential
from zoora_community.store import Store, exclusive_file
from zoora_community.validation import canonical


def check_measured_answer(answer):
    answer = answer.lower()
    byte_count = r"\b12\s+(?:utf-?8\s+)?bytes\b|\b(?:utf-?8\s+)?bytes?(?:\s+count)?\s*(?:[:=]|is|are|of)?\s*12\b"
    word_count = r"\b2\s+words\b|\bwords?(?:\s+count)?\s*(?:[:=]|is|are|of)?\s*2\b"
    if not (re.search(byte_count, answer) and re.search(word_count, answer)):
        raise AssertionError("Written model output did not associate the measured values with their correct units")
    if "final allowed step" in answer or "first call" in answer:
        raise AssertionError("Written model output echoed runner instructions")


def run():
    model = os.environ.get("ZOORA_TEST_MODEL", "qwen3:1.7b")
    checks = []
    with tempfile.TemporaryDirectory(prefix="zoora-real-model-") as name:
        folder = Path(name)
        state, owner_file = folder / "state", folder / "owner.json"
        command("init", "--state", state, "--owner-file", owner_file)
        running = Running(state, folder)
        try:
            owner = read_credential(owner_file)
            operator = running.client.request("POST", "/v1/operators", {"handle": "real_model_test_operator"}, owner)[1]["credential"]["token"]
            challenge = running.client.request("POST", "/v1/wallet/challenges", {"handle": "real_model_test_agent",
                "wallet": address("REAL-MODEL-TEST-WALLET-NEVER-FUND"), "capabilities": ["development"]}, operator)[1]
            agent = running.client.request("POST", "/v1/agents", signed_body(challenge, "REAL-MODEL-TEST-WALLET-NEVER-FUND"), operator)[1]
            credential = agent["credential"]
            credential_file = folder / "agent.json"
            with exclusive_file(credential_file) as output:
                output.write(canonical(credential).encode())
            project = running.client.request("POST", "/v1/projects", {"title": "Real local model acceptance",
                          "summary": "Automated test, not customer activity or autonomous revenue"}, credential["token"])[1]
            task = folder / "task.json"
            test_prompt = 'Use text_metrics to measure this exact text: Zoora builds\nAfter the tool result, write one sentence reporting the measured UTF-8 bytes and words.'
            task.write_text(canonical({"prompt": test_prompt}), encoding="utf-8")
            out = folder / "report.json"
            completed = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community", "run-agent",
                "--credential-file", str(credential_file), "--task-file", str(task), "--out", str(out), "--model", model,
                "--port", str(running.port), "--timeout", "120", "--max-steps", "4", "--project", project["id"]],
                cwd=ROOT, capture_output=True, text=True, timeout=140)
            if completed.returncode != 0:
                failure = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                           "real_model_verified": False, "model": model, "error": completed.stderr.strip()}
                if out.exists():
                    failure["failed_report"] = json.loads(out.read_bytes())
                Path("evidence-output").mkdir(exist_ok=True)
                Path("evidence-output/live-model-failure.json").write_text(canonical(failure) + "\n", encoding="utf-8")
                capture(model, test_prompt)
                raise AssertionError("Strict real model acceptance failed: " + completed.stderr)
            report = json.loads(out.read_bytes())
            result = json.loads(completed.stdout)
            Path("evidence-output").mkdir(exist_ok=True)
            candidate = Path("evidence-output/live-model-candidate.json")
            candidate.write_text(canonical({"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "activity": "AUTOMATED_REAL_LOCAL_MODEL_TEST", "real_model_verified": False,
                "state": "UNVERIFIED_PENDING_ACCEPTANCE", "report": report, "result": result}) + "\n", encoding="utf-8")
            assert credential["token"] not in out.read_text() + completed.stdout + completed.stderr
            assert report["state"] == "AVAILABLE" and report["output_classification"] == "LEARNED"
            assert report["steps"][0]["action"] == {"action": "text_metrics", "arguments": {"text": "Zoora builds"}}
            assert report["steps"][0]["tool_result"]["words"] == 2
            assert report["steps"][0]["tool_result"]["utf8_bytes"] == 12
            assert report["steps"][-1]["action"]["action"] == "finish"
            check_measured_answer(report["output"])
            assert result["report_sha256"] == hashlib.sha256(out.read_bytes()).hexdigest()
            checks.append("actual local model generated an allowed tool action and a final written output using the measured byte/word facts")
            artifact = running.client.request("GET", "/v1/projects/" + project["id"] + "/artifacts")[1]["items"][0]
            assert artifact["digest"] == result["report_sha256"] and artifact["author_id"] == agent["agent"]["id"]
            checks.append("actual tool measurement and report digest independently matched API artifact attribution")
            queued_project = running.client.request("POST", "/v1/projects", {"title": "Real queued model acceptance",
                "summary": "Automated test of durable tasks; no customer funds"}, credential["token"])[1]
            queued_body = {"request_id": "1" * 32, "title": "Real queued model report (unverified output)",
                           "prompt": test_prompt, "max_steps": 4, "timeout_seconds": 120, "project_id": queued_project["id"]}
            submitted = running.client.request("POST", "/v1/jobs", queued_body, credential["token"])[1]["job"]
            assert submitted["state"] == "QUEUED" and submitted["attempt_id"] is None
            reports = folder / "queued-reports"
            worker = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community", "work-jobs",
                "--credential-file", str(credential_file), "--out-dir", str(reports), "--model", model,
                "--port", str(running.port), "--timeout", "120", "--max-steps", "4"],
                cwd=ROOT, capture_output=True, text=True, timeout=140)
            retained = list(reports.glob("*.json"))
            queued_report = json.loads(retained[0].read_bytes()) if len(retained) == 1 else None
            worker_result = json.loads(worker.stdout) if worker.returncode == 0 else None
            Path("evidence-output/live-jobs-candidate.json").write_text(canonical({
                "source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "activity": "AUTOMATED_REAL_LOCAL_MODEL_TEST", "real_model_verified": False,
                "state": "UNVERIFIED_PENDING_ACCEPTANCE", "report": queued_report,
                "result": worker_result, "error": worker.stderr.strip()}) + "\n", encoding="utf-8")
            assert worker.returncode == 0 and worker_result["processed"] == 1
            queued_result = worker_result["jobs"][0]
            assert queued_result["state"] == "SUCCEEDED" and queued_result["completion_recorded"]
            assert queued_report["job"] == {"job_id": submitted["id"], "attempt_id": queued_result["attempt_id"]}
            assert queued_report["agent_id"] == credential["principal_id"] and queued_report["credential_id"] == credential["credential_id"]
            assert queued_report["steps"][0]["action"] == {"action": "text_metrics", "arguments": {"text": "Zoora builds"}}
            assert queued_report["steps"][0]["tool_result"]["utf8_bytes"] == 12 and queued_report["steps"][0]["tool_result"]["words"] == 2
            check_measured_answer(queued_report["output"])
            assert queued_result["report_sha256"] == hashlib.sha256(retained[0].read_bytes()).hexdigest()
            assert credential["token"] not in canonical(queued_report) + worker.stdout + worker.stderr
            assert "jr1_" not in canonical(queued_report) + worker.stdout + worker.stderr
            queued_artifact = running.client.request("GET", "/v1/projects/" + queued_project["id"] + "/artifacts")[1]["items"][0]
            assert queued_artifact["digest"] == queued_result["report_sha256"] and queued_artifact["author_id"] == credential["principal_id"]
            terminal = running.client.request("GET", "/v1/jobs/" + submitted["id"], token=credential["token"])[1]
            assert terminal["state"] == "SUCCEEDED" and terminal["artifact_id"] == queued_artifact["id"]
            replay = running.client.request("POST", "/v1/jobs", queued_body, credential["token"])[1]
            assert replay["replayed"] and replay["job"]["id"] == submitted["id"]
            idle = json.loads(command("work-jobs", "--credential-file", credential_file, "--out-dir", reports,
                                     "--model", model, "--port", running.port).stdout)
            assert idle["processed"] == 0
            checks.append("durable queued task used a real local model and actual measured facts; private report bound the exact job and attempt")
            checks.append("job completion and attributed report artifact committed together; replay did not invoke a second model run")
        finally:
            running.stop()
        restarted = Running(state, folder)
        try:
            again = restarted.client.request("GET", "/v1/projects/" + project["id"] + "/artifacts")[1]["items"][0]
            assert again == artifact
            assert restarted.client.request("GET", "/v1/jobs/" + submitted["id"], token=credential["token"])[1] == terminal
            assert restarted.client.request("GET", "/v1/projects/" + queued_project["id"] + "/artifacts")[1]["items"][0] == queued_artifact
            assert Store(state).audit()["database_integrity"] == "OK"
            checks.append("fresh service process retained the model report reference and passed full evidence audit")
        finally:
            restarted.stop()
        # Read the provider's actual installed model manifest digest, not the mutable tag alone.
        channel = http.client.HTTPConnection("127.0.0.1", 11434, timeout=5)
        response = None
        try:
            channel.request("GET", "/api/tags")
            response = channel.getresponse()
            assert response.status == 200
            models = json.loads(response.read(65_537))["models"]
            installed = next(item for item in models if item["name"] == model)
            assert installed["digest"] and installed["size"] > 0
        finally:
            if response is not None:
                response.close()
            channel.close()
        evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                    "activity": "AUTOMATED_REAL_LOCAL_MODEL_TEST", "customer_activity": False,
                    "wallet_classification": "SYNTHETIC", "real_model_verified": True,
                    "model": model, "installed_manifest": installed,
                    "ollama_version": subprocess.check_output([os.environ.get("OLLAMA_BIN", "ollama"), "--version"], text=True).strip(),
                    "checks": checks, "report": report, "report_sha256": result["report_sha256"],
                    "artifact": artifact, "wallet_execution": "UNAVAILABLE", "output_correctness": "UNVERIFIED"}
        evidence.update(queued_model_verified=True, queued_report=queued_report,
                        queued_report_sha256=queued_result["report_sha256"], queued_job=terminal,
                        queued_artifact=queued_artifact)
        Path("evidence-output").mkdir(exist_ok=True)
        Path("evidence-output/live-model.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        print(canonical({"real_model_verified": True, "model": model, "checks": checks}))


if __name__ == "__main__":
    run()
