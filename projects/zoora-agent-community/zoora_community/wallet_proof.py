"""Single-use local raw-message Ed25519 proofs; no signing or transaction submission."""

import base64
import binascii
import hashlib
import json
import secrets

from nacl.bindings import crypto_core_ed25519_is_valid_point
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

from .validation import BASE58, Problem, capabilities, canonical, fields, handle, identifier, text, wallet

PROOF_VERSION = "ZOORA_AE007_RAW_ED25519_V1"
CHALLENGE_TTL_MS = 300_000


def decode_base58(value, size, code):
    if type(value) is not str or not 1 <= len(value) <= size * 2 or any(c not in BASE58 for c in value):
        raise Problem(400, code)
    number = 0
    for char in value:
        number = number * 58 + BASE58.index(char)
    raw = b"\0" * (len(value) - len(value.lstrip("1")))
    raw += number.to_bytes((number.bit_length() + 7) // 8, "big")
    if len(raw) != size:
        raise Problem(400, code)
    return raw


def signature_bytes(value):
    if type(value) is not str or len(value) != 88:
        raise Problem(400, "INVALID_WALLET_SIGNATURE")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise Problem(400, "INVALID_WALLET_SIGNATURE") from None
    if len(raw) != 64 or base64.b64encode(raw).decode("ascii") != value:
        raise Problem(400, "INVALID_WALLET_SIGNATURE")
    return raw


def verify_signature(address, message, signature):
    raw_key = decode_base58(address, 32, "INVALID_WALLET_ADDRESS")
    if not crypto_core_ed25519_is_valid_point(raw_key):
        raise Problem(403, "WALLET_KEY_REJECTED")
    try:
        VerifyKey(raw_key).verify(message.encode("utf-8"), signature_bytes(signature))
    except (BadSignatureError, ValueError):
        raise Problem(403, "WALLET_SIGNATURE_REJECTED") from None


def profile(body):
    fields(body, ("handle", "wallet", "capabilities"), ("bio",))
    return {"handle": handle(body["handle"]), "wallet": wallet(body["wallet"]),
            "capabilities": capabilities(body["capabilities"]), "bio": text(body.get("bio", ""), 512, 0)}


def challenge_message(instance, principal, payload, purpose, agent_id, nonce, at,
                      audience="LOCAL_ONLY / 127.0.0.1"):
    # Distinct printable prefix and exact UTF-8 bytes cannot be a Solana transaction.
    digest = hashlib.sha256(canonical(payload).encode("utf-8")).hexdigest()
    return ("Zoora community wallet ownership proof\n"
            "Signing proves control at this time. No payment or transaction is authorized.\n"
            f"Audience: {audience}\n"
            f"Protocol: {PROOF_VERSION}\nInstance: {instance}\n"
            f"Purpose: {purpose}\nActor: {principal['role']}:{principal['principal_id']}\n"
            f"Credential: {principal['id']}\nAgent: {agent_id or 'NEW'}\n"
            f"Wallet: {payload['wallet']}\nHandle: {payload['handle']}\n"
            f"Profile SHA256: {digest}\nNonce: {nonce}\n"
            f"Issued at (Unix ms): {at}\nExpires at (Unix ms): {at + CHALLENGE_TTL_MS}")


class WalletProofMethods:
    def _new_challenge(self, connection, principal, payload, at, agent_id=None, audience=None):
        from .store import new_id
        if not crypto_core_ed25519_is_valid_point(decode_base58(payload["wallet"], 32, "INVALID_WALLET_ADDRESS")):
            raise Problem(403, "WALLET_KEY_REJECTED")
        if agent_id is None:
            self._role(principal, "OPERATOR")
            operator_id = principal["principal_id"]
            if connection.execute("SELECT 1 FROM agents WHERE wallet=?", (payload["wallet"],)).fetchone():
                raise Problem(409, "WALLET_RESERVED")
            if connection.execute("SELECT 1 FROM handles WHERE handle=?", (payload["handle"],)).fetchone():
                raise Problem(409, "HANDLE_RESERVED")
        else:
            agent = self._active_agent(connection, agent_id)
            self._manage_agent(principal, agent)
            operator_id = agent["operator_id"]
        count = connection.execute("SELECT COUNT(*) FROM wallet_challenges WHERE actor_role=? AND actor_id=? AND created_ms>?",
                                   (principal["role"], principal["principal_id"], at - 60_000)).fetchone()[0]
        if count >= 5:
            raise Problem(429, "CHALLENGE_RATE_LIMIT")
        self._capacity(connection, "wallet_challenges")
        instance = connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()[0]
        record_id = new_id()
        nonce = secrets.token_hex(32)
        purpose = "REGISTER_AGENT" if agent_id is None else "VERIFY_EXISTING_AGENT"
        message_audience = "LOCAL_ONLY / 127.0.0.1" if audience is None else audience
        if (type(message_audience) is not str or len(message_audience) > 255
                or "\n" in message_audience or "\r" in message_audience):
            raise Problem(400, "INVALID_AUTH_AUDIENCE")
        response_audience = "LOCAL_ONLY" if audience is None else audience
        message = challenge_message(instance, principal, payload, purpose, agent_id, nonce, at, message_audience)
        connection.execute("INSERT INTO wallet_challenges (id,actor_role,actor_id,credential_id,operator_id,agent_id,profile,nonce,message,created_ms,expires_ms,consumed,audience) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)",
                           (record_id, principal["role"], principal["principal_id"], principal["id"],
                            operator_id, agent_id, canonical(payload), nonce, message, at, at + CHALLENGE_TTL_MS,
                            message_audience))
        self._event(connection, principal, "WALLET_CHALLENGE", record_id, {"purpose": purpose}, at)
        return 201, {"challenge_id": record_id, "protocol": PROOF_VERSION, "message": message,
                     "message_base64": base64.b64encode(message.encode("utf-8")).decode("ascii"),
                     "expires_at_ms": at + CHALLENGE_TTL_MS, "wallet": payload["wallet"],
                     "audience": response_audience, "transactions_authorized": False,
                     "provenance": {"classification": "OBSERVED", "source": PROOF_VERSION,
                        "observed_at_ms": at, "available_at_ms": at, "slot": None, "commitment": None,
                        "transformation_version": 1, "state": "AVAILABLE",
                        "missingness": ["solana_slot", "chain_commitment"],
                        "quality_flags": ["SERVER_ISSUED_LOCAL_CHALLENGE", "OFF_CHAIN_MESSAGE"]}}

    def _consume_challenge(self, connection, principal, body, at, agent_id=None):
        fields(body, ("challenge_id", "signature"))
        record = self._row(connection, "wallet_challenges", identifier(body["challenge_id"]))
        if (record["actor_role"] != principal["role"] or record["actor_id"] != principal["principal_id"]
                or record["credential_id"] != principal["id"] or record["agent_id"] != agent_id):
            raise Problem(403, "CHALLENGE_BINDING_REJECTED")
        if record["consumed"]:
            raise Problem(409, "CHALLENGE_CONSUMED")
        if at < record["created_ms"] or at >= record["expires_ms"]:
            raise Problem(410, "CHALLENGE_EXPIRED")
        payload = json.loads(record["profile"])
        verify_signature(payload["wallet"], record["message"], body["signature"])
        connection.execute("UPDATE wallet_challenges SET consumed=1 WHERE id=?", (record["id"],))
        return record, payload

    def _record_proof(self, connection, challenge, agent_id, signature, at):
        from .store import new_id
        # The most recent proof replaces only the derived current summary; all issued
        # challenges/signatures remain bound through the audit and proof history.
        self._capacity(connection, "wallet_proofs")
        record_id = new_id()
        digest = hashlib.sha256(challenge["message"].encode("utf-8") + signature_bytes(signature)).hexdigest()
        seq = connection.execute("SELECT COALESCE(MAX(seq),0)+1 FROM wallet_proofs").fetchone()[0]
        connection.execute("INSERT INTO wallet_proofs VALUES (?,?,?,?,?,?,?)",
                           (record_id, agent_id, challenge["id"], signature, at, digest, seq))
        return record_id

    def _proof_summary(self, connection, agent_id):
        row = connection.execute("SELECT * FROM wallet_proofs WHERE agent_id=? ORDER BY verified_ms DESC,seq DESC LIMIT 1",
                                 (agent_id,)).fetchone()
        if row is None:
            return {"status": "DECLARED_UNVERIFIED", "verified_at_ms": None,
                    "classification": "LABEL", "protocol": PROOF_VERSION,
                    "source": PROOF_VERSION, "observed_at_ms": None, "available_at_ms": None,
                    "slot": None, "commitment": None, "transformation_version": 1, "state": "UNVERIFIED",
                    "missingness": ["signature_proof", "current_control", "solana_slot", "chain_commitment"],
                    "quality_flags": ["LEGACY_ADDRESS_DECLARATION", "WALLET_CONTROL_UNVERIFIED"]}
        return {"status": "SIGNATURE_VERIFIED", "verified_at_ms": row["verified_ms"],
                "classification": "DERIVED", "protocol": PROOF_VERSION, "proof_id": row["id"],
                "source": PROOF_VERSION, "observed_at_ms": row["verified_ms"], "available_at_ms": row["verified_ms"],
                "slot": None, "commitment": None, "transformation_version": 1, "state": "AVAILABLE",
                "missingness": ["current_control", "solana_slot", "chain_commitment"],
                "proof_sha256": row["digest"], "quality_flags": ["CONTROL_PROVEN_AT_RECORDED_TIME",
                "CURRENT_CONTROL_NOT_CONTINUOUSLY_VERIFIED", "NOT_HUMAN_OR_AGENT_IDENTITY_PROOF"]}

    def _proof_read(self, connection, agent_id):
        agent = self._row(connection, "agents", agent_id)
        summary = self._proof_summary(connection, agent_id)
        if "proof_id" in summary:
            row = self._row(connection, "wallet_proofs", summary["proof_id"])
            challenge = self._row(connection, "wallet_challenges", row["challenge_id"])
            summary.update({"message": challenge["message"], "signature": row["signature"],
                            "wallet": agent["wallet"], "algorithm": "Ed25519"})
        return summary

    def _audit_wallet_proofs(self, connection):
        instance = connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()[0]
        for row in connection.execute("SELECT * FROM wallet_challenges"):
            payload = profile(json.loads(row["profile"]))
            credential = self._row(connection, "credentials", row["credential_id"])
            if (credential["role"] != row["actor_role"] or credential["principal_id"] != row["actor_id"]
                    or credential["created_ms"] > row["created_ms"] or credential["expires_ms"] <= row["created_ms"]
                    or row["expires_ms"] != row["created_ms"] + CHALLENGE_TTL_MS
                    or len(row["nonce"]) != 64 or any(c not in "0123456789abcdef" for c in row["nonce"])):
                raise Problem(503, "WALLET_PROOF_CONSISTENCY_FAILURE")
            principal = {"role": row["actor_role"], "principal_id": row["actor_id"], "id": row["credential_id"]}
            purpose = "REGISTER_AGENT" if row["agent_id"] is None else "VERIFY_EXISTING_AGENT"
            audience = row["audience"] if "audience" in row.keys() else "LOCAL_ONLY / 127.0.0.1"
            expected = challenge_message(instance, principal, payload, purpose, row["agent_id"], row["nonce"],
                                         row["created_ms"], audience)
            if expected != row["message"]:
                raise Problem(503, "WALLET_PROOF_CONSISTENCY_FAILURE")
            if row["actor_role"] == "OPERATOR" and row["actor_id"] != row["operator_id"]:
                raise Problem(503, "WALLET_PROOF_CONSISTENCY_FAILURE")
            if row["agent_id"] is not None:
                agent = self._row(connection, "agents", row["agent_id"])
                if (agent["operator_id"] != row["operator_id"] or agent["wallet"] != payload["wallet"]
                        or row["actor_role"] == "AGENT" and row["actor_id"] != agent["id"]):
                    raise Problem(503, "WALLET_PROOF_CONSISTENCY_FAILURE")
            elif row["actor_role"] != "OPERATOR":
                raise Problem(503, "WALLET_PROOF_CONSISTENCY_FAILURE")
            has_proof = connection.execute("SELECT 1 FROM wallet_proofs WHERE challenge_id=?", (row["id"],)).fetchone() is not None
            if bool(row["consumed"]) != has_proof:
                raise Problem(503, "WALLET_PROOF_CONSISTENCY_FAILURE")
        seq = 0
        for row in connection.execute("SELECT * FROM wallet_proofs ORDER BY seq"):
            seq += 1
            challenge = self._row(connection, "wallet_challenges", row["challenge_id"])
            agent = self._row(connection, "agents", row["agent_id"])
            payload = json.loads(challenge["profile"])
            if (row["seq"] != seq or agent["operator_id"] != challenge["operator_id"]
                    or agent["wallet"] != payload["wallet"]
                    or challenge["agent_id"] not in (None, row["agent_id"])
                    or not challenge["created_ms"] <= row["verified_ms"] < challenge["expires_ms"]):
                raise Problem(503, "WALLET_PROOF_CONSISTENCY_FAILURE")
            verify_signature(agent["wallet"], challenge["message"], row["signature"])
            digest = hashlib.sha256(challenge["message"].encode("utf-8") + signature_bytes(row["signature"])).hexdigest()
            if not secrets.compare_digest(digest, row["digest"]):
                raise Problem(503, "WALLET_PROOF_CONSISTENCY_FAILURE")
