"""Narrow Bridge sandbox transport. No production endpoint, signer or card data."""

import argparse
import hashlib
import http.client
from http.client import HTTPSConnection
import os
from pathlib import Path
import re
import ssl
import stat
import sys
import time
import uuid

from .validation import Problem, canonical, fields, identifier, matching, parse_json, wallet

HOST = "api.sandbox.bridge.xyz"
MAX_RESPONSE = 65_536
REQUEST_SECONDS = 10
KEY = re.compile(r"sk-test[A-Za-z0-9_-]{10,240}\Z")
AMOUNT = re.compile(r"(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,6}))?\Z")
STATE = re.compile(r"[a-z][a-z0-9_]{0,47}\Z")


def sha(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def provider_id(value):
    if type(value) is not str or len(value) != 36:
        raise Problem(400, "INVALID_BRIDGE_ID")
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        raise Problem(400, "INVALID_BRIDGE_ID") from None
    if str(parsed) != value:
        raise Problem(400, "INVALID_BRIDGE_ID")
    return value


def amount(value):
    matching(value, AMOUNT, "INVALID_BRIDGE_AMOUNT")
    whole, _, fraction = value.partition(".")
    units = int(whole) * 1_000_000 + int((fraction + "000000")[:6])
    if not 1 <= units <= 1_000_000_000_000:
        raise Problem(400, "INVALID_BRIDGE_AMOUNT")
    return f"{units // 1_000_000}.{units % 1_000_000:06d}"


def intent_value(value):
    fields(value, ("request_id", "customer_id", "source_address", "destination_address", "amount_usdc"))
    result = {"request_id": identifier(value["request_id"]), "customer_id": provider_id(value["customer_id"]),
              "source_address": wallet(value["source_address"]),
              "destination_address": wallet(value["destination_address"]), "amount_usdc": amount(value["amount_usdc"])}
    if result["source_address"] == result["destination_address"]:
        raise Problem(400, "BRIDGE_DISTINCT_ADDRESSES_REQUIRED")
    return result


def transfer_body(intent, reference):
    value = intent_value(intent)
    return {"on_behalf_of": value["customer_id"], "amount": value["amount_usdc"],
            "client_reference_id": provider_id(reference),
            "source": {"payment_rail": "solana", "currency": "usdc", "from_address": value["source_address"]},
            "destination": {"payment_rail": "solana", "currency": "usdc", "to_address": value["destination_address"]}}


def body_value(value):
    fields(value, ("on_behalf_of", "amount", "client_reference_id", "source", "destination"))
    fields(value["source"], ("payment_rail", "currency", "from_address"))
    fields(value["destination"], ("payment_rail", "currency", "to_address"))
    intent = {"request_id": "0" * 32, "customer_id": value["on_behalf_of"], "amount_usdc": value["amount"],
              "source_address": value["source"]["from_address"], "destination_address": value["destination"]["to_address"]}
    expected = transfer_body(intent, value["client_reference_id"])
    if expected != value:
        raise Problem(400, "INVALID_BRIDGE_BODY")
    return expected


def observation(value, body, expected_id=None):
    """Require exact returned terms; never infer settlement or expose deposit/card details."""
    try:
        transfer_id = provider_id(value.get("id"))
        if expected_id is not None and transfer_id != expected_id:
            raise ValueError("wrong transfer")
        if (value.get("on_behalf_of") != body["on_behalf_of"]
                or value.get("client_reference_id") != body["client_reference_id"]
                or amount(value.get("amount")) != body["amount"]):
            raise ValueError("wrong terms")
        for name in ("source", "destination"):
            if type(value.get(name)) is not dict or any(value[name].get(k) != v for k, v in body[name].items()):
                raise ValueError("wrong rail or address")
        state = matching(value.get("state"), STATE, "INVALID_BRIDGE_STATE")
    except (Problem, ValueError, KeyError, TypeError, AttributeError):
        raise Problem(502, "BRIDGE_RESPONSE_REJECTED") from None
    return {"id": transfer_id, "state": state, "body_sha256": sha(body)}


def read_key(path):
    path = Path(path)
    try:
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or not 16 <= info.st_size <= 256
                or os.name == "posix" and stat.S_IMODE(info.st_mode) & 0o077):
            raise Problem(400, "UNSAFE_BRIDGE_KEY_FILE")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as file:
            actual = os.fstat(file.fileno())
            if ((actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino)
                    or not stat.S_ISREG(actual.st_mode) or not 16 <= actual.st_size <= 256
                    or os.name == "posix" and stat.S_IMODE(actual.st_mode) & 0o077):
                raise Problem(400, "UNSAFE_BRIDGE_KEY_FILE")
            raw = file.read(257)
        key = raw.decode("ascii").rstrip("\r\n")
    except (OSError, UnicodeError):
        raise Problem(400, "BRIDGE_KEY_UNAVAILABLE") from None
    return matching(key, KEY, "BRIDGE_SANDBOX_KEY_REQUIRED")


class BridgeSandboxClient:
    def __init__(self, api_key):
        self._key = matching(api_key, KEY, "BRIDGE_SANDBOX_KEY_REQUIRED")

    @property
    def credential_fingerprint(self):
        return hashlib.sha256(b"ZOORA_BRIDGE_SANDBOX_KEY_V1\0" + self._key.encode()).hexdigest()

    def _request(self, method, path, body=None, idempotency_key=None):
        # No URL/base-host argument, environment override, proxy, redirect or generic path API.
        if not ((method == "POST" and path == "/v0/transfers" and body is not None and idempotency_key)
                or (method == "GET" and path.startswith("/v0/transfers/") and body is None and idempotency_key is None)):
            raise Problem(400, "BRIDGE_OPERATION_REJECTED")
        if method == "GET":
            provider_id(path.removeprefix("/v0/transfers/"))
        else:
            provider_id(idempotency_key)
            body_value(body)
            if idempotency_key != body["client_reference_id"]:
                raise Problem(400, "BRIDGE_REFERENCE_KEY_MISMATCH")
        deadline = time.monotonic() + REQUEST_SECONDS
        connection = HTTPSConnection(HOST, timeout=3, context=ssl.create_default_context())
        response = None
        try:
            headers = {"Api-Key": self._key, "Accept": "application/json", "Accept-Encoding": "identity"}
            if body is not None:
                headers.update({"Content-Type": "application/json", "Idempotency-Key": idempotency_key})
            connection.request(method, path, None if body is None else canonical(body).encode(), headers)
            response = connection.getresponse()
            # getresponse may detach/close the connection for HTTP/1.0 or Connection: close.
            # Its response file still owns the read socket with the initial timeout.
            sock = connection.sock
            if response.status not in ((200, 201) if method == "POST" else (200,)):
                raise Problem(502, f"BRIDGE_HTTP_{response.status}")
            if ((response.getheader("Content-Type") or "").split(";", 1)[0].strip().lower() != "application/json"
                    or response.getheader("Content-Encoding") not in (None, "identity")):
                raise Problem(502, "BRIDGE_ENCODING_REJECTED")
            declared = response.getheader("Content-Length")
            if declared is not None:
                if not re.fullmatch(r"[0-9]{1,9}", declared):
                    raise Problem(502, "BRIDGE_RESPONSE_REJECTED")
                declared = int(declared)
                if declared > MAX_RESPONSE:
                    raise Problem(502, "BRIDGE_RESPONSE_TOO_LARGE")
            raw = bytearray()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise Problem(504, "BRIDGE_TIMEOUT")
                if sock is not None:
                    sock.settimeout(min(3, remaining))
                chunk = response.read1(min(8192, MAX_RESPONSE + 1 - len(raw)))
                raw.extend(chunk)
                if len(raw) > MAX_RESPONSE:
                    raise Problem(502, "BRIDGE_RESPONSE_TOO_LARGE")
                if not chunk:
                    break
            if time.monotonic() >= deadline:
                raise Problem(504, "BRIDGE_TIMEOUT")
            if declared is not None and len(raw) != declared:
                raise Problem(502, "BRIDGE_RESPONSE_REJECTED")
            try:
                value = parse_json(bytes(raw), MAX_RESPONSE)
            except Problem:
                raise Problem(502, "BRIDGE_RESPONSE_REJECTED") from None
            return value, hashlib.sha256(raw).hexdigest()
        except TimeoutError:
            raise Problem(504, "BRIDGE_TIMEOUT") from None
        except (OSError, http.client.HTTPException):
            raise Problem(502, "BRIDGE_UNAVAILABLE") from None
        finally:
            if response is not None:
                response.close()
            connection.close()

    def create(self, body, idempotency_key):
        value, response_hash = self._request("POST", "/v0/transfers", body, idempotency_key)
        return {**observation(value, body), "response_sha256": response_hash}

    def poll(self, transfer_id, body):
        body_value(body)
        value, response_hash = self._request("GET", "/v0/transfers/" + provider_id(transfer_id))
        return {**observation(value, body, transfer_id), "response_sha256": response_hash}


def main():
    from .bridge_journal import BridgeJournal
    parser = argparse.ArgumentParser(description="Bridge sandbox transfer rehearsal; no production or wallet signing")
    parser.add_argument("--state", type=Path, required=True, help="separate private sandbox journal directory")
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare")
    prepare.add_argument("--intent-file", type=Path, required=True)
    for name in ("show", "advance"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--request-id", required=True)
        if name == "advance":
            cmd.add_argument("--key-file", type=Path, required=True)
    args = parser.parse_args()
    try:
        journal = BridgeJournal(args.state)
        if args.command == "prepare":
            from .spending import read_json
            value = journal.prepare(read_json(args.intent_file, 4096))
        elif args.command == "show":
            value = journal.show(args.request_id)
        else:
            value = journal.advance(args.request_id, BridgeSandboxClient(read_key(args.key_file)))
        print(canonical(value))
        return 2 if args.command == "advance" and value["state"] == "UNKNOWN" else 0
    except (Problem, OSError) as error:
        print(canonical({"error": error.code if isinstance(error, Problem) else "BRIDGE_LOCAL_IO_FAILED"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
