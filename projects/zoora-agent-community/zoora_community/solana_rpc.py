"""Bounded fixed-endpoint read-only RPC; provider assertions are not validator proofs."""

import hashlib
import http.client
import ssl
import threading
import time

from .validation import Problem, canonical, parse_json, wallet
from .wallet_proof import decode_base58

NETWORKS = {
    "solana:devnet": ("api.devnet.solana.com", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"),
    "solana:mainnet": ("api.mainnet.solana.com", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"),
}
MAX_RESPONSE = 262_144
SYSTEM_PROGRAM = "11111111111111111111111111111111"
BASE_FLAGS = ["SINGLE_RPC_SOURCE", "PROVIDER_REPORTED_FINALITY", "SUBSET_INSTRUCTION_PARSER",
              "NO_PAYMENT_ATTRIBUTION", "NOT_VALIDATOR_VERIFIED", "WALLET_PROOF_HISTORICAL"]


def network(value):
    if type(value) is not str or value not in NETWORKS:
        raise Problem(400, "UNSUPPORTED_NETWORK")
    return value


def transaction_signature(value):
    decode_base58(value, 64, "INVALID_TRANSACTION_SIGNATURE")
    return value


def unsigned(value):
    if type(value) is not int or not 0 <= value <= 2**64 - 1:
        raise Problem(502, "RPC_SCHEMA_REJECTED")
    return value


def empty_report(network_name, signature, state, flags):
    return {"network": network_name, "signature": signature, "state": state,
            "source": "https://" + NETWORKS[network_name][0], "slot": None,
            "observed_at_ms": None, "commitment": "finalized", "classification": "OBSERVED",
            "transformation_version": 1, "execution": "UNAVAILABLE", "fee_lamports": None,
            "related_to_agent": None, "native_balance_change_lamports": None,
            "native_transfer_instructions": [], "native_transfer_instruction_count": 0,
            "pnl": "UNAVAILABLE", "token_transfer_accounting": "UNAVAILABLE",
            "quality_flags": BASE_FLAGS + list(flags), "response_sha256": None,
            "missingness": ["slot", "block_time", "fee", "transaction_metadata"]}


def summarize(result, network_name, signature, address):
    report = empty_report(network_name, signature, "AVAILABLE", [])
    if result is None:
        report["state"] = "UNAVAILABLE"
        report["quality_flags"].append("NOT_FOUND_AT_FINALIZED_OR_OUTSIDE_PROVIDER_RETENTION")
        return report
    if type(result) is not dict or not (result.get("version") == "legacy" or type(result.get("version")) is int and result["version"] == 0):
        raise Problem(502, "RPC_SCHEMA_REJECTED")
    report["slot"] = str(unsigned(result.get("slot")))
    stamp = result.get("blockTime")
    if stamp is not None and (type(stamp) is not int or not 0 <= stamp <= 2**63 - 1):
        raise Problem(502, "RPC_SCHEMA_REJECTED")
    report["observed_at_ms"] = str(stamp * 1000) if stamp is not None else None
    transaction = result.get("transaction")
    if type(transaction) is not dict or type(transaction.get("signatures")) is not list or not transaction["signatures"]:
        raise Problem(502, "RPC_SCHEMA_REJECTED")
    if transaction["signatures"][0] != signature or len(transaction["signatures"]) > 64:
        raise Problem(502, "RPC_SIGNATURE_MISMATCH")
    for entry in transaction["signatures"]:
        transaction_signature(entry)
    message = transaction.get("message")
    if type(message) is not dict or type(message.get("accountKeys")) is not list or not 1 <= len(message["accountKeys"]) <= 256:
        raise Problem(502, "RPC_SCHEMA_REJECTED")
    keys = []
    for entry in message["accountKeys"]:
        if (type(entry) is not dict or type(entry.get("signer")) is not bool
                or type(entry.get("writable")) is not bool or entry.get("source") not in (None, "transaction", "lookupTable")):
            raise Problem(502, "RPC_SCHEMA_REJECTED")
        keys.append(wallet(entry.get("pubkey")))
    if len(keys) != len(set(keys)):
        raise Problem(502, "RPC_SCHEMA_REJECTED")
    report["related_to_agent"] = address in keys
    if not report["related_to_agent"]:
        report["quality_flags"].append("UNRELATED_TO_AGENT")
    meta = result.get("meta")
    if meta is None:
        report["state"] = "UNVERIFIED"
        report["quality_flags"].append("TRANSACTION_METADATA_UNAVAILABLE")
        report["missingness"] = ["fee", "execution", "balances", "inner_instructions"]
        if stamp is None:
            report["missingness"].append("block_time")
        return report
    if type(meta) is not dict or "err" not in meta or (meta["err"] is not None and type(meta["err"]) not in (str, dict)):
        raise Problem(502, "RPC_SCHEMA_REJECTED")
    report["execution"] = "SUCCEEDED" if meta["err"] is None else "FAILED"
    report["fee_lamports"] = str(unsigned(meta.get("fee")))
    before, after = meta.get("preBalances"), meta.get("postBalances")
    if type(before) is not list or type(after) is not list or len(before) != len(keys) or len(after) != len(keys):
        raise Problem(502, "RPC_SCHEMA_REJECTED")
    before, after = [unsigned(x) for x in before], [unsigned(x) for x in after]
    if address in keys:
        index = keys.index(address)
        report["native_balance_change_lamports"] = str(after[index] - before[index])
    instructions = message.get("instructions")
    if type(instructions) is not list or len(instructions) > 256:
        raise Problem(502, "RPC_SCHEMA_REJECTED")
    work = [("OUTER", index, item) for index, item in enumerate(instructions)]
    inner = meta.get("innerInstructions")
    missing = ["block_time"] if stamp is None else []
    if inner is None:
        missing.append("inner_instructions")
    else:
        if type(inner) is not list or len(inner) > len(instructions):
            raise Problem(502, "RPC_SCHEMA_REJECTED")
        seen = set()
        for group in inner:
            if type(group) is not dict or type(group.get("index")) is not int or not 0 <= group["index"] < len(instructions) or group["index"] in seen:
                raise Problem(502, "RPC_SCHEMA_REJECTED")
            seen.add(group["index"])
            items = group.get("instructions")
            if type(items) is not list or len(items) > 256 or len(work) + len(items) > 1024:
                raise Problem(502, "RPC_SCHEMA_REJECTED")
            work.extend(("INNER", group["index"], item) for item in items)
    unsupported = False
    for scope, index, instruction in work:
        if type(instruction) is not dict:
            raise Problem(502, "RPC_SCHEMA_REJECTED")
        program_id = wallet(instruction.get("programId"))
        if program_id not in keys:
            raise Problem(502, "RPC_SCHEMA_REJECTED")
        parsed = instruction.get("parsed")
        if (program_id != SYSTEM_PROGRAM or type(parsed) is not dict
                or parsed.get("type") not in ("transfer", "transferWithSeed")):
            unsupported = True
            continue
        info = parsed.get("info")
        if type(info) is not dict:
            raise Problem(502, "RPC_SCHEMA_REJECTED")
        source, destination = wallet(info.get("source")), wallet(info.get("destination"))
        if source not in keys or destination not in keys:
            raise Problem(502, "RPC_SCHEMA_REJECTED")
        report["native_transfer_instructions"].append({"scope": scope, "outer_index": index,
            "source": source, "destination": destination, "lamports": str(unsigned(info.get("lamports"))),
            "classification": "DERIVED", "settlement": "RPC_REPORTED_SUCCESS" if meta["err"] is None else "NOT_SETTLED"})
    if unsupported:
        report["quality_flags"].append("UNSUPPORTED_INSTRUCTIONS_PRESERVED_IN_RAW_RPC")
    if meta["err"] is not None:
        report["quality_flags"].append("FAILED_TRANSACTION_INSTRUCTIONS_NOT_SETTLED")
    report["missingness"] = missing
    report["native_transfer_instruction_count"] = len(report["native_transfer_instructions"])
    return report


class SolanaRPC:
    def __init__(self):
        self.workers = threading.BoundedSemaphore(4)

    def _request(self, network_name, method, params, deadline):
        if method not in ("getGenesisHash", "getTransaction", "getSignaturesForAddress"):
            raise Problem(400, "READ_ONLY_RPC_METHOD_REQUIRED")
        host = NETWORKS[network_name][0]
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise Problem(504, "RPC_TIMEOUT")
        connection = http.client.HTTPSConnection(host, timeout=min(3, remaining), context=ssl.create_default_context())
        try:
            connection.request("POST", "/", canonical({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}),
                               {"Content-Type": "application/json", "Accept": "application/json", "Accept-Encoding": "identity"})
            transport_socket = connection.sock
            response = connection.getresponse()
            if response.status != 200:
                raise Problem(502, "RPC_RATE_LIMITED" if response.status == 429 else "RPC_HTTP_FAILED")
            if response.getheader("Content-Encoding") not in (None, "identity"):
                raise Problem(502, "RPC_ENCODING_REJECTED")
            if (response.getheader("Content-Type") or "").split(";", 1)[0].strip().lower() != "application/json":
                raise Problem(502, "RPC_ENCODING_REJECTED")
            data = bytearray()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise Problem(504, "RPC_TIMEOUT")
                if transport_socket is not None:
                    transport_socket.settimeout(min(3, remaining))
                chunk = response.read1(min(8192, MAX_RESPONSE + 1 - len(data)))
                data.extend(chunk)
                if len(data) > MAX_RESPONSE:
                    raise Problem(502, "RPC_RESPONSE_TOO_LARGE")
                if not chunk:
                    break
            if time.monotonic() >= deadline:
                raise Problem(504, "RPC_TIMEOUT")
            # Same strict duplicate/non-finite JSON rules as client inputs, with
            # a larger read-only provider envelope limit.
            payload = parse_json(bytes(data), maximum=MAX_RESPONSE)
            if payload.get("jsonrpc") != "2.0" or type(payload.get("id")) is not int or payload["id"] != 1 or ("error" in payload) == ("result" in payload):
                raise Problem(502, "RPC_ENVELOPE_REJECTED")
            if "error" in payload:
                raise Problem(502, "RPC_PROVIDER_ERROR")
            return payload["result"], bytes(data).decode("utf-8"), hashlib.sha256(data).hexdigest()
        except TimeoutError:
            raise Problem(504, "RPC_TIMEOUT") from None
        except (OSError, http.client.HTTPException):
            raise Problem(502, "RPC_UNAVAILABLE") from None
        finally:
            connection.close()

    def observe(self, network_name, signature, address):
        network(network_name)
        transaction_signature(signature)
        wallet(address)
        if not self.workers.acquire(blocking=False):
            return empty_report(network_name, signature, "FAILED", ["RPC_CAPACITY_LIMIT"]), None
        try:
            deadline = time.monotonic() + 8
            genesis, _genesis_raw, genesis_digest = self._request(network_name, "getGenesisHash", [], deadline)
            if genesis != NETWORKS[network_name][1]:
                raise Problem(502, "RPC_NETWORK_MISMATCH")
            result, raw, digest = self._request(network_name, "getTransaction",
                [signature, {"encoding": "jsonParsed", "commitment": "finalized", "maxSupportedTransactionVersion": 0}], deadline)
            report = summarize(result, network_name, signature, address)
            report.update({"response_sha256": digest, "genesis_response_sha256": genesis_digest,
                           "genesis_hash": genesis})
            return report, raw
        except Problem as problem:
            state = "UNVERIFIED" if problem.code in {"RPC_NETWORK_MISMATCH", "RPC_SCHEMA_REJECTED", "RPC_SIGNATURE_MISMATCH",
                "RPC_ENVELOPE_REJECTED", "INVALID_WALLET_ADDRESS", "INVALID_TRANSACTION_SIGNATURE", "INVALID_JSON", "DUPLICATE_JSON_FIELD"} else "FAILED"
            return empty_report(network_name, signature, state, [problem.code]), None
        finally:
            self.workers.release()
