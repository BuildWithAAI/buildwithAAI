"""Fail-closed verification of one finalized AAI token payment; never activates access."""

import re

from .solana_rpc import transaction_signature, unsigned
from .validation import Problem, wallet

TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
MAX_ACCOUNTS = 256
MAX_INSTRUCTIONS = 1024
ORDER_MEMO = re.compile(r"ZOORA-MEMBER-[A-Za-z0-9_-]{22,64}\Z")
RAW_AMOUNT = re.compile(r"[1-9][0-9]{0,19}\Z")


def _chain_wallet(value):
    try:
        return wallet(value)
    except Problem:
        raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED") from None


def _chain_signature(value):
    try:
        return transaction_signature(value)
    except Problem:
        raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED") from None


def payment_request(signature, payer, recipient, mint, amount_raw, decimals, memo,
                    quote_created_at, quote_expires_at):
    transaction_signature(signature)
    for address in (payer, recipient, mint):
        wallet(address)
    if payer == recipient:
        raise Problem(400, "PAYMENT_PARTIES_MUST_DIFFER")
    if type(amount_raw) is not str or not RAW_AMOUNT.fullmatch(amount_raw):
        raise Problem(400, "PAYMENT_AMOUNT_REJECTED")
    amount = int(amount_raw)
    if amount > 2**64 - 1:
        raise Problem(400, "PAYMENT_AMOUNT_REJECTED")
    if type(decimals) is not int or not 0 <= decimals <= 18:
        raise Problem(400, "PAYMENT_DECIMALS_REJECTED")
    if type(memo) is not str or not ORDER_MEMO.fullmatch(memo):
        raise Problem(400, "PAYMENT_ORDER_MEMO_REJECTED")
    for value in (quote_created_at, quote_expires_at):
        if type(value) is not int or not 0 <= value <= 2**63 - 1:
            raise Problem(400, "PAYMENT_QUOTE_TIME_REJECTED")
    if not quote_created_at < quote_expires_at or quote_expires_at - quote_created_at > 86_400:
        raise Problem(400, "PAYMENT_QUOTE_TIME_REJECTED")
    return {"signature": signature, "payer": payer, "recipient": recipient, "mint": mint,
            "amount_raw": amount_raw, "amount": amount, "decimals": decimals, "memo": memo,
            "quote_created_at": quote_created_at, "quote_expires_at": quote_expires_at}


def _parsed_instructions(result):
    transaction = result.get("transaction")
    if type(transaction) is not dict:
        raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
    message = transaction.get("message")
    if type(message) is not dict:
        raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
    raw_keys = message.get("accountKeys")
    if type(raw_keys) is not list or not 1 <= len(raw_keys) <= MAX_ACCOUNTS:
        raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
    keys, key_info = [], {}
    for entry in raw_keys:
        if (type(entry) is not dict or type(entry.get("signer")) is not bool
                or type(entry.get("writable")) is not bool
                or entry.get("source") not in ("transaction", "lookupTable")):
            raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
        address = _chain_wallet(entry.get("pubkey"))
        if address in key_info:
            raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
        keys.append(address)
        key_info[address] = entry

    instructions = message.get("instructions")
    if type(instructions) is not list or len(instructions) > MAX_INSTRUCTIONS:
        raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
    inner = result.get("meta", {}).get("innerInstructions")
    if type(inner) is not list or len(inner) > len(instructions):
        raise Problem(502, "PAYMENT_INNER_INSTRUCTIONS_UNAVAILABLE")
    flattened = []
    for index, instruction in enumerate(instructions):
        flattened.append(("outer", index, instruction))
    inner_count = 0
    seen_outer = set()
    for group in inner:
        if type(group) is not dict or type(group.get("index")) is not int:
            raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
        outer_index = group["index"]
        nested = group.get("instructions")
        if (not 0 <= outer_index < len(instructions) or outer_index in seen_outer
                or type(nested) is not list):
            raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
        seen_outer.add(outer_index)
        inner_count += len(nested)
        if inner_count > MAX_INSTRUCTIONS:
            raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
        for index, instruction in enumerate(nested):
            flattened.append(("inner", (outer_index, index), instruction))
    return keys, key_info, flattened


def _transaction_balances(meta, keys, mint, decimals):
    before, after = {}, {}
    for field, target in (("preTokenBalances", before),
                          ("postTokenBalances", after)):
        rows = meta.get(field)
        if type(rows) is not list or len(rows) > MAX_ACCOUNTS:
            raise Problem(502, "PAYMENT_TOKEN_BALANCES_UNAVAILABLE")
        for row in rows:
            if type(row) is not dict:
                raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
            index = row.get("accountIndex")
            if type(index) is not int or not 0 <= index < len(keys):
                raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
            row_mint = _chain_wallet(row.get("mint"))
            if row_mint != mint:
                continue
            owner = _chain_wallet(row.get("owner"))
            if row.get("programId") != TOKEN_PROGRAM:
                if row.get("programId") == TOKEN_2022_PROGRAM:
                    raise Problem(422, "PAYMENT_TOKEN_2022_UNSUPPORTED")
                raise Problem(502, "PAYMENT_TOKEN_PROGRAM_REJECTED")
            ui_amount = row.get("uiTokenAmount")
            if type(ui_amount) is not dict:
                raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
            raw = ui_amount.get("amount")
            row_decimals = ui_amount.get("decimals")
            if (type(raw) is not str or not re.fullmatch(r"(?:0|[1-9][0-9]{0,19})", raw)
                    or type(row_decimals) is not int or not 0 <= row_decimals <= 18
                    or row_decimals != decimals or int(raw) > 2**64 - 1):
                raise Problem(502, "PAYMENT_TOKEN_BALANCE_REJECTED")
            if index in target:
                raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
            target[index] = {"owner": owner, "amount": int(raw)}
    return before, after


def verify_payment(result, *, finalized_slot, **request):
    """Verify provider-reported finalized transaction evidence against an exact quote."""
    quote = payment_request(**request)
    finalized_slot = unsigned(finalized_slot)
    if result is None:
        raise Problem(404, "PAYMENT_TRANSACTION_NOT_FOUND_AT_FINALIZED")
    if type(result) is not dict:
        raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
    version = result.get("version")
    if not (version == "legacy" or type(version) is int and version in (0, 1)):
        raise Problem(502, "PAYMENT_TRANSACTION_VERSION_UNSUPPORTED")
    slot = unsigned(result.get("slot"))
    if slot > finalized_slot:
        raise Problem(502, "PAYMENT_SLOT_NOT_FINALIZED")
    block_time = result.get("blockTime")
    if type(block_time) is not int or not 0 <= block_time <= 2**63 - 1:
        raise Problem(422, "PAYMENT_BLOCK_TIME_UNAVAILABLE")
    if not quote["quote_created_at"] <= block_time <= quote["quote_expires_at"]:
        raise Problem(422, "PAYMENT_OUTSIDE_QUOTE_WINDOW")
    meta = result.get("meta")
    if type(meta) is not dict or meta.get("err", object()) is not None:
        raise Problem(422, "PAYMENT_TRANSACTION_FAILED_OR_UNVERIFIED")
    transaction = result.get("transaction")
    if type(transaction) is not dict:
        raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
    signatures = transaction.get("signatures")
    if type(signatures) is not list or not 1 <= len(signatures) <= 64:
        raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
    for entry in signatures:
        _chain_signature(entry)
    if signatures[0] != quote["signature"]:
        raise Problem(502, "PAYMENT_SIGNATURE_MISMATCH")
    keys, key_info, instructions = _parsed_instructions(result)
    if quote["payer"] not in key_info or not key_info[quote["payer"]]["signer"]:
        raise Problem(422, "PAYMENT_PAYER_SIGNATURE_MISSING")

    memo_instructions, transfers = [], []
    for location, position, instruction in instructions:
        if type(instruction) is not dict:
            raise Problem(502, "PAYMENT_TRANSACTION_SCHEMA_REJECTED")
        program_id = instruction.get("programId")
        if program_id == MEMO_PROGRAM:
            parsed = instruction.get("parsed")
            if type(parsed) is not str:
                raise Problem(502, "PAYMENT_MEMO_UNPARSED")
            memo_instructions.append((location, position, parsed))
        if program_id in (TOKEN_PROGRAM, TOKEN_2022_PROGRAM):
            parsed = instruction.get("parsed")
            if type(parsed) is not dict or type(parsed.get("type")) is not str:
                raise Problem(502, "PAYMENT_TOKEN_INSTRUCTION_UNPARSED")
            if parsed["type"] in ("transfer", "transferChecked", "transferCheckedWithFee"):
                transfers.append((location, position, program_id, parsed))
    if len(memo_instructions) != 1 or memo_instructions[0][2] != quote["memo"]:
        raise Problem(422, "PAYMENT_ORDER_MEMO_MISMATCH")
    if len(transfers) != 1:
        raise Problem(422, "PAYMENT_TRANSFER_AMBIGUOUS")
    location, position, program_id, parsed = transfers[0]
    if location != "outer" or program_id != TOKEN_PROGRAM or parsed["type"] not in ("transfer", "transferChecked"):
        raise Problem(422, "PAYMENT_TRANSFER_UNSUPPORTED")
    memo_location, memo_position, _memo = memo_instructions[0]
    if memo_location != "outer" or position != memo_position + 1:
        raise Problem(422, "PAYMENT_ORDER_MEMO_POSITION_REJECTED")
    info = parsed.get("info")
    if type(info) is not dict:
        raise Problem(502, "PAYMENT_TRANSFER_SCHEMA_REJECTED")
    source = _chain_wallet(info.get("source"))
    destination = _chain_wallet(info.get("destination"))
    authority = _chain_wallet(info.get("authority"))
    if source == destination or authority != quote["payer"]:
        raise Problem(422, "PAYMENT_TRANSFER_AUTHORITY_REJECTED")
    if parsed["type"] == "transferChecked":
        if _chain_wallet(info.get("mint")) != quote["mint"]:
            raise Problem(422, "PAYMENT_MINT_MISMATCH")
        token_amount = info.get("tokenAmount")
        if (type(token_amount) is not dict or token_amount.get("amount") != quote["amount_raw"]
                or type(token_amount.get("decimals")) is not int
                or token_amount["decimals"] != quote["decimals"]):
            raise Problem(422, "PAYMENT_AMOUNT_MISMATCH")
    else:
        raw_amount = info.get("amount")
        if type(raw_amount) is not str or raw_amount != quote["amount_raw"]:
            raise Problem(422, "PAYMENT_AMOUNT_MISMATCH")

    before, after = _transaction_balances(meta, keys, quote["mint"], quote["decimals"])
    key_to_index = {address: index for index, address in enumerate(keys)}
    if source not in key_to_index or destination not in key_to_index:
        raise Problem(502, "PAYMENT_TRANSFER_ACCOUNT_MISSING")
    source_index, destination_index = key_to_index[source], key_to_index[destination]
    source_pre, source_post = before.get(source_index), after.get(source_index)
    destination_pre, destination_post = before.get(destination_index), after.get(destination_index)
    if (source_pre is None or source_post is None or destination_post is None
            or source_pre["owner"] != quote["payer"] or source_post["owner"] != quote["payer"]
            or destination_post["owner"] != quote["recipient"]
            or destination_pre is not None and destination_pre["owner"] != quote["recipient"]):
        raise Problem(422, "PAYMENT_TOKEN_OWNER_MISMATCH")

    amount = quote["amount"]
    changes = {}
    for index in set(before) | set(after):
        delta = after.get(index, {"amount": 0})["amount"] - before.get(index, {"amount": 0})["amount"]
        if delta:
            changes[index] = delta
    if (changes.get(source_index) != -amount or changes.get(destination_index) != amount
            or any(index not in (source_index, destination_index) for index in changes)
            or sum(changes.values()) != 0):
        raise Problem(422, "PAYMENT_TOKEN_DELTAS_MISMATCH")
    fee = unsigned(meta.get("fee"))
    return {"signature": quote["signature"], "slot": str(slot), "block_time_unix_seconds": block_time,
            "finalized_slot_observed": str(finalized_slot), "payer": quote["payer"],
            "recipient": quote["recipient"], "mint": quote["mint"],
            "token_program_id": TOKEN_PROGRAM, "amount_raw": quote["amount_raw"],
            "decimals": quote["decimals"], "memo": quote["memo"],
            "quote_created_at_unix_seconds": quote["quote_created_at"],
            "quote_expires_at_unix_seconds": quote["quote_expires_at"],
            "transaction_fee_lamports": str(fee), "execution": "SUCCEEDED",
            "finality": "PROVIDER_REPORTED_FINALIZED", "token_transfer_count": 1,
            "quote_window_checked": True, "receipt_key": "solana:mainnet:" + quote["signature"],
            "receipt_deduplication": "DOWNSTREAM_DURABLE_UNIQUE_CONSTRAINT_REQUIRED",
            "membership_activated": False, "fulfillment_authorized": False,
            "burn_verified": False, "lp_deposit_verified": False,
            "quality_flags": ["SINGLE_RPC_SOURCE", "PROVIDER_REPORTED_FINALITY",
                              "EXACT_MINT_AND_RAW_AMOUNT", "TOKEN_2022_AND_TRANSFER_FEES_UNSUPPORTED",
                              "PAYMENT_EVIDENCE_ONLY"]}
