from __future__ import annotations

from dataclasses import asdict, dataclass
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class RawEnvelope:
    raw_event_id: str
    source_id: str
    transport: str
    method: str
    params_hash: str
    requested_commitment: str
    received_at: str
    payload: dict[str, Any]
    payload_hash: str
    parser_target_version: int
    ingestion_build: str

    @classmethod
    def from_rpc(cls, *, source_id: str, method: str, params: list[Any],
                 requested_commitment: str, payload: dict[str, Any],
                 parser_target_version: int, ingestion_build: str,
                 received_at: str | None = None) -> "RawEnvelope":
        payload = deepcopy(payload)
        timestamp = received_at or utc_now_iso()
        payload_hash = sha256_json(payload)
        params_hash = sha256_json(params)
        identity = {"source_id": source_id, "method": method,
                    "params_hash": params_hash, "received_at": timestamp,
                    "payload_hash": payload_hash}
        return cls(sha256_json(identity), source_id, "HTTP_JSON_RPC", method,
                   params_hash, requested_commitment, timestamp, payload,
                   payload_hash, parser_target_version, ingestion_build)

    def validate_payload(self) -> None:
        if sha256_json(self.payload) != self.payload_hash:
            raise ValueError("raw payload hash mismatch")

    def to_dict(self) -> dict[str, Any]:
        self.validate_payload()
        return asdict(self)
