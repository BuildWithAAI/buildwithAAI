"""Holder concentration from public reads.

getTokenSupply and getTokenLargestAccounts go through the shared allowlisted
Solana client. getMultipleAccounts labels a pool or bonding-curve vault only
when the token account's owner equals the observed pair, or when that owner's
program is the published pump.fun program. Any other account stays
UNCLASSIFIED.

When that RPC method is rate-limited, a capture may read the same top-holder
list from the public Rugcheck token report. Shares are still integer parts
per million of the reported supply. A pool or curve account is excluded only
when that same report identifies it. A failed read stores no share.
"""
from __future__ import annotations

import json
import time
import urllib.error
from datetime import datetime, timezone
from urllib.parse import urlsplit

from .live_curve import PUMP
from .public_rpc import post
from .rpc_allow import ALLOWED

PROTOCOL = "AAI_HOLDER_CONCENTRATION_V1"
COMMITMENT = "finalized"
RUGCHECK_HOST = "api.rugcheck.xyz"
RUGCHECK_PREFIX = "/v1/tokens/"
RUGCHECK_SUFFIX = "/report"
_BONDING_MARKET = "pump_fun"
RULE_TOP10_SHARE_PPM = 500_000
_MAX_ATOMS = 2**64 - 1
_EXACT_INT = 2**53
_B58 = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
POOL_VAULT = "POOL_VAULT"
BONDING_CURVE = "BONDING_CURVE"
UNCLASSIFIED = "UNCLASSIFIED"
_VAULTS = frozenset({POOL_VAULT, BONDING_CURVE})


def _address(value) -> bool:
    return type(value) is str and 32 <= len(value) <= 44 and all(ch in _B58 for ch in value)


def rugcheck_url(mint: str) -> str | None:
    """Exact public report URL. None when the mint is not a Solana address."""
    if not _address(mint):
        return None
    return f"https://{RUGCHECK_HOST}{RUGCHECK_PREFIX}{mint}{RUGCHECK_SUFFIX}"


def rugcheck_url_ok(url, mint) -> bool:
    """True only for https://api.rugcheck.xyz/v1/tokens/{mint}/report."""
    if type(url) is not str or not _address(mint):
        return False
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname != RUGCHECK_HOST:
        return False
    if parts.port not in (None, 443) or parts.username or parts.password or parts.query or parts.fragment:
        return False
    return parts.path == f"{RUGCHECK_PREFIX}{mint}{RUGCHECK_SUFFIX}"


def _atoms(value):
    if type(value) is not str or not value.isdigit() or not 1 <= len(value) <= 20:
        return None
    number = int(value)
    if number > _MAX_ATOMS:
        return None
    return number


def _exact(number: int) -> bool:
    return type(number) is int and abs(number) <= _EXACT_INT and int(float(number)) == number


def _ppm(part: int, whole: int) -> int:
    return (part * 1_000_000 + whole // 2) // whole


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _blank(mint, endpoint, fetched_at_ms, reason: str, **extra) -> dict:
    body = {
        "protocol": PROTOCOL,
        "status": "UNAVAILABLE",
        "reason": reason,
        "mint": mint if type(mint) is str else None,
        "endpoint": endpoint if endpoint in ALLOWED else None,
        "fetched_at_ms": fetched_at_ms if type(fetched_at_ms) is int else None,
        "fetched_at": _iso(fetched_at_ms) if type(fetched_at_ms) is int and fetched_at_ms >= 0 else None,
        "commitment": COMMITMENT,
        "supply_slot": None,
        "largest_slot": None,
        "slots_match": None,
        "supply_atoms": None,
        "decimals": None,
        "top1_atoms": None,
        "top10_atoms": None,
        "top1_share_ppm": None,
        "top10_share_ppm": None,
        "top1_ex_vault_atoms": None,
        "top10_ex_vault_atoms": None,
        "top1_ex_vault_share_ppm": None,
        "top10_ex_vault_share_ppm": None,
        "top10_account_count": None,
        "top10_ex_vault_account_count": None,
        "exclusion_applied": False,
        "vaults_identified": None,
        "unclassified_accounts": None,
        "accounts_returned": None,
        "accounts": [],
        "rule_top10_share_ppm": RULE_TOP10_SHARE_PPM,
        "share_basis": None,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
    body.update(extra)
    stamp = body.get("read_ts_ms")
    if "read_ts" not in body and type(stamp) is int and not isinstance(stamp, bool) and stamp >= 0:
        body["read_ts"] = _iso(stamp)
    return body


def _error_code(payload) -> int | None:
    if type(payload) is not dict:
        return None
    error = payload.get("error")
    if type(error) is not dict or type(error.get("code")) is not int:
        return None
    return error["code"]


def _rpc_reason(payload) -> str | None:
    if type(payload) is not dict:
        return "RPC_ENVELOPE"
    if "error" not in payload:
        return None
    code = _error_code(payload)
    if code == 429:
        return "RATE_LIMITED"
    return "RPC_ERROR"


def _http_failure(error: urllib.error.HTTPError) -> dict:
    retry = None
    header = error.headers.get("Retry-After") if error.headers is not None else None
    if type(header) is str and header.strip().isdigit():
        retry = int(header.strip())
    rpc_code = None
    try:
        raw = error.read(2048)
        parsed = json.loads(raw)
        rpc_code = _error_code(parsed)
    except Exception:
        rpc_code = None
    finally:
        error.close()
    reason = "RATE_LIMITED" if error.code == 429 or rpc_code == 429 else "RPC_ERROR"
    extra = {"http_status": error.code}
    if retry is not None:
        extra["retry_after_seconds"] = retry
    if rpc_code is not None:
        extra["rpc_error_code"] = rpc_code
    return {"reason": reason, **extra}


def _call(endpoint: str, method: str, params: list, transport):
    if transport is not None:
        return transport(method, params)
    return post(endpoint, method, params, timeout=20)


def _failure_from_exception(error: Exception) -> dict:
    if isinstance(error, urllib.error.HTTPError):
        return _http_failure(error)
    if isinstance(error, urllib.error.URLError):
        if isinstance(error.reason, TimeoutError):
            return {"reason": "RPC_TIMEOUT"}
        return {"reason": "RPC_UNREACHABLE"}
    if isinstance(error, TimeoutError):
        return {"reason": "RPC_TIMEOUT"}
    if isinstance(error, ValueError) and str(error) in {"REFUSED", "RPC_TOO_LARGE", "RPC_ENVELOPE"}:
        return {"reason": str(error)}
    if isinstance(error, json.JSONDecodeError):
        return {"reason": "RPC_ENVELOPE"}
    return {"reason": "RPC_UNREACHABLE"}


def _context_slot(payload) -> int | None:
    result = payload.get("result") if type(payload) is dict else None
    context = result.get("context") if type(result) is dict else None
    slot = context.get("slot") if type(context) is dict else None
    if type(slot) is not int or isinstance(slot, bool) or slot < 0:
        return None
    return slot


def _supply(payload) -> tuple[int, int, int] | str:
    reason = _rpc_reason(payload)
    if reason:
        return reason
    slot = _context_slot(payload)
    value = payload.get("result", {}).get("value") if type(payload.get("result")) is dict else None
    if type(value) is not dict or slot is None:
        return "RPC_SHAPE"
    atoms = _atoms(value.get("amount"))
    decimals = value.get("decimals")
    if atoms is None or type(decimals) is not int or isinstance(decimals, bool) or not 0 <= decimals <= 255:
        return "RPC_SHAPE"
    if atoms == 0:
        return "ZERO_SUPPLY"
    return atoms, decimals, slot


def _largest_rows(payload, decimals: int) -> tuple[list[dict], int] | str:
    reason = _rpc_reason(payload)
    if reason:
        return reason
    slot = _context_slot(payload)
    value = payload.get("result", {}).get("value") if type(payload.get("result")) is dict else None
    if type(value) is not list or len(value) > 20 or slot is None:
        return "RPC_SHAPE"
    rows = []
    seen = set()
    for item in value:
        if type(item) is not dict:
            return "RPC_SHAPE"
        address = item.get("address")
        amount = _atoms(item.get("amount"))
        row_decimals = item.get("decimals")
        if not _address(address) or amount is None or address in seen:
            return "RPC_SHAPE"
        if type(row_decimals) is not int or isinstance(row_decimals, bool) or row_decimals != decimals:
            return "INCONSISTENT_DECIMALS"
        seen.add(address)
        rows.append({"token_account": address, "amount_atoms": amount})
    return rows, slot


def _parsed_token(account, mint: str):
    if account is None:
        return "ACCOUNT_MISSING"
    if type(account) is not dict:
        return "PARSED_SHAPE"
    data = account.get("data")
    parsed = data.get("parsed") if type(data) is dict else None
    info = parsed.get("info") if type(parsed) is dict else None
    if type(info) is not dict or parsed.get("type") != "account":
        observed = parsed.get("type") if type(parsed.get("type")) is str else None
        return ("PARSED_TYPE_UNHANDLED", observed)
    if info.get("mint") != mint:
        return "MINT_MISMATCH"
    owner = info.get("owner")
    amount = _atoms((info.get("tokenAmount") or {}).get("amount") if type(info.get("tokenAmount")) is dict else None)
    if not _address(owner) or amount is None:
        return "PARSED_OWNER_MISSING"
    return {"owner": owner, "amount_atoms": amount}


def _owner_programs(payload, owners: list[str]) -> dict[str, str] | None:
    if type(payload) is not dict or _rpc_reason(payload):
        return None
    value = payload.get("result", {}).get("value") if type(payload.get("result")) is dict else None
    if type(value) is not list or len(value) != len(owners):
        return None
    found = {}
    for owner, account in zip(owners, value):
        if account is None:
            continue
        if type(account) is not dict or not _address(account.get("owner")):
            return None
        found[owner] = account["owner"]
    return found


def _classify(rows: list[dict], mint: str, pair_address: str | None, token_payload, owner_payload) -> tuple[bool, str | None]:
    """Label rows in place. Returns (exclusion_applied, classification_reason)."""
    if not rows:
        return True, None
    if token_payload is None:
        for row in rows:
            row["owner"] = None
            row["owner_program"] = None
            row["classification"] = UNCLASSIFIED
            row["classification_reason"] = "CLASSIFICATION_UNAVAILABLE"
        return False, "CLASSIFICATION_UNAVAILABLE"
    if _rpc_reason(token_payload):
        code_reason = _rpc_reason(token_payload)
        for row in rows:
            row["owner"] = None
            row["owner_program"] = None
            row["classification"] = UNCLASSIFIED
            row["classification_reason"] = code_reason
        return False, code_reason
    value = token_payload.get("result", {}).get("value") if type(token_payload.get("result")) is dict else None
    if type(value) is not list or len(value) != len(rows):
        for row in rows:
            row["owner"] = None
            row["owner_program"] = None
            row["classification"] = UNCLASSIFIED
            row["classification_reason"] = "CLASSIFICATION_SHAPE"
        return False, "CLASSIFICATION_SHAPE"
    parsed = [_parsed_token(account, mint) for account in value]
    owners = []
    for row, item in zip(rows, parsed):
        if type(item) is str or type(item) is tuple:
            row["owner"] = None
            row["owner_program"] = None
            row["classification"] = UNCLASSIFIED
            row["classification_reason"] = item if type(item) is str else item[0]
            if type(item) is tuple and type(item[1]) is str:
                row["parsed_type"] = item[1]
            continue
        row["owner"] = item["owner"]
        if item["amount_atoms"] != row["amount_atoms"]:
            row["owner_program"] = None
            row["classification"] = UNCLASSIFIED
            row["classification_reason"] = "AMOUNT_DIFFERS_FROM_LARGEST"
            continue
        owners.append(item["owner"])
    programs = None if owner_payload is None else _owner_programs(owner_payload, list(dict.fromkeys(owners)))
    for row in rows:
        if row.get("classification") == UNCLASSIFIED and row.get("classification_reason") in {
            "ACCOUNT_MISSING", "PARSED_SHAPE", "PARSED_TYPE_UNHANDLED", "MINT_MISMATCH",
            "PARSED_OWNER_MISSING", "AMOUNT_DIFFERS_FROM_LARGEST",
        }:
            continue
        owner = row.get("owner")
        if pair_address is not None and owner == pair_address:
            row["owner_program"] = None if programs is None else programs.get(owner)
            row["classification"] = POOL_VAULT
            row["classification_reason"] = "OWNER_EQUALS_OBSERVED_PAIR"
            continue
        program = None if programs is None else programs.get(owner)
        row["owner_program"] = program
        if program == PUMP:
            row["classification"] = BONDING_CURVE
            row["classification_reason"] = "OWNER_PROGRAM_IS_PUMP"
            continue
        if programs is None:
            row["classification"] = UNCLASSIFIED
            row["classification_reason"] = "OWNER_PROGRAM_UNAVAILABLE"
            continue
        if owner not in programs:
            row["classification"] = UNCLASSIFIED
            row["classification_reason"] = "OWNER_ACCOUNT_MISSING"
            continue
        row["classification"] = UNCLASSIFIED
        row["classification_reason"] = "OWNER_PROGRAM_NOT_POOL_OR_CURVE"
    program_note = None
    if any(row.get("classification_reason") == "OWNER_PROGRAM_UNAVAILABLE" for row in rows):
        program_note = "OWNER_PROGRAM_UNAVAILABLE"
    return True, program_note


def interpret(
    mint: str,
    endpoint: str,
    supply_payload,
    largest_payload,
    *,
    token_accounts_payload=None,
    owner_accounts_payload=None,
    pair_address: str | None = None,
    fetched_at_ms: int,
) -> dict:
    """Build a concentration record from RPC payloads. Shares are integer ppm."""
    if endpoint not in ALLOWED:
        return _blank(mint, endpoint, fetched_at_ms, "REFUSED")
    if not _address(mint):
        return _blank(mint, endpoint, fetched_at_ms, "BAD_MINT")
    if type(fetched_at_ms) is not int or isinstance(fetched_at_ms, bool) or fetched_at_ms < 0:
        return _blank(mint, endpoint, fetched_at_ms, "MISSING_FETCHED_AT")
    pair = pair_address if _address(pair_address) else None
    supply = _supply(supply_payload)
    if type(supply) is str:
        extra = {"failed_method": "getTokenSupply"}
        if supply in {"RPC_ERROR", "RATE_LIMITED"}:
            code = _error_code(supply_payload)
            if code is not None:
                extra["rpc_error_code"] = code
        return _blank(mint, endpoint, fetched_at_ms, supply, **extra)
    supply_atoms, decimals, supply_slot = supply
    largest = _largest_rows(largest_payload, decimals)
    if type(largest) is str:
        extra = {"failed_method": "getTokenLargestAccounts", "supply_slot": supply_slot}
        if largest in {"RPC_ERROR", "RATE_LIMITED"}:
            code = _error_code(largest_payload)
            if code is not None:
                extra["rpc_error_code"] = code
        return _blank(mint, endpoint, fetched_at_ms, largest, **extra)
    rows, largest_slot = largest
    if any(row["amount_atoms"] > supply_atoms for row in rows) or sum(row["amount_atoms"] for row in rows) > supply_atoms:
        return _blank(
            mint, endpoint, fetched_at_ms, "INCONSISTENT_SUPPLY",
            supply_slot=supply_slot, largest_slot=largest_slot,
            slots_match=supply_slot == largest_slot, failed_method="getTokenLargestAccounts",
        )
    applied, class_note = _classify(rows, mint, pair, token_accounts_payload, owner_accounts_payload)
    rows.sort(key=lambda row: (-row["amount_atoms"], row["token_account"]))
    for row in rows:
        row["share_ppm"] = _ppm(row["amount_atoms"], supply_atoms)
    top = rows[:10]
    top1 = rows[0]["amount_atoms"] if rows else 0
    top10 = sum(row["amount_atoms"] for row in top)
    non_vault = [row for row in rows if row.get("classification") not in _VAULTS]
    ex = non_vault[:10]
    ex1 = ex[0]["amount_atoms"] if ex else 0
    ex10 = sum(row["amount_atoms"] for row in ex)
    vaults = sum(1 for row in rows if row.get("classification") in _VAULTS)
    unclassified = sum(1 for row in rows if row.get("classification") == UNCLASSIFIED)
    basis = "TOP10_EXCLUDING_IDENTIFIED_VAULTS" if applied else "TOP10_RAW_VAULTS_NOT_EXCLUDED"
    body = _blank(mint, endpoint, fetched_at_ms, "")
    body.update({
        "status": "AVAILABLE",
        "reason": None,
        "supply_slot": supply_slot,
        "largest_slot": largest_slot,
        "slots_match": supply_slot == largest_slot,
        "supply_atoms": supply_atoms,
        "decimals": decimals,
        "top1_atoms": top1,
        "top10_atoms": top10,
        "top1_share_ppm": _ppm(top1, supply_atoms),
        "top10_share_ppm": _ppm(top10, supply_atoms),
        "top10_account_count": len(top),
        "exclusion_applied": applied,
        "vaults_identified": vaults,
        "unclassified_accounts": unclassified,
        "accounts_returned": len(rows),
        "accounts": rows,
        "share_basis": basis,
        "pair_address": pair,
        "classification_note": class_note,
    })
    if applied:
        body["top1_ex_vault_atoms"] = ex1
        body["top10_ex_vault_atoms"] = ex10
        body["top1_ex_vault_share_ppm"] = _ppm(ex1, supply_atoms)
        body["top10_ex_vault_share_ppm"] = _ppm(ex10, supply_atoms)
        body["top10_ex_vault_account_count"] = len(ex)
    return body


def _json_atoms(value):
    """An integer token amount. Floats are refused so a rounded JSON number cannot become a share."""
    if type(value) is bool:
        return None
    if type(value) is int:
        return value if 0 <= value <= _MAX_ATOMS else None
    return _atoms(value)


def _market_sets(markets, mint: str):
    """Pool and curve identities taken from the same report as the holder list.

    None means the report did not include a market list, so nothing is excluded.
    """
    if type(markets) is not list:
        return None
    pools: set[str] = set()
    curves: set[str] = set()
    pool_owners: set[str] = set()
    curve_owners: set[str] = set()
    for market in markets:
        if type(market) is not dict:
            continue
        curve = market.get("marketType") == _BONDING_MARKET
        pubkey = market.get("pubkey")
        if _address(pubkey):
            (curve_owners if curve else pool_owners).add(pubkey)
        for side, account_key in (("liquidityA", "liquidityAAccount"), ("liquidityB", "liquidityBAccount")):
            address = market.get(side)
            account = market.get(account_key)
            if type(account) is not dict or account.get("mint") != mint or not _address(address):
                continue
            (curves if curve else pools).add(address)
    return pools, curves, pool_owners, curve_owners


def interpret_rugcheck(
    mint: str,
    payload,
    *,
    source: str,
    read_ts_ms: int,
    pair_address: str | None = None,
    body_sha256: str | None = None,
) -> dict:
    """Build a concentration record from a Rugcheck token report.

    `pct` and `uiAmount` are ignored. Shares are integer ppm of `token.supply`.
    """
    if not rugcheck_url_ok(source, mint):
        return _blank(mint, None, read_ts_ms, "REFUSED", source=source if type(source) is str else None, read_ts_ms=read_ts_ms, status="NOT_OBSERVED")
    if type(read_ts_ms) is not int or isinstance(read_ts_ms, bool) or read_ts_ms < 0:
        return _blank(mint, None, read_ts_ms, "MISSING_FETCHED_AT", source=source, status="NOT_OBSERVED")
    if type(payload) is not dict:
        return _blank(mint, None, read_ts_ms, "RESPONSE_SHAPE", source=source, read_ts_ms=read_ts_ms, status="NOT_OBSERVED")
    if payload.get("mint") != mint:
        return _blank(mint, None, read_ts_ms, "MINT_MISMATCH", source=source, read_ts_ms=read_ts_ms, status="NOT_OBSERVED")
    token = payload.get("token")
    holders = payload.get("topHolders")
    if type(token) is not dict or type(holders) is not list or len(holders) > 20:
        return _blank(mint, None, read_ts_ms, "RESPONSE_SHAPE", source=source, read_ts_ms=read_ts_ms, status="NOT_OBSERVED")
    supply_atoms = _json_atoms(token.get("supply"))
    decimals = token.get("decimals")
    if supply_atoms is None or supply_atoms == 0 or type(decimals) is not int or isinstance(decimals, bool) or not 0 <= decimals <= 255:
        reason = "ZERO_SUPPLY" if supply_atoms == 0 else "RESPONSE_SHAPE"
        return _blank(mint, None, read_ts_ms, reason, source=source, read_ts_ms=read_ts_ms, status="NOT_OBSERVED")
    rows = []
    seen = set()
    for item in holders:
        if type(item) is not dict:
            return _blank(mint, None, read_ts_ms, "HOLDER_SHAPE", source=source, read_ts_ms=read_ts_ms, status="NOT_OBSERVED")
        address = item.get("address")
        owner = item.get("owner")
        amount = _json_atoms(item.get("amount"))
        row_decimals = item.get("decimals")
        if not _address(address) or not _address(owner) or amount is None or address in seen:
            return _blank(mint, None, read_ts_ms, "HOLDER_SHAPE", source=source, read_ts_ms=read_ts_ms, status="NOT_OBSERVED")
        if row_decimals is not None and (type(row_decimals) is not int or isinstance(row_decimals, bool) or row_decimals != decimals):
            return _blank(mint, None, read_ts_ms, "INCONSISTENT_DECIMALS", source=source, read_ts_ms=read_ts_ms, status="NOT_OBSERVED")
        seen.add(address)
        rows.append({"token_account": address, "amount_atoms": amount, "owner": owner})
    if any(row["amount_atoms"] > supply_atoms for row in rows) or sum(row["amount_atoms"] for row in rows) > supply_atoms:
        return _blank(mint, None, read_ts_ms, "INCONSISTENT_SUPPLY", source=source, read_ts_ms=read_ts_ms, status="NOT_OBSERVED")
    identified = _market_sets(payload.get("markets"), mint)
    pair = pair_address if _address(pair_address) else None
    if identified is None:
        pools, curves, pool_owners, curve_owners = set(), set(), set(), set()
        if pair is not None:
            pool_owners.add(pair)
        applied = pair is not None
        class_note = None if applied else "MARKETS_ABSENT"
    else:
        pools, curves, pool_owners, curve_owners = identified
        if pair is not None:
            if pair in curve_owners:
                curve_owners.add(pair)
            else:
                pool_owners.add(pair)
        applied = True
        class_note = None
    for row in rows:
        address = row["token_account"]
        owner = row["owner"]
        row["owner_program"] = None
        if address in curves or owner in curve_owners:
            row["classification"] = BONDING_CURVE
            row["classification_reason"] = "MARKET_LIQUIDITY_ACCOUNT" if address in curves else "OWNER_EQUALS_MARKET"
        elif address in pools or owner in pool_owners:
            row["classification"] = POOL_VAULT
            if address in pools:
                row["classification_reason"] = "MARKET_LIQUIDITY_ACCOUNT"
            elif pair is not None and owner == pair:
                row["classification_reason"] = "OWNER_EQUALS_OBSERVED_PAIR"
            else:
                row["classification_reason"] = "OWNER_EQUALS_MARKET"
        else:
            row["classification"] = UNCLASSIFIED
            row["classification_reason"] = "NOT_IDENTIFIED_AS_POOL_OR_CURVE"
    rows.sort(key=lambda row: (-row["amount_atoms"], row["token_account"]))
    for row in rows:
        row["share_ppm"] = _ppm(row["amount_atoms"], supply_atoms)
    top = rows[:10]
    top1 = rows[0]["amount_atoms"] if rows else 0
    top10 = sum(row["amount_atoms"] for row in top)
    non_vault = [row for row in rows if row.get("classification") not in _VAULTS]
    ex = non_vault[:10]
    ex1 = ex[0]["amount_atoms"] if ex else 0
    ex10 = sum(row["amount_atoms"] for row in ex)
    basis = "TOP10_EXCLUDING_IDENTIFIED_VAULTS" if applied else "TOP10_RAW_VAULTS_NOT_EXCLUDED"
    body = _blank(mint, None, read_ts_ms, "")
    body.update({
        "status": "AVAILABLE",
        "reason": None,
        "source": source,
        "read_ts_ms": read_ts_ms,
        "read_ts": _iso(read_ts_ms),
        "supply_atoms": supply_atoms,
        "decimals": decimals,
        "top1_atoms": top1,
        "top10_atoms": top10,
        "top1_share_ppm": _ppm(top1, supply_atoms),
        "top10_share_ppm": _ppm(top10, supply_atoms),
        "top10_account_count": len(top),
        "exclusion_applied": applied,
        "vaults_identified": sum(1 for row in rows if row.get("classification") in _VAULTS),
        "unclassified_accounts": sum(1 for row in rows if row.get("classification") == UNCLASSIFIED),
        "accounts_returned": len(rows),
        "accounts": rows,
        "share_basis": basis,
        "pair_address": pair,
        "classification_note": class_note,
        "body_sha256": body_sha256 if type(body_sha256) is str and len(body_sha256) == 64 else None,
    })
    if applied:
        body["top1_ex_vault_atoms"] = ex1
        body["top10_ex_vault_atoms"] = ex10
        body["top1_ex_vault_share_ppm"] = _ppm(ex1, supply_atoms)
        body["top10_ex_vault_share_ppm"] = _ppm(ex10, supply_atoms)
        body["top10_ex_vault_account_count"] = len(ex)
    return body


def not_observed(mint, source, read_ts_ms, reason: str, **extra) -> dict:
    """A stored read that did not produce a share."""
    endpoint = source if source in ALLOWED else None
    stamp = read_ts_ms if type(read_ts_ms) is int and not isinstance(read_ts_ms, bool) else None
    body = _blank(
        mint, endpoint, stamp, reason if type(reason) is str else "NOT_OBSERVED",
        source=source if type(source) is str else None,
        read_ts_ms=stamp,
        status="NOT_OBSERVED",
        **extra,
    )
    if stamp is not None:
        body["read_ts"] = _iso(stamp)
    return body


def live_read(mint: str, endpoint: str, *, pair_address: str | None = None, transport=None, fetched_at_ms: int | None = None) -> dict:
    """Read supply and the largest token accounts. No share is invented on failure."""
    clock = int(time.time() * 1000) if fetched_at_ms is None else fetched_at_ms
    if endpoint not in ALLOWED:
        return _blank(mint, endpoint, clock, "REFUSED")
    if not _address(mint):
        return _blank(mint, endpoint, clock, "BAD_MINT")
    config = {"commitment": COMMITMENT}
    try:
        supply_payload = _call(endpoint, "getTokenSupply", [mint, config], transport)
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
        failure = _failure_from_exception(error)
        return _blank(mint, endpoint, clock, failure.pop("reason"), failed_method="getTokenSupply", **failure)
    supply = _supply(supply_payload) if type(supply_payload) is dict else "RPC_ENVELOPE"
    if type(supply) is str:
        extra = {"failed_method": "getTokenSupply"}
        code = _error_code(supply_payload) if type(supply_payload) is dict else None
        if code is not None:
            extra["rpc_error_code"] = code
        return _blank(mint, endpoint, clock, supply, **extra)
    try:
        largest_payload = _call(endpoint, "getTokenLargestAccounts", [mint, config], transport)
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
        failure = _failure_from_exception(error)
        return _blank(
            mint, endpoint, clock, failure.pop("reason"),
            failed_method="getTokenLargestAccounts", supply_slot=supply[2], **failure,
        )
    token_payload = None
    owner_payload = None
    parsed = _largest_rows(largest_payload, supply[1])
    if type(parsed) is tuple and parsed[0]:
        addresses = [row["token_account"] for row in parsed[0]]
        try:
            token_payload = _call(
                endpoint, "getMultipleAccounts",
                [addresses, {"encoding": "jsonParsed", "commitment": COMMITMENT}], transport,
            )
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
            token_payload = None
        if type(token_payload) is dict and not _rpc_reason(token_payload):
            owners = []
            value = token_payload.get("result", {}).get("value") if type(token_payload.get("result")) is dict else None
            if type(value) is list and len(value) == len(addresses):
                for account in value:
                    item = _parsed_token(account, mint)
                    if type(item) is dict:
                        owners.append(item["owner"])
            owners = list(dict.fromkeys(owners))
            if owners:
                try:
                    owner_payload = _call(
                        endpoint, "getMultipleAccounts",
                        [owners, {"encoding": "base64", "commitment": COMMITMENT}], transport,
                    )
                except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
                    owner_payload = None
    return interpret(
        mint, endpoint, supply_payload, largest_payload,
        token_accounts_payload=token_payload,
        owner_accounts_payload=owner_payload,
        pair_address=pair_address,
        fetched_at_ms=clock,
    )


def _decision_time(read: dict):
    """The clock the time gate uses. A stored read_ts_ms wins over fetched_at_ms."""
    if "read_ts_ms" in read and read.get("read_ts_ms") is not None:
        stamp = read.get("read_ts_ms")
        if type(stamp) is int and not isinstance(stamp, bool) and stamp >= 0:
            return stamp
        return None
    stamp = read.get("fetched_at_ms")
    if type(stamp) is int and not isinstance(stamp, bool) and stamp >= 0:
        return stamp
    return None


def _source_ok(read: dict) -> bool:
    endpoint = read.get("endpoint")
    source = read.get("source")
    if endpoint in ALLOWED and source in (None, endpoint):
        return True
    mint = read.get("mint")
    return type(source) is str and rugcheck_url_ok(source, mint) and endpoint in (None,)


def _causal(read, now_ms: int):
    if read is None:
        return "ABSENT", "NOT_IN_SNAPSHOT", None
    if type(read) is not dict or read.get("protocol") != PROTOCOL:
        return "UNAVAILABLE", "NOT_A_READ", None
    stamp = _decision_time(read)
    if read.get("status") != "AVAILABLE":
        if type(stamp) is int and type(now_ms) is int and not isinstance(now_ms, bool) and stamp > now_ms:
            return "NOT_CAUSAL", "AFTER_DECISION", None
        if read.get("status") == "NOT_OBSERVED" and type(read.get("reason")) is not str:
            reason = "NOT_OBSERVED"
        else:
            reason = read.get("reason") if type(read.get("reason")) is str else "RPC_ERROR"
        return "UNAVAILABLE", reason, None
    if stamp is None:
        return "UNAVAILABLE", "MISSING_FETCHED_AT", None
    if not _source_ok(read):
        return "UNAVAILABLE", "REFUSED", None
    if read.get("endpoint") in ALLOWED:
        for key in ("supply_slot", "largest_slot"):
            slot = read.get(key)
            if type(slot) is not int or isinstance(slot, bool) or slot < 0:
                return "UNAVAILABLE", "RPC_SHAPE", None
    if type(now_ms) is not int or isinstance(now_ms, bool) or stamp > now_ms:
        return "NOT_CAUSAL", "AFTER_DECISION", None
    share = read.get("top10_ex_vault_share_ppm") if read.get("exclusion_applied") is True else read.get("top10_share_ppm")
    if type(share) is not int or isinstance(share, bool):
        return "UNAVAILABLE", "SHARE_NOT_OBSERVED", None
    return "AVAILABLE", None, read


def _attach_origin(flag: dict, read) -> dict:
    if type(read) is not dict:
        return flag
    if type(read.get("source")) is str:
        flag["source"] = read["source"]
    stamp = read.get("read_ts_ms")
    if type(stamp) is int and not isinstance(stamp, bool):
        flag["read_ts_ms"] = stamp
    return flag


def _summary(read: dict) -> dict:
    applied = read.get("exclusion_applied") is True
    compared = read["top10_ex_vault_share_ppm"] if applied else read["top10_share_ppm"]
    summary = {
        "top1_share_ppm": read["top1_share_ppm"],
        "top10_share_ppm": read["top10_share_ppm"],
        "compared_share_ppm": compared,
        "share_basis": read.get("share_basis"),
        "vaults_identified": read.get("vaults_identified"),
        "unclassified_accounts": read.get("unclassified_accounts"),
        "accounts_returned": read.get("accounts_returned"),
        "exclusion_applied": applied,
    }
    if applied:
        summary["top1_ex_vault_share_ppm"] = read.get("top1_ex_vault_share_ppm")
        summary["top10_ex_vault_share_ppm"] = read.get("top10_ex_vault_share_ppm")
    for key in ("top1_atoms", "top10_atoms", "top1_ex_vault_atoms", "top10_ex_vault_atoms", "supply_atoms"):
        value = read.get(key)
        if type(value) is int and not isinstance(value, bool) and _exact(value):
            summary[key] = value
    return summary


def thesis_parts(read, now_ms: int) -> tuple[dict, dict | None]:
    """Risk flag plus the numbers that may be copied into the thesis."""
    status, reason, usable = _causal(read, now_ms)
    if usable is None:
        flag = {
            "flag": "HOLDER_CONCENTRATION",
            "status": "UNAVAILABLE",
            "reason": reason,
            "observed": None,
        }
        if type(read) is dict and read.get("endpoint") in ALLOWED:
            flag["endpoint"] = read["endpoint"]
        if type(read) is dict and type(read.get("fetched_at_ms")) is int and not isinstance(read.get("fetched_at_ms"), bool):
            flag["fetched_at_ms"] = read["fetched_at_ms"]
        for key in ("supply_slot", "largest_slot", "http_status", "retry_after_seconds", "rpc_error_code"):
            value = read.get(key) if type(read) is dict else None
            if type(value) is int and not isinstance(value, bool):
                flag[key] = value
        if type(read) is dict and type(read.get("failed_method")) is str:
            flag["failed_method"] = read["failed_method"]
        return _attach_origin(flag, read), None
    summary = _summary(usable)
    raised = summary["compared_share_ppm"] >= RULE_TOP10_SHARE_PPM
    flag = {
        "flag": "HOLDER_CONCENTRATION",
        "status": "RAISED" if raised else "CLEAR",
        "observed": summary,
        "rule_top10_share_ppm": RULE_TOP10_SHARE_PPM,
        "endpoint": usable.get("endpoint"),
        "supply_slot": usable.get("supply_slot"),
        "largest_slot": usable.get("largest_slot"),
        "slots_match": usable.get("slots_match"),
        "fetched_at_ms": usable.get("fetched_at_ms"),
        "exclusion_applied": usable.get("exclusion_applied") is True,
    }
    if type(usable.get("classification_note")) is str:
        flag["classification_note"] = usable["classification_note"]
    return _attach_origin(flag, usable), summary


def council_input(read, now_ms: int) -> dict:
    """Copy a causal read onto the council inputs. This is not a vote."""
    status, reason, usable = _causal(read, now_ms)
    body = {
        "role": "INPUT_NOT_A_VOTE",
        "status": status if status != "ABSENT" else "ABSENT",
        "reason": reason,
        "top1_share_ppm": None,
        "top10_share_ppm": None,
        "top10_ex_vault_share_ppm": None,
        "rule_top10_share_ppm": RULE_TOP10_SHARE_PPM,
    }
    if usable is None:
        return body
    summary = _summary(usable)
    body["status"] = "AVAILABLE"
    body["reason"] = None
    body["top1_share_ppm"] = summary["top1_share_ppm"]
    body["top10_share_ppm"] = summary["top10_share_ppm"]
    body["top10_ex_vault_share_ppm"] = summary.get("top10_ex_vault_share_ppm")
    body["compared_share_ppm"] = summary["compared_share_ppm"]
    body["share_basis"] = summary["share_basis"]
    body["fetched_at_ms"] = usable.get("fetched_at_ms")
    if type(usable.get("read_ts_ms")) is int and not isinstance(usable.get("read_ts_ms"), bool):
        body["read_ts_ms"] = usable["read_ts_ms"]
    if type(usable.get("source")) is str:
        body["source"] = usable["source"]
    return body
