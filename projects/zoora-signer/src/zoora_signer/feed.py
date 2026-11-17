"""Outbound intent pull. The signer does not listen."""

from __future__ import annotations

import httpx

from zoora_signer.models import Intent
from zoora_signer.ports import PullBatch
from zoora_signer.rpc import redact
from zoora_signer.signer import parse_intent


class FeedError(RuntimeError):
    pass


class HttpIntentFeed:
    def __init__(self, base_url: str, client: httpx.Client) -> None:
        self._base = base_url.rstrip("/")
        self._client = client

    def pull(self, after: str | None) -> PullBatch:
        try:
            response = self._client.get(
                f"{self._base}/v1/intents",
                params={"after": after or ""},
                timeout=10.0,
            )
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise FeedError(redact(str(exc))) from None
        if not isinstance(body, dict) or not isinstance(body.get("intents"), list):
            return PullBatch(True, [])
        found: list[tuple[Intent, str]] = []
        items = body["intents"]
        assert isinstance(items, list)
        for item in items:
            if not isinstance(item, dict):
                continue
            payload = item.get("payload")
            sig = item.get("sig")
            if not isinstance(payload, dict) or not isinstance(sig, str):
                continue
            intent = parse_intent(payload)
            if intent is not None:
                found.append((intent, sig))
        return PullBatch(False, found)

    def push_events(self, events: list[dict[str, object]]) -> None:
        try:
            response = self._client.post(
                f"{self._base}/v1/events",
                json={"events": events},
                timeout=10.0,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise FeedError(redact(str(exc))) from None
