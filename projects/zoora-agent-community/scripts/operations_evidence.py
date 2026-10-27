"""Actual Waitress/CLI polling, process crash, snapshot audit, restore and credential recovery."""

from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import platform
import sqlite3
import tempfile

from integration_evidence import ROOT, Running, command
from fixture_signatures import address, signed_body
from zoora_community.client import read_credential
from zoora_community.store import Store
from zoora_community.validation import Problem, canonical


def run():
    checks = []
    with tempfile.TemporaryDirectory(prefix="zoora-operations-acceptance-") as name:
        folder = Path(name)
        state = folder / "state"
        owner_file = folder / "owner.credential.json"
        command("init", "--state", state, "--owner-file", owner_file)
        owner = read_credential(owner_file)
        doctor = json.loads(command("doctor", "--state", state).stdout)
        assert doctor["status"] == "AVAILABLE"
        assert doctor["audit"]["database_integrity"] == "OK"
        running = Running(state, folder)
        tokens = [owner]
        try:
            assert running.transport == "WAITRESS_3_0_2"
            ready = running.client.request("GET", "/v1/ready", token=owner)[1]
            assert ready["package_digest"] == doctor["package_digest"] == running.package_digest
            assert ready["public_launch"] == ready["external_rpc"] == "UNVERIFIED"
            checks.append("actual Waitress HTTP readiness matches offline package and instance, without claiming public or RPC readiness")
            operator_result = running.client.request("POST", "/v1/operators", {"handle": "ops_fixture"}, owner)[1]
            operator = operator_result["credential"]["token"]
            tokens.append(operator)
            challenge = running.client.request("POST", "/v1/wallet/challenges", {"handle": "ops_agent",
                "wallet": address("ops-fixture"), "capabilities": ["research"]}, operator)[1]
            issued = running.client.request("POST", "/v1/agents", signed_body(challenge, "ops-fixture"), operator)[1]
            agent_id = issued["agent"]["id"]
            agent = issued["credential"]["token"]
            tokens.append(agent)
            post = running.client.request("POST", "/v1/posts", {"body": "Automated crash recovery fixture"}, agent)[1]
            monitor_file = folder / "monitor.jsonl"
            before = hashlib.sha256(state.joinpath("community.sqlite3").read_bytes()).hexdigest()
            poll = command("monitor", "--state", state, "--port", running.port,
                "--credential-file", owner_file, "--samples", 3, "--interval", "0.1", "--out", monitor_file)
            samples = [json.loads(line) for line in monitor_file.read_text().splitlines()]
            assert json.loads(poll.stdout)["samples"] == len(samples) == 3
            assert len({sample["process_id"] for sample in samples}) == 1
            assert all(token not in poll.stdout + poll.stderr + monitor_file.read_text() for token in tokens)
            assert before == hashlib.sha256(state.joinpath("community.sqlite3").read_bytes()).hexdigest()
            checks.append("actual credential-file monitoring produces three private samples with aggregate telemetry and no durable writes or bearer values")
            backup = folder / "snapshot.sqlite3"
            command("backup", "--state", state, "--out", backup)
            verified = json.loads(command("verify-backup", "--backup", backup).stdout)
            assert verified["audit"] == Store(state).audit()
            checks.append("online SQLite snapshot is independently reaudited for schema, relationships, audit chain and wallet proofs")
            old_process = ready["process_id"]
            running.child.kill()  # Abrupt crash, not a graceful stop or mock.
            running.child.wait(timeout=5)
        finally:
            running.stop()
        failure = command("monitor", "--state", state, "--port", running.port,
                          "--credential-file", owner_file, expected=1)
        assert all(token not in failure.stdout + failure.stderr for token in tokens)
        checks.append("monitor exits nonzero for the actually stopped process without exposing credentials")
        running = Running(state, folder)
        try:
            ready = running.client.request("GET", "/v1/ready", token=owner)[1]
            assert ready["process_id"] != old_process
            assert ready["checks"]["instance_id"] == doctor["checks"]["instance_id"]
            assert running.client.request("GET", "/v1/posts/" + post["id"])[1] == post
            assert running.client.request("GET", "/v1/me", token=agent)[1]["principal_id"] == agent_id
            checks.append("fresh Waitress process after abrupt termination preserves committed authorship and credential authentication")
        finally:
            running.stop()
        restored = folder / "restored"
        result = json.loads(command("restore", "--backup", backup, "--state", restored).stdout)
        assert result["audit"] == verified["audit"]
        assert result["all_previous_credentials_revoked"] is False
        conflict = command("restore", "--backup", backup, "--state", restored, expected=1)
        assert json.loads(conflict.stderr)["error"] == "LOCAL_OPERATION_FAILED"
        new_owner_file = folder / "recovery.credential.json"
        recovery = command("recover-owner", "--state", restored, "--owner-file", new_owner_file,
                           "--invalidate-all-credentials")
        fresh_owner = read_credential(new_owner_file)
        assert fresh_owner not in recovery.stdout + recovery.stderr
        running = Running(restored, folder)
        try:
            for token in tokens:
                try:
                    running.client.request("GET", "/v1/me", token=token)
                except Problem as denied:
                    assert denied.code == "UNAUTHORIZED"
                else:
                    raise AssertionError("Restored credential was not revoked")
            assert running.client.request("GET", "/v1/ready", token=fresh_owner)[1]["status"] == "AVAILABLE"
            assert running.client.request("GET", "/v1/posts/" + post["id"])[1] == post
            proof = running.client.request("GET", "/v1/agents/" + agent_id + "/wallet-proof")[1]
            assert proof["status"] == "SIGNATURE_VERIFIED"
            checks.append("exclusive CLI restore plus offline recovery revokes every old API credential while preserving authored content and historical wallet proof")
        finally:
            running.stop()
        tampered = folder / "tampered.sqlite3"
        Store(restored).backup(tampered)
        with closing(sqlite3.connect(tampered, autocommit=True)) as connection:
            connection.execute("UPDATE audit SET hash=? WHERE seq=1", ("f" * 64,))
        failed = command("verify-backup", "--backup", tampered, expected=1)
        assert json.loads(failed.stderr)["error"] == "AUDIT_CHAIN_FAILURE"
        destination = folder / "bad-restore"
        failed = command("restore", "--backup", tampered, "--state", destination, expected=1)
        assert json.loads(failed.stderr)["error"] == "AUDIT_CHAIN_FAILURE"
        assert not destination.exists()
        checks.append("corrupted snapshot fails actual verification and restore before publishing any state directory")
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "activity": "AUTOMATED_TEST_FIXTURE", "python": platform.python_version(),
                "platform": platform.platform(), "sqlite": sqlite3.sqlite_version,
                "transport": "WAITRESS_3_0_2", "checks": checks, "monitor_samples": len(samples),
                "public_launch": "UNVERIFIED", "windows_acl_audit": "UNVERIFIED",
                "customer_wallets": 0, "chain_requests": 0, "transactions_submitted": 0}
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    (output / "operations.json").write_text(canonical(evidence) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    run()
