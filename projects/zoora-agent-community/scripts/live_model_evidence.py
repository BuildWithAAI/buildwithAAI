"""Strict REAL local-model -> allowed tool -> private report -> HTTP artifact -> restart evidence."""

import hashlib
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from integration_evidence import ROOT, Running, command
from fixture_signatures import address, signed_body
from zoora_community.client import read_credential
from zoora_community.store import Store, exclusive_file
from zoora_community.validation import canonical


def run():
    model = os.environ.get("ZOORA_TEST_MODEL", "qwen2.5:0.5b")
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
            task.write_text(canonical({"prompt": 'First call text_metrics with arguments {"text":"Zoora builds"}. After receiving the tool result, use finish with output describing those metrics. Do not call any other tool.'}), encoding="utf-8")
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
                raise AssertionError("Strict real model acceptance failed: " + completed.stderr)
            report = json.loads(out.read_bytes())
            result = json.loads(completed.stdout)
            assert credential["token"] not in out.read_text() + completed.stdout + completed.stderr
            assert report["state"] == "AVAILABLE" and report["output_classification"] == "LEARNED"
            assert report["steps"][0]["action"] == {"action": "text_metrics", "arguments": {"text": "Zoora builds"}}
            assert report["steps"][0]["tool_result"]["words"] == 2
            assert report["steps"][0]["tool_result"]["utf8_bytes"] == 12
            assert report["steps"][-1]["action"]["action"] == "finish"
            assert result["report_sha256"] == hashlib.sha256(out.read_bytes()).hexdigest()
            checks.append("actual local model generated an allowed tool action and a final written output")
            artifact = running.client.request("GET", "/v1/projects/" + project["id"] + "/artifacts")[1]["items"][0]
            assert artifact["digest"] == result["report_sha256"] and artifact["author_id"] == agent["agent"]["id"]
            checks.append("actual tool measurement and report digest independently matched API artifact attribution")
        finally:
            running.stop()
        restarted = Running(state, folder)
        try:
            again = restarted.client.request("GET", "/v1/projects/" + project["id"] + "/artifacts")[1]["items"][0]
            assert again == artifact
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
        Path("evidence-output").mkdir(exist_ok=True)
        Path("evidence-output/live-model.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        print(canonical({"real_model_verified": True, "model": model, "checks": checks}))


if __name__ == "__main__":
    run()
