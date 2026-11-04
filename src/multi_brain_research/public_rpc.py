"""One allowlisted read-only Solana POST.

live_curve, curve_read, host_capture and hold_check used to open their own
HTTPS clients. Two of those clients accepted any https URL. Callers now share
this helper: the endpoint must be on the public-mainnet allowlist, redirects
are refused, and the method must be read-only.
"""
from __future__ import annotations

import json
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .rpc_allow import ALLOWED

READ_METHODS = frozenset({
    "getAccountInfo",
    "getSignaturesForAddress",
    "getTransaction",
    "getTokenAccountsByOwner",
    "getBlock",
    "getBlocks",
    "getGenesisHash",
    "getSlot",
    "getBalance",
})


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("REFUSED")


def post(endpoint: str, method: str, params: list, *, timeout: float = 20, limit: int = 262144) -> dict:
    if endpoint not in ALLOWED or method not in READ_METHODS or type(timeout) not in (int, float) or not 0 < timeout <= 30:
        raise ValueError("REFUSED")
    if type(params) is not list:
        raise ValueError("REFUSED")
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        separators=(",", ":"),
        allow_nan=False,
    ).encode()
    request = Request(endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with build_opener(_NoRedirect()).open(request, timeout=timeout) as response:
        raw = response.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("RPC_TOO_LARGE")
    payload = json.loads(raw)
    if type(payload) is not dict:
        raise ValueError("RPC_ENVELOPE")
    return payload
