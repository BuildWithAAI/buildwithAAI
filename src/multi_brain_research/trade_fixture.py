"""Explicitly synthetic RPC-schema fixtures for AAI.fun learning tests."""
from __future__ import annotations

import base64
import hashlib
import random

from ..solana_research import coin_evidence as ev
from . import trade_learning as learning
from . import training_lab as lab


def address(label):
    return ev.b58encode(hashlib.sha256(str(label).encode()).digest())


def response(method, params, result, index):
    request = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    raw = ev.canonical({"jsonrpc": "2.0", "id": 1, "result": result}).encode()
    return {"request": request, "request_sha256": ev.digest(request),
            "received_at": f"2026-10-20T19:00:{index:02d}Z", "elapsed_ms": 10,
            "http_status": 200, "response_base64": base64.b64encode(raw).decode(),
            "response_sha256": ev.sha(raw), "error": None}


def raw_event(asset, quote):
    direction = 1 if asset % 2 == 0 else -1
    numbers = [1_790_000_000, 1_000_000, 99, 100, 200, 300, 400, quote,
               20, 2, 5, 1, quote + 2, quote + 3]
    return ((ev.BUY if direction > 0 else ev.SELL)
            + b"".join(n.to_bytes(8, "little", signed=i == 0) for i, n in enumerate(numbers))
            + b"".join(ev.b58decode(address(f"{kind}_{asset}"), 32)
                       for kind in ("pool", "user", "base_account", "quote_account"))
            + b"SYNTHETIC_OPAQUE_SUFFIX")


def transaction(asset, step, quote):
    keys = [ev.PROGRAM] + [address(f"{kind}_{asset}") for kind in
                          ("pool", "user", "base_account", "quote_account")]
    balances = [{"accountIndex": index, "mint": mint,
                 "uiTokenAmount": {"decimals": decimals, "amount": "10000000000"}}
                for index, mint, decimals in ((3, address(f"mint_{asset}"), 6), (4, address("quote_mint"), 9))]
    instructions = [{"programIdIndex": 0, "accounts": [1, 2, 3, 4], "stackHeight": 2,
                     "data": ev.b58encode(ev.EVENT_CPI + raw_event(asset, quote))}]
    if step == 7:
        instructions.append({**instructions[0],
                             "data": ev.b58encode(ev.EVENT_CPI + raw_event(asset, quote + 1000))})
    signature = hashlib.sha512(f"fixture:{asset}:{step}".encode()).digest()
    return {"version": 0,
            "transaction": {"signatures": [ev.b58encode(signature)],
                            "message": {"accountKeys": keys, "instructions": [
                                {"programIdIndex": 0, "accounts": [1, 2, 3, 4], "data": "1"}]}},
            "meta": {"err": None, "fee": 5000, "loadedAddresses": {"writable": [], "readonly": []},
                     "preTokenBalances": balances, "postTokenBalances": balances,
                     "innerInstructions": [{"index": 0, "instructions": instructions}], "logMessages": []}}


def archives():
    result = []
    for phase in range(3):
        start = (phase + 1) * 1000
        records = [response("getGenesisHash", [], ev.MAINNET_GENESIS, phase*10),
                   response("getSlot", [{"commitment": "finalized"}], start + 1, phase*10 + 1),
                   response("getBlocks", [start, start + 1, {"commitment": "finalized"}],
                            [start, start + 1], phase*10 + 2)]
        prices = {}
        for asset in range(phase*4, phase*4 + 4):
            generator, price = random.Random(8800 + asset), 20_000_000 + asset*100_000
            prices[asset] = []
            for step in range(32):
                price += (100_000 if asset % 2 == 0 else -100_000) + generator.randint(-10_000, 10_000)
                if asset % 4 == 2 and step == 20:
                    price //= 2
                prices[asset].append(price)
        for offset in range(2):
            slot = start + offset
            transactions = [transaction(asset, step, prices[asset][step])
                            for step in range(offset*16, offset*16 + 16)
                            for asset in range(phase*4, phase*4 + 4)]
            block = {"blockhash": address(f"block_{slot}"), "previousBlockhash": address(f"block_{slot - 1}"),
                     "parentSlot": slot - 1, "blockHeight": slot, "blockTime": 1_790_000_000 + slot,
                     "transactions": transactions}
            records.append(response("getBlock", [slot, {
                "commitment": "finalized", "encoding": "json", "transactionDetails": "full",
                "rewards": False, "maxSupportedTransactionVersion": 1}], block, phase*10 + 3 + offset))
        result.append({"protocol": "AAI_SOLANA_RAW_BLOCK_ARCHIVE_V1", "classification": "SYNTHETIC_FIXTURE",
                       "endpoint": ev.ENDPOINTS[0], "status": "COMPLETE", "error": None,
                       "requested_start_slot": start, "requested_end_slot": start + 1,
                       "capture_code_sha256": lab.digest("SYNTHETIC_SOURCE_SCHEMA_FIXTURE_ONLY"), "records": records})
    return result


def plan(data):
    sources = [item["archive_sha256"] for item in data["sources"]]
    return {"protocol": "AAI_TRADE_READOUT_PLAN_V1", "dataset_sha256": lab.digest(data),
            "horizon_transactions": 1, "max_horizon_slots": 2, "shuffle_seed": 718,
            "alias_salt": lab.digest("PUBLIC_SYNTHETIC_TRADE_ALIAS_SALT"),
            "splits": {part: [e["episode_id"] for e in data["episodes"] if e["source_archive_sha256"] == source]
                       for part, source in zip(lab.PARTS, sources, strict=True)},
            "epochs": 200, "learning_rate": 0.1, "l2": 0.001}


def demo():
    source = archives()
    data = learning.build_dataset(source)
    return source, data, plan(data)
