"""Bounded Solana source evidence and PumpSwap trade replay; never executable quotes."""
from __future__ import annotations

import base64
import binascii
from collections import defaultdict
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
import os
from pathlib import Path

from .model import RawEnvelope
from .normalize import normalize_block

PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
ENDPOINTS = ("https://api.mainnet.solana.com", "https://api.mainnet-beta.solana.com")
IDL_COMMIT = "639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22"
IDL_BLOB = "d907b16a91f035aeb3c3182bfa0972a91bf23a86"
EVENT_CPI = bytes.fromhex("e445a52e51cb9a1d")
BUY = bytes((103, 244, 82, 31, 44, 245, 119, 119))
SELL = bytes((62, 47, 55, 10, 165, 3, 220, 42))
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
MAX_RAW = 8 * 1024**2
MAX_FILE = 16 * 1024**2
METHODS = {"getGenesisHash", "getSlot", "getBlocks", "getBlock"}
POLICY = {"decoder": "PUMPSWAP_FIXED_PREFIX_248_V1", "idl_commit": IDL_COMMIT,
          "idl_blob_sha1": IDL_BLOB, "event_cpi_hex": EVENT_CPI.hex(),
          "trailing_fields": "RETAINED_OPAQUE_NOT_ZERO_FILLED",
          "program_version_at_event_attested": False}


class EvidenceError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise EvidenceError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(value):
    return sha(canonical(value).encode())


def integer(value, low=0, high=2**64 - 1):
    require(type(value) is int and low <= value <= high, "INVALID_INTEGER")
    return value


def exact(value, keys):
    require(type(value) is dict and set(value) == set(keys), "INVALID_FIELDS")


def parse(raw):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_FILE, "JSON_BOUND")

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "DUPLICATE_JSON_KEY")
            result[key] = value
        return result

    def invalid(_):
        raise EvidenceError("NONFINITE_JSON")

    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise EvidenceError("INVALID_JSON") from error


def write(path, value):
    raw = (canonical(value) + "\n").encode()
    require(len(raw) <= MAX_FILE, "OUTPUT_BOUND")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        require(stream.write(raw) == len(raw), "SHORT_WRITE")
        stream.flush()
        os.fsync(stream.fileno())


def read(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_FILE, "INVALID_FILE")
    return parse(path.read_bytes())


def unbase64(value, limit=MAX_RAW):
    require(type(value) is str and len(value) <= (limit + 2) // 3 * 4, "BASE64_BOUND")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as error:
        raise EvidenceError("INVALID_BASE64") from error
    require(len(raw) <= limit, "BASE64_BOUND")
    return raw


def b58encode(raw):
    number, text = int.from_bytes(raw, "big"), ""
    while number:
        number, remainder = divmod(number, 58)
        text = ALPHABET[remainder] + text
    return "1" * (len(raw) - len(raw.lstrip(b"\0"))) + text


def b58decode(text, limit=4096):
    require(type(text) is str and 0 < len(text) <= limit * 2, "BASE58_BOUND")
    number = 0
    for char in text:
        require(char in ALPHABET, "INVALID_BASE58")
        number = number * 58 + ALPHABET.index(char)
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big")
    raw = b"\0" * (len(text) - len(text.lstrip("1"))) + raw
    require(len(raw) <= limit, "BASE58_BOUND")
    return raw


def key(value, length=32):
    require(len(b58decode(value, length)) == length, "INVALID_CHAIN_KEY")
    return value


def timestamp(value):
    require(type(value) is str and len(value) <= 40, "INVALID_CAPTURE_TIME")
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise EvidenceError("INVALID_CAPTURE_TIME") from error
    require(moment.tzinfo is not None, "CAPTURE_TIME_REQUIRES_ZONE")
    return moment.astimezone(timezone.utc)


def unwrap(record):
    exact(record, ("request", "request_sha256", "received_at", "elapsed_ms",
                   "http_status", "response_base64", "response_sha256", "error"))
    request = record["request"]
    exact(request, ("jsonrpc", "id", "method", "params"))
    require(request["jsonrpc"] == "2.0" and type(request["id"]) is int and request["id"] == 1
            and request["method"] in METHODS and type(request["params"]) is list, "READ_ONLY_REQUEST")
    require(record["request_sha256"] == digest(request), "REQUEST_HASH_MISMATCH")
    timestamp(record["received_at"])
    integer(record["elapsed_ms"], 0, 120_000)
    raw = unbase64(record["response_base64"])
    require(record["response_sha256"] == sha(raw), "RESPONSE_HASH_MISMATCH")
    require(record["http_status"] == 200 and record["error"] is None, "ACQUISITION_INCOMPLETE")
    payload = parse(raw)
    require(type(payload) is dict and payload.get("jsonrpc") == "2.0"
            and type(payload.get("id")) is int and payload["id"] == 1
            and "error" not in payload and "result" in payload, "RPC_RESPONSE_ERROR")
    return request, payload, len(raw)


def archive_blocks(archive):
    exact(archive, ("protocol", "classification", "endpoint", "status", "error",
                    "requested_start_slot", "requested_end_slot", "capture_code_sha256", "records"))
    require(archive["protocol"] == "AAI_SOLANA_RAW_BLOCK_ARCHIVE_V1"
            and archive["classification"] in ("RPC_CAPTURE", "SYNTHETIC_FIXTURE"), "ARCHIVE_PROTOCOL")
    require(archive["endpoint"] in ENDPOINTS and archive["status"] == "COMPLETE"
            and archive["error"] is None, "ACQUISITION_INCOMPLETE")
    require(type(archive["capture_code_sha256"]) is str and len(archive["capture_code_sha256"]) == 64
            and all(c in "0123456789abcdef" for c in archive["capture_code_sha256"]), "CAPTURE_CODE_PIN")
    start, end = integer(archive["requested_start_slot"]), integer(archive["requested_end_slot"])
    require(0 <= end - start < 4, "BLOCK_WINDOW_BOUND")
    records = archive["records"]
    require(type(records) is list and 3 <= len(records) <= 7, "RECORD_BOUND")
    decoded, total, previous = [], 0, None
    for record in records:
        request, payload, size = unwrap(record)
        total += size
        require(total <= MAX_RAW, "ARCHIVE_RAW_BUDGET")
        now = timestamp(record["received_at"])
        require(previous is None or previous <= now, "CAPTURE_CLOCK_REVERSED")
        previous = now
        decoded.append((record, request, payload))
    _, request, payload = decoded[0]
    require(request["method"] == "getGenesisHash" and request["params"] == []
            and payload["result"] == MAINNET_GENESIS, "WRONG_GENESIS")
    _, request, payload = decoded[1]
    require(request["method"] == "getSlot" and request["params"] == [{"commitment": "finalized"}]
            and integer(payload["result"]) >= end, "FINALIZED_BOUNDARY")
    _, request, payload = decoded[2]
    expected = [start, end, {"commitment": "finalized"}]
    require(request["method"] == "getBlocks" and request["params"] == expected, "COVERAGE_REQUEST")
    slots = payload["result"]
    require(type(slots) is list and len(slots) <= 4
            and all(type(s) is int and start <= s <= end for s in slots)
            and slots == sorted(set(slots)), "INVALID_BLOCK_COVERAGE")
    require(len(decoded) == 3 + len(slots), "BLOCK_COVERAGE_GAP")
    blocks = []
    for slot, (record, request, payload) in zip(slots, decoded[3:], strict=True):
        require(request["method"] == "getBlock" and request["params"] == [slot, {
            "commitment": "finalized", "encoding": "json", "transactionDetails": "full",
            "rewards": False, "maxSupportedTransactionVersion": 1}], "BLOCK_REQUEST")
        raw = payload["result"]
        require(type(raw) is dict and type(raw.get("transactions")) is list
                and len(raw["transactions"]) <= 10_000, "BLOCK_UNAVAILABLE_OR_BOUND")
        key(raw.get("blockhash"))
        key(raw.get("previousBlockhash"))
        require(integer(raw.get("parentSlot")) < slot, "INVALID_BLOCK_PARENT")
        if raw.get("blockTime") is not None:
            integer(raw["blockTime"], 0, 2**63 - 1)
        if blocks:
            require(raw["parentSlot"] == blocks[-1]["slot"]
                    and raw["previousBlockhash"] == blocks[-1]["blockhash"], "BLOCK_LINKAGE_GAP")
        envelope = RawEnvelope.from_rpc(
            source_id="solana-public-mainnet", method="getBlock", params=request["params"],
            requested_commitment="finalized", payload=payload, parser_target_version=1,
            ingestion_build=archive["capture_code_sha256"], received_at=record["received_at"])
        block = normalize_block(envelope, slot=slot, commitment="finalized",
                                normalizer_version="aai-coin-evidence-v1")
        block["raw_response_sha256"] = record["response_sha256"]
        blocks.append(block)
    return blocks, sorted(set(range(start, end + 1)) - set(slots))


def account_keys(transaction):
    static = transaction["account_keys"]
    require(type(static) is list and 1 <= len(static) <= 512, "ACCOUNT_KEYS_UNAVAILABLE")
    loaded = transaction["loaded_addresses"]
    if loaded is not None:
        require(type(loaded) is dict and type(loaded.get("writable")) is list
                and type(loaded.get("readonly")) is list, "INVALID_LOADED_ADDRESSES")
        static = static + loaded["writable"] + loaded["readonly"]
    require(len(static) <= 512 and len(set(static)) == len(static), "ACCOUNT_KEY_BOUND_OR_DUPLICATE")
    return [key(value) for value in static]


def token_identity(transaction, keys, address):
    found = []
    for field in ("pre_token_balances", "post_token_balances"):
        balances = transaction[field]
        require(balances is None or type(balances) is list, "TOKEN_BALANCES")
        for item in balances or []:
            require(type(item) is dict, "TOKEN_BALANCE_ITEM")
            index = integer(item.get("accountIndex"), 0, len(keys) - 1)
            if keys[index] == address:
                amount = item.get("uiTokenAmount")
                require(type(amount) is dict and type(amount.get("amount")) is str
                        and amount["amount"].isascii() and amount["amount"].isdigit()
                        and len(amount["amount"]) <= 20, "EXACT_TOKEN_AMOUNT")
                integer(int(amount["amount"]))
                found.append((key(item.get("mint")), integer(amount.get("decimals"), 0, 18)))
    require(not found or len(set(found)) == 1, "TOKEN_IDENTITY_CONFLICT")
    return found[0] if found else None


def decode_prefix(raw):
    if raw[:8] not in (BUY, SELL):
        return None
    require(len(raw) >= 248, "TRUNCATED_SUPPORTED_TRADE_EVENT")
    values = [int.from_bytes(raw[8 + 8*i:16 + 8*i], "little", signed=i == 0) for i in range(14)]
    require(values[0] >= 0, "NEGATIVE_EVENT_TIME")
    fields = {"event_timestamp": values[0], "base_atoms": values[1], "quote_atoms": values[7],
              "user_base_reserves_reported": values[3], "user_quote_reserves_reported": values[4],
              "pool_base_reserves_reported": values[5], "pool_quote_reserves_reported": values[6],
              "lp_fee_bps_reported": values[8], "lp_fee_atoms_reported": values[9],
              "protocol_fee_bps_reported": values[10], "protocol_fee_atoms_reported": values[11],
              "user_quote_atoms_reported": values[13],
              "side": "BUY" if raw[:8] == BUY else "SELL"}
    for i, label in enumerate(("pool", "user", "user_base_account", "user_quote_account")):
        fields[label] = b58encode(raw[120 + i*32:152 + i*32])
    require(fields["base_atoms"] > 0 and fields["quote_atoms"] > 0, "ZERO_TRADE_AMOUNT")
    fields["opaque_tail_bytes"] = len(raw) - 248
    fields["opaque_tail_sha256"] = sha(raw[248:])
    return fields


def transaction_events(transaction, keys):
    # CPI events only: program ID + Anchor tag + event discriminator are all checked.
    # Logs remain in raw/normalized evidence but are not counted a second time.
    groups = transaction["inner_instructions"]
    require(groups is None or type(groups) is list, "INNER_INSTRUCTIONS")
    outer_count = len(transaction["instructions"] or [])
    events, other = [], 0
    seen = set()
    for group in groups or []:
        require(type(group) is dict and type(group.get("instructions")) is list, "INNER_GROUP")
        outer = integer(group.get("index"), 0, max(0, outer_count - 1))
        require(outer_count > 0 and outer not in seen, "INNER_GROUP_INDEX")
        seen.add(outer)
        for inner, instruction in enumerate(group["instructions"]):
            require(type(instruction) is dict, "INNER_INSTRUCTION")
            index = integer(instruction.get("programIdIndex"), 0, len(keys) - 1)
            if keys[index] != PROGRAM:
                continue
            raw = b58decode(instruction.get("data"))
            if not raw.startswith(EVENT_CPI):
                continue
            decoded = decode_prefix(raw[len(EVENT_CPI):])
            if decoded is None:
                other += 1
                continue
            for label in ("pool", "user", "user_base_account", "user_quote_account"):
                require(decoded[label] in keys, "EVENT_ACCOUNT_NOT_IN_TRANSACTION")
            base = token_identity(transaction, keys, decoded["user_base_account"])
            quote = token_identity(transaction, keys, decoded["user_quote_account"])
            if base is None or quote is None:
                other += 1  # Retained raw, explicitly not included in mapped-trade totals.
                continue
            require(base[0] != quote[0], "IDENTICAL_BASE_AND_QUOTE")
            events.append({**decoded, "base_mint": base[0], "base_decimals": base[1],
                           "quote_mint": quote[0], "quote_decimals": quote[1],
                           "outer_instruction_index": outer, "inner_instruction_index": inner})
    events.sort(key=lambda event: (event["outer_instruction_index"], event["inner_instruction_index"]))
    return events, other


def fraction(value):
    return {"numerator": value.numerator, "denominator": value.denominator}


def price(trade):
    # Quote whole-token units per whole base token; no USD conversion.
    return Fraction(trade["quote_atoms"] * 10**trade["base_decimals"],
                    trade["base_atoms"] * 10**trade["quote_decimals"])


def reconstruct(archive):
    blocks, skipped = archive_blocks(archive)
    trades, transaction_records, signatures, other_events = [], [], set(), 0
    for block in blocks:
        for transaction in block["transactions"]:
            signature = key(transaction["signature"], 64)
            require(signature not in signatures, "DUPLICATE_TRANSACTION")
            signatures.add(signature)
            known = transaction["success"] is not None
            fee = transaction["fee_lamports"]
            if fee is not None:
                integer(fee)
            transaction_records.append({"signature": signature, "slot": block["slot"],
                "transaction_index": transaction["transaction_index"], "success": transaction["success"],
                "error": transaction["error"], "fee_lamports": fee,
                "raw_response_sha256": block["raw_response_sha256"]})
            if not known or not transaction["success"]:
                continue  # Failed transactions pay fees but cannot create executed trades.
            keys = account_keys(transaction)
            if PROGRAM not in keys:
                continue
            events, other = transaction_events(transaction, keys)
            other_events += other
            for event in events:
                trades.append({**event, "signature": signature, "slot": block["slot"],
                    "transaction_index": transaction["transaction_index"],
                    "block_time": block["block_time"], "captured_at": block["available_time"],
                    "raw_response_sha256": block["raw_response_sha256"]})
    trades.sort(key=lambda t: (t["slot"], t["transaction_index"],
                              t["outer_instruction_index"], t["inner_instruction_index"]))
    by_market = defaultdict(list)
    for trade in trades:
        by_market[(trade["pool"], trade["base_mint"], trade["quote_mint"])].append(trade)
    markets = []
    for (pool, base, quote), rows in sorted(by_market.items()):
        require(len({(t["base_decimals"], t["quote_decimals"]) for t in rows}) == 1, "MARKET_DECIMALS_CONFLICT")
        prices = [price(t) for t in rows]
        markets.append({"pool": pool, "base_mint": base, "quote_mint": quote,
                        "base_decimals": rows[0]["base_decimals"], "quote_decimals": rows[0]["quote_decimals"],
                        "trade_count": len(rows), "base_volume_atoms": sum(t["base_atoms"] for t in rows),
                        "quote_volume_atoms": sum(t["quote_atoms"] for t in rows),
                        "open": fraction(prices[0]), "high": fraction(max(prices)),
                        "low": fraction(min(prices)), "close": fraction(prices[-1])})
    return {"protocol": "AAI_RECORDED_TRADE_TAPE_V1", "classification": archive["classification"],
            "archive_sha256": digest(archive), "decoder_policy": POLICY,
            "requested_start_slot": archive["requested_start_slot"],
            "requested_end_slot": archive["requested_end_slot"], "skipped_slots": skipped,
            "captured_block_count": len(blocks), "transactions": transaction_records,
            "trades": trades, "markets": markets, "other_or_unmapped_cpi_events": other_events,
            "known_fee_lamports": sum(t["fee_lamports"] for t in transaction_records if t["fee_lamports"] is not None),
            "unknown_fee_count": sum(t["fee_lamports"] is None for t in transaction_records),
            "failed_transaction_count": sum(t["success"] is False for t in transaction_records),
            "unknown_result_count": sum(t["success"] is None for t in transaction_records),
            "coverage": "BOUNDED_FINALIZED_BLOCK_WINDOW_NOT_TOKEN_LIFECYCLE",
            "trust": "SINGLE_RPC_ASSERTION_NOT_INDEPENDENTLY_ATTESTED",
            "historical_observer_availability_known": False, "execution_quotes_available": False,
            "market_validation_established": False, "live_execution_allowed": False}


def replay(tape, *, alias_salt, max_events=None):
    require(tape.get("protocol") == "AAI_RECORDED_TRADE_TAPE_V1", "TAPE_PROTOCOL")
    require(type(alias_salt) is str and len(alias_salt) == 64
            and all(c in "0123456789abcdef" for c in alias_salt), "ALIAS_SALT")
    rows = tape["trades"]
    count = len(rows) if max_events is None else integer(max_events, 0, len(rows))
    history, events, previous = defaultdict(list), [], "0" * 64
    for trade in rows[:count]:
        market = (trade["pool"], trade["base_mint"], trade["quote_mint"])
        past = history[market]
        current_price = price(trade)
        previous_price = price(past[-1]) if past else current_price
        trailing = max(-1.0, min(1.0, float(current_price / previous_price - 1)))
        event = {"type": "OBSERVED_EXECUTED_TRADE",
                 "alias": "sim_" + digest([alias_salt, trade["base_mint"]])[:16],
                 "market_alias": "pool_" + digest([alias_salt, list(market)])[:16],
                 "quote_alias": "quote_" + digest([alias_salt, trade["quote_mint"]])[:16],
                 "order": [trade["slot"], trade["transaction_index"],
                           trade["outer_instruction_index"], trade["inner_instruction_index"]],
                 "block_time": trade["block_time"], "side": trade["side"],
                 "base_atoms": trade["base_atoms"], "quote_atoms": trade["quote_atoms"],
                 "base_decimals": trade["base_decimals"], "quote_decimals": trade["quote_decimals"],
                 "observed_price": fraction(current_price), "trailing_price_change": trailing,
                 "execution": "OBSERVATION_ONLY_NO_SIMULATED_FILL"}
        item = {"previous_sha256": previous, "event": event}
        previous = digest(item)
        events.append({**item, "sha256": previous})
        past.append(trade)
    return {"protocol": "AAI_ANONYMOUS_TRADE_REPLAY_V1", "classification": tape["classification"],
            "ordering": "CANONICAL_LEDGER_ORDER_NOT_HISTORICAL_OBSERVER_LATENCY",
            "aliases": "PRESENTATION_ONLY_NOT_INDEPENDENT_BLINDING", "events": events,
            "head_sha256": previous, "live_execution_allowed": False}


def verify_outputs(directory):
    directory = Path(directory)
    archive, saved, plan, trace = [read(directory / name) for name in
                                  ("archive.json", "trade-tape.json", "replay-plan.json", "public-replay.json")]
    exact(plan, ("alias_salt",))
    tape = reconstruct(archive)
    require(canonical(saved) == canonical(tape), "RECONSTRUCTION_MISMATCH")
    require(canonical(trace) == canonical(replay(tape, alias_salt=plan["alias_salt"])), "REPLAY_MISMATCH")
    return {"verified": True, "classification": tape["classification"], "archive_sha256": digest(archive),
            "trade_count": len(tape["trades"]), "market_count": len(tape["markets"]),
            "transaction_count": len(tape["transactions"]), "live_execution_allowed": False}
