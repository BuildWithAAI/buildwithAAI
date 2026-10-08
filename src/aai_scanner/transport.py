"""Size-limited HTTPS JSON transport and a read-only RPC allowlist."""
import hashlib
import json
import threading
import time
from decimal import Decimal
import urllib.error
import urllib.request
from .config import https_url
from .evidence import receipt

MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
READ_METHODS = frozenset({"getAccountInfo", "getTokenLargestAccounts",
                         "getSignaturesForAddress", "getBalance", "getGenesisHash"})


class ProviderError(RuntimeError):
    """Redacted failure safe to publish; never contains a provider credential."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def reject_constant(value):
    raise ValueError("Non-finite JSON number")


def fetch_json(url, payload=None, *, timeout=6, limit=2_000_000):
    https_url(url)
    encoded = None if payload is None else json.dumps(payload, allow_nan=False).encode()
    request = urllib.request.Request(url, data=encoded, headers={
        "Accept": "application/json", "Content-Type": "application/json",
        "User-Agent": "AAI-Scanner/0.1 (read-only)",
    })
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            deadline, chunks, count = time.monotonic() + timeout, [], 0
            while True:
                if time.monotonic() > deadline:
                    raise ProviderError("Provider response exceeded read deadline")
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
        raise ProviderError(f"Provider HTTP {error.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ProviderError("Provider connection failed or timed out") from None
    except (ValueError, UnicodeError, RecursionError):
        raise ProviderError("Provider returned invalid JSON") from None


class RpcClient:
    def __init__(self, endpoint, timeout=6):
        self.endpoint, self.timeout = https_url(endpoint), timeout
        self.network_receipt = None
        self._network_lock = threading.Lock()

    def _request(self, method, params):
        if method not in READ_METHODS:
            raise ValueError("Read-only RPC method not allowed")
        for attempt in range(2):
            try:
                result, digest = fetch_json(self.endpoint, {
                    "jsonrpc": "2.0", "id": 1, "method": method, "params": params,
                }, timeout=self.timeout)
                break
            except ProviderError as error:
                transient = str(error) in {"Provider connection failed or timed out", "Provider HTTP 429",
                                          "Provider HTTP 502", "Provider HTTP 503", "Provider HTTP 504"}
                if attempt or not transient:
                    raise
                time.sleep(0.2)
        if not isinstance(result, dict) or result.get("jsonrpc") != "2.0" or type(result.get("id")) is not int or result.get("id") != 1:
            raise ProviderError("Malformed JSON-RPC response envelope")
        if "error" in result:
            raise ProviderError("RPC method returned an error")
        if "result" not in result:
            raise ProviderError("RPC response is missing result")
        return result, digest

    def ensure_mainnet(self):
        with self._network_lock:
            if self.network_receipt is None:
                result, digest = self._request("getGenesisHash", [])
                if result["result"] != MAINNET_GENESIS:
                    raise ProviderError("RPC network differs from Solana mainnet; valuation blocked")
                self.network_receipt = receipt("Solana RPC", self.endpoint, "getGenesisHash", raw_hash=digest)
                self.network_receipt["genesis_hash"] = result["result"]
        return self.network_receipt

    def call(self, method, params):
        if method not in READ_METHODS:
            raise ValueError("Read-only RPC method not allowed")
        self.ensure_mainnet()
        result, digest = self._request(method, params)
        context = result["result"].get("context", {}) if isinstance(result["result"], dict) else {}
        slot = context.get("slot")
        if method not in ("getSignaturesForAddress", "getGenesisHash") and (type(slot) is not int or slot < 0):
            raise ProviderError("RPC snapshot is missing a valid context slot")
        result["_evidence"] = receipt("Solana RPC", self.endpoint, method, slot=slot,
                                      commitment="finalized", raw_hash=digest)
        result["_evidence"]["commitment_basis"] = "REQUESTED"
        return result
