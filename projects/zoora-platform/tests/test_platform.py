"""Production composition regressions. All chain/model transports here are SYNTHETIC."""
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import threading
import time
import urllib.request
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT), str(ROOT / "projects/zoora-platform"), str(ROOT / "projects/zoora-agent-community")]

from zoora_community.store import Store, credential_digest
from zoora_community.validation import Problem
from zoora_community.wsgi_server import Application, WSGIServer
from zoora_community.wallet_proof import decode_base58
from zoora_platform.application import Platform
from zoora_platform.ledger import Ledger
from zoora_platform.payments import Payments, PaymentRPC, encode58, transfer_message, TOKEN_PROGRAM, MEMO_PROGRAM
from zoora_platform.providers import ModelProvider
from zoora_platform.registry import Registry
from zoora_platform.__main__ import prepare_community


class Environment(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.at = 1800000000000
        self.clock = lambda: self.at
        self.ledger = Ledger(self.root / "platform.sqlite3", self.clock)

    def error(self, code, callback):
        with self.assertRaises(Problem) as raised:
            callback()
        self.assertEqual(raised.exception.code, code)


class LedgerTests(Environment):
    def submit(self, request="request_001", principal="OPERATOR:a", payload=None):
        return self.ledger.submit(principal, request, "community.snapshot", {} if payload is None else payload)

    def test_startup_preserves_identity_credential_and_read_only_rpc(self):
        state, owner = self.root / "existing-community", self.root / "existing-owner.json"
        first = prepare_community(state, owner)
        credential = owner.read_bytes()
        instance = first.call("GET", "/v1/status")[1]["instance_id"]
        restarted = prepare_community(state, owner)
        self.assertEqual(owner.read_bytes(), credential)
        self.assertEqual(restarted.call("GET", "/v1/status")[1]["instance_id"], instance)
        self.assertIsNotNone(restarted.rpc)

    def test_idempotency_preserves_one_job_across_credential_rotation(self):
        first, replay = self.submit(payload={"_authority": {"credential_id": "a"}})
        second, replay2 = self.submit(payload={"_authority": {"credential_id": "b"}})
        self.assertFalse(replay)
        self.assertTrue(replay2)
        self.assertEqual(first["id"], second["id"])
        self.error("IDEMPOTENCY_CONFLICT", lambda: self.submit(payload={"changed": True}))

    def test_principal_scoping_and_owner_visibility(self):
        job, _ = self.submit()
        self.assertEqual(self.ledger.list("OPERATOR:b"), [])
        self.error("JOB_NOT_FOUND", lambda: self.ledger.get(job["id"], "OPERATOR:b"))
        self.error("JOB_NOT_FOUND", lambda: self.ledger.cancel(job["id"], "OPERATOR:b"))
        self.assertEqual(self.ledger.get(job["id"], "OWNER:owner", True)["id"], job["id"])

    def test_restart_retains_queue_and_result(self):
        job, _ = self.submit()
        restarted = Ledger(self.ledger.path, self.clock)
        claim = restarted.claim()
        restarted.complete(claim, {"source": "SYNTHETIC"})
        self.assertEqual(Ledger(self.ledger.path, self.clock).get(job["id"], "OPERATOR:a")["result"], {"source": "SYNTHETIC"})

    def test_competing_workers_claim_once(self):
        self.submit()
        with ThreadPoolExecutor(max_workers=8) as pool:
            claims = list(pool.map(lambda _: self.ledger.claim(), range(8)))
        self.assertEqual(sum(item is not None for item in claims), 1)

    def test_expired_lease_is_not_reexecuted_or_completed(self):
        job, _ = self.submit()
        old = self.ledger.claim()
        self.at += 180001
        self.assertIsNone(self.ledger.claim())
        self.error("STALE_WORKER_COMPLETION", lambda: self.ledger.complete(old, {}))
        self.assertEqual(self.ledger.get(job["id"], "OPERATOR:a")["error"], "WORKER_INTERRUPTED_NO_AUTOMATIC_RETRY")

    def test_cancel_only_queued_work(self):
        job, _ = self.submit()
        self.assertEqual(self.ledger.cancel(job["id"], "OPERATOR:a")["state"], "CANCELLED")
        self.assertIsNone(self.ledger.claim())
        other, _ = self.submit("request_002")
        self.ledger.claim()
        self.error("ONLY_QUEUED_WORK_CAN_BE_CANCELLED", lambda: self.ledger.cancel(other["id"], "OPERATOR:a"))

    def test_requests_and_provider_calls_are_bounded(self):
        for i in range(20):
            self.submit("request_%03d" % i)
            self.ledger.reserve_model_request()
        self.error("HOURLY_WORK_LIMIT", lambda: self.submit("request_overflow"))
        self.error("HOST_MODEL_REQUEST_BUDGET_EXHAUSTED", self.ledger.reserve_model_request)

    def test_oversized_artifact_fails_without_publishing_content(self):
        job, _ = self.submit()
        claim = self.ledger.claim()
        self.ledger.complete(claim, {"body": "x" * 500001})
        result = self.ledger.get(job["id"], "OPERATOR:a")
        self.assertEqual(result["state"], "FAILED")
        self.assertIsNone(result["result"])

    def test_private_path_checks_reject_symlinks(self):
        link = self.root / "symlink.sqlite3"
        link.symlink_to(self.ledger.path)
        with self.assertRaises(ValueError):
            Ledger(link)

    def test_schedule_runs_once_per_due_slot_and_stops_at_budget(self):
        payload = {"_authority": {"credential_id": "synthetic"}}
        schedule = self.ledger.schedule("OPERATOR:a", "schedule_001", "community.snapshot", payload, 60, 2)
        authorize = lambda _: {"role": "OPERATOR", "principal_id": "a"}
        self.ledger.tick(authorize)
        self.ledger.tick(authorize)
        self.assertEqual(len(self.ledger.list("OPERATOR:a")), 1)
        restarted = Ledger(self.ledger.path, self.clock)
        self.at += 60000
        restarted.tick(authorize)
        self.assertEqual(len(restarted.list("OPERATOR:a")), 2)
        state = restarted.schedules("OPERATOR:a")[0]
        self.assertEqual(state["id"], schedule["id"])
        self.assertEqual((state["state"], state["remaining"]), ("COMPLETED", 0))

    def test_revocation_stops_scheduled_work(self):
        self.ledger.schedule("OPERATOR:a", "schedule_001", "community.snapshot", {"_authority": {"credential_id": "x"}}, 60, 5)
        def revoked(_):
            raise Problem(401, "UNAUTHORIZED")
        self.ledger.tick(revoked)
        self.assertEqual(self.ledger.schedules("OPERATOR:a")[0]["state"], "CANCELLED")
        self.assertEqual(self.ledger.list("OPERATOR:a"), [])

    def test_schedule_budget_is_not_silently_changed_by_retry(self):
        payload = {"_authority": {"credential_id": "x"}}
        self.ledger.schedule("OPERATOR:a", "schedule_001", "community.snapshot", payload, 60, 5)
        self.error("SCHEDULE_REQUEST_CONFLICT", lambda: self.ledger.schedule("OPERATOR:a", "schedule_001", "community.snapshot", payload, 60, 100))
        self.error("SCHEDULE_RUN_BUDGET_REJECTED", lambda: self.ledger.schedule("OPERATOR:a", "schedule_002", "community.snapshot", payload, 60, 101))


class FakeModel:
    configured = True
    provider = "SYNTHETIC"
    def __init__(self, decisions=None):
        self.decisions = list(decisions or [])
        self.reserve = None
    def generate(self, prompt):
        if self.reserve:
            self.reserve()
        return {"text": json.dumps(self.decisions.pop(0)), "provider": "SYNTHETIC", "usage": {}}


class PlatformTests(Environment):
    def setUp(self):
        super().setUp()
        self.owner_file = self.root / "owner.json"
        self.community = Store.initialize(self.root / "community", self.owner_file, self.clock)
        self.owner = json.loads(self.owner_file.read_text())["token"]
        self.registry = Registry(self.community, FakeModel(), self.root)
        self.wsgi = Application(self.community)
        self.wsgi.host, self.wsgi.origin = "127.0.0.1:8765", "http://127.0.0.1:8765"
        self.platform = Platform(self.community, self.ledger, self.registry, self.wsgi.runtime.assets["/"][0], {})
        self.wsgi.extension = self.platform.route

    def request(self, path, method="GET", body=None, token=None, origin=None):
        raw = b"" if body is None else json.dumps(body).encode()
        env = {"REQUEST_METHOD": method, "REQUEST_URI": path, "PATH_INFO": path.split("?")[0], "HTTP_HOST": self.wsgi.host, "wsgi.input": io.BytesIO(raw)}
        if body is not None:
            env.update(CONTENT_TYPE="application/json", CONTENT_LENGTH=str(len(raw)))
        if token is not None:
            env["HTTP_AUTHORIZATION"] = "Bearer " + token
        if origin:
            env["HTTP_ORIGIN"] = origin
        response = {}
        def start(status, headers):
            response.update(status=int(status.split()[0]), headers=dict(headers))
        data = b"".join(self.wsgi(env, start))
        response["body"] = json.loads(data) if response["headers"]["Content-Type"].startswith("application/json") else data.decode()
        return response

    def submit(self, kind="community.snapshot", payload=None, request="request_001"):
        return self.request("/api/platform/jobs", "POST", {"request_id": request, "kind": kind, "payload": payload or {}}, self.owner)

    def test_public_shell_status_and_existing_workspace_share_origin(self):
        self.assertIn("Economy control room", self.request("/")["body"])
        self.assertEqual(self.request("/workspace")["status"], 200)
        self.assertEqual(self.request("/v1/status")["status"], 200)
        status = self.request("/api/platform/status")["body"]
        self.assertFalse(status["activation"]["message_signature_is_payment"])
        self.assertEqual(self.request("/api/platform/jobs")["status"], 401)

    def test_host_origin_and_instance_checks_precede_mutation(self):
        before = self.ledger.status()["counts"]
        bad = self.request("/api/platform/jobs", "POST", {"request_id": "request_001", "kind": "community.snapshot", "payload": {}}, self.owner, "https://attacker.example")
        self.assertEqual(bad["status"], 403)
        pinned = self.request("/api/platform/jobs?expected_instance=" + "0" * 32, "POST", {"request_id": "request_001", "kind": "community.snapshot", "payload": {}}, self.owner)
        self.assertEqual(pinned["status"], 409)
        self.assertEqual(before, self.ledger.status()["counts"])

    def test_real_community_adapter_completes_durable_job_without_storing_bearer(self):
        response = self.submit()
        self.assertEqual(response["status"], 201)
        job = response["body"]["job"]
        self.assertTrue(self.platform.work_once())
        completed = self.request("/api/platform/jobs/" + job["id"], token=self.owner)["body"]["job"]
        self.assertEqual(completed["state"], "SUCCEEDED")
        self.assertEqual(completed["result"]["output"]["instance_id"], self.community.call("GET", "/v1/status")[1]["instance_id"])
        with self.ledger.db() as db:
            raw = db.execute("SELECT payload FROM jobs").fetchone()[0]
        self.assertNotIn(self.owner, raw)
        self.assertNotIn(credential_digest(self.owner), raw)

    def test_queued_authority_is_rechecked_after_rotation(self):
        job = self.submit()["body"]["job"]
        self.community.call("POST", "/v1/credentials/rotate", {}, self.owner)
        self.platform.work_once()
        result = self.ledger.get(job["id"], "OWNER:owner")
        self.assertEqual(result["state"], "FAILED")
        self.assertEqual(result["error"], "UNAUTHORIZED")

    def test_unregistered_code_and_user_rpc_input_are_rejected(self):
        self.assertEqual(self.submit("os.system", {"command": "echo bad"})["status"], 400)
        self.assertEqual(self.submit("community.snapshot", {"rpc_url": "https://attacker.example"})["status"], 400)
        self.assertEqual(self.ledger.status()["counts"], {})

    def test_missing_provider_cannot_succeed_or_fabricate_output(self):
        self.registry.model.configured = False
        self.assertEqual(self.submit("agent.generate", {"prompt": "hello"})["status"], 503)
        self.assertEqual(self.ledger.status()["counts"], {})

    def test_bounded_agent_executes_only_registered_tools(self):
        self.registry.model.decisions = [{"action": "tool", "kind": "community.snapshot", "payload": {}}, {"action": "finish", "text": "Read the actual community snapshot."}]
        job = self.submit("agent.work", {"prompt": "Inspect community state"})["body"]["job"]
        self.platform.work_once()
        result = self.ledger.get(job["id"], "OWNER:owner")
        self.assertEqual(result["state"], "SUCCEEDED")
        self.assertEqual(result["result"]["output"]["steps"][0]["kind"], "community.snapshot")
        self.assertFalse(result["result"]["financial_execution"])

    def test_model_cannot_grant_itself_a_shell_or_signer(self):
        self.registry.model.decisions = [{"action": "tool", "kind": "wallet.send", "payload": {}}]
        job = self.submit("agent.work", {"prompt": "Do a thing"})["body"]["job"]
        self.platform.work_once()
        self.assertEqual(self.ledger.get(job["id"], "OWNER:owner")["error"], "UNREGISTERED_AGENT_TOOL")

    def test_brain_readiness_reads_catalog_and_keeps_qualification_limits(self):
        job = self.submit("research.brain_readiness")["body"]["job"]
        self.platform.work_once()
        output = self.ledger.get(job["id"], "OWNER:owner")["result"]["output"]
        self.assertTrue(output["sources"])
        self.assertEqual(output["qualified_trading_models"], 0)

    def test_owner_can_schedule_and_cancel_work(self):
        value = self.request("/api/platform/schedules", "POST", {"request_id": "schedule_001", "kind": "community.snapshot", "payload": {}, "interval_seconds": 60, "max_runs": 2}, self.owner)
        self.assertEqual(value["status"], 201)
        key = value["body"]["schedule"]["id"]
        self.assertEqual(self.request("/api/platform/schedules/"+key+"/cancel", "POST", {}, self.owner)["body"]["schedule"]["state"], "CANCELLED")

    def test_actual_http_and_background_worker_complete_without_manual_dispatch(self):
        with patch.dict("os.environ", {"ZOORA_PRIVATE_PILOT": "0"}, clear=True):
            server = WSGIServer(self.community, 0)
        server.application.extension = self.platform.route
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.platform.start()
        try:
            data = json.dumps({"request_id": "http_request_001", "kind": "community.snapshot", "payload": {}}).encode()
            request = urllib.request.Request(server.origin + "/api/platform/jobs", data=data, headers={"Authorization": "Bearer " + self.owner, "Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=3) as response:
                job = json.load(response)["job"]
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                current = self.ledger.get(job["id"], "OWNER:owner")
                if current["state"] == "SUCCEEDED":
                    break
                time.sleep(0.02)
            self.assertEqual(current["state"], "SUCCEEDED")
            self.assertEqual(self.ledger.status()["worker"], "ONLINE")
        finally:
            self.platform.close()
            server.shutdown()
            thread.join(timeout=2)


class ModelTests(Environment):
    def provider(self):
        return ModelProvider({"ZOORA_MODEL_PROVIDER": "xai", "ZOORA_MODEL_NAME": "synthetic-model", "ZOORA_MODEL_API_KEY": "synthetic-private-key"})

    def test_provider_uses_fixed_host_caps_and_reports_only_numeric_usage(self):
        class Response:
            status = 200
            def __init__(self):
                self.data = json.dumps({"choices": [{"message": {"content": "Synthetic response"}}], "usage": {"output_tokens": 5, "secret": "must not retain"}}).encode()
            def read1(self, size):
                data, self.data = self.data[:size], self.data[size:]
                return data
        class Connection:
            sock = None
            def request(self, method, path, body, headers):
                self.body, self.headers = json.loads(body), headers
            def getresponse(self):
                return Response()
            def close(self):
                pass
        connection = Connection()
        provider = self.provider()
        provider.reserve = self.ledger.reserve_model_request
        with patch("zoora_platform.providers.http.client.HTTPSConnection", return_value=connection) as constructor:
            result = provider.generate("Synthetic test prompt")
        self.assertEqual(constructor.call_args.args[0], "api.x.ai")
        self.assertEqual(connection.body["max_tokens"], 1024)
        self.assertEqual(result["usage"], {"output_tokens": 5})
        self.assertNotIn("synthetic-private-key", json.dumps(result))

    def test_provider_error_has_no_secret_text_or_automatic_retry(self):
        class Response:
            status = 429
            def read1(self, size):
                return b""
        class Connection:
            sock = None
            def request(self, *args):
                pass
            def getresponse(self):
                return Response()
            def close(self):
                pass
        with patch("zoora_platform.providers.http.client.HTTPSConnection", return_value=Connection()) as constructor:
            self.error("MODEL_PROVIDER_REQUEST_FAILED", lambda: self.provider().generate("Synthetic"))
        self.assertEqual(constructor.call_count, 1)

    def test_absent_provider_cannot_infer_or_consume_budget(self):
        with patch("zoora_platform.providers.http.client.HTTPSConnection") as constructor:
            self.error("MODEL_PROVIDER_NOT_CONFIGURED", lambda: ModelProvider({}).generate("Synthetic"))
        constructor.assert_not_called()


def address(n):
    return encode58(bytes([n]) * 32)


class FakeRPC:
    def __init__(self):
        self.transaction = None
    def identity(self):
        return None
    def token_account(self, owner, mint, amount):
        return address(2) if owner == address(1) else address(3)
    def call(self, method, params):
        if method == "getAccountInfo":
            return {"value": {"owner": TOKEN_PROGRAM, "data": {"parsed": {"type": "mint", "info": {"decimals": 6, "isInitialized": True}}}}}
        if method == "getLatestBlockhash":
            return {"value": {"blockhash": address(7), "lastValidBlockHeight": 1000}}
        if method == "getTransaction":
            return self.transaction
        if method == "getSlot":
            return 110
        raise AssertionError(method)


def transaction_for(payment, signature):
    def balance(index, owner, amount):
        return {"accountIndex": index, "mint": payment["mint"], "owner": owner, "programId": TOKEN_PROGRAM,
                "uiTokenAmount": {"amount": str(amount), "decimals": 6}}
    keys = [payment["payer"], address(2), address(3), payment["mint"], MEMO_PROGRAM, TOKEN_PROGRAM]
    amount = int(payment["amount_raw"])
    return {"version": 0, "slot": 100, "blockTime": payment["quote_created_at"] + 1,
            "transaction": {"signatures": [signature], "message": {
              "accountKeys": [{"pubkey": key, "signer": i == 0, "writable": i < 3, "source": "transaction"} for i, key in enumerate(keys)],
              "instructions": [{"programId": MEMO_PROGRAM, "parsed": payment["memo"]},
                {"programId": TOKEN_PROGRAM, "parsed": {"type": "transferChecked", "info": {
                  "source": address(2), "destination": address(3), "authority": payment["payer"], "mint": payment["mint"],
                  "tokenAmount": {"amount": payment["amount_raw"], "decimals": 6}}}}]}},
            "meta": {"err": None, "fee": 5000, "innerInstructions": [],
              "preTokenBalances": [balance(1, payment["payer"], amount * 2), balance(2, payment["recipient"], 0)],
              "postTokenBalances": [balance(1, payment["payer"], amount), balance(2, payment["recipient"], amount)]}}


class PaymentTests(Environment):
    def setUp(self):
        super().setUp()
        self.rpc = FakeRPC()
        self.payments = Payments(self.ledger, {"ZOORA_AAI_MINT": address(4), "ZOORA_PAYMENT_RECIPIENT": address(5)}, self.rpc)
        self.invoice = self.payments.create("invoice_001", address(1), "1000")
        self.signature = encode58(bytes([9]) * 64)

    def test_unsigned_message_account_order_and_instruction_amount(self):
        message = transfer_message(self.invoice, address(2), address(3), address(7))
        self.assertEqual(message[:4], bytes([1, 0, 3, 6]))
        keys = [message[4+i*32:4+(i+1)*32] for i in range(6)]
        self.assertEqual(keys[0], decode_base58(address(1), 32, "invalid"))
        self.assertEqual(message[196:228], decode_base58(address(7), 32, "invalid"))
        self.assertEqual(message[228], 2)
        self.assertEqual(message[-10:], b"\x0c" + struct.pack("<Q", 1000) + b"\x06")

    def test_invoice_deduplication_and_payer_isolation(self):
        self.assertEqual(self.payments.create("invoice_001", address(1), "1000")["id"], self.invoice["id"])
        self.error("PAYMENT_NOT_FOUND", lambda: self.payments.get(self.invoice["id"], address(8)))
        self.error("PAYMENT_REQUEST_CONFLICT", lambda: self.payments.create("invoice_001", address(1), "1001"))

    def test_finalized_exact_payment_confirms_service_not_activation(self):
        self.payments.submit(self.invoice["id"], self.signature, address(1))
        self.rpc.transaction = transaction_for(self.invoice, self.signature)
        self.payments.poll()
        result = self.payments.get(self.invoice["id"], address(1))
        self.assertEqual(result["state"], "CONFIRMED")
        self.assertFalse(result["activation_granted"])
        self.assertFalse(result["receipt"]["membership_activated"])
        self.assertEqual(result["receipt"]["receipt_deduplication"], "DURABLE_UNIQUE_SIGNATURE")

    def test_pending_is_never_reported_as_confirmed(self):
        self.payments.submit(self.invoice["id"], self.signature, address(1))
        self.payments.poll()
        self.assertEqual(self.payments.get(self.invoice["id"], address(1))["state"], "SUBMITTED")

    def test_pending_transaction_does_not_starve_another_finalized_invoice(self):
        other = self.payments.create("invoice_002", address(1), "1000")
        second_signature = encode58(bytes([10]) * 64)
        self.payments.submit(self.invoice["id"], self.signature, address(1))
        self.payments.submit(other["id"], second_signature, address(1))
        original = self.rpc.call
        observed = []

        def response(method, params):
            if method == "getTransaction":
                observed.append(params[0])
                return transaction_for(other, second_signature) if params[0] == second_signature else None
            return original(method, params)

        # Force a deterministic order independent of random invoice IDs.
        with self.ledger.db(True) as db:
            db.execute("UPDATE payments SET updated_ms=updated_ms-1 WHERE id=?", (self.invoice["id"],))
        with patch.object(self.rpc, "call", side_effect=response):
            self.payments.poll()
            self.payments.last_poll = 0
            self.payments.poll()
        self.assertEqual(observed, [self.signature, second_signature])
        self.assertEqual(self.payments.get(self.invoice["id"], address(1))["state"], "SUBMITTED")
        self.assertEqual(self.payments.get(other["id"], address(1))["state"], "CONFIRMED")

    def test_signature_cannot_be_reused_for_another_invoice(self):
        self.payments.submit(self.invoice["id"], self.signature, address(1))
        other = self.payments.create("invoice_002", address(1), "1000")
        self.error("PAYMENT_SIGNATURE_REPLAY", lambda: self.payments.submit(other["id"], self.signature, address(1)))

    def test_failed_transaction_never_confirms(self):
        self.payments.submit(self.invoice["id"], self.signature, address(1))
        self.rpc.transaction = transaction_for(self.invoice, self.signature)
        self.rpc.transaction["meta"]["err"] = {"synthetic": "failure"}
        self.payments.poll()
        self.assertEqual(self.payments.get(self.invoice["id"], address(1))["state"], "REJECTED")

    def test_wrong_memo_and_amount_are_rejected(self):
        for mutation in ("memo", "amount"):
            invoice = self.payments.create("invoice_"+mutation, address(1), "1000")
            signature = encode58(bytes([10 if mutation == "memo" else 11]) * 64)
            self.payments.submit(invoice["id"], signature, address(1))
            # Cancel earlier unsubmitted invoice; only submitted rows are polled.
            self.rpc.transaction = transaction_for(invoice, signature)
            if mutation == "memo":
                self.rpc.transaction["transaction"]["message"]["instructions"][0]["parsed"] = "wrong"
            else:
                self.rpc.transaction["transaction"]["message"]["instructions"][1]["parsed"]["info"]["tokenAmount"]["amount"] = "999"
            self.payments.last_poll = 0
            self.payments.poll()
            self.assertEqual(self.payments.get(invoice["id"], address(1))["state"], "REJECTED")

    def test_missing_configuration_and_fake_signatures_cannot_activate(self):
        self.error("AAI_MINT_AND_PAYMENT_RECIPIENT_REQUIRED", lambda: Payments(self.ledger, {}).create("invoice_missing", address(1), "1000"))
        self.error("INVALID_TRANSACTION_SIGNATURE", lambda: self.payments.submit(self.invoice["id"], "CHAIN_READ", address(1)))

    def test_chain_identity_must_match_mainnet(self):
        rpc = PaymentRPC()
        with patch.object(rpc, "call", return_value="wrong_genesis"):
            self.error("PAYMENT_CHAIN_MISMATCH", rpc.identity)


if __name__ == "__main__":
    unittest.main()
