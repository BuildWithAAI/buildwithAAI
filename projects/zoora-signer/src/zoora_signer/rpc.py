"""Read-only Helius client. There is no transaction submission method.

Free tier (read 2026-11-17): 10 RPC requests/second and 5 getProgramAccounts/second.
https://www.helius.dev/docs/billing/rate-limits
This client stays at 8 and 4. A 429 or quota error becomes UNKNOWN.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from zoora_signer.constants import HELIUS_CLIENT_GPA_PER_S, HELIUS_CLIENT_RPC_PER_S
from zoora_signer.ports import Clock

_URL = re.compile(r"https?://\S+")
ALLOWED_METHODS = frozenset(
    {
        "getAccountInfo",
        "getMultipleAccounts",
        "getBalance",
        "getLatestBlockhash",
        "getMinimumBalanceForRentExemption",
        "getSignatureStatuses",
        "simulateTransaction",
    }
)
GPA = "getProgramAccounts"


def rpc_host_allowed(url: str, *, live: bool) -> bool:
    """Exact Helius host. Devnet is refused once the signer is live."""

    from urllib.parse import urlparse

    from zoora_signer.constants import HELIUS_LIVE_HOSTS, HELIUS_RPC_HOSTS

    parsed = urlparse(url)
    hosts = HELIUS_LIVE_HOSTS if live else HELIUS_RPC_HOSTS
    return parsed.scheme == "https" and parsed.hostname in hosts and parsed.username is None


def redact(text: str) -> str:
    return _URL.sub("[url]", text)


@dataclass(frozen=True)
class RpcResult:
    ok: bool
    reason: str
    value: object | None = None


class TokenBucket:
    def __init__(self, per_second: int, clock: Clock) -> None:
        self.per_second = per_second
        self.clock = clock
        self.tokens = float(per_second)
        self.updated = clock.now_ms()

    def take(self) -> bool:
        now = self.clock.now_ms()
        elapsed = max(0, now - self.updated) / 1000
        self.tokens = min(float(self.per_second), self.tokens + elapsed * self.per_second)
        self.updated = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True


class HeliusRpc:
    def __init__(
        self,
        url_provider: Callable[[], str | None],
        clock: Clock,
        client: httpx.Client | None = None,
        sleeper: Callable[[float], None] | None = None,
    ) -> None:
        self._url_provider = url_provider
        self._clock = clock
        self._client = client or httpx.Client()
        self._sleep = sleeper or (lambda _seconds: None)
        self._rpc = TokenBucket(HELIUS_CLIENT_RPC_PER_S, clock)
        self._gpa = TokenBucket(HELIUS_CLIENT_GPA_PER_S, clock)

    def call(self, method: str, params: list[object]) -> RpcResult:
        if method not in ALLOWED_METHODS and method != GPA:
            return RpcResult(False, "METHOD_DENIED", None)
        bucket = self._gpa if method == GPA else self._rpc
        if not bucket.take():
            return RpcResult(False, "UNKNOWN", None)
        url = self._url_provider()
        if not url:
            return RpcResult(False, "UNKNOWN", None)
        body_params = params
        if method == "simulateTransaction":
            body_params = _force_unsigned_sim(params)
        delays = (0.2, 0.4, 0.8)
        last = "UNKNOWN"
        for attempt in range(4):
            try:
                response = self._client.post(
                    url,
                    json={"jsonrpc": "2.0", "id": 1, "method": method, "params": body_params},
                    timeout=8.0,
                )
            except httpx.HTTPError as exc:
                last = redact(str(exc))
                if attempt < 3:
                    self._sleep(delays[attempt])
                    continue
                return RpcResult(False, "UNKNOWN", None)
            if response.status_code == 429 or _quota(response.text):
                last = "UNKNOWN"
                if attempt < 3:
                    self._sleep(delays[attempt])
                    continue
                return RpcResult(False, "UNKNOWN", None)
            if response.status_code >= 400:
                return RpcResult(False, "UNKNOWN", None)
            try:
                payload = response.json()
            except ValueError:
                return RpcResult(False, "UNKNOWN", None)
            if isinstance(payload, dict) and payload.get("error") is not None:
                err = redact(str(payload.get("error")))
                if "429" in err or "quota" in err.lower() or "credit" in err.lower():
                    if attempt < 3:
                        self._sleep(delays[attempt])
                        continue
                    return RpcResult(False, "UNKNOWN", None)
                return RpcResult(False, "UNKNOWN", None)
            value = payload.get("result") if isinstance(payload, dict) else None
            return RpcResult(True, "OK", value)
        return RpcResult(False, last, None)


def _quota(text: str) -> bool:
    lowered = text.lower()
    return "quota" in lowered or "insufficient credits" in lowered or "max usage" in lowered


def _force_unsigned_sim(params: list[object]) -> list[object]:
    config: dict[str, object] = {
        "sigVerify": False,
        "replaceRecentBlockhash": True,
        "commitment": "processed",
    }
    if params and isinstance(params[-1], dict):
        merged = dict(params[-1])
        merged.update(config)
        return [*params[:-1], merged]
    return [*params, config]
