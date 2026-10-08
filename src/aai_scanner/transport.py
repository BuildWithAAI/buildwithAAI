"""Bounded HTTPS reads, cooldowns and explicitly configured mainnet RPC recovery."""
import copy
import hashlib
import json
import math
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
import urllib.error
import urllib.request
from .config import https_url
from .evidence import receipt, source_host

MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
READ_METHODS = frozenset({"getAccountInfo", "getTokenLargestAccounts",
                         "getSignaturesForAddress", "getBalance", "getGenesisHash"})


class ProviderError(RuntimeError):
    """Only locally defined, credential-free messages and structured diagnostics."""
    def __init__(self, message, *, code="VALIDATION_FAILED", http_status=None, retry_after=None):
        super().__init__(message)
        self.code, self.http_status, self.retry_after = code, http_status, retry_after
        self.attempts = []

    @property
    def retryable(self):
        return self.code in ("CONNECTION_FAILED", "COOLDOWN", "DEADLINE_EXCEEDED") or self.http_status in (429, 502, 503, 504)

    def details(self):
        return {"code": self.code, "http_status": self.http_status,
                "retry_after_seconds": self.retry_after, "attempts": list(self.attempts)}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def reject_constant(value):
    raise ValueError("Non-finite JSON number")


def retry_after_seconds(value):
    """Support HTTP delay-seconds/date; bound integers without sleeping a request."""
    try:
        if isinstance(value, str) and value.strip().isdigit():
            seconds = int(value.strip())
        else:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                return None
            seconds = math.ceil((date - datetime.now(timezone.utc)).total_seconds())
        return min(2**31 - 1, max(1, seconds))
    except (TypeError, ValueError, OverflowError):
        return None


def fetch_json(url, payload=None, *, timeout=6, limit=2_000_000):
    https_url(url)
    encoded = None if payload is None else json.dumps(payload, allow_nan=False).encode()
    request = urllib.request.Request(url, data=encoded, headers={
        "Accept": "application/json", "Content-Type": "application/json",
        "User-Agent": "AAI-Scanner/0.1 (read-only)",
    })
    deadline = time.monotonic() + timeout
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            chunks, count = [], 0
            while True:
                if time.monotonic() > deadline:
                    raise ProviderError("Provider response exceeded read deadline", code="DEADLINE_EXCEEDED")
                chunk = response.read1(min(65536, limit + 1 - count))
                if not chunk:
                    break
                chunks.append(chunk)
                count += len(chunk)
                if count > limit:
                    raise ProviderError("Provider response exceeds size limit")
        raw = b"".join(chunks)
        return json.loads(raw, parse_float=Decimal, parse_constant=reject_constant), hashlib.sha256(raw).hexdigest()
    except urllib.error.HTTPError as error:
        delay = retry_after_seconds(error.headers.get("Retry-After")) if error.headers else None
        raise ProviderError(f"Provider HTTP {error.code}", code="HTTP_ERROR", http_status=error.code,
                            retry_after=delay) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ProviderError("Provider connection failed or timed out", code="CONNECTION_FAILED") from None
    except (ValueError, UnicodeError, RecursionError):
        raise ProviderError("Provider returned invalid JSON") from None


class RpcClient:
    def __init__(self, endpoint, timeout=6, provider_id="rpc-1"):
        self.endpoint, self.timeout, self.provider_id = https_url(endpoint), timeout, provider_id
        self.network_receipt, self._network_verified_at = None, 0
        self._network_lock, self._state_lock = threading.Lock(), threading.Lock()
        self._cooldown_until, self._last_error = 0, None
        self._calls, self._failures = 0, 0

    def diagnostics(self):
        with self._state_lock:
            remaining = max(0, math.ceil(self._cooldown_until - time.monotonic()))
            return {"provider_id": self.provider_id, "endpoint_host": source_host(self.endpoint),
                    "network_status": ("STALE" if time.monotonic() - self._network_verified_at >= 300 else "AVAILABLE") if self.network_receipt else "UNVERIFIED",
                    "network_verified_at": self.network_receipt.get("available_at") if self.network_receipt else None,
                    "cooldown_seconds": remaining, "requests": self._calls, "failures": self._failures,
                    "last_error_code": self._last_error}

    def _note_failure(self, error):
        with self._state_lock:
            self._failures += 1
            self._last_error = error.code
            if error.retryable:
                delay = error.retry_after or (30 if error.http_status == 429 else 3)
                self._cooldown_until = max(self._cooldown_until, time.monotonic() + delay)

    def _request(self, method, params, deadline=None):
        if method not in READ_METHODS:
            raise ValueError("Read-only RPC method not allowed")
        with self._state_lock:
            remaining = math.ceil(self._cooldown_until - time.monotonic())
            if remaining > 0:
                raise ProviderError("RPC provider is cooling down", code="COOLDOWN", retry_after=remaining)
        timeout = self.timeout if deadline is None else min(self.timeout, deadline - time.monotonic())
        if timeout <= 0:
            raise ProviderError("RPC recovery deadline reached", code="DEADLINE_EXCEEDED")
        with self._state_lock:
            self._calls += 1
        try:
            result, digest = fetch_json(self.endpoint, {
                "jsonrpc": "2.0", "id": 1, "method": method, "params": params,
            }, timeout=timeout)
            if not isinstance(result, dict) or result.get("jsonrpc") != "2.0" or type(result.get("id")) is not int or result.get("id") != 1:
                raise ProviderError("Malformed JSON-RPC response envelope")
            if "error" in result:
                raise ProviderError("RPC method returned an error", code="RPC_ERROR")
            if "result" not in result:
                raise ProviderError("RPC response is missing result")
            return result, digest
        except ProviderError as error:
            self._note_failure(error)
            raise

    def ensure_mainnet(self, deadline=None):
        # Recheck identity periodically rather than trusting a process-lifetime cache.
        wait = -1 if deadline is None else max(0, deadline - time.monotonic())
        if not self._network_lock.acquire(timeout=wait):
            raise ProviderError("RPC identity verification deadline reached", code="DEADLINE_EXCEEDED")
        try:
            if self.network_receipt is None or time.monotonic() - self._network_verified_at >= 300:
                self.network_receipt = None
                result, digest = self._request("getGenesisHash", [], deadline)
                if result["result"] != MAINNET_GENESIS:
                    error = ProviderError("RPC network differs from Solana mainnet; valuation blocked", code="NETWORK_MISMATCH")
                    self._note_failure(error)
                    raise error
                proof = receipt("Solana RPC", self.endpoint, "getGenesisHash", raw_hash=digest)
                proof.update(genesis_hash=result["result"], provider_id=self.provider_id)
                self.network_receipt, self._network_verified_at = proof, time.monotonic()
            return self.network_receipt
        finally:
            self._network_lock.release()

    def call(self, method, params, deadline=None):
        if method not in READ_METHODS:
            raise ValueError("Read-only RPC method not allowed")
        params = finalized_params(method, params)
        proof = self.ensure_mainnet(deadline)
        if method == "getGenesisHash":
            return {"jsonrpc": "2.0", "id": 1, "result": MAINNET_GENESIS, "_evidence": copy.deepcopy(proof)}
        result, digest = self._request(method, params, deadline)
        context = result["result"].get("context", {}) if isinstance(result["result"], dict) else {}
        if not isinstance(context, dict):
            error = ProviderError("Invalid RPC context shape")
            self._note_failure(error)
            raise error
        slot = context.get("slot")
        if method != "getSignaturesForAddress" and (type(slot) is not int or slot < 0):
            error = ProviderError("RPC snapshot is missing a valid context slot")
            self._note_failure(error)
            raise error
        result["_evidence"] = receipt("Solana RPC", self.endpoint, method, slot=slot,
                                      commitment="finalized", raw_hash=digest)
        result["_evidence"].update(commitment_basis="REQUESTED", provider_id=self.provider_id,
                                   network_evidence=proof)
        return result


class RpcPool:
    """One attempt per configured provider. Never recover around invalid data/network."""
    def __init__(self, endpoints, timeout=6):
        if not 1 <= len(endpoints) <= 3 or len(set(endpoints)) != len(endpoints):
            raise ValueError("Configure one to three distinct RPC URLs")
        self.clients = [RpcClient(url, timeout, f"rpc-{i + 1}") for i, url in enumerate(endpoints)]
        self.timeout = timeout

    @property
    def network_receipt(self):
        return next((client.network_receipt for client in self.clients if client.network_receipt), None)

    def diagnostics(self):
        return [client.diagnostics() for client in self.clients]

    def call(self, method, params):
        if method not in READ_METHODS:
            raise ValueError("Read-only RPC method not allowed")
        deadline, attempts = time.monotonic() + min(30, 2 * self.timeout), []
        for client in self.clients:
            try:
                result = client.call(method, params, deadline)
                proof = result["_evidence"]
                proof["recovery_attempts"] = attempts
                if attempts:
                    proof["quality_flags"].append("RPC_FAILOVER_USED")
                return result
            except ProviderError as error:
                attempts.append({"provider_id": client.provider_id, "endpoint_host": source_host(client.endpoint),
                                 "code": error.code, "http_status": error.http_status,
                                 "retry_after_seconds": error.retry_after})
                error.attempts = list(attempts)
                if not error.retryable:
                    raise
                last_error = error
        raise last_error


def finalized_params(method, params):
    if not isinstance(params, list):
        raise ValueError("RPC params must be a list")
    if method == "getGenesisHash":
        if params:
            raise ValueError("Genesis identity query has no params")
        return []
    if len(params) not in (1, 2) or (len(params) == 2 and not isinstance(params[1], dict)):
        raise ValueError("RPC reads require one public address and optional configuration")
    options = copy.deepcopy(params[1]) if len(params) == 2 else {}
    if options.get("commitment", "finalized") != "finalized":
        raise ValueError("Scanner RPC reads require finalized commitment")
    options["commitment"] = "finalized"
    return [params[0], options]
