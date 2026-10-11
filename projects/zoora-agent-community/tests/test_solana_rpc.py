from contextlib import closing
import hashlib
import http.client
import json
import sqlite3
import time
import unittest
from unittest.mock import Mock, patch

from helpers import Fixture, address
from test_wallet_proof import encode58
from zoora_community.solana_rpc import NETWORKS, SYSTEM_PROGRAM, SolanaRPC, empty_report, summarize
from zoora_community.store import Store
from zoora_community.validation import Problem, canonical

SIGNATURE = encode58(bytes(range(64)))


def transaction(agent=None, failure=False, inner=False):
    agent = address("rpc_agent") if agent is None else agent
    destination = address("recipient")
    instruction = {"programId": SYSTEM_PROGRAM, "program": "system", "parsed": {"type": "transfer",
                   "info": {"source": agent, "destination": destination, "lamports": 1000}}}
    return {"slot": 2**64 - 1, "blockTime": None, "version": 0,
        "transaction": {"signatures": [SIGNATURE], "message": {
            "accountKeys": [{"pubkey": agent, "signer": True, "writable": True, "source": "transaction"},
                            {"pubkey": destination, "signer": False, "writable": True, "source": "lookupTable"},
                            {"pubkey": SYSTEM_PROGRAM, "signer": False, "writable": False, "source": "transaction"}],
            "instructions": [instruction]}},
        "meta": {"err": {"InstructionError": [0, "Custom"]} if failure else None, "fee": 5000,
                 "preBalances": [10000, 0, 1], "postBalances": [5000 if failure else 4000, 0 if failure else 1000, 1],
                 "innerInstructions": [{"index": 0, "instructions": [instruction]}] if inner else []}}


class FixtureRPC(SolanaRPC):
    def __init__(self, value=None):
        super().__init__()
        self.value = transaction() if value is None else value
        self.requests = []

    def _request(self, cluster, method, params, deadline):
        self.requests.append((cluster, method, params))
        value = NETWORKS[cluster][1] if method == "getGenesisHash" else self.value
        raw = canonical({"jsonrpc": "2.0", "id": 1, "result": value})
        return value, raw, hashlib.sha256(raw.encode()).hexdigest()


class RpcTests(unittest.TestCase):
    def refused(self, fn):
        with self.assertRaises(Problem):
            fn()

    def test_native_transfer_keeps_exact_units_fee_and_missing_time(self):
        report = summarize(transaction(), "solana:devnet", SIGNATURE, address("rpc_agent"))
        self.assertEqual(report["slot"], "18446744073709551615")
        self.assertEqual(report["fee_lamports"], "5000")
        self.assertEqual(report["native_balance_change_lamports"], "-6000")
        self.assertEqual(report["native_transfer_instructions"][0]["lamports"], "1000")
        self.assertEqual(report["missingness"], ["block_time"])
        self.assertIsNone(report["observed_at_ms"])
        self.assertEqual(report["pnl"], "UNAVAILABLE")

    def test_failed_transaction_is_observable_and_instructions_not_settled(self):
        report = summarize(transaction(failure=True), "solana:devnet", SIGNATURE, address("rpc_agent"))
        self.assertEqual(report["state"], "AVAILABLE")
        self.assertEqual(report["execution"], "FAILED")
        self.assertEqual(report["native_balance_change_lamports"], "-5000")
        self.assertEqual(report["native_transfer_instructions"][0]["settlement"], "NOT_SETTLED")
        self.assertEqual(report["fee_lamports"], "5000")

    def test_unrelated_transaction_is_preserved_and_no_payment_attribution(self):
        report = summarize(transaction(), "solana:devnet", SIGNATURE, address("other"))
        self.assertFalse(report["related_to_agent"])
        self.assertIn("UNRELATED_TO_AGENT", report["quality_flags"])
        self.assertIn("NO_PAYMENT_ATTRIBUTION", report["quality_flags"])
        self.assertIsNone(report["native_balance_change_lamports"])

    def test_missing_transaction_and_metadata_are_distinct(self):
        self.assertEqual(summarize(None, "solana:devnet", SIGNATURE, address("rpc_agent"))["state"], "UNAVAILABLE")
        value = transaction()
        value["meta"] = None
        report = summarize(value, "solana:devnet", SIGNATURE, address("rpc_agent"))
        self.assertEqual(report["state"], "UNVERIFIED")
        self.assertIsNone(report["fee_lamports"])
        self.assertEqual(report["native_transfer_instructions"], [])

    def test_inner_instructions_large_amounts_and_unsupported_programs(self):
        value = transaction(inner=True)
        value["meta"]["innerInstructions"][0]["instructions"][0]["parsed"]["info"]["lamports"] = 2**64 - 1
        value["transaction"]["message"]["instructions"].append({"programId": SYSTEM_PROGRAM, "data": "111"})
        report = summarize(value, "solana:devnet", SIGNATURE, address("rpc_agent"))
        self.assertEqual(report["native_transfer_instructions"][1]["scope"], "INNER")
        self.assertEqual(report["native_transfer_instructions"][1]["lamports"], "18446744073709551615")
        self.assertIn("UNSUPPORTED_INSTRUCTIONS_PRESERVED_IN_RAW_RPC", report["quality_flags"])

    def test_malformed_schema_cannot_be_successful_data(self):
        for mutate in (lambda x: x.update(slot=True), lambda x: x.update(version=False),
                       lambda x: x["meta"].update(fee=-1), lambda x: x["meta"].update(preBalances=[1]),
                       lambda x: x["transaction"].update(signatures=["1" * 64]),
                       lambda x: x["transaction"]["message"]["accountKeys"].append(x["transaction"]["message"]["accountKeys"][0]),
                       lambda x: x["transaction"]["message"]["instructions"][0]["parsed"]["info"].update(lamports=1.5)):
            value = transaction()
            mutate(value)
            self.refused(lambda value=value: summarize(value, "solana:devnet", SIGNATURE, address("rpc_agent")))

    def test_wrong_genesis_and_mismatched_signature_are_unverified(self):
        rpc = FixtureRPC()
        original = rpc._request
        rpc._request = lambda cluster, method, params, deadline: ("wrong", "", "0" * 64) if method == "getGenesisHash" else original(cluster, method, params, deadline)
        report, raw = rpc.observe("solana:devnet", SIGNATURE, address("rpc_agent"))
        self.assertEqual(report["state"], "UNVERIFIED")
        self.assertIn("RPC_NETWORK_MISMATCH", report["quality_flags"])
        self.assertIsNone(raw)
        self.assertEqual(rpc.requests, [])
        value = transaction()
        value["transaction"]["signatures"] = [encode58(b"x" * 64)]
        report, _raw = FixtureRPC(value).observe("solana:devnet", SIGNATURE, address("rpc_agent"))
        self.assertIn("RPC_SIGNATURE_MISMATCH", report["quality_flags"])

    def test_adapter_uses_only_fixed_hosts_finalized_parsed_and_version_zero(self):
        rpc = FixtureRPC()
        rpc.observe("solana:devnet", SIGNATURE, address("rpc_agent"))
        self.assertEqual([x[1] for x in rpc.requests], ["getGenesisHash", "getTransaction"])
        self.assertEqual(rpc.requests[1][2], [SIGNATURE, {"encoding": "jsonParsed", "commitment": "finalized", "maxSupportedTransactionVersion": 0}])
        self.refused(lambda: rpc.observe("http://localhost/", SIGNATURE, address("rpc_agent")))
        self.refused(lambda: SolanaRPC()._request("solana:devnet", "sendTransaction", [], time.monotonic() + 8))

    def transport(self, body, status=200, encoding=None):
        response = Mock()
        response.status = status
        response.getheader.side_effect = lambda name: encoding if name == "Content-Encoding" else "application/json"
        response.read1.side_effect = [body, b""]
        connection = Mock()
        connection.getresponse.return_value = response
        return connection

    def test_transport_rejects_redirects_encoding_large_duplicate_and_wrong_id(self):
        valid = canonical({"jsonrpc": "2.0", "id": 1, "result": None}).encode()
        for body, status, encoding in ((valid, 302, None), (valid, 200, "gzip"), (b"x" * 262145, 200, None),
                (b'{"jsonrpc":"2.0","id":1,"result":null,"result":1}', 200, None),
                (b'{"jsonrpc":"2.0","id":true,"result":null}', 200, None)):
            connection = self.transport(body, status, encoding)
            with patch("zoora_community.solana_rpc.http.client.HTTPSConnection", return_value=connection):
                self.refused(lambda: SolanaRPC()._request("solana:devnet", "getTransaction", [], time.monotonic() + 8))
                connection.close.assert_called_once()
                connection.getresponse.return_value.close.assert_called_once()

    def test_transport_failures_redact_provider_details_and_always_close(self):
        for exception, flag in ((OSError("sensitive proxy information"), "RPC_UNAVAILABLE"),
                               (TimeoutError("sensitive timeout"), "RPC_TIMEOUT"),
                               (http.client.RemoteDisconnected("detail"), "RPC_UNAVAILABLE")):
            connection = Mock()
            connection.request.side_effect = exception
            with patch("zoora_community.solana_rpc.http.client.HTTPSConnection", return_value=connection):
                report, raw = SolanaRPC().observe("solana:devnet", SIGNATURE, address("rpc_agent"))
            self.assertEqual(report["state"], "FAILED")
            self.assertIn(flag, report["quality_flags"])
            self.assertIsNone(raw)
            self.assertNotIn("sensitive", json.dumps(report))
            connection.close.assert_called_once()

    def test_provider_error_keeps_numeric_method_and_digest_without_message(self):
        for value, expected in ((-32015, -32015), (True, None), ("private metadata", None), (2**40, None)):
            body = canonical({"jsonrpc": "2.0", "id": 1, "error": {"code": value,
                "message": "private metadata must not escape", "data": "sensitive"}}).encode()
            connection = self.transport(body)
            with patch("zoora_community.solana_rpc.http.client.HTTPSConnection", return_value=connection):
                report, raw = SolanaRPC().observe("solana:devnet", SIGNATURE, address("rpc_agent"))
            self.assertEqual(report["state"], "FAILED")
            self.assertEqual(report["provider_error_code"], expected)
            self.assertEqual(report["failed_rpc_method"], "getGenesisHash")
            self.assertEqual(report["provider_error_response_sha256"], hashlib.sha256(body).hexdigest())
            self.assertIsNone(raw)
            self.assertNotIn("private metadata", json.dumps(report))
            self.assertNotIn("sensitive", json.dumps(report))
            connection.close.assert_called_once()

    def test_concurrency_limit_returns_failure_without_fetch(self):
        rpc = FixtureRPC()
        for _ in range(4):
            rpc.workers.acquire()
        report, _raw = rpc.observe("solana:devnet", SIGNATURE, address("rpc_agent"))
        self.assertIn("RPC_CAPACITY_LIMIT", report["quality_flags"])
        self.assertEqual(rpc.requests, [])


class ObservationStoreTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        _, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator, "rpc_agent")
        self.rpc = FixtureRPC()
        self.f.store.rpc = self.rpc
        self.route = "/v1/agents/" + self.agent_id + "/transactions"
        self.body = {"network": "solana:devnet", "signature": SIGNATURE}

    def refused(self, code, fn):
        with self.assertRaises(Problem) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def test_real_store_links_observation_provenance_raw_and_restart(self):
        result = self.f.store.call("POST", self.route, self.body, self.agent)[1]
        self.assertEqual(result["report"]["available_at_ms"], self.f.at)
        self.assertEqual(result["report"]["state"], "AVAILABLE")
        restored = Store(self.f.state, clock=lambda: self.f.at)
        detail = restored.call("GET", "/v1/transactions/" + result["id"])[1]
        self.assertIn('"slot":18446744073709551615', detail["raw_rpc_json"])
        self.assertEqual(restored.call("GET", self.route)[1]["items"][0]["id"], result["id"])
        self.assertEqual(restored.call("GET", "/v1/status")[1]["transaction_observations"], 1)
        restored.audit()

    def test_failed_fetch_is_persistent_and_charged_across_restart(self):
        self.rpc.observe = lambda *args: (empty_report("solana:devnet", SIGNATURE, "FAILED", ["RPC_TIMEOUT"]), None)
        for _ in range(3):
            self.assertEqual(self.f.store.call("POST", self.route, self.body, self.agent)[1]["report"]["state"], "FAILED")
        restarted = Store(self.f.state, clock=lambda: self.f.at, rpc=FixtureRPC())
        self.refused("OBSERVATION_RATE_LIMIT", lambda: restarted.call("POST", self.route, self.body, self.agent))
        self.f.at += 60_000
        self.assertEqual(restarted.call("POST", self.route, self.body, self.agent)[0], 201)
        restarted.audit()

    def test_unauthorized_role_network_overrides_and_unsigned_wallet_rejected(self):
        self.refused("FORBIDDEN", lambda: self.f.store.call("POST", self.route, self.body, self.operator))
        self.refused("INVALID_FIELDS", lambda: self.f.store.call("POST", self.route, dict(self.body, rpc_url="http://169.254.169.254"), self.agent))
        self.refused("UNSUPPORTED_NETWORK", lambda: self.f.store.call("POST", self.route, dict(self.body, network="evil"), self.agent))
        self.refused("INVALID_TRANSACTION_SIGNATURE", lambda: self.f.store.call("POST", self.route, dict(self.body, signature="not a signature"), self.agent))
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("DELETE FROM wallet_proofs")
        self.refused("WALLET_PROOF_REQUIRED", lambda: self.f.store.call("POST", self.route, self.body, self.agent))
        self.assertEqual(self.rpc.requests, [])

    def test_rpc_disabled_does_not_reserve_an_attempt(self):
        self.f.store.rpc = None
        self.refused("RPC_DISABLED", lambda: self.f.store.call("POST", self.route, self.body, self.agent))
        self.assertEqual(self.f.store.call("GET", "/v1/status")[1]["transaction_observations"], 0)

    def test_completion_reauth_prevents_revoked_credential_writes(self):
        observe = self.rpc.observe

        def revoke_during_fetch(*args):
            self.f.store.call("POST", "/v1/credentials/rotate", {}, self.agent)
            return observe(*args)

        self.rpc.observe = revoke_during_fetch
        self.refused("UNAUTHORIZED", lambda: self.f.store.call("POST", self.route, self.body, self.agent))
        row = self.f.store.call("GET", "/v1/transactions")[1]["items"][0]
        self.assertEqual(row["report"]["state"], "UNVERIFIED")
        self.assertIn("REQUEST_PENDING_NOT_CHAIN_OBSERVATION", row["report"]["quality_flags"])
        self.f.store.audit()

    def test_pending_attempt_survives_process_failure_and_no_unattributed_balance(self):
        self.rpc.observe = Mock(side_effect=RuntimeError("injected process failure"))
        with self.assertRaises(RuntimeError):
            self.f.store.call("POST", self.route, self.body, self.agent)
        result = Store(self.f.state, clock=lambda: self.f.at).call("GET", "/v1/transactions")[1]["items"][0]
        self.assertIsNone(result["report"]["fee_lamports"])
        self.assertEqual(result["report"]["state"], "UNVERIFIED")
        self.assertIsNone(result["provenance"]["available_at_ms"])

    def test_audit_detects_normalized_amount_different_from_raw(self):
        result = self.f.store.call("POST", self.route, self.body, self.agent)[1]
        result["report"]["fee_lamports"] = "0"
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("UPDATE transactions SET report=? WHERE id=?", (canonical(result["report"]), result["id"]))
        self.refused("EVIDENCE_CONSISTENCY_FAILURE", self.f.store.audit)
