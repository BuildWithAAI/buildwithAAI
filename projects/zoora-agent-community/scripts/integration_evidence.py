"""Actual subprocess CLI + HTTP + restart + restore acceptance; no live customer data."""

import json
import os
from pathlib import Path
import platform
import sqlite3
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from zoora_community.client import Client, read_credential  # noqa: E402
from zoora_community.validation import canonical  # noqa: E402
from fixture_signatures import address, signed_body  # noqa: E402


def command(*args, expected=0):
    result = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community", *map(str, args)],
                            cwd=ROOT, capture_output=True, text=True, timeout=20)
    assert result.returncode == expected, "CLI failed: " + result.stderr
    return result


class Running:
    def __init__(self, state, folder, enable_solana=False):
        self.path = folder / "server-log.txt"
        self.log = self.path.open("wb")
        arguments = [sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community", "serve", "--state", str(state), "--port", "0"]
        if enable_solana:
            arguments.append("--solana-rpc")
        self.child = subprocess.Popen(arguments,
                                      cwd=ROOT, stdin=subprocess.DEVNULL, stdout=self.log, stderr=self.log)
        try:
            started = time.monotonic()
            while time.monotonic() - started < 10:
                if self.child.poll() is not None:
                    raise RuntimeError("Service did not start")
                lines = self.path.read_text().splitlines()
                if lines:
                    info = json.loads(lines[0])
                    self.transport = info["transport"]
                    self.package_digest = info["package_digest"]
                    self.origin = info["url"]
                    self.port = int(self.origin.rsplit(":", 1)[1])
                    self.client = Client(self.port)
                    return
                time.sleep(0.02)
            raise RuntimeError("Service start timed out")
        except BaseException:
            self.stop()
            raise

    def stop(self):
        if self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait(timeout=5)
        self.log.close()


def run():
    checks = []
    with tempfile.TemporaryDirectory(prefix="zoora-service-acceptance-") as name:
        folder = Path(name)
        state = folder / "state"
        owner_file = folder / "owner.credential.json"
        command("init", "--state", state, "--owner-file", owner_file)
        owner = read_credential(owner_file)
        running = Running(state, folder)
        tokens = [owner]
        try:
            def request(method, route, body=None, credential_file=None, save=None, expected=0):
                arguments = ["request", method, route, "--port", running.port]
                if body is not None:
                    body_file = folder / "body.json"
                    body_file.write_text(canonical(body), encoding="utf-8")
                    arguments += ["--body-file", body_file]
                if credential_file:
                    arguments += ["--credential-file", credential_file]
                if save:
                    arguments += ["--save-credential", save]
                result = command(*arguments, expected=expected)
                assert all(token not in result.stdout + result.stderr for token in tokens)
                return json.loads(result.stdout) if expected == 0 else json.loads(result.stderr)

            operator_file = folder / "operator.credential.json"
            request("POST", "/v1/operators", {"handle": "test_operator"}, owner_file, operator_file)
            tokens.append(read_credential(operator_file))
            agent_file = folder / "agent.credential.json"
            challenge = request("POST", "/v1/wallet/challenges", {"handle": "test_agent", "wallet": address("acceptance-fixture"), "capabilities": ["research", "coding"]}, operator_file)["result"]
            agent = request("POST", "/v1/agents", signed_body(challenge, "acceptance-fixture"), operator_file, agent_file)["result"]["agent"]
            tokens.append(read_credential(agent_file))
            assert agent["wallet_status"] == "SIGNATURE_VERIFIED"
            checks.append("actual CLI verifies a wallet challenge and enrolls a scoped agent without printing credentials")
            assert request("POST", "/v1/agents", signed_body(challenge, "acceptance-fixture"), operator_file, folder / "replay.credential.json", expected=1)["error"] == "CHALLENGE_CONSUMED"
            checks.append("reused wallet signature is rejected without issuing a second credential")
            project = request("POST", "/v1/projects", {"title": "Acceptance fixture", "summary": "Automated test, not customer activity"}, agent_file)["result"]
            request("POST", "/v1/projects/" + project["id"] + "/artifacts", {"title": "Declared test output", "digest": "a" * 64}, agent_file)
            post = request("POST", "/v1/posts", {"body": "Test discussion", "project_id": project["id"]}, agent_file)["result"]
            request("POST", "/v1/posts", {"body": "Test reply", "project_id": project["id"], "reply_to": post["id"]}, agent_file)
            offer = request("POST", "/v1/offers", {"project_id": project["id"], "title": "Test service", "criteria_digest": "b" * 64, "quote": "No payment requested in this test", "delivery_terms": "Declared test report"}, agent_file)["result"]
            checks.append("HTTP persists authored projects, artifact references, replies and offers")
            request("PATCH", "/v1/agents/" + agent["id"], {"active": False}, operator_file)
            assert not running.client.request("GET", "/v1/offers/" + offer["id"])[1]["available"]
            assert request("POST", "/v1/posts", {"body": "denied"}, agent_file, expected=1)["error"] == "UNAUTHORIZED"
            request("PATCH", "/v1/agents/" + agent["id"], {"active": True}, operator_file)
            rotated_file = folder / "rotated.credential.json"
            request("POST", "/v1/credentials/rotate", {}, agent_file, rotated_file)
            tokens.append(read_credential(rotated_file))
            assert request("GET", "/v1/me", credential_file=agent_file, expected=1)["error"] == "UNAUTHORIZED"
            assert request("GET", "/v1/me", credential_file=rotated_file)["result"]["principal_id"] == agent["id"]
            checks.append("deactivation denies writes and offers; rotation revokes old credential")
            status = running.client.request("GET", "/v1/status")[1]
            assert status["counts"] == {"agents": 1, "projects": 1, "posts": 2, "offers": 1}
            backup_file = folder / "backup.sqlite3"
            command("backup", "--state", state, "--out", backup_file)
            audit = json.loads(command("audit", "--state", state).stdout)
            assert audit["audit_events"] == 12
            assert audit["sqlite_defensive"] is True
            assert audit["extension_loading"] is False
            assert all(token.encode() not in state.joinpath("community.sqlite3").read_bytes() for token in tokens)
            assert all(token not in running.path.read_text() for token in tokens)
            checks.append("consistent backup and audit contain no plaintext bearer values")
        finally:
            running.stop()
        running = Running(state, folder)
        try:
            assert running.client.request("GET", "/v1/status")[1]["counts"] == status["counts"]
            assert running.client.request("GET", "/v1/me", token=tokens[-1])[1]["principal_id"] == agent["id"]
            checks.append("fresh server process restores records and credential authentication")
        finally:
            running.stop()
        restored = folder / "restored"
        restored.mkdir(mode=0o700)
        backup_file.replace(restored / "community.sqlite3")
        assert json.loads(command("audit", "--state", restored).stdout) == audit
        running = Running(restored, folder)
        try:
            assert running.client.request("GET", "/v1/posts")[1]["items"]
            assert running.client.request("GET", "/v1/me", token=tokens[-1])[0] == 200
            checks.append("backup restored into independent directory and served over HTTP")
        finally:
            running.stop()
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "python": platform.python_version(), "sqlite": sqlite3.sqlite_version,
                "platform": platform.platform(), "activity": "AUTOMATED_TEST_FIXTURE",
                "checks": checks, "persisted_counts": status["counts"], "audit_events": audit["audit_events"],
                "sqlite_defensive": audit["sqlite_defensive"], "extension_loading": audit["extension_loading"],
                "runtime_patch_audit": "UNVERIFIED",
                "pynacl": __import__("nacl").__version__,
                "transport": running.transport,
                "customer_wallets": 0, "chain_requests": 0, "transactions_submitted": 0}
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    (output / "integration.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    run()
