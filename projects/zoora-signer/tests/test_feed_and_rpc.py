"""Intent TTL, re-vet freshness, unreachable feed, deposits, and the Helius limiter."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from harness import MINT, activate, build
from zoora_signer.constants import HELIUS_CLIENT_RPC_PER_S, INTENT_TTL_MS, VET_FRESH_MS
from zoora_signer.preflight import av_active, parse_icacls, parse_w32tm_offset_ms, parse_whoami
from zoora_signer.rpc import HeliusRpc


class FixedClock:
    def __init__(self) -> None:
        self.now = 0

    def now_ms(self) -> int:
        return self.now


def test_constants() -> None:
    assert INTENT_TTL_MS == 90_000
    assert VET_FRESH_MS == 15_000
    assert HELIUS_CLIENT_RPC_PER_S == 8


def test_expired_intent_and_unreachable_feed(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    issued = services.clock.now_ms()
    services.clock.now = issued + 90_001
    from zoora_signer.signer import sign_intent

    raw: dict[str, object] = {
        "intent_id": "expired",
        "issued_at_ms": issued,
        "max_slippage_bps": 1500,
        "mint": MINT,
        "side": "buy",
        "usd_stake_cents": 200,
    }
    key = services.secrets.get_hmac_key()
    assert key is not None
    assert signer.handle_intent(raw, sign_intent(raw, key)).code == "EXPIRED"
    services.clock.now = issued
    services.feed.batch = type(services.feed.batch)(True, [])
    assert signer.pull_once() == []
    assert signer.open_trade_count() == 0
    text = " ".join(payload for _row, kind, payload in signer.read_events(0) if kind == "feed_unreachable")
    assert "UNREACHABLE" in text


def test_expect_deposit_and_hmac_rotation(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    dest = "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw"
    assert signer.whitelist_add(dest).ok
    assert signer.expect_deposit(50_000_000).ok
    assert signer.observe_sol(150_000_000, dest).code == "DEPOSIT"
    assert signer.observe_sol(150_000_001, "not-whitelist").code == "UNEXPECTED_SOL"
    assert signer.activity() == "HALTED"
    other, other_services = build(tmp_path / "hmac")
    assert activate(other).ok
    old = other_services.secrets.get_hmac_key()
    assert old is not None
    assert other.rotate_hmac(b"rotated-hmac-key-0123456789abcd").ok
    from zoora_signer.signer import sign_intent

    raw = {
        "intent_id": "after-rotation",
        "issued_at_ms": other_services.clock.now_ms(),
        "max_slippage_bps": 1500,
        "mint": MINT,
        "side": "buy",
        "usd_stake_cents": 200,
    }
    assert other.handle_intent(raw, sign_intent(raw, old)).code == "BAD_HMAC"
    new_key = other_services.secrets.get_hmac_key()
    assert new_key is not None
    assert other.handle_intent(raw, sign_intent(raw, new_key)).ok


def test_helius_429_is_unknown_and_budget() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        body = json.loads(request.content.decode())
        assert body["method"] != "sendTransaction"
        if body["method"] == "simulateTransaction":
            assert body["params"][-1]["sigVerify"] is False
        return httpx.Response(429, json={"error": "quota exceeded at [url]"})

    clock = FixedClock()
    slept: list[float] = []
    client = HeliusRpc(
        lambda: "https://example.invalid/rpc?api-key=hidden",
        clock,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleeper=slept.append,
    )
    result = client.call("getBalance", ["11111111111111111111111111111111"])
    assert result.ok is False
    assert result.reason == "UNKNOWN"
    assert slept == [0.2, 0.4, 0.8]
    assert "api-key" not in result.reason
    denied = client.call("sendTransaction", [])
    assert denied.reason == "METHOD_DENIED"


def test_bucket_stops_at_eight() -> None:
    clock = FixedClock()
    client = HeliusRpc(lambda: None, clock, client=httpx.Client())
    allowed = sum(1 for _ in range(20) if client._rpc.take())
    assert allowed == 8


def test_windows_parsers() -> None:
    assert av_active("AMServiceEnabled : True\nRealTimeProtectionEnabled : True\n", "")
    assert av_active("AMServiceEnabled : False\nRealTimeProtectionEnabled : False\n", "Defender|4096")
    assert not av_active("AMServiceEnabled : False\n", "")
    assert parse_whoami("BUILTIN\\Administrators  Enabled group\n")
    assert not parse_whoami("BUILTIN\\Users  Enabled group\n")
    assert parse_icacls("C:\\secret\\db\n  OWNER\\zoora:(F)\n")
    assert not parse_icacls("C:\\secret\\db\n  Everyone:(F)\n")
    assert parse_w32tm_offset_ms("Phase Offset: 0.001s\n") == 1
