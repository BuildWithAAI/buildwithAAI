"""Source eligibility only; a source license or checksum cannot promote a market model."""
import json
from pathlib import Path

from .graph import ARCHIVE_SHA256, SOURCE_ID

CATALOG = Path(__file__).resolve().parents[2] / "research/brain-assets/source_catalog.json"


def source_gate(source_id: str, stage: str) -> tuple[str, ...]:
    if stage not in ("ASSET_IMPORT", "LIVE_SHADOW", "WALLET_EXECUTION"):
        raise ValueError("UNSUPPORTED_STAGE")
    catalog = json.loads(CATALOG.read_bytes())
    sources = [s for s in catalog["sources"] if s["source_id"] == source_id]
    if len(sources) != 1:
        return ("UNKNOWN_OR_DUPLICATE_SOURCE",)
    source = sources[0]
    reasons = []
    if source["license"] != "CC-BY-4.0":
        reasons.append("COMMERCIAL_REUSE_UNRESOLVED_OR_RESTRICTED")
    if source_id != SOURCE_ID or source["asset_sha256"] != ARCHIVE_SHA256:
        reasons.append("NO_SUPPORTED_PINNED_ASSET_ADAPTER")
    if stage in ("LIVE_SHADOW", "WALLET_EXECUTION"):
        reasons.extend(("NO_REGISTERED_MODEL_OR_MARKET_ENCODER", "NO_BENCHMARK_PROMOTION",
                        "NO_CONNECTED_SHADOW_SERVICE"))
    if stage == "WALLET_EXECUTION":
        reasons.append("EXECUTION_NOT_AUTHORIZED_OR_IMPLEMENTED")
    return tuple(reasons)
