"""Origin-bound wallet login for an existing agent; no wallet transactions."""

import base64
import hashlib
import secrets
from urllib.parse import urlsplit

from nacl.bindings import crypto_core_ed25519_is_valid_point

from .validation import Problem, fields, identifier, wallet
from .wallet_proof import CHALLENGE_TTL_MS, decode_base58, signature_bytes, verify_signature

LOGIN_VERSION = "ZOORA_AE008_RAW_ED25519_V1"
CHALLENGE_RETENTION_MS = 15 * 60_000
CHALLENGE_RATE_PER_WALLET = 5
CHALLENGE_RATE_GLOBAL = 120


def validate_audience(value):
    if value is None or value == "LOCAL_ONLY":
        return "LOCAL_ONLY"
    if type(value) is not str or len(value) > 255 or "\n" in value or "\r" in value:
        raise Problem(400, "INVALID_AUTH_AUDIENCE")
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username is not None
            or parsed.password is not None or parsed.path or parsed.query or parsed.fragment
            or f"{parsed.scheme}://{parsed.netloc}" != value):
        raise Problem(400, "INVALID_AUTH_AUDIENCE")
    if parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise Problem(400, "INSECURE_AUTH_AUDIENCE")
    return value


def public_origin(value):
    origin = validate_audience(value)
    if not origin.startswith("https://"):
        raise Problem(400, "HTTPS_PUBLIC_ORIGIN_REQUIRED")
    return origin


def login_message(instance, address, nonce, created_ms, expires_ms, audience):
    return ("Zoora Agent Economy wallet sign-in\n"
            "Signing proves control of this wallet for account access only. No payment, transfer, or transaction is authorized.\n"
            f"Audience: {audience}\nProtocol: {LOGIN_VERSION}\nService instance: {instance}\n"
            f"Purpose: SIGN_IN_TO_EXISTING_AGENT\nWallet: {address}\nNonce: {nonce}\n"
            f"Issued at (Unix ms): {created_ms}\nExpires at (Unix ms): {expires_ms}")


class WalletLoginMethods:
    def _wallet_login_challenge(self, connection, body, at, audience):
        from .store import new_id

        fields(body, ("wallet",))
        address = wallet(body["wallet"])
        raw_key = decode_base58(address, 32, "INVALID_WALLET_ADDRESS")
        if not crypto_core_ed25519_is_valid_point(raw_key):
            raise Problem(403, "WALLET_KEY_REJECTED")
        audience = validate_audience(audience)
        connection.execute("DELETE FROM wallet_login_challenges WHERE created_ms<?", (at - CHALLENGE_RETENTION_MS,))
        count = connection.execute("SELECT COUNT(*) FROM wallet_login_challenges WHERE wallet=? AND created_ms>=?",
                                   (address, at - 60_000)).fetchone()[0]
        if count >= CHALLENGE_RATE_PER_WALLET:
            raise Problem(429, "CHALLENGE_RATE_LIMIT")
        total = connection.execute("SELECT COUNT(*) FROM wallet_login_challenges WHERE created_ms>=?",
                                   (at - 60_000,)).fetchone()[0]
        if total >= CHALLENGE_RATE_GLOBAL:
            raise Problem(429, "PUBLIC_CHALLENGE_RATE_LIMIT")
        self._capacity(connection, "wallet_login_challenges")
        instance = connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()[0]
        record_id = new_id()
        nonce = secrets.token_hex(32)
        expires_ms = at + CHALLENGE_TTL_MS
        message = login_message(instance, address, nonce, at, expires_ms, audience)
        connection.execute("INSERT INTO wallet_login_challenges "
                           "(id,wallet,nonce,message,audience,created_ms,expires_ms,consumed) "
                           "VALUES (?,?,?,?,?,?,?,0)",
                           (record_id, address, nonce, message, audience, at, expires_ms))
        return 201, {"challenge_id": record_id, "protocol": LOGIN_VERSION, "message": message,
                     "message_base64": base64.b64encode(message.encode("utf-8")).decode("ascii"),
                     "expires_at_ms": expires_ms, "wallet": address, "audience": audience,
                     "transactions_authorized": False,
                     "provenance": {"classification": "OBSERVED", "source": LOGIN_VERSION,
                        "observed_at_ms": at, "available_at_ms": at, "slot": None, "commitment": None,
                        "transformation_version": 1, "state": "AVAILABLE",
                        "missingness": ["solana_slot", "chain_commitment"],
                        "quality_flags": ["SERVER_ISSUED_ONE_TIME_CHALLENGE", "OFF_CHAIN_MESSAGE"]}}

    def _wallet_login(self, connection, body, at):
        fields(body, ("challenge_id", "signature"))
        challenge_id = identifier(body["challenge_id"])
        challenge = connection.execute("SELECT * FROM wallet_login_challenges WHERE id=?", (challenge_id,)).fetchone()
        if challenge is None:
            raise Problem(404, "CHALLENGE_NOT_FOUND")
        if challenge["consumed"]:
            raise Problem(409, "CHALLENGE_CONSUMED")
        if at < challenge["created_ms"] or at >= challenge["expires_ms"]:
            raise Problem(410, "CHALLENGE_EXPIRED")
        verify_signature(challenge["wallet"], challenge["message"], body["signature"])
        signature_text = body["signature"]
        signature = signature_bytes(signature_text)
        proof_digest = hashlib.sha256(challenge["message"].encode("utf-8") + signature).hexdigest()
        agent_row = connection.execute("SELECT * FROM agents WHERE wallet=?", (challenge["wallet"],)).fetchone()
        if agent_row is None:
            connection.execute("UPDATE wallet_login_challenges SET consumed=1,result='AGENT_NOT_FOUND',proof_sha256=?,signature=?,authenticated_ms=? WHERE id=?",
                               (proof_digest, signature_text, at, challenge_id))
            return 404, {"error": "AGENT_NOT_FOUND"}
        agent = dict(agent_row)
        operator = self._row(connection, "operators", agent["operator_id"])
        if (not agent["active"] or not operator["active"]
                or self._access_held(connection, "AGENT", agent["id"])
                or self._access_held(connection, "OPERATOR", operator["id"])):
            connection.execute("UPDATE wallet_login_challenges SET consumed=1,result='ACCESS_DENIED',proof_sha256=?,signature=?,authenticated_ms=?,agent_id=? WHERE id=?",
                               (proof_digest, signature_text, at, agent["id"], challenge_id))
            return 403, {"error": "AGENT_ACCESS_SUSPENDED"}
        issued = self._issue(connection, "AGENT", agent["id"], at)
        connection.execute("UPDATE wallet_login_challenges SET consumed=1,result='AUTHENTICATED',proof_sha256=?,signature=?,authenticated_ms=?,agent_id=?,credential_id=? WHERE id=?",
                           (proof_digest, signature_text, at, agent["id"], issued["credential_id"], challenge_id))
        self._event(connection, {"role": "AGENT", "principal_id": agent["id"]}, "WALLET_LOGIN", agent["id"],
                    {"challenge_id": challenge_id, "credential_id": issued["credential_id"],
                     "proof_sha256": proof_digest, "audience": challenge["audience"]}, at)
        return 200, {"agent": self._agent_public(connection, agent_row), "credential": issued,
                     "authentication": {"method": "WALLET_SIGNATURE", "wallet": challenge["wallet"],
                         "verified_at_ms": at, "proof_sha256": proof_digest,
                         "quality_flags": ["WALLET_CONTROL_PROVEN_FOR_THIS_LOGIN", "NOT_HUMAN_OR_AGENT_IDENTITY_PROOF"]}}

    def _audit_wallet_logins(self, connection):
        instance = connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()[0]
        for row in connection.execute("SELECT * FROM wallet_login_challenges"):
            address = wallet(row["wallet"])
            raw_key = decode_base58(address, 32, "INVALID_WALLET_ADDRESS")
            if (not crypto_core_ed25519_is_valid_point(raw_key) or len(row["nonce"]) != 64
                    or any(char not in "0123456789abcdef" for char in row["nonce"])
                    or row["expires_ms"] != row["created_ms"] + CHALLENGE_TTL_MS
                    or validate_audience(row["audience"]) != row["audience"]
                    or login_message(instance, address, row["nonce"], row["created_ms"],
                                     row["expires_ms"], row["audience"]) != row["message"]):
                raise Problem(503, "WALLET_LOGIN_CONSISTENCY_FAILURE")
            if not row["consumed"]:
                if any(row[key] is not None for key in ("result", "proof_sha256", "signature", "authenticated_ms", "agent_id", "credential_id")):
                    raise Problem(503, "WALLET_LOGIN_CONSISTENCY_FAILURE")
                continue
            digest = row["proof_sha256"]
            signature = row["signature"]
            if (row["result"] not in {"AUTHENTICATED", "AGENT_NOT_FOUND", "ACCESS_DENIED"}
                    or type(digest) is not str or len(digest) != 64
                    or any(char not in "0123456789abcdef" for char in digest)
                    or type(signature) is not str
                    or not row["created_ms"] <= row["authenticated_ms"] < row["expires_ms"]):
                raise Problem(503, "WALLET_LOGIN_CONSISTENCY_FAILURE")
            signature_raw = signature_bytes(signature)
            verify_signature(address, row["message"], signature)
            if hashlib.sha256(row["message"].encode("utf-8") + signature_raw).hexdigest() != digest:
                raise Problem(503, "WALLET_LOGIN_CONSISTENCY_FAILURE")
            if row["result"] == "AGENT_NOT_FOUND":
                if row["agent_id"] is not None or row["credential_id"] is not None:
                    raise Problem(503, "WALLET_LOGIN_CONSISTENCY_FAILURE")
                continue
            agent = self._row(connection, "agents", row["agent_id"])
            if agent["wallet"] != address:
                raise Problem(503, "WALLET_LOGIN_CONSISTENCY_FAILURE")
            if row["result"] == "ACCESS_DENIED":
                if row["credential_id"] is not None:
                    raise Problem(503, "WALLET_LOGIN_CONSISTENCY_FAILURE")
                continue
            credential = self._row(connection, "credentials", row["credential_id"])
            if (credential["role"] != "AGENT" or credential["principal_id"] != agent["id"]
                    or credential["created_ms"] != row["authenticated_ms"]):
                raise Problem(503, "WALLET_LOGIN_CONSISTENCY_FAILURE")
