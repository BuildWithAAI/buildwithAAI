"""Explicit real-service reads. No fixture fallback, payment writes, or wallet keys."""

import argparse
import hashlib
import http.client
from http.client import HTTPSConnection
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import sys
import time

from . import VERSION
from .bridge_preflight import customer_observation
from .bridge_sandbox import KEY, provider_id
from .solana_rpc import NETWORKS, transaction_signature, unsigned
from .solana_payment_verifier import payment_request, verify_payment
from .store import exclusive_file, now_ms
from .validation import Problem, canonical, matching, parse_json, wallet

BRIDGE_HOSTS = {"production": "api.bridge.xyz", "sandbox": "api.sandbox.bridge.xyz"}
MAX_RESPONSE = 262_144
REQUEST_SECONDS = 10
READ_METHODS = {"getGenesisHash", "getSlot", "getBalance", "getTransaction"}


def read_api_key(path, environment):
    """Read a private header value; production key syntax is not vendor-attested."""
    if environment not in BRIDGE_HOSTS:
        raise Problem(400, "CONNECTION_ENVIRONMENT_REJECTED")
    path = Path(path)
    try:
        before = path.lstat()
        if (not stat.S_ISREG(before.st_mode) or not 16 <= before.st_size <= 258
                or os.name == "posix" and (stat.S_IMODE(before.st_mode) & 0o077
                                           or before.st_uid != os.getuid())):
            raise Problem(400, "CONNECTION_UNSAFE_KEY_FILE")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                             | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(descriptor, "rb") as source:
            opened = os.fstat(source.fileno())
            if ((opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns)
                    != (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
                    or not stat.S_ISREG(opened.st_mode)
                    or os.name == "posix" and (stat.S_IMODE(opened.st_mode) & 0o077
                                               or opened.st_uid != os.getuid())):
                raise Problem(400, "CONNECTION_UNSAFE_KEY_FILE")
            raw = source.read(259)
            after = os.fstat(source.fileno())
        if (len(raw) != before.st_size or (after.st_size, after.st_mtime_ns)
                != (before.st_size, before.st_mtime_ns)):
            raise Problem(400, "CONNECTION_UNSAFE_KEY_FILE")
        key = raw.decode("ascii").removesuffix("\n").removesuffix("\r")
    except (OSError, UnicodeError):
        raise Problem(400, "CONNECTION_KEY_UNAVAILABLE") from None
    matching(key, re.compile(r"[\x21-\x7e]{16,256}\Z"), "CONNECTION_KEY_FORMAT_REJECTED")
    if environment == "sandbox":
        matching(key, KEY, "BRIDGE_SANDBOX_KEY_REQUIRED")
    elif key.startswith("sk-test"):
        raise Problem(400, "CONNECTION_TEST_KEY_ON_PRODUCTION")
    return key


def request_json(host, method, path, *, payload=None, api_key=None):
    """Only four fixed RPC reads and an exact-customer GET can cross this boundary."""
    rpc = host in {value[0] for value in NETWORKS.values()}
    if rpc:
        if (method != "POST" or path != "/" or api_key is not None
                or type(payload) is not dict
                or set(payload) != {"jsonrpc", "id", "method", "params"}
                or payload["jsonrpc"] != "2.0" or type(payload["id"]) is not int
                or payload["id"] != 1 or type(payload["method"]) is not str
                or payload["method"] not in READ_METHODS):
            raise Problem(400, "CONNECTION_OPERATION_REJECTED")
        name, params = payload["method"], payload["params"]
        if name == "getGenesisHash":
            valid = params == []
        elif name == "getSlot":
            valid = params == [{"commitment": "finalized"}]
        elif name == "getTransaction":
            valid = (type(params) is list and len(params) == 2
                     and type(params[1]) is dict
                     and params[1] == {"commitment": "finalized", "encoding": "jsonParsed",
                                       "maxSupportedTransactionVersion": 1})
            if valid:
                transaction_signature(params[0])
        else:
            valid = (type(params) is list and len(params) == 2
                     and params[1] == {"commitment": "finalized"})
            if valid:
                wallet(params[0])
        if not valid:
            raise Problem(400, "CONNECTION_OPERATION_REJECTED")
    elif host in BRIDGE_HOSTS.values():
        if (method != "GET" or payload is not None or type(path) is not str
                or not path.startswith("/v0/customers/") or type(api_key) is not str):
            raise Problem(400, "CONNECTION_OPERATION_REJECTED")
        provider_id(path.removeprefix("/v0/customers/"))
        matching(api_key, re.compile(r"[\x21-\x7e]{16,256}\Z"), "CONNECTION_KEY_FORMAT_REJECTED")
        if host == BRIDGE_HOSTS["sandbox"]:
            matching(api_key, KEY, "BRIDGE_SANDBOX_KEY_REQUIRED")
        elif api_key.startswith("sk-test"):
            raise Problem(400, "CONNECTION_TEST_KEY_ON_PRODUCTION")
    else:
        raise Problem(400, "CONNECTION_HOST_REJECTED")

    deadline = time.monotonic() + REQUEST_SECONDS
    connection = HTTPSConnection(host, timeout=3, context=ssl.create_default_context())
    response = None
    try:
        headers = {"Accept": "application/json", "Accept-Encoding": "identity"}
        if api_key is not None:
            headers["Api-Key"] = api_key
        if payload is not None:
            headers["Content-Type"] = "application/json"
        connection.request(method, path, None if payload is None else canonical(payload).encode(), headers)
        response = connection.getresponse()
        # HTTP/1.0 detaches/closes the socket object; the response file retains
        # its original three-second timeout. Never operate on that closed object.
        sock = connection.sock
        if response.status != 200:
            raise Problem(502, f"CONNECTION_HTTP_{response.status}")
        if ((response.getheader("Content-Type") or "").split(";", 1)[0].strip().lower()
                != "application/json" or response.getheader("Content-Encoding") not in (None, "identity")):
            raise Problem(502, "CONNECTION_ENCODING_REJECTED")
        declared = response.getheader("Content-Length")
        if declared is not None:
            if not re.fullmatch(r"[0-9]{1,9}", declared):
                raise Problem(502, "CONNECTION_LENGTH_REJECTED")
            declared = int(declared)
            if declared > MAX_RESPONSE:
                raise Problem(502, "CONNECTION_RESPONSE_TOO_LARGE")
        raw = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise Problem(504, "CONNECTION_TIMEOUT")
            if sock is not None:
                sock.settimeout(min(3, remaining))
            chunk = response.read1(min(8192, MAX_RESPONSE + 1 - len(raw)))
            raw.extend(chunk)
            if len(raw) > MAX_RESPONSE:
                raise Problem(502, "CONNECTION_RESPONSE_TOO_LARGE")
            if not chunk:
                break
        if time.monotonic() >= deadline:
            raise Problem(504, "CONNECTION_TIMEOUT")
        if declared is not None and len(raw) != declared:
            raise Problem(502, "CONNECTION_LENGTH_REJECTED")
        try:
            value = parse_json(bytes(raw), MAX_RESPONSE)
        except Problem:
            raise Problem(502, "CONNECTION_JSON_REJECTED") from None
        return value, hashlib.sha256(raw).hexdigest()
    except ssl.SSLError:
        raise Problem(502, "CONNECTION_TLS_FAILED") from None
    except socket.gaierror:
        raise Problem(502, "CONNECTION_DNS_FAILED") from None
    except TimeoutError:
        raise Problem(504, "CONNECTION_TIMEOUT") from None
    except (OSError, http.client.HTTPException):
        raise Problem(502, "CONNECTION_NETWORK_FAILED") from None
    finally:
        if response is not None:
            response.close()
        connection.close()


def solana_read(network_name, address=None):
    if network_name not in NETWORKS:
        raise Problem(400, "UNSUPPORTED_NETWORK")
    if address is not None:
        wallet(address)
    host, expected_genesis = NETWORKS[network_name]
    observations = []

    def read(method, params):
        value, digest = request_json(host, "POST", "/", payload={
            "jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        if (type(value) is not dict or value.get("jsonrpc") != "2.0"
                or type(value.get("id")) is not int or value["id"] != 1
                or "error" in value or "result" not in value):
            raise Problem(502, "CONNECTION_RPC_RESPONSE_REJECTED")
        observations.append({"method": method, "response_sha256": digest})
        return value["result"]

    genesis = read("getGenesisHash", [])
    if genesis != expected_genesis:
        raise Problem(502, "CONNECTION_WRONG_SOLANA_CLUSTER")
    slot = unsigned(read("getSlot", [{"commitment": "finalized"}]))
    balance = None
    if address is not None:
        result = read("getBalance", [address, {"commitment": "finalized"}])
        if type(result) is not dict or type(result.get("context")) is not dict:
            raise Problem(502, "CONNECTION_BALANCE_REJECTED")
        balance_slot = unsigned(result["context"].get("slot"))
        if balance_slot < slot:
            raise Problem(502, "CONNECTION_SLOT_REGRESSION")
        balance = {"wallet": address, "lamports": str(unsigned(result.get("value"))),
                   "context_slot": str(balance_slot)}
    return {"network": network_name, "endpoint_host": host, "genesis_hash": genesis,
            "finalized_slot": str(slot), "native_balance": balance,
            "observations": observations, "classification": "EXTERNAL_RPC_OBSERVATION",
            "scope": "PUBLIC_CHAIN_READ_ONLY", "pnl": "UNAVAILABLE",
            "wallet_control_verified": False, "token_balances_verified": False,
            "quality_flags": ["SINGLE_RPC_SOURCE", "PROVIDER_REPORTED_FINALITY",
                              "POINT_IN_TIME_NOT_CONTINUOUS_MONITORING"]}


def solana_payment_read(**request):
    """Read one Mainnet transaction and compare it with an exact membership quote."""
    request = payment_request(**request)
    host, expected_genesis = NETWORKS["solana:mainnet"]
    observations = []

    def read(method, params):
        value, digest = request_json(host, "POST", "/", payload={
            "jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        if (type(value) is not dict or value.get("jsonrpc") != "2.0"
                or type(value.get("id")) is not int or value["id"] != 1
                or "error" in value or "result" not in value):
            raise Problem(502, "CONNECTION_RPC_RESPONSE_REJECTED")
        observations.append({"method": method, "response_sha256": digest})
        return value["result"]

    genesis = read("getGenesisHash", [])
    if genesis != expected_genesis:
        raise Problem(502, "CONNECTION_WRONG_SOLANA_CLUSTER")
    finalized_slot = unsigned(read("getSlot", [{"commitment": "finalized"}]))
    transaction = read("getTransaction", [request.get("signature"), {
        "commitment": "finalized", "encoding": "jsonParsed",
        "maxSupportedTransactionVersion": 1}])
    receipt = verify_payment(
        transaction, finalized_slot=finalized_slot, signature=request["signature"],
        payer=request["payer"], recipient=request["recipient"], mint=request["mint"],
        amount_raw=request["amount_raw"], decimals=request["decimals"], memo=request["memo"],
        quote_created_at=request["quote_created_at"], quote_expires_at=request["quote_expires_at"])
    return {"network": "solana:mainnet", "endpoint_host": host,
            "genesis_hash": genesis, "finalized_slot": str(finalized_slot),
            "payment": receipt, "observations": observations,
            "classification": "EXTERNAL_PAYMENT_RECEIPT", "scope": "MAINNET_CHAIN_READ_ONLY",
            "wallet_control_verified": False, "membership_activated": False,
            "fulfillment_authorized": False, "payment_writes": 0,
            "live_launch_ready": False,
            "quality_flags": ["SINGLE_RPC_SOURCE", "PROVIDER_REPORTED_FINALITY",
                              "PAYMENT_EVIDENCE_ONLY", "NO_AUTOMATIC_FULFILLMENT"]}


def bridge_read(environment, customer_id, key_file):
    if environment not in BRIDGE_HOSTS:
        raise Problem(400, "CONNECTION_ENVIRONMENT_REJECTED")
    customer_id = provider_id(customer_id)
    key = read_api_key(key_file, environment)
    host, path = BRIDGE_HOSTS[environment], "/v0/customers/" + customer_id
    value, digest = request_json(host, "GET", path, api_key=key)
    return {**customer_observation(value, customer_id), "environment": environment,
            "endpoint_host": host, "method": "GET", "response_sha256": digest,
            "credential_sha256": hashlib.sha256(
                b"ZOORA_BRIDGE_READ_KEY_V1\0" + environment.encode() + b"\0" + key.encode()).hexdigest(),
            "account_read_verified": True, "payment_execution_ready": False}


def implementation_digest():
    root = Path(__file__).resolve().parent
    files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.glob("*.py"))}
    files["requirements.lock"] = hashlib.sha256((root.parent / "requirements.lock").read_bytes()).hexdigest()
    return hashlib.sha256(canonical(files).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description="Real external read checks; no simulated fallback or spending")
    sub = parser.add_subparsers(dest="command", required=True)
    solana = sub.add_parser("solana")
    solana.add_argument("--network", choices=tuple(NETWORKS), default="solana:mainnet")
    solana.add_argument("--wallet", help="Public address only; optional native SOL balance read")
    payment = sub.add_parser("solana-payment", help="Verify a finalized AAI membership payment; never fulfills it")
    payment.add_argument("--signature", required=True)
    payment.add_argument("--payer", required=True, help="Public wallet expected to have signed")
    payment.add_argument("--recipient", required=True, help="Exact treasury owner wallet from the approved quote")
    payment.add_argument("--mint", required=True, help="Exact official AAI mint; no ticker lookup or default")
    payment.add_argument("--amount-raw", required=True, help="Exact integer token base units from the quote")
    payment.add_argument("--decimals", required=True, type=int)
    payment.add_argument("--memo", required=True, help="Unique public quote memo, e.g. ZOORA-MEMBER-<random>")
    payment.add_argument("--quote-created-at", required=True, type=int, help="Quote issue time, Unix seconds")
    payment.add_argument("--quote-expires-at", required=True, type=int, help="Quote expiry, Unix seconds")
    bridge = sub.add_parser("bridge")
    bridge.add_argument("--environment", choices=tuple(BRIDGE_HOSTS), required=True)
    bridge.add_argument("--customer-id", required=True)
    bridge.add_argument("--key-file", type=Path, required=True)
    for command in (solana, payment, bridge):
        command.add_argument("--out", type=Path, required=True, help="New private report file; never overwritten")
    args = parser.parse_args()
    try:
        # Refuse an output conflict before touching credentials or the network.
        with exclusive_file(args.out) as output:
            report = {"protocol": "ZOORA_LIVE_CONNECTION_V1", "package_version": VERSION,
                      "implementation_sha256": implementation_digest(), "started_at_ms": now_ms(),
                      "connector": args.command, "state": "BLOCKED", "observation": None,
                      "target_environment": (args.network if args.command == "solana" else
                          "solana:mainnet" if args.command == "solana-payment" else args.environment),
                      "fixture_fallback": False, "wallet_execution": False,
                      "payment_writes": 0, "live_launch_ready": False}
            started = time.monotonic()
            try:
                if args.command == "solana":
                    value = solana_read(args.network, args.wallet)
                elif args.command == "solana-payment":
                    value = solana_payment_read(
                        signature=args.signature, payer=args.payer, recipient=args.recipient,
                        mint=args.mint, amount_raw=args.amount_raw, decimals=args.decimals,
                        memo=args.memo, quote_created_at=args.quote_created_at,
                        quote_expires_at=args.quote_expires_at)
                else:
                    value = bridge_read(args.environment, args.customer_id, args.key_file)
                report.update({"state": "PAYMENT_VERIFIED" if args.command == "solana-payment"
                               else "READ_VERIFIED", "observation": value})
                if args.command == "bridge" and value["assessment"] != "CUSTOMER_SIGNALS_OBSERVED":
                    report["state"] = "READ_VERIFIED_ACCOUNT_NOT_READY"
            except Problem as error:
                report["error"] = error.code
            report.update({"finished_at_ms": now_ms(),
                           "elapsed_ms": int((time.monotonic() - started) * 1000)})
            raw = (canonical(report) + "\n").encode()
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        print(canonical(report))
        return 0 if report["state"] in {"READ_VERIFIED", "PAYMENT_VERIFIED"} else 2
    except (Problem, OSError, ValueError):
        error = sys.exception()
        print(canonical({"error": error.code if isinstance(error, Problem)
                         else "CONNECTION_LOCAL_FAILURE"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
