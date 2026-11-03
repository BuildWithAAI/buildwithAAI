"""P1 provider-vault acceptance.

The provider transport in this module is SYNTHETIC. It does not call xAI, OpenAI
or Anthropic and is not a live provider acceptance run.
"""
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT), str(ROOT / "projects/zoora-platform"), str(ROOT / "projects/zoora-agent-community"),
                str(ROOT / "projects/zoora-agent-community/tests")]

from helpers import address, signed_body
from zoora_community.store import Store
from zoora_community.validation import Problem
from zoora_community.wsgi_server import Application
from zoora_platform.application import Platform
from zoora_platform.ledger import Ledger
from zoora_platform.providers import ModelProvider
from zoora_platform.registry import Registry
from zoora_platform.vault import Vault

REAL_PROVIDER_ACCEPTANCE = False
SYNTHETIC_KEY = "synthetic-vault-key-001"


class Response:
    status = 200

    def __init__(self, content, usage):
        self.data = json.dumps({"choices": [{"message": {"content": content}}], "usage": usage}).encode()

    def read1(self, size):
        chunk, self.data = self.data[:size], self.data[size:]
        return chunk


class SyntheticTransport:
    """Stand-in for HTTPSConnection. Failures are explicit and local."""

    def __init__(self, steps):
        self.steps = list(steps)
        self.hosts = []
        self.authorizations = []

    def connection(self):
        transport = self

        class Connection:
            sock = None

            def __init__(self, host, timeout=30, context=None):
                transport.hosts.append(host)
                self.step = transport.steps.pop(0)
                if self.step == "CONSTRUCTOR":
                    raise TimeoutError("synthetic failure before the provider is contacted")

            def request(self, method, path, body, headers):
                transport.authorizations.append(headers.get("Authorization") or headers.get("x-api-key"))
                if self.step == "TIMEOUT":
                    raise TimeoutError("synthetic timeout after the request was submitted")

            def getresponse(self):
                return self.step

            def close(self):
                pass

        return Connection


class VaultAcceptance(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.at = 1_800_000_000_000
        self.clock = lambda: self.at
        self.ledger = Ledger(self.root / "platform.sqlite3", self.clock)
        self.owner_file = self.root / "owner.json"
        self.community = Store.initialize(self.root / "community", self.owner_file, self.clock)
        self.owner = json.loads(self.owner_file.read_text())["token"]
        self.registry = Registry(self.community, ModelProvider({}), self.root)
        self.wsgi = Application(self.community)
        self.wsgi.host, self.wsgi.origin = "127.0.0.1:8765", "http://127.0.0.1:8765"
        self.platform = Platform(self.community, self.ledger, self.registry, self.wsgi.runtime.assets["/"][0], {})
        self.wsgi.extension = self.platform.route
        self.vault = self.platform.vault
        operator = self.community.call("POST", "/v1/operators", {"handle": "pilot_one"}, self.owner)[1]
        self.operator = operator["credential"]["token"]
        self.agent_a, self.token_a = self.agent("agent_one")
        self.agent_b, self.token_b = self.agent("agent_two")

    def agent(self, label):
        challenge = self.community.call("POST", "/v1/wallet/challenges",
                                        {"handle": label, "wallet": address(label), "capabilities": ["research"]}, self.operator)[1]
        result = self.community.call("POST", "/v1/agents", signed_body(challenge, label), self.operator)[1]
        return result["agent"]["id"], result["credential"]["token"]

    def request(self, path, method="GET", body=None, token=None):
        import io
        raw = b"" if body is None else json.dumps(body).encode()
        env = {"REQUEST_METHOD": method, "REQUEST_URI": path, "PATH_INFO": path, "HTTP_HOST": self.wsgi.host, "wsgi.input": io.BytesIO(raw)}
        if body is not None:
            env.update(CONTENT_TYPE="application/json", CONTENT_LENGTH=str(len(raw)))
        if token is not None:
            env["HTTP_AUTHORIZATION"] = "Bearer " + token
        response = {}

        def start(status, headers):
            response.update(status=int(status.split()[0]), headers=dict(headers))

        data = b"".join(self.wsgi(env, start))
        response["body"] = json.loads(data) if response["headers"]["Content-Type"].startswith("application/json") else data.decode()
        return response

    def error(self, code, callback):
        with self.assertRaises(Problem) as raised:
            callback()
        self.assertEqual(raised.exception.code, code)

    def deposit(self, token=None, request="credential_001"):
        response = self.request("/api/platform/vault/credentials", "POST", {
            "request_id": request, "provider": "xai", "model": "synthetic-model",
            "api_key": SYNTHETIC_KEY, "label": "pilot"}, token or self.owner)
        self.assertIn(response["status"], (200, 201))
        self.assertNotIn(SYNTHETIC_KEY, json.dumps(response["body"]))
        return response["body"]["credential"]

    def grant(self, credential_id, agent_id, request="grant_001", requests=4, tokens=4096, ttl=3600, token=None):
        response = self.request("/api/platform/vault/grants", "POST", {
            "request_id": request, "credential_id": credential_id, "grantee": agent_id,
            "ttl_seconds": ttl, "request_budget": requests, "token_budget": tokens}, token or self.owner)
        self.assertEqual(response["status"], 201, response["body"])
        return response["body"]["grant"]

    def host_requests(self):
        with self.ledger.db() as db:
            return db.execute("SELECT count(*) FROM model_requests").fetchone()[0]

    def test_synthetic_acceptance_covers_tools_restart_revoke_and_single_billing(self):
        self.assertFalse(REAL_PROVIDER_ACCEPTANCE)
        self.vault.set_budget("OWNER:owner", 20, 0)
        self.error("OWNER_TOKEN_BUDGET_EXHAUSTED", lambda: self.vault.reserve_call(None, "OWNER:owner", "ab" * 16, "host-attempt"))
        self.assertEqual(self.vault.summary()["owner_token_remaining"], 0)
        credential = self.deposit()
        again = self.deposit()
        self.assertEqual(again["id"], credential["id"])
        self.error("PROVIDER_CREDENTIAL_CONFLICT", lambda: self.vault.deposit(
            "OWNER:owner", "credential_001", "xai", "synthetic-model", SYNTHETIC_KEY + "-other", "pilot"))
        grant = self.grant(credential["id"], self.agent_a)
        self.error("PROVIDER_GRANT_REASSIGNMENT_FORBIDDEN", lambda: self._reassign(credential["id"]))

        transport = SyntheticTransport([
            Response(json.dumps({"action": "tool", "kind": "community.snapshot", "payload": {}}), {"total_tokens": 20, "secret": "drop"}),
            Response(json.dumps({"action": "finish", "text": "Community snapshot recorded from the tool result."}), {"total_tokens": 11})])
        early = self.request("/api/platform/jobs", "POST", {
            "request_id": "order_001", "kind": "agent.work", "grant_id": grant["id"],
            "counterparty": self.agent_b, "payload": {"prompt": "Inspect the community and finish."}}, self.token_a)
        self.assertEqual(early["status"], 201, early["body"])
        job_id = early["body"]["job"]["id"]
        self.assertEqual(self.request("/api/platform/jobs/" + job_id + "/accept", "POST", {}, self.token_b)["status"], 409)
        with patch("zoora_platform.providers.http.client.HTTPSConnection", transport.connection()):
            self.assertTrue(self.platform.work_once())
        self.assertEqual(transport.hosts, ["api.x.ai", "api.x.ai"])
        self.assertEqual(transport.authorizations, ["Bearer " + SYNTHETIC_KEY, "Bearer " + SYNTHETIC_KEY])
        completed = self.request("/api/platform/jobs/" + job_id, token=self.token_b)["body"]["job"]
        self.assertEqual(completed["state"], "SUCCEEDED")
        self.assertEqual(completed["result"]["output"]["steps"][0]["kind"], "community.snapshot")
        self.assertIn("instance_id", completed["result"]["output"]["steps"][0]["output_preview"])
        self.assertEqual(completed["result"]["output"]["text"], "Community snapshot recorded from the tool result.")
        self.assertFalse(completed["result"]["financial_execution"])
        self.assertNotIn(SYNTHETIC_KEY, json.dumps(completed))
        self.assertEqual(self.request("/api/platform/jobs/" + job_id, token=self.operator)["status"], 404)
        accepted = self.request("/api/platform/jobs/" + job_id + "/accept", "POST", {"note": "Reviewed the recorded snapshot."}, self.token_b)["body"]["job"]
        repeated = self.request("/api/platform/jobs/" + job_id + "/accept", "POST", {"note": "second"}, self.token_b)["body"]["job"]
        self.assertEqual(repeated["acceptance"], accepted["acceptance"])
        self.assertFalse(accepted["acceptance"]["payment"])
        self.assertEqual(accepted["acceptance"]["principal"], "AGENT:" + self.agent_b)
        self.assertEqual(self.request("/api/platform/jobs/" + job_id + "/accept", "POST", {}, self.token_a)["status"], 404)
        usage = {row["observed_tokens"] for row in self.vault.usage("OWNER:owner") if row["job_id"] == job_id}
        self.assertEqual(usage, {20, 11})
        current = self.vault.grants("AGENT:" + self.agent_a)[0]
        self.assertEqual((current["request_budget"], current["token_budget"], current["state"]), (2, 4065, "ACTIVE"))
        self.assertEqual(self.vault.summary()["owner_token_remaining"], 0)
        sealed = self.ledger.path.read_bytes()
        self.assertNotIn(SYNTHETIC_KEY.encode(), sealed)
        self.assertNotIn(SYNTHETIC_KEY.encode(), self.vault.key_path.read_bytes())

        restarted_ledger = Ledger(self.ledger.path, self.clock)
        restarted_vault = Vault(restarted_ledger)
        restored = restarted_ledger.get(job_id, "AGENT:" + self.agent_b)
        self.assertEqual(restored["acceptance"]["note"], "Reviewed the recorded snapshot.")
        self.assertEqual({row["observed_tokens"] for row in restarted_vault.usage("OWNER:owner") if row["job_id"] == job_id}, {20, 11})
        opened = restarted_vault.credential_for(grant["id"], "AGENT:" + self.agent_a)
        self.assertEqual(opened["api_key"], SYNTHETIC_KEY)
        opened["api_key"] = ""

        queued = self.request("/api/platform/jobs", "POST", {
            "request_id": "order_002", "kind": "agent.generate", "grant_id": grant["id"],
            "payload": {"prompt": "This call must not reach the provider."}}, self.token_a)
        self.assertEqual(queued["status"], 201, queued["body"])
        self.vault.revoke_grant("OWNER:owner", grant["id"])
        blocked = SyntheticTransport(["TIMEOUT"])
        with patch("zoora_platform.providers.http.client.HTTPSConnection", blocked.connection()):
            self.platform.work_once()
        self.assertEqual(blocked.hosts, [])
        self.assertEqual(self.ledger.get(queued["body"]["job"]["id"], "OWNER:owner", True)["error"], "PROVIDER_GRANT_REVOKED")
        self.assertEqual(self.request("/api/platform/jobs", "POST", {
            "request_id": "order_003", "kind": "agent.generate", "payload": {"prompt": "Still revoked."}}, self.token_a)["status"], 403)

        fresh = self.grant(credential["id"], self.agent_a, request="grant_meter", requests=1, tokens=1024)
        before_hosts = self.host_requests()
        missed = SyntheticTransport(["CONSTRUCTOR"])
        missed_job = self.request("/api/platform/jobs", "POST", {
            "request_id": "order_004", "kind": "agent.generate", "grant_id": fresh["id"],
            "payload": {"prompt": "Fail before contact."}}, self.token_a)["body"]["job"]
        with patch("zoora_platform.providers.http.client.HTTPSConnection", missed.connection()):
            self.platform.work_once()
        self.assertEqual(self.ledger.get(missed_job["id"], "OWNER:owner", True)["error"], "MODEL_PROVIDER_UNAVAILABLE")
        released = self.vault.grants("AGENT:" + self.agent_a)
        released = next(item for item in released if item["id"] == fresh["id"])
        self.assertEqual((released["request_budget"], released["token_budget"], released["state"]), (1, 1024, "ACTIVE"))
        self.assertEqual(self.host_requests(), before_hosts)
        self.assertEqual(next(row["state"] for row in self.vault.usage("OWNER:owner") if row["job_id"] == missed_job["id"]), "RELEASED")

        unknown_job = self.request("/api/platform/jobs", "POST", {
            "request_id": "order_005", "kind": "agent.generate", "grant_id": fresh["id"],
            "payload": {"prompt": "Time out after submit."}}, self.token_a)["body"]["job"]
        timed = SyntheticTransport(["TIMEOUT"])
        with patch("zoora_platform.providers.http.client.HTTPSConnection", timed.connection()):
            self.platform.work_once()
        self.assertEqual(timed.authorizations, ["Bearer " + SYNTHETIC_KEY])
        unknown = next(row for row in self.vault.usage("OWNER:owner") if row["job_id"] == unknown_job["id"])
        self.assertEqual(unknown["state"], "UNKNOWN")
        held = next(item for item in self.vault.grants("AGENT:" + self.agent_a) if item["id"] == fresh["id"])
        self.assertEqual((held["request_budget"], held["token_budget"], held["state"]), (0, 0, "EXHAUSTED"))
        replay = self.vault.reserve_call(fresh["id"], "AGENT:" + self.agent_a, unknown_job["id"], unknown["attempt"])
        self.assertTrue(replay["replayed"])
        self.assertEqual(next(item for item in self.vault.grants("AGENT:" + self.agent_a) if item["id"] == fresh["id"])["token_budget"], 0)
        self.vault.reconcile(unknown["attempt"], {"total_tokens": 10})
        once = next(item for item in self.vault.grants("AGENT:" + self.agent_a) if item["id"] == fresh["id"])["token_budget"]
        self.vault.reconcile(unknown["attempt"], {"total_tokens": 1})
        twice = next(item for item in self.vault.grants("AGENT:" + self.agent_a) if item["id"] == fresh["id"])["token_budget"]
        self.assertEqual(once, 1014)
        self.assertEqual(twice, once)
        refused = SyntheticTransport(["TIMEOUT"])
        self.assertEqual(self.request("/api/platform/jobs", "POST", {
            "request_id": "order_006", "kind": "agent.generate", "grant_id": fresh["id"],
            "payload": {"prompt": "Budget is already held."}}, self.token_a)["status"], 429)
        self.assertEqual(refused.hosts, [])

    def _reassign(self, _owner_credential_id):
        # An owner-deposited key may be granted to an agent. An agent-deposited key may not be redirected.
        owned = self.community.call("POST", "/v1/operators", {"handle": "pilot_two"}, self.owner)[1]
        challenge = self.community.call("POST", "/v1/wallet/challenges",
                                        {"handle": "agent_three", "wallet": address("agent_three"), "capabilities": ["research"]}, owned["credential"]["token"])[1]
        third = self.community.call("POST", "/v1/agents", signed_body(challenge, "agent_three"), owned["credential"]["token"])[1]
        deposited, _ = self.vault.deposit("AGENT:" + third["agent"]["id"], "agent_key_001", "openai", "synthetic-model", "synthetic-agent-key-001", "agent key")
        return self.vault.grant("OWNER:owner", "stolen_grant", deposited["id"], "AGENT:" + self.agent_b, 3600, 1, 1024)

    def test_seeds_cookies_and_private_key_material_are_refused(self):
        phrase = " ".join(["abandon"] * 12)
        self.error("VAULT_SECRET_REJECTED", lambda: self.vault.deposit("OWNER:owner", "seed_001", "xai", "synthetic-model", phrase, "seed"))
        self.error("VAULT_SECRET_REJECTED", lambda: self.vault.deposit("OWNER:owner", "cookie_001", "xai", "synthetic-model", "sessionid=abc1234567890", "cookie"))
        self.error("VAULT_SECRET_REJECTED", lambda: self.vault.deposit("OWNER:owner", "hexkey_001", "xai", "synthetic-model", "ab" * 32, "hex"))
        self.assertEqual(self.vault.credentials("OWNER:owner"), [])
        self.assertEqual(self.request("/api/platform/status")["body"]["provider_vault"]["wallet_seeds_accepted"], False)
        self.assertFalse(self.request("/api/platform/status")["body"]["provider_vault"]["secrets_disclosed"])

    def test_expiry_and_revoked_grant_stop_a_schedule_without_calling_out(self):
        credential = self.deposit(request="credential_schedule")
        short = self.grant(credential["id"], self.agent_a, request="grant_short", requests=2, tokens=2048, ttl=60)
        self.at += 60_001
        self.error("PROVIDER_GRANT_EXPIRED", lambda: self.vault.assert_usable(short["id"], "AGENT:" + self.agent_a))
        self.assertEqual(self.vault.grants("OWNER:owner")[0]["state"], "EXPIRED")
        self.at -= 60_001
        live = self.grant(credential["id"], self.agent_a, request="grant_live", requests=2, tokens=2048, ttl=3600)
        scheduled = self.request("/api/platform/schedules", "POST", {
            "request_id": "schedule_vault_001", "kind": "agent.generate", "grant_id": live["id"],
            "payload": {"prompt": "Scheduled and then revoked."}, "interval_seconds": 60, "max_runs": 2}, self.token_a)
        self.assertEqual(scheduled["status"], 201, scheduled["body"])
        self.vault.revoke_grant("AGENT:" + self.agent_a, live["id"])
        transport = SyntheticTransport(["TIMEOUT"])
        with patch("zoora_platform.providers.http.client.HTTPSConnection", transport.connection()):
            self.ledger.tick(self.community.recorded_work_authority, self.platform._schedule_grant)
        self.assertEqual(transport.hosts, [])
        self.assertEqual(self.ledger.schedules("AGENT:" + self.agent_a)[0]["state"], "CANCELLED")
        self.assertEqual(self.ledger.list("AGENT:" + self.agent_a), [])

    def test_schema_v3_migrates_and_vault_key_stays_private(self):
        path = self.root / "legacy.sqlite3"
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        database = sqlite3.connect(path)
        database.executescript("""
            CREATE TABLE jobs(
              id TEXT PRIMARY KEY, principal TEXT NOT NULL, request_id TEXT NOT NULL,
              fingerprint TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
              state TEXT NOT NULL, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
              lease_token TEXT, lease_until_ms INTEGER, result TEXT, error TEXT,
              UNIQUE(principal,request_id));
            CREATE TABLE events(seq INTEGER PRIMARY KEY, job_id TEXT NOT NULL,
              at_ms INTEGER NOT NULL, action TEXT NOT NULL, digest TEXT NOT NULL);
            CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE payments(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,
              payer TEXT NOT NULL,quote TEXT NOT NULL,message TEXT NOT NULL,
              state TEXT NOT NULL,signature TEXT UNIQUE,receipt TEXT,error TEXT,
              created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL);
            CREATE TABLE schedules(id TEXT PRIMARY KEY,principal TEXT NOT NULL,
              request_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,
              interval_seconds INTEGER NOT NULL,remaining INTEGER NOT NULL,initial_runs INTEGER NOT NULL,
              next_ms INTEGER NOT NULL,state TEXT NOT NULL,UNIQUE(principal,request_id));
            CREATE TABLE model_requests(id TEXT PRIMARY KEY,at_ms INTEGER NOT NULL);
            PRAGMA user_version=3;
        """)
        database.execute("INSERT INTO jobs(id,principal,request_id,fingerprint,kind,payload,state,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?)",
                         ("c" * 32, "OPERATOR:a", "request_001", "f" * 64, "community.snapshot", "{}", "QUEUED", 1, 1))
        database.commit()
        database.close()
        migrated = Ledger(path, self.clock)
        self.assertEqual(migrated.get("c" * 32, "OPERATOR:a")["state"], "QUEUED")
        self.assertIsNone(migrated.get("c" * 32, "OPERATOR:a")["acceptance"])
        with migrated.db() as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 4)
            self.assertEqual(db.execute("SELECT hourly_request_limit, owner_token_remaining FROM compute_policy").fetchone()[1], 1_000_000)
        link = self.root / "linked.key"
        link.symlink_to(self.vault.key_path)
        with self.assertRaises(ValueError):
            Vault(self.ledger, link)
        os.chmod(self.vault.key_path, 0o644)
        with self.assertRaises(ValueError):
            Vault(self.ledger)
        os.chmod(self.vault.key_path, 0o600)


if __name__ == "__main__":
    unittest.main()
