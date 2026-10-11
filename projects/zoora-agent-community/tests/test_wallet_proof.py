import base64
from contextlib import closing
import json
import sqlite3
import unittest
from unittest.mock import patch

from helpers import Fixture, address, signed_body
from zoora_community.store import LIMITS, Store
from zoora_community.validation import BASE58, Problem
from zoora_community.wallet_proof import CHALLENGE_TTL_MS, decode_base58, verify_signature
from nacl.bindings import crypto_core_ed25519_add, crypto_core_ed25519_is_valid_point


def encode58(raw):
    number = int.from_bytes(raw, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = BASE58[remainder] + encoded
    return "1" * (len(raw) - len(raw.lstrip(b"\0"))) + encoded


class WalletProofTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.operator_id, self.operator = self.f.operator()

    def refused(self, code, fn):
        with self.assertRaises(Problem) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def challenge(self, label="wallet_agent", token=None):
        return self.f.store.call("POST", "/v1/wallet/challenges", {"handle": label,
            "wallet": address(label), "capabilities": ["research"], "bio": "Test profile"}, token or self.operator)[1]

    def test_independent_rfc8032_vector_and_tampered_signature(self):
        # RFC 8032 section 7.1, TEST 2, public key and signature, not generated here.
        public = bytes.fromhex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c")
        signature = bytes.fromhex("92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da"
                                  "085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00")
        verify_signature(encode58(public), "r", base64.b64encode(signature).decode())
        self.refused("WALLET_SIGNATURE_REJECTED", lambda: verify_signature(encode58(public), "s", base64.b64encode(signature).decode()))

    def test_low_order_off_curve_and_mixed_order_keys_cannot_prove_control(self):
        public = bytes.fromhex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c")
        order_two = bytes.fromhex("ec" + "ff" * 30 + "7f")
        mixed = crypto_core_ed25519_add(public, order_two)
        self.assertFalse(crypto_core_ed25519_is_valid_point(mixed), "Patched libsodium main-subgroup validation is required")
        for key in (bytes(32), b"\1" + bytes(31), bytes.fromhex("ff" * 32), order_two, mixed):
            self.refused("WALLET_KEY_REJECTED", lambda key=key: verify_signature(encode58(key), "Any message", base64.b64encode(bytes(64)).decode()))
        self.refused("WALLET_KEY_REJECTED", lambda: self.f.store.call("POST", "/v1/wallet/challenges",
            {"handle": "forged_wallet", "wallet": "1" * 32, "capabilities": ["research"]}, self.operator))

    def test_registration_requires_bound_proof_and_never_accepts_keys(self):
        self.refused("INVALID_FIELDS", lambda: self.f.store.call("POST", "/v1/agents",
            {"handle": "wallet_agent", "wallet": address("wallet_agent"), "capabilities": ["research"]}, self.operator))
        challenge = self.challenge()
        body = signed_body(challenge, "wallet_agent")
        self.refused("INVALID_FIELDS", lambda: self.f.store.call("POST", "/v1/agents", dict(body, seed_phrase="never accepted"), self.operator))
        result = self.f.store.call("POST", "/v1/agents", body, self.operator)[1]
        self.assertEqual(result["agent"]["wallet_status"], "SIGNATURE_VERIFIED")
        self.assertEqual(result["agent"]["bio"], "Test profile")
        self.assertNotIn("token", json.dumps(result["agent"]))
        public = self.f.store.call("GET", "/v1/agents/" + result["agent"]["id"] + "/wallet-proof")[1]
        verify_signature(public["wallet"], public["message"], public["signature"])
        self.f.store.audit()

    def test_wrong_key_and_modified_message_do_not_consume_nonce(self):
        challenge = self.challenge()
        wrong = signed_body(challenge, "different_key")
        self.refused("WALLET_SIGNATURE_REJECTED", lambda: self.f.store.call("POST", "/v1/agents", wrong, self.operator))
        modified = dict(challenge, message=challenge["message"] + " ")
        self.refused("WALLET_SIGNATURE_REJECTED", lambda: self.f.store.call("POST", "/v1/agents", signed_body(modified, "wallet_agent"), self.operator))
        self.assertEqual(self.f.store.call("POST", "/v1/agents", signed_body(challenge, "wallet_agent"), self.operator)[0], 201)

    def test_expiry_is_exact_and_restart_cannot_reuse_nonce(self):
        challenge = self.challenge()
        self.f.at += CHALLENGE_TTL_MS
        restarted = Store(self.f.state, clock=lambda: self.f.at)
        self.refused("CHALLENGE_EXPIRED", lambda: restarted.call("POST", "/v1/agents", signed_body(challenge, "wallet_agent"), self.operator))
        fresh = self.challenge("fresh_wallet")
        body = signed_body(fresh, "fresh_wallet")
        restarted.call("POST", "/v1/agents", body, self.operator)
        self.refused("CHALLENGE_CONSUMED", lambda: Store(self.f.state, clock=lambda: self.f.at).call("POST", "/v1/agents", body, self.operator))

    def test_other_operator_and_rotated_credential_cannot_use_challenge(self):
        challenge = self.challenge()
        body = signed_body(challenge, "wallet_agent")
        _, other = self.f.operator("other_operator")
        self.refused("CHALLENGE_BINDING_REJECTED", lambda: self.f.store.call("POST", "/v1/agents", body, other))
        rotated = self.f.store.call("POST", "/v1/credentials/rotate", {}, self.operator)[1]["credential"]["token"]
        self.refused("CHALLENGE_BINDING_REJECTED", lambda: self.f.store.call("POST", "/v1/agents", body, rotated))
        self.refused("UNAUTHORIZED", lambda: self.f.store.call("POST", "/v1/agents", body, self.operator))

    def test_pending_challenge_never_reserves_wallet(self):
        first = self.challenge()
        _, other = self.f.operator("other_operator")
        second = self.challenge(token=other)
        self.f.store.call("POST", "/v1/agents", signed_body(second, "wallet_agent"), other)
        self.refused("HANDLE_RESERVED", lambda: self.f.store.call("POST", "/v1/agents", signed_body(first, "wallet_agent"), self.operator))
        self.f.store.audit()

    def test_challenge_rate_and_capacity_fail_before_reserving_state(self):
        for index in range(5):
            self.challenge("wallet_" + str(index))
        self.refused("CHALLENGE_RATE_LIMIT", lambda: self.challenge("rate_overflow"))
        self.f.at += 60_000
        with patch.dict(LIMITS, {"wallet_challenges": 5}):
            self.refused("STORAGE_LIMIT", lambda: self.challenge("storage_overflow"))
        self.assertEqual(self.f.store.call("GET", "/v1/agents")[1]["items"], [])

    def test_same_timestamp_renewal_returns_latest_proof_and_keeps_history(self):
        agent_id, agent = self.f.agent(self.operator, "wallet_agent")
        route = "/v1/agents/" + agent_id
        first = self.f.store.call("GET", route + "/wallet-proof")[1]
        challenge = self.f.store.call("POST", route + "/wallet-challenges", {}, agent)[1]
        latest = self.f.store.call("POST", route + "/wallet-proof", signed_body(challenge, "wallet_agent"), agent)[1]
        self.assertNotEqual(first["proof_id"], latest["proof_id"])
        self.assertEqual(self.f.store.call("GET", route + "/wallet-proof")[1]["proof_id"], latest["proof_id"])
        self.f.store.audit()

    def test_cross_instance_signature_does_not_transfer(self):
        other = Fixture()
        self.addCleanup(other.close)
        _, operator = other.operator()
        first = self.challenge()
        second = other.store.call("POST", "/v1/wallet/challenges", {"handle": "wallet_agent", "wallet": address("wallet_agent"), "capabilities": ["research"]}, operator)[1]
        body = signed_body(first, "wallet_agent")
        body["challenge_id"] = second["challenge_id"]
        self.refused("WALLET_SIGNATURE_REJECTED", lambda: other.store.call("POST", "/v1/agents", body, operator))

    def test_bad_signature_encoding_never_reaches_crypto(self):
        challenge = self.challenge()
        for value in (None, 1, "a" * 87, "!" * 88, base64.b64encode(b"x" * 63).decode()):
            self.refused("INVALID_WALLET_SIGNATURE", lambda value=value: self.f.store.call("POST", "/v1/agents", {"challenge_id": challenge["challenge_id"], "signature": value}, self.operator))
        self.assertEqual(decode_base58("1" * 32, 32, "bad"), b"\0" * 32)

    def test_registration_audit_failure_rolls_back_proof_and_consumption(self):
        challenge = self.challenge()
        body = signed_body(challenge, "wallet_agent")
        before = self.f.store.audit()
        with patch.object(self.f.store, "_event", side_effect=RuntimeError("injected")):
            with self.assertRaises(RuntimeError):
                self.f.store.call("POST", "/v1/agents", body, self.operator)
        self.assertEqual(before, self.f.store.audit())
        self.f.store.call("POST", "/v1/agents", body, self.operator)

    def test_audit_detects_proof_and_challenge_tampering(self):
        self.f.agent(self.operator, "wallet_agent")
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("UPDATE wallet_proofs SET digest=?", ("0" * 64,))
        self.refused("EVIDENCE_CONSISTENCY_FAILURE", self.f.store.audit)
