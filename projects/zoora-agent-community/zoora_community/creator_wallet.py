"""Creator wallet authentication, separate from the agent operating wallet."""

import base64
import secrets

from nacl.bindings import crypto_core_ed25519_is_valid_point

from .validation import Problem, fields, identifier, wallet
from .wallet_login import validate_audience
from .wallet_proof import CHALLENGE_TTL_MS, decode_base58, verify_signature

CREATOR_PROTOCOL = "ZOORA_CREATOR_RAW_ED25519_V1"


def creator_message(instance, purpose, address, operator, credential, nonce, audience, created, expires):
    return ("Zoora creator wallet access\n"
            "No payment, transfer, transaction, or agent spending permission is authorized.\n"
            f"Protocol: {CREATOR_PROTOCOL}\nService instance: {instance}\nAudience: {audience}\n"
            f"Purpose: {purpose}_CREATOR_WALLET\nWallet: {address}\n"
            f"Creator account: {operator or 'RESOLVE_AFTER_SIGNATURE'}\n"
            f"Current credential: {credential or 'NONE'}\nNonce: {nonce}\n"
            f"Issued at (Unix ms): {created}\nExpires at (Unix ms): {expires}")


class CreatorWalletMethods:
    def _creator_challenge(self, connection, body, at, audience, principal=None):
        from .store import new_id

        fields(body, ("wallet",))
        address = wallet(body["wallet"])
        if not crypto_core_ed25519_is_valid_point(decode_base58(address, 32, "INVALID_WALLET_ADDRESS")):
            raise Problem(403, "WALLET_KEY_REJECTED")
        purpose = "LINK" if principal is not None else "LOGIN"
        if principal is not None:
            self._role(principal, "OPERATOR")
            if connection.execute("SELECT 1 FROM creator_wallets WHERE id=?", (principal["principal_id"],)).fetchone():
                raise Problem(409, "CREATOR_WALLET_ALREADY_LINKED")
        # Retain successful link proofs. Login attempts have bounded 15-minute retention.
        connection.execute("DELETE FROM creator_wallet_challenges WHERE consumed=0 AND expires_ms<?", (at - 900_000,))
        connection.execute("DELETE FROM creator_wallet_challenges WHERE purpose='LOGIN' AND created_ms<?", (at - 900_000,))
        recent = connection.execute("SELECT COUNT(*),SUM(wallet=?) FROM creator_wallet_challenges WHERE created_ms>=?",
                                    (address, at - 60_000)).fetchone()
        if recent[0] >= 120 or (recent[1] or 0) >= 5:
            raise Problem(429, "CHALLENGE_RATE_LIMIT")
        self._capacity(connection, "creator_wallet_challenges")
        record_id, nonce = new_id(), secrets.token_hex(32)
        audience = validate_audience(audience)
        operator = principal["principal_id"] if principal else None
        credential = principal["id"] if principal else None
        instance = connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()[0]
        expires = at + CHALLENGE_TTL_MS
        message = creator_message(instance, purpose, address, operator, credential, nonce, audience, at, expires)
        connection.execute("INSERT INTO creator_wallet_challenges "
                           "(id,wallet,purpose,operator_id,credential_id,nonce,audience,message,created_ms,expires_ms) "
                           "VALUES (?,?,?,?,?,?,?,?,?,?)",
                           (record_id, address, purpose, operator, credential, nonce, audience, message, at, expires))
        return 201, {"challenge_id": record_id, "protocol": CREATOR_PROTOCOL, "wallet": address,
                     "message": message, "message_base64": base64.b64encode(message.encode()).decode(),
                     "expires_at_ms": expires, "audience": audience, "transactions_authorized": False}

    def _creator_proof(self, connection, body, at, principal=None):
        fields(body, ("challenge_id", "signature"))
        challenge_id = identifier(body["challenge_id"])
        row = connection.execute("SELECT * FROM creator_wallet_challenges WHERE id=?", (challenge_id,)).fetchone()
        if row is None:
            raise Problem(404, "CHALLENGE_NOT_FOUND")
        if row["consumed"]:
            raise Problem(409, "CHALLENGE_CONSUMED")
        if not row["created_ms"] <= at < row["expires_ms"]:
            raise Problem(410, "CHALLENGE_EXPIRED")
        purpose = "LINK" if principal is not None else "LOGIN"
        if row["purpose"] != purpose:
            raise Problem(403, "CHALLENGE_PURPOSE_MISMATCH")
        if principal is not None:
            self._role(principal, "OPERATOR")
            if row["operator_id"] != principal["principal_id"] or row["credential_id"] != principal["id"]:
                raise Problem(403, "CHALLENGE_OWNER_MISMATCH")
        verify_signature(row["wallet"], row["message"], body["signature"])
        issued = None
        if purpose == "LINK":
            self._capacity(connection, "creator_wallets")
            connection.execute("INSERT INTO creator_wallets VALUES (?,?,?,?)",
                               (principal["principal_id"], row["wallet"], challenge_id, at))
            result, status = "LINKED", 201
            response = {"wallet": row["wallet"], "operator_id": principal["principal_id"], "linked_at_ms": at}
        else:
            binding = connection.execute("SELECT * FROM creator_wallets WHERE wallet=?", (row["wallet"],)).fetchone()
            if binding is None:
                result, status, response = "NOT_LINKED", 404, {"error": "CREATOR_WALLET_NOT_LINKED"}
            else:
                operator = self._row(connection, "operators", binding["id"])
                if not operator["active"] or self._access_held(connection, "OPERATOR", operator["id"]):
                    result, status, response = "DENIED", 403, {"error": "CREATOR_ACCESS_SUSPENDED"}
                else:
                    issued = self._issue(connection, "OPERATOR", operator["id"], at)
                    principal = {"role": "OPERATOR", "principal_id": operator["id"]}
                    result, status, response = "AUTHENTICATED", 200, {"credential": issued, "wallet": row["wallet"]}
        connection.execute("UPDATE creator_wallet_challenges SET consumed=1,signature=?,result=?,authenticated_ms=?,issued_id=? WHERE id=?",
                           (body["signature"], result, at, issued["credential_id"] if issued else None, challenge_id))
        if principal is not None:
            self._event(connection, principal, "CREATOR_WALLET_" + result, challenge_id, {"wallet": row["wallet"]}, at)
        return status, response

    def _audit_creator_wallets(self, connection):
        instance = connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()[0]
        for row in connection.execute("SELECT * FROM creator_wallet_challenges"):
            if (not crypto_core_ed25519_is_valid_point(decode_base58(row["wallet"], 32, "INVALID_WALLET_ADDRESS"))
                    or creator_message(instance, row["purpose"], wallet(row["wallet"]), row["operator_id"],
                                row["credential_id"], row["nonce"], validate_audience(row["audience"]),
                                row["created_ms"], row["expires_ms"]) != row["message"]
                    or row["expires_ms"] != row["created_ms"] + CHALLENGE_TTL_MS
                    or len(row["nonce"]) != 64 or any(c not in "0123456789abcdef" for c in row["nonce"])):
                raise Problem(503, "CREATOR_WALLET_CONSISTENCY_FAILURE")
            if row["purpose"] == "LINK":
                credential = self._row(connection, "credentials", row["credential_id"])
                if credential["role"] != "OPERATOR" or credential["principal_id"] != row["operator_id"]:
                    raise Problem(503, "CREATOR_WALLET_CONSISTENCY_FAILURE")
            elif row["operator_id"] is not None or row["credential_id"] is not None:
                raise Problem(503, "CREATOR_WALLET_CONSISTENCY_FAILURE")
            if not row["consumed"]:
                if any(row[key] is not None for key in ("signature", "result", "authenticated_ms", "issued_id")):
                    raise Problem(503, "CREATOR_WALLET_CONSISTENCY_FAILURE")
                continue
            verify_signature(row["wallet"], row["message"], row["signature"])
            if not row["created_ms"] <= row["authenticated_ms"] < row["expires_ms"]:
                raise Problem(503, "CREATOR_WALLET_CONSISTENCY_FAILURE")
            if row["purpose"] == "LINK":
                binding = connection.execute("SELECT * FROM creator_wallets WHERE challenge_id=?", (row["id"],)).fetchone()
                if row["result"] != "LINKED" or binding is None:
                    raise Problem(503, "CREATOR_WALLET_CONSISTENCY_FAILURE")
            if row["purpose"] == "LOGIN" and row["result"] not in {"AUTHENTICATED", "DENIED", "NOT_LINKED"}:
                raise Problem(503, "CREATOR_WALLET_CONSISTENCY_FAILURE")
            if row["result"] == "AUTHENTICATED":
                issued = self._row(connection, "credentials", row["issued_id"])
                binding = connection.execute("SELECT * FROM creator_wallets WHERE wallet=?", (row["wallet"],)).fetchone()
                if (binding is None or issued["role"] != "OPERATOR" or issued["principal_id"] != binding["id"]
                        or issued["created_ms"] != row["authenticated_ms"]):
                    raise Problem(503, "CREATOR_WALLET_CONSISTENCY_FAILURE")
            elif row["issued_id"] is not None:
                raise Problem(503, "CREATOR_WALLET_CONSISTENCY_FAILURE")
        for binding in connection.execute("SELECT * FROM creator_wallets"):
            proof = connection.execute("SELECT * FROM creator_wallet_challenges WHERE id=?", (binding["challenge_id"],)).fetchone()
            if (proof is None or proof["result"] != "LINKED" or proof["operator_id"] != binding["id"]
                    or proof["wallet"] != binding["wallet"] or proof["authenticated_ms"] != binding["created_ms"]):
                raise Problem(503, "CREATOR_WALLET_CONSISTENCY_FAILURE")
