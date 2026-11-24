"""Free public known-bad address / domain lists (no API keys)."""
from __future__ import annotations
import logging
from common import http

log = logging.getLogger("wallets.badlists")
SCAMSNIFFER_ADDR = "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json"


def known_bad_addresses(exposure: dict) -> tuple[set[str], list[str]]:
    """Returns (set of lowercase EVM / case-preserved Solana addresses, list of list-load errors)."""
    bad, errors = set(), []
    for a in exposure.get("known_bad_addresses") or []:
        bad.add(a.lower() if a.startswith("0x") else a)
    try:
        lst = http.cached_json(SCAMSNIFFER_ADDR, max_age_s=12 * 3600)
        bad |= {a.lower() for a in lst if isinstance(a, str)}
    except Exception as e:
        errors.append(f"scamsniffer address list: {e}")
    return bad, errors
