from contextlib import closing
import unittest

from helpers import Fixture, address, signed_body
from zoora_community.store import SCHEMA_VERSION
from zoora_community.wallet_proof import CHALLENGE_TTL_MS
from zoora_community.validation import Problem


class WalletLoginTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.operator_id, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)

    def challenge(self, label="agent_one", audience=None):
        return self.f.store.call("POST", "/v1/wallet/login/challenges", {"wallet": address(label)},
                                 audience=audience)[1]

    def test_signed_wallet_login_opens_its_agent_workspace(self):
        challenge = self.challenge(audience="https://economy.example")
        self.assertEqual(challenge["audience"], "https://economy.example")
        self.assertIn("No payment, transfer, or transaction is authorized", challenge["message"])
        status, result = self.f.store.call("POST", "/v1/wallet/login", signed_body(challenge, "agent_one"))
        self.assertEqual(status, 200)
        self.assertEqual(result["agent"]["id"], self.agent_id)
        self.assertEqual(result["authentication"]["wallet"], address("agent_one"))
        credential = result["credential"]
        self.assertEqual(credential["role"], "AGENT")
        self.assertEqual(credential["principal_id"], self.agent_id)
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=credential["token"])[1]["principal_id"], self.agent_id)
        project = self.f.store.call("POST", "/v1/projects", {"title": "Agent economy", "summary": "Wallet-owned workspace"}, credential["token"])[1]
        self.assertEqual(project["owner_id"], self.agent_id)
        self.assertEqual(self.f.store.audit()["schema_version"], SCHEMA_VERSION)

    def test_invalid_signature_does_not_consume_challenge_and_replay_is_rejected(self):
        challenge = self.challenge()
        wrong = signed_body(challenge, "another_wallet")
        with self.assertRaises(Problem) as rejected:
            self.f.store.call("POST", "/v1/wallet/login", wrong)
        self.assertEqual(rejected.exception.code, "WALLET_SIGNATURE_REJECTED")
        self.f.store.call("POST", "/v1/wallet/login", signed_body(challenge, "agent_one"))
        with self.assertRaises(Problem) as replay:
            self.f.store.call("POST", "/v1/wallet/login", signed_body(challenge, "agent_one"))
        self.assertEqual(replay.exception.code, "CHALLENGE_CONSUMED")

    def test_unknown_wallet_consumes_verified_challenge_without_issuing_a_session(self):
        challenge = self.challenge("unregistered_wallet")
        status, result = self.f.store.call("POST", "/v1/wallet/login", signed_body(challenge, "unregistered_wallet"))
        self.assertEqual((status, result["error"]), (404, "AGENT_NOT_FOUND"))
        with self.assertRaises(Problem) as replay:
            self.f.store.call("POST", "/v1/wallet/login", signed_body(challenge, "unregistered_wallet"))
        self.assertEqual(replay.exception.code, "CHALLENGE_CONSUMED")
        self.assertEqual(self.f.store.audit()["schema_version"], SCHEMA_VERSION)

    def test_expired_challenge_and_http_only_audience_restrictions(self):
        challenge = self.challenge()
        self.f.at += CHALLENGE_TTL_MS
        with self.assertRaises(Problem) as expired:
            self.f.store.call("POST", "/v1/wallet/login", signed_body(challenge, "agent_one"))
        self.assertEqual(expired.exception.code, "CHALLENGE_EXPIRED")
        with self.assertRaises(Problem) as insecure:
            self.f.store.call("POST", "/v1/wallet/login/challenges", {"wallet": address("agent_one")}, audience="http://economy.example")
        self.assertEqual(insecure.exception.code, "INSECURE_AUTH_AUDIENCE")

    def test_wallet_specific_challenge_rate_limit(self):
        for _ in range(5):
            self.challenge()
        with self.assertRaises(Problem) as limited:
            self.challenge()
        self.assertEqual(limited.exception.code, "CHALLENGE_RATE_LIMIT")

    def test_audit_reverifies_retained_login_signature(self):
        challenge = self.challenge(audience="https://economy.example")
        self.f.store.call("POST", "/v1/wallet/login", signed_body(challenge, "agent_one"))
        self.assertEqual(self.f.store.audit()["schema_version"], SCHEMA_VERSION)
        with closing(self.f.store._connection()) as connection:
            connection.execute("UPDATE wallet_login_challenges SET signature=? WHERE id=?",
                               ("A" * 88, challenge["challenge_id"]))
        with self.assertRaises(Problem) as corrupted:
            self.f.store.audit()
        self.assertEqual(corrupted.exception.code, "WALLET_LOGIN_CONSISTENCY_FAILURE")


if __name__ == "__main__":
    unittest.main()
