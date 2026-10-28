"""Historical wallet/operator affiliation snapshots for offline research only."""

import hashlib
import json
import secrets

from .validation import DIGEST, Problem, canonical, fields, handle, identifier, matching, wallet
from .wallet_proof import (
    CHALLENGE_TTL_MS,
    PROOF_VERSION,
    challenge_message,
    profile,
    signature_bytes,
    verify_signature,
)
from .wallet_login import validate_audience

MODEL = "zoora-research-ownership-snapshot/0.1.0"
CLASSIFICATION = "DERIVED_LOCAL_ENROLLMENT_SNAPSHOT"
DOMAIN = b"ZOORA_AE019_OWNERSHIP_SNAPSHOT_V1\0"
MAX_SNAPSHOT_BYTES = 512 * 1024


def fingerprint(value, domain=DOMAIN):
    return hashlib.sha256(
        domain + canonical({k: v for k, v in value.items() if k != "fingerprint"}).encode("utf-8")
    ).hexdigest()


def integer(value, low=0, high=2**63 - 1):
    if type(value) is not int or not low <= value <= high:
        raise Problem(400, "INVALID_RESEARCH_INTEGER")
    return value


def _challenge_audience(message):
    prefix = (
        "Zoora community wallet ownership proof\n"
        "Signing proves control at this time. No payment or transaction is authorized.\n"
        "Audience: "
    )
    if type(message) is not str or not message.startswith(prefix):
        raise Problem(400, "INVALID_RESEARCH_SNAPSHOT")
    audience = message[len(prefix):].split("\n", 1)[0]
    if audience == "LOCAL_ONLY / 127.0.0.1":
        return audience
    try:
        return validate_audience(audience)
    except Problem:
        raise Problem(400, "INVALID_RESEARCH_SNAPSHOT") from None


def selection(body):
    fields(body, ("agents",))
    values = body["agents"]
    if type(values) is not list or not 8 <= len(values) <= 64:
        raise Problem(400, "RESEARCH_REQUIRES_8_TO_64_AGENTS")
    values = [identifier(v) for v in values]
    if len(values) != len(set(values)):
        raise Problem(400, "DUPLICATE_RESEARCH_AGENT")
    return values


def verify_snapshot(value, expected=None):
    fields(
        value,
        (
            "schema_version",
            "model",
            "classification",
            "instance_id",
            "exported_at_ms",
            "protocol",
            "audit_prefix",
            "agents",
            "operators",
            "operator_indices",
            "fingerprint",
        ),
    )
    if (
        type(value["schema_version"]) is not int
        or value["schema_version"] != 1
        or value["model"] != MODEL
        or value["classification"] != CLASSIFICATION
        or value["protocol"] != PROOF_VERSION
    ):
        raise Problem(400, "INVALID_RESEARCH_SNAPSHOT")
    matching(value["fingerprint"], DIGEST, "INVALID_RESEARCH_FINGERPRINT")
    if expected is not None:
        matching(expected, DIGEST, "INVALID_RESEARCH_FINGERPRINT")
        if not secrets.compare_digest(value["fingerprint"], expected):
            raise Problem(409, "RESEARCH_SNAPSHOT_PIN_MISMATCH")
    if not secrets.compare_digest(value["fingerprint"], fingerprint(value)):
        raise Problem(409, "RESEARCH_SNAPSHOT_HASH_MISMATCH")
    if len(canonical(value).encode("utf-8")) > MAX_SNAPSHOT_BYTES:
        raise Problem(413, "RESEARCH_SNAPSHOT_TOO_LARGE")
    instance = identifier(value["instance_id"])
    at = integer(value["exported_at_ms"])
    fields(value["audit_prefix"], ("events", "head"))
    integer(value["audit_prefix"]["events"], 1, 50_000)
    matching(value["audit_prefix"]["head"], DIGEST, "INVALID_RESEARCH_AUDIT_ANCHOR")
    if type(value["agents"]) is not list or not 8 <= len(value["agents"]) <= 64:
        raise Problem(400, "INVALID_RESEARCH_SNAPSHOT")
    ids, wallets, proof_ids, challenge_ids = [], [], [], []
    for slot, record in enumerate(value["agents"]):
        fields(record, ("slot", "agent_id", "operator_id", "wallet", "handle", "affiliation_proof"))
        if integer(record["slot"], 0, 63) != slot:
            raise Problem(400, "INVALID_RESEARCH_SLOT")
        ids.append(identifier(record["agent_id"]))
        op = identifier(record["operator_id"])
        wallets.append(wallet(record["wallet"]))
        handle(
            record["handle"]
        )  # Current handle is a server record, not the original signed handle.
        p = record["affiliation_proof"]
        fields(
            p,
            (
                "proof_id",
                "challenge_id",
                "credential_id",
                "agent_binding",
                "profile",
                "nonce",
                "issued_at_ms",
                "expires_at_ms",
                "verified_at_ms",
                "message",
                "signature",
                "proof_sha256",
            ),
        )
        proof_ids.append(identifier(p["proof_id"]))
        challenge_ids.append(identifier(p["challenge_id"]))
        credential = identifier(p["credential_id"])
        if p["agent_binding"] is not None and identifier(p["agent_binding"]) != record["agent_id"]:
            raise Problem(400, "RESEARCH_AGENT_BINDING_MISMATCH")
        payload = profile(p["profile"])
        if payload != p["profile"] or payload["wallet"] != record["wallet"]:
            raise Problem(400, "RESEARCH_WALLET_BINDING_MISMATCH")
        nonce = matching(p["nonce"], DIGEST, "INVALID_RESEARCH_NONCE")
        issued = integer(p["issued_at_ms"])
        expires = integer(p["expires_at_ms"])
        verified = integer(p["verified_at_ms"])
        if (
            expires != issued + CHALLENGE_TTL_MS
            or not issued <= verified < expires
            or verified > at
        ):
            raise Problem(400, "INVALID_RESEARCH_PROOF_TIME")
        principal = dict(role="OPERATOR", principal_id=op, id=credential)
        purpose = "REGISTER_AGENT" if p["agent_binding"] is None else "VERIFY_EXISTING_AGENT"
        audience = _challenge_audience(p["message"])
        message = challenge_message(
            instance, principal, payload, purpose, p["agent_binding"], nonce, issued, audience
        )
        if message != p["message"]:
            raise Problem(409, "RESEARCH_AFFILIATION_BINDING_MISMATCH")
        verify_signature(record["wallet"], message, p["signature"])
        digest = hashlib.sha256(
            message.encode("utf-8") + signature_bytes(p["signature"])
        ).hexdigest()
        matching(p["proof_sha256"], DIGEST, "INVALID_RESEARCH_FINGERPRINT")
        if not secrets.compare_digest(p["proof_sha256"], digest):
            raise Problem(409, "RESEARCH_PROOF_HASH_MISMATCH")
    selection(dict(agents=ids))
    if any(len(v) != len(set(v)) for v in [wallets, proof_ids, challenge_ids]):
        raise Problem(400, "DUPLICATE_RESEARCH_PROOF")
    operators = sorted({r["operator_id"] for r in value["agents"]})
    if value["operators"] != operators:
        raise Problem(409, "RESEARCH_OPERATOR_MAPPING_MISMATCH")
    mapping = [operators.index(r["operator_id"]) for r in value["agents"]]
    if (
        type(value["operator_indices"]) is not list
        or any(type(v) is not int for v in value["operator_indices"])
        or value["operator_indices"] != mapping
    ):
        raise Problem(409, "RESEARCH_OPERATOR_MAPPING_MISMATCH")
    return mapping


class ResearchIdentityMethods:
    def _research_snapshot(self, connection, principal, body, at):
        self._role(principal, "OWNER")
        ids = selection(body)
        instance = connection.execute(
            "SELECT value FROM metadata WHERE key='instance_id'"
        ).fetchone()[0]
        prefix = connection.execute(
            "SELECT seq,hash FROM audit ORDER BY seq DESC LIMIT 1"
        ).fetchone()
        records = []
        for slot, agent_id in enumerate(ids):
            agent = self._active_agent(connection, agent_id)
            # Agent-authored reproofs establish wallet control, not a signed operator affiliation.
            row = connection.execute(
                "SELECT p.*,c.credential_id,c.agent_id AS agent_binding,c.profile,c.nonce,c.message,"
                "c.created_ms AS issued_ms,c.expires_ms,c.consumed,c.actor_id,c.operator_id "
                "FROM wallet_proofs p JOIN wallet_challenges c ON c.id=p.challenge_id "
                "WHERE p.agent_id=? AND c.actor_role='OPERATOR' ORDER BY p.verified_ms DESC,p.seq DESC LIMIT 1",
                (agent_id,),
            ).fetchone()
            if row is None:
                raise Problem(409, "OPERATOR_SIGNED_AFFILIATION_REQUIRED")
            if (
                not row["consumed"]
                or row["operator_id"] != agent["operator_id"]
                or row["actor_id"] != agent["operator_id"]
            ):
                raise Problem(503, "RESEARCH_SOURCE_CONSISTENCY_FAILURE")
            credential = self._row(connection, "credentials", row["credential_id"])
            if (
                credential["role"] != "OPERATOR"
                or credential["principal_id"] != agent["operator_id"]
                or not credential["created_ms"] <= row["issued_ms"] < credential["expires_ms"]
            ):
                raise Problem(503, "RESEARCH_SOURCE_CONSISTENCY_FAILURE")
            proof = dict(
                proof_id=row["id"],
                challenge_id=row["challenge_id"],
                credential_id=row["credential_id"],
                agent_binding=row["agent_binding"],
                profile=json.loads(row["profile"]),
                nonce=row["nonce"],
                issued_at_ms=row["issued_ms"],
                expires_at_ms=row["expires_ms"],
                verified_at_ms=row["verified_ms"],
                message=row["message"],
                signature=row["signature"],
                proof_sha256=row["digest"],
            )
            records.append(
                dict(
                    slot=slot,
                    agent_id=agent_id,
                    operator_id=agent["operator_id"],
                    wallet=agent["wallet"],
                    handle=agent["handle"],
                    affiliation_proof=proof,
                )
            )
        operators = sorted({r["operator_id"] for r in records})
        value = dict(
            schema_version=1,
            model=MODEL,
            classification=CLASSIFICATION,
            instance_id=instance,
            exported_at_ms=at,
            protocol=PROOF_VERSION,
            audit_prefix=dict(events=prefix["seq"], head=prefix["hash"]),
            agents=records,
            operators=operators,
            operator_indices=[operators.index(r["operator_id"]) for r in records],
        )
        value["fingerprint"] = fingerprint(value)
        verify_snapshot(value)
        self._event(
            connection,
            principal,
            "RESEARCH_OWNERSHIP_EXPORT",
            value["fingerprint"],
            dict(
                snapshot_fingerprint=value["fingerprint"],
                agents=ids,
                basis="HISTORICAL_OPERATOR_AFFILIATION",
            ),
            at,
        )
        return 201, value
