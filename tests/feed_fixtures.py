"""Declared scanner metadata for protocol tests; never live provider evidence."""

import base64
from copy import deepcopy
from datetime import datetime, timezone
import time

from src.ecosystem_research import scanner_feed as f
from src.solana_research import coin_evidence as ev

MINT = "So11111111111111111111111111111111111111112"
NOW = time.time_ns() // 1000000
RELEASE = "a" * 64


def iso(moment):
    return datetime.fromtimestamp(moment / 1000, timezone.utc).isoformat(
        timespec="milliseconds"
    )


def rules():
    return f.policy(MINT, RELEASE, "b" * 64, ["rpc.test"])


def receipt(method, moment=NOW, market=False):
    result = {
        "status": "AVAILABLE",
        "classification": "OBSERVED",
        "quality_flags": [],
        "endpoint_host": "api.dexscreener.com" if market else "rpc.test",
        "method": method,
        "available_at": iso(moment),
        "raw_sha256": "c" * 64,
        "timestamp_basis": "RETRIEVAL_TIME",
        "slot": 100,
        "commitment": "finalized",
        "commitment_basis": "REQUESTED",
    }
    if method == "getGenesisHash":
        result["genesis_hash"] = ev.MAINNET_GENESIS
    elif not market:
        result["network_evidence"] = receipt("getGenesisHash", moment)
    return result


def metric(value="2", classification="OBSERVED", moment=NOW):
    return {
        "status": "AVAILABLE" if value is not None else "UNAVAILABLE",
        "value": value,
        "classification": classification,
        "source": receipt("token-pairs/v1/solana", moment, True),
    }


def report(moment=NOW):
    return {
        "mint": MINT,
        "available_at": iso(moment),
        "network": "solana-mainnet",
        "cached": False,
        "network_evidence": receipt("getGenesisHash", moment),
        "mint_info": {
            "mint": MINT,
            "status": "AVAILABLE",
            "slot": 100,
            "evidence": receipt("getAccountInfo", moment),
            "supply_raw": "1000000",
            "decimals": 6,
            "mint_authority": None,
            "freeze_authority": None,
            "extension_type_ids": [],
            "token_program_address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
        "market": {
            "price_usd": metric(moment=moment),
            "price_sol": metric("0.01", "DERIVED", moment),
            "liquidity_usd": metric("10000", moment=moment),
            "volume_24h_usd": metric("5000", moment=moment),
        },
        "holders": {
            "status": "AVAILABLE",
            "source": receipt("getTokenLargestAccounts", moment),
            "accounts": [],
        },
        "activity": {
            "status": "AVAILABLE",
            "source": receipt("getSignaturesForAddress", moment),
            "records": [],
        },
        "coverage": {
            "scope": "SELECTED_CORE_SECTIONS",
            "complete": True,
            "sections": {key: "AVAILABLE" for key in f.CORE},
            "missing_sections": [],
        },
    }


def health(moment=NOW):
    return {
        "status": "AVAILABLE",
        "scope": "PROCESS_ONLY",
        "read_only": True,
        "access_required": True,
        "timestamp": iso(moment),
        "release": {
            "status": "AVAILABLE",
            "scope": "SCANNER_PACKAGE_CONTENTS",
            "sha256": RELEASE,
        },
    }


def ready():
    return {
        "status": "AVAILABLE",
        "scope": "LOCAL_APPLICATION",
        "application_ready": True,
        "read_only": True,
        "execution": "DISABLED",
        "checks": {"fixture": {"status": "AVAILABLE"}},
    }


def wire(value, method="GET", path="/api/health", body=None, status=200):
    raw = ev.canonical(value).encode()
    return {
        "method": method,
        "path": path,
        "body": body,
        "status": status,
        "content_type": "application/json",
        "no_store": True,
        "retry_after_seconds": None,
        "raw_base64": base64.b64encode(raw).decode(),
        "raw_sha256": ev.sha(raw),
        "bytes": len(raw),
    }


def record(moment=NOW, model=None):
    return {
        "protocol": f.PROTOCOL,
        "policy_sha256": ev.digest(rules()),
        "captured_ms": moment,
        "responses": {
            "health_before": wire(health(moment)),
            "ready": wire(ready(), path="/api/ready"),
            "scan": wire(
                deepcopy(model) if model is not None else report(moment),
                "POST",
                "/api/scan",
                {"mint": MINT, "refresh": False},
            ),
            "health_after": wire(health(moment)),
        },
        "io_error": None,
        "live_execution_allowed": False,
    }
