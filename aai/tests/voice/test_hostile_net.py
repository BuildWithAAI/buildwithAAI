"""Real-socket tests: a local TLS server that drips or stalls must not outlive the call's budget (B3)."""

from __future__ import annotations

import datetime
import importlib
import ipaddress
import os
import socket
import ssl
import threading
import time
import types
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

from aai.voice import ProviderError, VoiceConfig, VoiceGateway, constant_time_verifier
from aai.voice.net import Transport, deadline
from aai.voice.providers import OpenAICompatChatLLM, OpenAICompatSTT, OpenAICompatTTS

TOK = "hud-token-hostile-net-0123456789"
SLACK_S = 1.5


NO_KEEPALIVE = httpx.Limits(max_keepalive_connections=0)


def _strict() -> bool:
    """In CI (or with AAI_VOICE_STRICT_TESTS set) a missing test dependency fails instead of silently skipping."""
    return bool(os.environ.get("CI") or os.environ.get("AAI_VOICE_STRICT_TESTS"))


def _need(module: str) -> types.ModuleType:
    try:
        return importlib.import_module(module)
    except ImportError:
        msg = f"{module} is required for the real-socket tests (pip install -r tests/voice/requirements-test.txt)"
        if _strict():
            pytest.fail(msg)
        pytest.skip(msg)


@pytest.fixture(scope="module")
def certpair(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    x509 = _need("cryptography.x509")
    hashes = _need("cryptography.hazmat.primitives.hashes")
    serialization = _need("cryptography.hazmat.primitives.serialization")
    ec = _need("cryptography.hazmat.primitives.asymmetric.ec")
    oid = _need("cryptography.x509.oid")
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(oid.NameOID.COMMON_NAME, "localhost")])
    now = datetime.datetime.now(datetime.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]),
            critical=False,
        )
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    d = tmp_path_factory.mktemp("tls")
    c, k = d / "c.pem", d / "k.pem"
    c.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    k.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    return c, k


class _Hostile:
    """Accepts TLS connections and misbehaves: drips response headers byte by byte, or stalls the handshake."""

    def __init__(self, mode: str, cert: Path, key: Path) -> None:
        self.mode = mode
        self.ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.ctx.load_cert_chain(cert, key)
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(16)
        self.port = self.sock.getsockname()[1]
        self.connections = 0
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self) -> None:
        while True:
            try:
                c, _ = self.sock.accept()
            except OSError:
                return
            self.connections += 1
            threading.Thread(target=self._handle, args=(c,), daemon=True).start()

    def _handle(self, c: socket.socket) -> None:
        try:
            if self.mode == "stall_tls":
                time.sleep(30)
                return
            s = self.ctx.wrap_socket(c, server_side=True)
            s.recv(65536)
            for ch in b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Slow: " + b"a" * 10000:
                s.send(bytes([ch]))
                time.sleep(0.2)
        except OSError:
            pass
        finally:
            c.close()

    def close(self) -> None:
        self.sock.close()


@pytest.fixture(params=["drip_headers", "stall_tls"])
def hostile(request: pytest.FixtureRequest, certpair: tuple[Path, Path]) -> Iterator[tuple[_Hostile, Transport]]:
    srv = _Hostile(request.param, *certpair)
    ctx = ssl.create_default_context(cafile=str(certpair[0]))
    t = Transport(
        client=httpx.Client(verify=ctx, trust_env=False, follow_redirects=False, limits=NO_KEEPALIVE), timeout_s=30.0
    )
    try:
        yield srv, t
    finally:
        t.close()
        srv.close()


class _Keys:
    def get(self, name: str, *, host: str | None = None) -> str:
        return "custom-key-abcdefgh"


def _timed(fn: object) -> float:
    t0 = time.monotonic()
    with pytest.raises(ProviderError):
        fn()  # type: ignore[operator]
    return time.monotonic() - t0


def test_ask_bounded(hostile: tuple[_Hostile, Transport]) -> None:
    srv, t = hostile
    llm = OpenAICompatChatLLM(keys=_Keys(), transport=t, base_url=f"https://localhost:{srv.port}/v1")
    g = VoiceGateway(
        token_verifier=constant_time_verifier(lambda: TOK),
        llm=llm,
        stt=None,
        tts=None,
        config=VoiceConfig(ask_deadline_s=3.0),
    )
    assert _timed(lambda: g.ask("hi", hud_token=TOK)) < 3.0 + SLACK_S


def test_transcribe_then_synthesize_bounded_on_same_transport(hostile: tuple[_Hostile, Transport]) -> None:
    srv, t = hostile
    base = f"https://localhost:{srv.port}/v1"
    g = VoiceGateway(
        token_verifier=constant_time_verifier(lambda: TOK),
        llm=None,
        stt=OpenAICompatSTT(keys=_Keys(), transport=t, base_url=base),
        tts=OpenAICompatTTS(keys=_Keys(), transport=t, base_url=base),
        config=VoiceConfig(call_deadline_s=2.0),
    )
    assert _timed(lambda: g.transcribe(b"x", hud_token=TOK, mime="audio/webm", duration_s=1.0)) < 2.0 + SLACK_S
    # The transport is still usable after a watchdog abort: the second call opens a new connection.
    assert _timed(lambda: g.synthesize("hello", hud_token=TOK)) < 2.0 + SLACK_S
    assert srv.connections >= 2


def test_bare_transport_without_deadline_uses_timeout_as_total_cap(
    hostile: tuple[_Hostile, Transport], certpair: tuple[Path, Path]
) -> None:
    srv, _ = hostile
    ctx = ssl.create_default_context(cafile=str(certpair[0]))
    t = Transport(client=httpx.Client(verify=ctx, trust_env=False, limits=NO_KEEPALIVE), timeout_s=1.5)
    try:
        el = _timed(lambda: t.request("POST", f"https://localhost:{srv.port}/x", provider="p", headers={}, json={}))
        assert el < 1.5 + SLACK_S
    finally:
        t.close()


def test_abort_message_is_clean_and_has_no_context(hostile: tuple[_Hostile, Transport]) -> None:
    srv, t = hostile
    with deadline(1.0, label="zoora voice call"), pytest.raises(ProviderError) as ei:
        t.request("POST", f"https://localhost:{srv.port}/x", provider="p", headers={"authorization": "Bearer k"})
    assert "time limit" in str(ei.value) or str(ei.value) == "p timed out"  # watchdog or httpx timeout, whichever first
    assert ei.value.__context__ is None and ei.value.__cause__ is None


@pytest.mark.parametrize(
    "make",
    [
        lambda: httpx.Client(),  # default pool keeps 20 idle connections
        lambda: httpx.Client(limits=httpx.Limits(max_keepalive_connections=1)),
        lambda: httpx.Client(transport=httpx.HTTPTransport(), limits=NO_KEEPALIVE),  # transport= ignores limits
        lambda: httpx.Client(limits=NO_KEEPALIVE, mounts={"https://": httpx.HTTPTransport()}),
    ],
)
def test_transport_refuses_clients_that_can_reuse_connections(make: object) -> None:
    client = make()  # type: ignore[operator]
    try:
        with pytest.raises(ValueError, match="keep-alive|mounted"):
            Transport(client=client)
    finally:
        client.close()


def test_transport_accepts_no_keepalive_and_mock_clients() -> None:
    for client in (
        httpx.Client(limits=NO_KEEPALIVE),
        httpx.Client(transport=httpx.HTTPTransport(limits=NO_KEEPALIVE)),
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200))),
    ):
        Transport(client=client).close()


def test_strict_mode_turns_missing_dependency_into_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AAI_VOICE_STRICT_TESTS", "1")
    with pytest.raises(pytest.fail.Exception):
        _need("aai_voice_no_such_module_xyz")
    monkeypatch.delenv("AAI_VOICE_STRICT_TESTS")
    monkeypatch.delenv("CI", raising=False)
    with pytest.raises(pytest.skip.Exception):
        _need("aai_voice_no_such_module_xyz")
