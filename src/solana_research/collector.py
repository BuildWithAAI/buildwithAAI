from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .fixture import FixtureManifest, records_hash
from .model import RawEnvelope, sha256_json
from .normalize import NormalizationError, normalize_block

MAX_FIXTURE_SLOTS = 32


@dataclass(frozen=True)
class CollectionResult:
    raw: list[dict[str, Any]]
    normalized: list[dict[str, Any]]
    failures: list[dict[str, Any]]
    skipped_slots: list[int]
    manifest: FixtureManifest


def collect_bounded_fixture(
    *, start_slot: int, end_slot: int, cluster: str, source_id: str,
    commitment: str, max_supported_transaction_version: int,
    ingestion_build: str, normalizer_version: str,
    available_blocks: Callable[[int, int], list[int]],
    acquire_block: Callable[[int], RawEnvelope],
) -> CollectionResult:
    if end_slot < start_slot:
        raise ValueError("end_slot must be >= start_slot")
    requested = list(range(start_slot, end_slot + 1))
    if len(requested) > MAX_FIXTURE_SLOTS:
        raise ValueError(f"fixture window exceeds {MAX_FIXTURE_SLOTS} slots")

    available = set(available_blocks(start_slot, end_slot))
    skipped = sorted(set(requested) - available)
    raw_records: list[dict[str, Any]] = []
    normalized: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for slot in sorted(available.intersection(requested)):
        try:
            envelope = acquire_block(slot)
            raw_records.append(envelope.to_dict())
            normalized.append(normalize_block(
                envelope, slot=slot, commitment=commitment, cluster=cluster,
                max_supported_transaction_version=max_supported_transaction_version,
                normalizer_version=normalizer_version))
        except Exception as exc:
            failures.append({"slot": slot, "error_type": type(exc).__name__,
                             "message": str(exc)})

    all_records = raw_records + normalized + failures
    digest = records_hash(all_records)
    manifest = FixtureManifest(
        fixture_id=sha256_json({"cluster": cluster, "source_id": source_id,
                                "start": start_slot, "end": end_slot,
                                "commitment": commitment, "records_hash": digest}),
        cluster=cluster, source_id=source_id,
        requested_start_slot=start_slot, requested_end_slot=end_slot,
        commitment=commitment.upper(),
        transaction_version_support=max_supported_transaction_version,
        acquisition_build=ingestion_build, normalizer_version=normalizer_version,
        raw_record_count=len(raw_records), normalized_block_count=len(normalized),
        normalized_transaction_count=sum(b["transaction_count"] for b in normalized),
        failure_count=len(failures), records_hash=digest)
    return CollectionResult(raw_records, normalized, failures, skipped, manifest)
