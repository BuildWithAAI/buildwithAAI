"""Actual invitation CLI/HTTP/restart/suspension/restore acceptance; no live users."""

import json
import os
from pathlib import Path
import secrets
import tempfile

from integration_evidence import ROOT, Running, command
from fixture_signatures import address, signed_body
from zoora_community.client import read_credential
from zoora_community.store import Store
from zoora_community.validation import Problem, canonical


def run():
    checks = []
    with tempfile.TemporaryDirectory(prefix="zoora-pilot-access-") as name:
        folder = Path(name)
        state, owner_file = folder / "state", folder / "owner.json"
        command("init", "--state", state, "--owner-file", owner_file)
        owner = read_credential(owner_file)
        server = Running(state, folder)
        private = [owner]

        def request(method, route, body=None, credential=None, output=None, invitation=False):
            args = ["request", method, route, "--port", server.port]
            if credential:
                args += ["--credential-file", credential]
            if body is not None:
                path = folder / "request.json"
                path.write_text(canonical(body), encoding="utf-8")
                path.chmod(0o600)
                args += ["--body-file", path]
            if output:
                args += ["--save-invitation" if invitation else "--save-credential", output]
            result = command(*args)
            if any(secret in result.stdout + result.stderr for secret in private):
                raise AssertionError("Private capability leaked to CLI output")
            return json.loads(result.stdout)["result"]

        try:
            invite_file = folder / "invitation.json"
            invitation = request("POST", "/v1/invitations", {"request_id": "a" * 32, "label": "Automated test invitation", "ttl_seconds": 300},
                                 owner_file, invite_file, invitation=True)["invitation"]
            invite = json.loads(invite_file.read_text())["token"]
            private.append(invite)
            body = {"invitation_token": invite, "handle": "pilot_fixture_operator", "claim_nonce": "icn1_" + secrets.token_urlsafe(32)}
            private.append(body["claim_nonce"])
            operator_file = folder / "operator.json"
            request("POST", "/v1/invitations/claim", body, output=operator_file)
            operator = read_credential(operator_file)
            private.append(operator)
            me = request("GET", "/v1/me", credential=operator_file)
            if me["role"] != "OPERATOR":
                raise AssertionError("Invitation granted unexpected role")
            repeat_file = folder / "reconciled.json"
            repeat = request("POST", "/v1/invitations/claim", body, output=repeat_file)
            if not repeat["replayed"] or repeat_file.read_bytes() != operator_file.read_bytes():
                raise AssertionError("Claim replay changed credential")
            checks.append("actual CLI issues a private invitation and exact claim retry returns one identical operator credential without printing secrets")
            challenge = server.client.request("POST", "/v1/wallet/challenges", {"handle": "pilot_fixture_agent",
                "wallet": address("PUBLIC-PILOT-TEST-KEY-NEVER-FUND"), "capabilities": ["research"]}, operator)[1]
            registered = server.client.request("POST", "/v1/agents", signed_body(challenge, "PUBLIC-PILOT-TEST-KEY-NEVER-FUND"), operator)[1]
            agent = registered["credential"]["token"]
            private.append(agent)
            running_job = server.client.request("POST", "/v1/jobs", {"request_id": "b" * 32, "title": "Running fixture", "prompt": "Private fixture task"}, agent)[1]["job"]
            server.client.request("POST", "/v1/jobs/claim", {"max_steps": 4, "timeout_seconds": 60}, agent)
            queued_job = server.client.request("POST", "/v1/jobs", {"request_id": "c" * 32, "title": "Queued fixture", "prompt": "Private fixture task"}, agent)[1]["job"]
        finally:
            server.stop()
        server = Running(state, folder)
        try:
            if server.client.request("POST", "/v1/invitations/claim", body)[1]["credential"]["token"] != operator:
                raise AssertionError("Restart lost claim reconciliation")
            if server.client.request("GET", "/v1/invitations", token=owner)[1]["items"][0]["id"] != invitation["id"]:
                raise AssertionError("Restart lost invitation")
            checks.append("fresh service process retains invitation consumption, claim retry and wallet-backed agent enrollment")
            request("POST", "/v1/operators/" + me["principal_id"] + "/suspend", {"reason": "Automated fixture suspension"}, owner_file)
            for token in (operator, agent):
                try:
                    server.client.request("GET", "/v1/me", token=token)
                except Problem as error:
                    if error.code != "UNAUTHORIZED":
                        raise
                else:
                    raise AssertionError("Suspended credential still authorized")
            for job, expected in ((running_job, "INTERRUPTED"), (queued_job, "CANCELLED")):
                observed = server.client.request("GET", "/v1/jobs/" + job["id"], token=owner)[1]
                if observed["recorded_state"] != expected or observed["artifact_id"] is not None:
                    raise AssertionError("Suspension did not retire work")
            checks.append("owner suspension revokes operator and agent credentials and commits running/queued job retirement without publication")
            audit = Store(state).audit()
            backup = folder / "pilot-backup.sqlite3"
            command("backup", "--state", state, "--out", backup)
            if json.loads(command("verify-backup", "--backup", backup).stdout)["audit"] != audit:
                raise AssertionError("Backup audit mismatch")
            if any(secret.encode() in state.joinpath("community.sqlite3").read_bytes() for secret in private):
                raise AssertionError("Private capability retained in database")
            if any(secret in server.path.read_text() for secret in private):
                raise AssertionError("Private capability in server log")
        finally:
            server.stop()
        restored, recovered_owner = folder / "restored", folder / "recovered-owner.json"
        command("restore", "--backup", backup, "--state", restored)
        command("recover-owner", "--state", restored, "--owner-file", recovered_owner, "--invalidate-all-credentials")
        server = Running(restored, folder)
        try:
            recovered = read_credential(recovered_owner)
            try:
                server.client.request("POST", "/v1/invitations/claim", body)
            except Problem as error:
                if error.code != "INVITATION_UNAVAILABLE":
                    raise
            else:
                raise AssertionError("Old invitation recovered an invalidated credential")
            operators = server.client.request("GET", "/v1/operators", token=recovered)[1]["items"]
            if not operators[0]["suspended"]:
                raise AssertionError("Restore lost durable suspension")
            server.client.request("POST", "/v1/operators/" + me["principal_id"] + "/resume", {"reason": "Automated fixture restore review"}, recovered)
            credential = server.client.request("POST", "/v1/operators/" + me["principal_id"] + "/credentials", {}, recovered)[1]["credential"]
            if server.client.request("GET", "/v1/me", token=credential["token"])[1]["role"] != "OPERATOR":
                raise AssertionError("Fresh credential failed after resume")
            if Store(restored).audit()["database_integrity"] != "OK":
                raise AssertionError("Restored access audit failed")
            checks.append("actual exclusive restore and credential-invalidating recovery preserve suspension and deny old invitation recovery; resume needs a fresh credential")
        finally:
            server.stop()
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "activity": "AUTOMATED_TEST_FIXTURE", "wallet_classification": "SYNTHETIC", "schema_version": 5,
                "checks": checks, "transport": server.transport, "customer_accounts": 0,
                "chain_requests": 0, "model_requests": 0, "transactions_submitted": 0,
                "public_deployment": False, "external_identity_verification": "UNAVAILABLE"}
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    (output / "pilot-access.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))


if __name__ == "__main__":
    run()
