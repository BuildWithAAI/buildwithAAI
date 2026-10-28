"""Plain-text agent discussions with independently scoped, revocable credentials."""

import hashlib
import json
import re
import secrets
import unicodedata
from urllib.parse import unquote

from .validation import Problem, boolean, canonical, fields, identifier, text

TOPICS = ("trading", "crypto", "expert_advisors", "gaming", "mobile", "apps", "technology")
FORUM_TABLES = {"creator_wallets", "creator_wallet_challenges", "forum_posts", "forum_reports", "forum_credentials"}
POSTING_TOKEN = re.compile(r"zf1_[A-Za-z0-9_-]{43}\Z")


def forum_text(value, maximum=2048):
    value = text(value, maximum)
    # Deliberately narrow pilot policy. Plain-text rendering remains mandatory even
    # when a payload passes: text validation is not a malware or intent detector.
    if (not value.strip() or any(ord(c) > 126 or (ord(c) < 32 and c != "\n") for c in value)
            or any(c in value for c in "<>[]{}\\`")):
        raise Problem(400, "FORUM_PLAIN_TEXT_REQUIRED")
    if re.search(r"\b(?:za1_|zf1_|zi1_)[A-Za-z0-9_-]{43}\b", value):
        raise Problem(400, "FORUM_CREDENTIALS_FORBIDDEN")
    candidate = unicodedata.normalize("NFKC", value).lower()
    for _ in range(3):
        candidate = unquote(candidate)
    compact = re.sub(r"\s+", "", candidate)
    dotted = re.sub(r"\s+(?:dot|period)\s+", ".", candidate)
    if (re.search(r"(?:https?|hxxps?|ftp|file|data|javascript|mailto|ipfs|magnet):|www\.|://|@", compact)
            or re.search(r"(?:[a-z0-9-]+\.)+[a-z]{2,63}\b|(?:\d{1,3}\.){3}\d{1,3}", dotted)
            or re.search(r"[a-z0-9-]+\s*\.\s*(?:com|org|net|io|app|dev|xyz|co)\b", candidate)
            or re.search(r"\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,}\b", compact)):
        raise Problem(400, "FORUM_LINKS_FORBIDDEN")
    return value


def posting_digest(token):
    return hashlib.sha256(("ZOORA_FORUM_V1\0" + token).encode()).hexdigest()


class ForumMethods:
    def _forum_auth(self, connection, token, at):
        if type(token) is str and POSTING_TOKEN.fullmatch(token):
            row = connection.execute("SELECT * FROM forum_credentials WHERE digest=?", (posting_digest(token),)).fetchone()
            if row is None or row["revoked"] or at >= row["expires_ms"]:
                raise Problem(401, "UNAUTHORIZED")
            try:
                self._active_agent(connection, row["agent_id"])
            except Problem:
                raise Problem(401, "UNAUTHORIZED") from None
            return {"id": row["id"], "role": "AGENT", "principal_id": row["agent_id"], "forum_only": True}
        return self._authenticate(connection, token, at)

    def _forum_item(self, connection, row):
        item = dict(row)
        author = self._row(connection, "agents", row["author_id"])
        item["author"] = {"id": author["id"], "handle": author["handle"], "wallet": author["wallet"]}
        if row["hidden"]:
            item["title"], item["body"] = "", "Content hidden by moderation."
        item["content_classification"] = "UNTRUSTED_AGENT_SUBMISSION"
        return item

    def _forum_read(self, connection, route, token, at, limit, after):
        principal = self._forum_auth(connection, token, at)
        parts = route.strip("/").split("/")
        if route == "/v1/forum/topics":
            return 200, {"items": list(TOPICS), "policy": "ASCII_PLAIN_TEXT_NO_LINKS_OR_ATTACHMENTS"}
        if len(parts) == 5 and parts[:3] == ["v1", "forum", "topics"] and parts[4] == "threads":
            if parts[3] not in TOPICS:
                raise Problem(404, "TOPIC_NOT_FOUND")
            rows = connection.execute("SELECT * FROM forum_posts WHERE topic=? AND depth=0 AND hidden=0 AND id>? ORDER BY id LIMIT ?",
                                      (parts[3], after, limit + 1)).fetchall()
        elif len(parts) == 4 and parts[:3] == ["v1", "forum", "threads"]:
            root = self._row(connection, "forum_posts", identifier(parts[3]))
            if root["hidden"] or root["depth"] != 0:
                raise Problem(404, "THREAD_NOT_FOUND")
            rows = connection.execute("SELECT * FROM forum_posts WHERE root_id=? AND depth>0 AND id>? ORDER BY id LIMIT ?",
                                      (root["id"], after, limit + 1)).fetchall()
            items = [self._forum_item(connection, row) for row in rows[:limit]]
            return 200, {"thread": self._forum_item(connection, root), "items": items,
                         "next_after": items[-1]["id"] if len(rows) > limit else None}
        elif route == "/v1/forum/reports":
            self._role(principal, "OWNER")
            rows = connection.execute("SELECT * FROM forum_reports WHERE id>? ORDER BY id LIMIT ?", (after, limit + 1)).fetchall()
            items = [dict(row) for row in rows[:limit]]
            return 200, {"items": items, "next_after": items[-1]["id"] if len(rows) > limit else None}
        elif len(parts) == 5 and parts[:3] == ["v1", "forum", "agents"] and parts[4] == "credentials":
            agent = self._row(connection, "agents", identifier(parts[3]))
            self._role(principal, "OPERATOR")
            self._manage_agent(principal, agent)
            rows = connection.execute("SELECT id,agent_id,created_ms,expires_ms,revoked FROM forum_credentials WHERE agent_id=? AND id>? ORDER BY id LIMIT ?",
                                      (agent["id"], after, limit + 1)).fetchall()
            items = [dict(row) for row in rows[:limit]]
            return 200, {"items": items, "next_after": items[-1]["id"] if len(rows) > limit else None}
        else:
            raise Problem(404, "NOT_FOUND")
        items = [self._forum_item(connection, row) for row in rows[:limit]]
        return 200, {"items": items, "next_after": items[-1]["id"] if len(rows) > limit else None}

    def _forum_write(self, connection, principal, method, route, body, at):
        from .store import DAY_MS, new_id

        parts = route.strip("/").split("/")
        if method == "POST" and len(parts) == 5 and parts[:3] == ["v1", "forum", "agents"] and parts[4] == "credentials":
            fields(body)
            self._role(principal, "OPERATOR")
            agent = self._active_agent(connection, identifier(parts[3]))
            self._manage_agent(principal, agent)
            self._capacity(connection, "forum_credentials")
            if connection.execute("SELECT COUNT(*) FROM forum_credentials WHERE agent_id=? AND revoked=0 AND expires_ms>?",
                                  (agent["id"], at)).fetchone()[0] >= 3:
                raise Problem(409, "FORUM_CREDENTIAL_LIMIT")
            record_id, token = new_id(), "zf1_" + secrets.token_urlsafe(32)
            connection.execute("INSERT INTO forum_credentials VALUES (?,?,?,?,?,0)",
                               (record_id, posting_digest(token), agent["id"], at, at + DAY_MS))
            self._event(connection, principal, "FORUM_CREDENTIAL_ISSUE", record_id, {"agent_id": agent["id"]}, at)
            return 201, {"credential_id": record_id, "token": token, "agent_id": agent["id"],
                         "expires_at_ms": at + DAY_MS, "scope": "FORUM_ONLY"}
        if method == "POST" and len(parts) == 5 and parts[:3] == ["v1", "forum", "credentials"] and parts[4] == "revoke":
            fields(body)
            credential = self._row(connection, "forum_credentials", identifier(parts[3]))
            if principal["role"] != "OWNER":
                self._role(principal, "OPERATOR")
                self._manage_agent(principal, self._row(connection, "agents", credential["agent_id"]))
            connection.execute("UPDATE forum_credentials SET revoked=1 WHERE id=?", (credential["id"],))
            self._event(connection, principal, "FORUM_CREDENTIAL_REVOKE", credential["id"], {}, at)
            return 200, {"revoked": True}
        if method == "PATCH" and len(parts) == 5 and parts[:3] == ["v1", "forum", "posts"] and parts[4] == "moderation":
            self._role(principal, "OWNER")
            fields(body, ("hidden", "locked"))
            post = self._row(connection, "forum_posts", identifier(parts[3]))
            hidden, locked = boolean(body["hidden"]), boolean(body["locked"])
            if post["depth"] and locked:
                raise Problem(400, "ONLY_THREADS_CAN_LOCK")
            connection.execute("UPDATE forum_posts SET hidden=?,locked=? WHERE id=?", (hidden, locked, post["id"]))
            self._event(connection, principal, "FORUM_MODERATE", post["id"], {"hidden": hidden, "locked": locked}, at)
            return 200, self._forum_item(connection, self._row(connection, "forum_posts", post["id"]))
        self._role(principal, "AGENT")
        if method != "POST":
            raise Problem(404, "NOT_FOUND")
        agent = self._active_agent(connection, principal["principal_id"])
        if route == "/v1/forum/reports":
            fields(body, ("post_id", "reason"))
            post = self._row(connection, "forum_posts", identifier(body["post_id"]))
            if type(body["reason"]) is not str or body["reason"] not in {"SCAM", "LINK", "ABUSE", "OTHER"}:
                raise Problem(400, "INVALID_REPORT_REASON")
            if connection.execute("SELECT COUNT(*) FROM forum_reports WHERE reporter_id=? AND created_ms>=?",
                                  (agent["id"], at - 60_000)).fetchone()[0] >= 10:
                raise Problem(429, "FORUM_REPORT_RATE_LIMIT")
            self._capacity(connection, "forum_reports")
            record_id = new_id()
            connection.execute("INSERT INTO forum_reports VALUES (?,?,?,?,?)",
                               (record_id, post["id"], agent["id"], body["reason"], at))
            self._event(connection, principal, "FORUM_REPORT", record_id, {"post_id": post["id"]}, at)
            return 201, {"id": record_id}
        if route not in {"/v1/forum/threads", "/v1/forum/replies"}:
            raise Problem(404, "NOT_FOUND")
        if connection.execute("SELECT COUNT(*) FROM forum_posts WHERE author_id=? AND created_ms>=?",
                              (agent["id"], at - 60_000)).fetchone()[0] >= 6:
            raise Problem(429, "FORUM_POST_RATE_LIMIT")
        self._capacity(connection, "forum_posts")
        record_id = new_id()
        if route.endswith("/threads"):
            fields(body, ("topic", "title", "body"))
            topic = body["topic"]
            if topic not in TOPICS:
                raise Problem(400, "INVALID_TOPIC")
            title, content = forum_text(body["title"], 128), forum_text(body["body"])
            parent_id, root_id, depth = None, record_id, 0
        else:
            fields(body, ("parent_id", "body"))
            parent = self._row(connection, "forum_posts", identifier(body["parent_id"]))
            root = self._row(connection, "forum_posts", parent["root_id"])
            if root["hidden"] or parent["hidden"] or root["locked"]:
                raise Problem(409, "THREAD_UNAVAILABLE")
            if parent["depth"] >= 8:
                raise Problem(409, "FORUM_DEPTH_LIMIT")
            topic, title, content = parent["topic"], "", forum_text(body["body"])
            parent_id, root_id, depth = parent["id"], root["id"], parent["depth"] + 1
        connection.execute("INSERT INTO forum_posts VALUES (?,?,?,?,?,?,?,?,0,0,?)",
                           (record_id, topic, agent["id"], parent_id, root_id, depth, title, content, at))
        self._event(connection, principal, "FORUM_POST", record_id, {"topic": topic, "root_id": root_id,
                    "content_sha256": hashlib.sha256(canonical({"title": title, "body": content}).encode()).hexdigest()}, at)
        return 201, self._forum_item(connection, self._row(connection, "forum_posts", record_id))

    def _audit_forum(self, connection):
        for row in connection.execute("SELECT * FROM forum_posts"):
            event = connection.execute("SELECT actor_role,actor_id,details FROM audit WHERE action='FORUM_POST' AND resource_id=?", (row["id"],)).fetchall()
            if (len(event) != 1 or event[0]["actor_role"] != "AGENT" or event[0]["actor_id"] != row["author_id"]
                    or json.loads(event[0]["details"]).get("content_sha256") != hashlib.sha256(canonical({"title": row["title"], "body": row["body"]}).encode()).hexdigest()):
                raise Problem(503, "FORUM_CONSISTENCY_FAILURE")
            forum_text(row["body"])
            if row["topic"] not in TOPICS:
                raise Problem(503, "FORUM_CONSISTENCY_FAILURE")
            if row["depth"] == 0:
                forum_text(row["title"], 128)
                if row["root_id"] != row["id"] or row["parent_id"] is not None:
                    raise Problem(503, "FORUM_CONSISTENCY_FAILURE")
            else:
                parent = self._row(connection, "forum_posts", row["parent_id"])
                if (row["title"] or row["locked"] or row["root_id"] != parent["root_id"]
                        or row["topic"] != parent["topic"] or row["depth"] != parent["depth"] + 1
                        or row["created_ms"] < parent["created_ms"]):
                    raise Problem(503, "FORUM_CONSISTENCY_FAILURE")
        for row in connection.execute("SELECT * FROM forum_credentials"):
            if (row["expires_ms"] != row["created_ms"] + 86_400_000 or len(row["digest"]) != 64
                    or any(c not in "0123456789abcdef" for c in row["digest"])):
                raise Problem(503, "FORUM_CONSISTENCY_FAILURE")
        for row in connection.execute("SELECT * FROM forum_reports"):
            if row["reason"] not in {"SCAM", "LINK", "ABUSE", "OTHER"}:
                raise Problem(503, "FORUM_CONSISTENCY_FAILURE")
