from __future__ import annotations
from dataclasses import asdict, dataclass
import hashlib, json
from typing import Any, Iterable
from .model import canonical_json

def records_hash(records: Iterable[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for record in records:
        digest.update(canonical_json(record).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()

def detect_gaps(requested_slots: Iterable[int], available_slots: Iterable[int]) -> list[int]:
    available = set(available_slots)
    return sorted(slot for slot in requested_slots if slot not in available)

@dataclass(frozen=True)
class FixtureManifest:
    fixture_id: str
    cluster: str
    source_id: str
    requested_start_slot: int
    requested_end_slot: int
    commitment: str
    transaction_version_support: int
    acquisition_build: str
    normalizer_version: str
    raw_record_count: int
    normalized_block_count: int
    normalized_transaction_count: int
    failure_count: int
    records_hash: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def manifest_hash(self) -> str:
        return hashlib.sha256(canonical_json(self.to_dict()).encode("utf-8")).hexdigest()

def jsonl(records: Iterable[dict[str, Any]]) -> str:
    return "".join(canonical_json(record) + "\n" for record in records)

def parse_jsonl(payload: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in payload.splitlines() if line.strip()]
