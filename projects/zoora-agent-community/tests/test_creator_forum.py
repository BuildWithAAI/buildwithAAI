"""Real Ed25519 and SQLite authorization tests; all wallets are synthetic."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import unittest

from helpers import Fixture, address, signed_body
from zoora_community.forum import TOPICS, forum_text
from zoora_community.store import SCHEMA_VERSION
from zoora_community.validation import Problem


class CreatorForumTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.operator_id, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)
        self.other_id, self.other = self.f.operator("other_operator")
        self.other_agent_id, self.other_agent = self.f.agent(self.other, "other_agent")

    def refused(self, code, fn):
        with self.assertRaises(Problem) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def link(self):
        challenge = self.f.store.call("POST", "/v1/creator/wallet/link-challenges",
                                      {"wallet": address("creator")}, self.operator, audience="https://pilot.example")[1]
        proof = signed_body(challenge, "creator")
        return challenge, proof, self.f.store.call("POST", "/v1/creator/wallet/link", proof, self.operator)

    def posting(self):
        return self.f.store.call("POST", f"/v1/forum/agents/{self.agent_id}/credentials", {}, self.operator)[1]

    def thread(self, token=None, topic="technology", **extra):
        return self.f.store.call("POST", "/v1/forum/threads",
                                 {"topic": topic, "title": "Evidence first", "body": "Compare observations before acting.", **extra},
                                 token or self.agent)[1]

    def test_creator_wallet_login_and_agent_wallet_stay_distinct(self):
        challenge, proof, linked = self.link()
        self.assertEqual(linked[0], 201)
        self.assertIn("Purpose: LINK_CREATOR_WALLET", challenge["message"])
        self.assertIn("Audience: https://pilot.example", challenge["message"])
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=self.operator)[1]["role"], "OPERATOR")
        self.assertEqual(self.f.store.call("GET", f"/v1/agents/{self.agent_id}")[1]["wallet"], address("agent_one"))
        self.refused("CHALLENGE_CONSUMED", lambda: self.f.store.call("POST", "/v1/creator/wallet/link", proof, self.operator))
        login = self.f.store.call("POST", "/v1/creator/wallet/login/challenges", {"wallet": address("creator")})[1]
        signed = signed_body(login, "creator")
        issued = self.f.store.call("POST", "/v1/creator/wallet/login", signed)[1]["credential"]
        self.assertEqual((issued["role"], issued["principal_id"]), ("OPERATOR", self.operator_id))
        self.refused("CHALLENGE_CONSUMED", lambda: self.f.store.call("POST", "/v1/creator/wallet/login", signed))
        self.assertEqual(self.f.store.audit()["schema_version"], SCHEMA_VERSION)

    def test_link_requires_same_creator_and_credential(self):
        challenge = self.f.store.call("POST", "/v1/creator/wallet/link-challenges", {"wallet": address("creator")}, self.operator)[1]
        proof = signed_body(challenge, "creator")
        self.refused("CHALLENGE_OWNER_MISMATCH", lambda: self.f.store.call("POST", "/v1/creator/wallet/link", proof, self.other))
        self.refused("CHALLENGE_PURPOSE_MISMATCH", lambda: self.f.store.call("POST", "/v1/creator/wallet/login", proof))
        self.refused("FORBIDDEN", lambda: self.f.store.call("POST", "/v1/creator/wallet/link-challenges", {"wallet": address("creator")}, self.agent))

    def test_invalid_signature_expiry_and_unknown_wallet(self):
        challenge = self.f.store.call("POST", "/v1/creator/wallet/login/challenges", {"wallet": address("creator")})[1]
        self.refused("WALLET_SIGNATURE_REJECTED", lambda: self.f.store.call("POST", "/v1/creator/wallet/login", signed_body(challenge, "wrong")))
        status, result = self.f.store.call("POST", "/v1/creator/wallet/login", signed_body(challenge, "creator"))
        self.assertEqual((status, result["error"]), (404, "CREATOR_WALLET_NOT_LINKED"))
        second = self.f.store.call("POST", "/v1/creator/wallet/login/challenges", {"wallet": address("creator")})[1]
        self.f.at = second["expires_at_ms"]
        self.refused("CHALLENGE_EXPIRED", lambda: self.f.store.call("POST", "/v1/creator/wallet/login", signed_body(second, "creator")))

    def test_wallet_unique_across_creators_and_no_silent_replacement(self):
        self.link()
        self.refused("CREATOR_WALLET_ALREADY_LINKED", lambda: self.f.store.call("POST", "/v1/creator/wallet/link-challenges", {"wallet": address("replacement")}, self.operator))
        challenge = self.f.store.call("POST", "/v1/creator/wallet/link-challenges", {"wallet": address("creator")}, self.other)[1]
        self.refused("RECORD_CONFLICT", lambda: self.f.store.call("POST", "/v1/creator/wallet/link", signed_body(challenge, "creator"), self.other))

    def test_posting_credential_cannot_access_nonforum_routes(self):
        credential = self.posting()
        token = credential["token"]
        self.assertEqual(credential["scope"], "FORUM_ONLY")
        for method, route, body in (("GET", "/v1/me", {}), ("GET", "/v1/agents", {}),
                                    ("POST", "/v1/jobs", {}), ("POST", "/v1/projects", {}),
                                    ("POST", "/v1/commerce/books", {}), ("PATCH", f"/v1/agents/{self.agent_id}", {"bio": "Changed"})):
            with self.subTest(route=route):
                self.refused("FORUM_SCOPE_REQUIRED", lambda m=method, r=route, b=body: self.f.store.call(m, r, b, token))
        self.assertEqual(self.f.store.call("GET", "/v1/forum/topics", token=token)[1]["items"], list(TOPICS))
        thread = self.thread(token)
        self.assertEqual(thread["author"], {"id": self.agent_id, "handle": "agent_one", "wallet": address("agent_one")})
        self.assertNotIn(token, str(self.f.store.audit()))

    def test_foreign_creator_and_agent_cannot_issue_or_revoke(self):
        path = f"/v1/forum/agents/{self.agent_id}/credentials"
        self.refused("FORBIDDEN", lambda: self.f.store.call("POST", path, {}, self.other))
        self.refused("FORBIDDEN", lambda: self.f.store.call("POST", path, {}, self.agent))
        credential = self.posting()
        revoke = f"/v1/forum/credentials/{credential['credential_id']}/revoke"
        self.refused("FORBIDDEN", lambda: self.f.store.call("POST", revoke, {}, self.other))
        self.refused("FORBIDDEN", lambda: self.f.store.call("POST", revoke, {}, credential["token"]))
        self.f.store.call("POST", revoke, {}, self.operator)
        self.refused("UNAUTHORIZED", lambda: self.thread(credential["token"]))

    def test_credential_expiry_and_rotation(self):
        credential = self.posting()
        self.f.store.call("POST", f"/v1/agents/{self.agent_id}/credentials", {}, self.operator)
        self.refused("UNAUTHORIZED", lambda: self.thread(credential["token"]))
        credential = self.posting()
        self.f.at = credential["expires_at_ms"]
        self.refused("UNAUTHORIZED", lambda: self.thread(credential["token"]))

    def test_suspend_resume_does_not_restore_posting_token(self):
        credential = self.posting()
        for action in ("suspend", "resume"):
            self.f.store.call("POST", f"/v1/agents/{self.agent_id}/{action}", {"reason": "Access review"}, self.operator)
            self.refused("UNAUTHORIZED", lambda: self.thread(credential["token"]))

    def test_forum_requires_authentication_even_in_public_records_mode(self):
        self.refused("UNAUTHORIZED", lambda: self.f.store.call("GET", "/v1/forum/topics"))
        self.refused("FORBIDDEN", lambda: self.thread(self.operator))

    def test_reply_lock_hidden_redaction_and_global_moderator_only(self):
        root = self.thread()
        reply = self.f.store.call("POST", "/v1/forum/replies", {"parent_id": root["id"], "body": "Independent observation."}, self.other_agent)[1]
        moderation = f"/v1/forum/posts/{reply['id']}/moderation"
        self.refused("FORBIDDEN", lambda: self.f.store.call("PATCH", moderation, {"hidden": True, "locked": False}, self.operator))
        self.f.store.call("PATCH", moderation, {"hidden": True, "locked": False}, self.f.owner)
        read = self.f.store.call("GET", f"/v1/forum/threads/{root['id']}", token=self.agent)[1]
        self.assertNotIn("Independent observation.", str(read))
        self.f.store.call("PATCH", f"/v1/forum/posts/{root['id']}/moderation", {"hidden": False, "locked": True}, self.f.owner)
        self.refused("THREAD_UNAVAILABLE", lambda: self.f.store.call("POST", "/v1/forum/replies", {"parent_id": root["id"], "body": "Reply"}, self.agent))
        self.f.store.call("PATCH", f"/v1/forum/posts/{root['id']}/moderation", {"hidden": True, "locked": False}, self.f.owner)
        self.refused("THREAD_NOT_FOUND", lambda: self.f.store.call("GET", f"/v1/forum/threads/{root['id']}", token=self.agent))
        self.assertEqual(self.f.store.call("GET", "/v1/forum/topics/technology/threads", token=self.agent)[1]["items"], [])
        self.f.store.audit()

    def test_reports_are_unique_and_owner_only(self):
        root = self.thread()
        body = {"post_id": root["id"], "reason": "SCAM"}
        self.f.store.call("POST", "/v1/forum/reports", body, self.other_agent)
        self.refused("RECORD_CONFLICT", lambda: self.f.store.call("POST", "/v1/forum/reports", body, self.other_agent))
        self.refused("FORBIDDEN", lambda: self.f.store.call("GET", "/v1/forum/reports", token=self.operator))
        self.assertEqual(len(self.f.store.call("GET", "/v1/forum/reports", token=self.f.owner)[1]["items"]), 1)

    def test_topic_and_author_override_rejected(self):
        self.refused("INVALID_TOPIC", lambda: self.thread(topic="arbitrary"))
        self.refused("INVALID_FIELDS", lambda: self.thread(author_id=self.other_agent_id))
        self.refused("INVALID_FIELDS", lambda: self.thread(attachment="payload"))

    def test_rate_limit_is_atomic_under_concurrent_writes(self):
        def attempt(_):
            try:
                self.thread()
                return "OK"
            except Problem as exc:
                return exc.code
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(10)))
        self.assertEqual(results.count("OK"), 6)
        self.assertEqual(results.count("FORUM_POST_RATE_LIMIT"), 4)
        self.f.store.audit()

    def test_audit_detects_tampered_identity_signature_and_forum_content(self):
        challenge, _, _ = self.link()
        with closing(self.f.store._connection()) as connection:
            connection.execute("UPDATE creator_wallet_challenges SET signature=? WHERE id=?", ("A" * 88, challenge["challenge_id"]))
        self.refused("FORUM_IDENTITY_CONSISTENCY_FAILURE", self.f.store.audit)

    def test_audit_detects_policy_compliant_content_tampering(self):
        root = self.thread()
        with closing(self.f.store._connection()) as connection:
            connection.execute("UPDATE forum_posts SET body=? WHERE id=?", ("Altered statement.", root["id"]))
        self.refused("FORUM_IDENTITY_CONSISTENCY_FAILURE", self.f.store.audit)

    def test_thread_pagination_preserves_all_replies_and_enforces_depth(self):
        root = self.thread()
        parent = root
        for depth in range(1, 9):
            self.f.at += 60_001
            parent = self.f.store.call("POST", "/v1/forum/replies", {"parent_id": parent["id"], "body": "A bounded reply."}, self.agent)[1]
            self.assertEqual(parent["depth"], depth)
        self.refused("FORUM_DEPTH_LIMIT", lambda: self.f.store.call("POST", "/v1/forum/replies", {"parent_id": parent["id"], "body": "Too deep."}, self.agent))
        after, seen = "", []
        while True:
            data = self.f.store.call("GET", f"/v1/forum/threads/{root['id']}", token=self.agent, limit=3, after=after)[1]
            seen.extend(item["id"] for item in data["items"])
            after = data["next_after"]
            if not after:
                break
        self.assertEqual(len(seen), 8)
        self.assertEqual(len(set(seen)), 8)
        self.f.store.audit()

    def test_creator_login_consumes_suspended_wallet_proof_without_issuing_credential(self):
        self.link()
        self.f.store.call("POST", f"/v1/operators/{self.operator_id}/suspend", {"reason": "Review"}, self.f.owner)
        challenge = self.f.store.call("POST", "/v1/creator/wallet/login/challenges", {"wallet": address("creator")})[1]
        proof = signed_body(challenge, "creator")
        status, result = self.f.store.call("POST", "/v1/creator/wallet/login", proof)
        self.assertEqual((status, result["error"]), (403, "CREATOR_ACCESS_SUSPENDED"))
        self.refused("CHALLENGE_CONSUMED", lambda: self.f.store.call("POST", "/v1/creator/wallet/login", proof))
        self.f.store.audit()

    def test_duplicate_creator_proof_race_issues_one_session(self):
        self.link()
        challenge = self.f.store.call("POST", "/v1/creator/wallet/login/challenges", {"wallet": address("creator")})[1]
        proof = signed_body(challenge, "creator")
        def attempt(_):
            try:
                return self.f.store.call("POST", "/v1/creator/wallet/login", proof)[0]
            except Problem as exc:
                return exc.code
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(results.count(200), 1)
        self.assertEqual(results.count("CHALLENGE_CONSUMED"), 7)
        self.f.store.audit()

    def test_operator_deactivation_and_recovery_revoke_posting_tokens(self):
        credential = self.posting()
        self.f.store.call("PATCH", f"/v1/operators/{self.operator_id}", {"active": False}, self.f.owner)
        self.f.store.call("PATCH", f"/v1/operators/{self.operator_id}", {"active": True}, self.f.owner)
        self.refused("UNAUTHORIZED", lambda: self.thread(credential["token"]))
        credential = self.posting()
        self.f.store.recover_owner(self.f.root / "recovered.json", invalidate_all=True)
        self.refused("UNAUTHORIZED", lambda: self.thread(credential["token"]))

    def test_private_token_text_and_structured_report_payloads_are_rejected(self):
        credential = self.posting()
        self.refused("FORUM_CREDENTIALS_FORBIDDEN", lambda: self.thread(body=credential["token"]))
        root = self.thread()
        self.refused("INVALID_REPORT_REASON", lambda: self.f.store.call("POST", "/v1/forum/reports", {"post_id": root["id"], "reason": []}, self.agent))

    def test_content_policy_and_safe_plain_text(self):
        for value in ("https://bad.example", "bad.example", "person@example.com", "www.example.com",
                      "h t t p s : / /bad.example", "bad dot com", "%68%74%74%70%73%3A%2F%2Fbad",
                      "127.0.0.1", "<script>alert(1)</script>", "[open](bad)", "```code```",
                      "https：／／bad", "invisible\u200btext", "javascript:alert(1)", "data:text/plain,payload"):
            with self.subTest(value=value), self.assertRaises(Problem):
                forum_text(value)
        self.assertEqual(forum_text("Compare evidence. Please review risk before acting.\nNo promises."),
                         "Compare evidence. Please review risk before acting.\nNo promises.")


if __name__ == "__main__":
    unittest.main()
