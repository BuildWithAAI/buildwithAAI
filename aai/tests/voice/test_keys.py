from __future__ import annotations

import json

import httpx
import pytest

from aai.voice import KeyMissingError, KeyringBackendError, VoiceConfig, VoiceGateway, constant_time_verifier
from aai.voice import keys as keys_mod
from aai.voice.keys import SERVICE, KeyringKeySource, assert_os_backend
from aai.voice.net import Transport
from aai.voice.providers import BraveSearch, OpenAICompatChatLLM, TavilySearch, XaiSTT, XaiTTS

from .fakes import TOKEN


class Counter:
    def __init__(self) -> None:
        self.n = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.n += 1
        return httpx.Response(200, json={"choices": [{"message": {"content": "hi"}}]})


def transport(handler) -> Transport:
    return Transport(client=httpx.Client(transport=httpx.MockTransport(handler), trust_env=False))


def empty_keyring(service: str, name: str) -> str | None:
    return None


def test_service_name_and_key_names():
    assert SERVICE == "zoora-voice"
    assert keys_mod.KEY_NAMES == {"xai-key", "openai-key", "brave-key", "tavily-key", "llm-key", "stt-key", "tts-key"}


@pytest.mark.parametrize("value", [None, "", "   "])
def test_missing_or_empty_key_fails_closed(value):
    src = KeyringKeySource(getter=lambda s, n: value, check_backend=False)
    with pytest.raises(KeyMissingError, match="llm-key"):
        src.get("llm-key")


def test_keyring_error_fails_closed_without_detail():
    def broken(s, n):
        raise RuntimeError("backend exploded with secret-ish detail")

    with pytest.raises(KeyMissingError) as ei:
        KeyringKeySource(getter=broken, check_backend=False).get("tts-key")
    assert "exploded" not in str(ei.value)


def test_unknown_key_name_refused():
    with pytest.raises(KeyMissingError):
        KeyringKeySource(getter=lambda s, n: "x" * 20, check_backend=False).get("wallet-key")


def test_reads_only_service_zoora_voice():
    seen = []
    KeyringKeySource(getter=lambda s, n: seen.append((s, n)) or "k" * 20, check_backend=False).get("brave-key")
    assert seen == [("zoora-voice", "brave-key")]


def test_no_env_var_fallback(monkeypatch):
    for var in ("XAI_API_KEY", "OPENAI_API_KEY", "BRAVE_API_KEY", "TAVILY_API_KEY", "ZOORA_VOICE_LLM_KEY", "LLM_KEY"):
        monkeypatch.setenv(var, "env-secret-should-never-be-used-123456")
    with pytest.raises(KeyMissingError):
        KeyringKeySource(getter=empty_keyring, check_backend=False).get("llm-key")


@pytest.mark.parametrize(
    "make",
    [
        lambda k, t: OpenAICompatChatLLM(keys=k, transport=t).complete([{"role": "user", "content": "x"}], []),
        lambda k, t: XaiSTT(keys=k, transport=t).transcribe(b"abc", mime="audio/wav"),
        lambda k, t: XaiTTS(keys=k, transport=t).synthesize("hi"),
        lambda k, t: BraveSearch(keys=k, transport=t).search("q"),
        lambda k, t: TavilySearch(keys=k, transport=t).search("q"),
    ],
)
def test_providers_fail_closed_before_any_network(make):
    counter = Counter()
    with pytest.raises(KeyMissingError):
        make(KeyringKeySource(getter=empty_keyring, check_backend=False), transport(counter))
    assert counter.n == 0


def test_gateway_from_keyring_missing_llm_key_fails_closed(monkeypatch):
    counter = Counter()
    monkeypatch.setattr(keys_mod.keyring, "get_password", empty_keyring)
    monkeypatch.setattr(keys_mod, "assert_os_backend", lambda backend=None: None)
    gw = VoiceGateway.from_keyring(token_verifier=constant_time_verifier(lambda: TOKEN), transport=transport(counter))
    with pytest.raises(KeyMissingError):
        gw.ask("hi", {}, hud_token=TOKEN)
    assert counter.n == 0


def test_missing_search_key_degrades_to_no_search_not_crash(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if any(m["role"] == "tool" for m in body["messages"]):
            return httpx.Response(200, json={"choices": [{"message": {"content": "no search today"}}]})
        call = {"id": "c1", "type": "function", "function": {"name": "web_search", "arguments": '{"query":"x"}'}}
        return httpx.Response(200, json={"choices": [{"message": {"content": None, "tool_calls": [call]}}]})

    monkeypatch.setattr(
        keys_mod.keyring, "get_password", lambda s, n: "llm-secret-abcdef123456" if n == "xai-key" else None
    )
    monkeypatch.setattr(keys_mod, "assert_os_backend", lambda backend=None: None)
    gw = VoiceGateway.from_keyring(token_verifier=constant_time_verifier(lambda: TOKEN), transport=transport(handler))
    out = gw.ask("hi", {}, hud_token=TOKEN)
    assert out["answer"] == "no search today" and out["sources"] == []


# ---------------------------------------------------------------- backend allowlist
def _fake(module: str, name: str = "Keyring"):
    cls = type(name, (), {})
    cls.__module__ = module
    return cls()


@pytest.mark.parametrize(
    "mod", ["keyring.backends.Windows", "keyring.backends.macOS", "keyring.backends.SecretService"]
)
def test_os_backends_allowed(mod):
    assert_os_backend(_fake(mod))


@pytest.mark.parametrize(
    "mod", ["keyrings.alt.file", "keyring.backends.fail", "keyring.backends.null", "my_plugin.plaintext"]
)
def test_non_os_backends_refused(mod):
    with pytest.raises(KeyringBackendError):
        assert_os_backend(_fake(mod))


def test_chainer_with_any_file_backend_refused():
    chainer = _fake("keyring.backends.chainer", "ChainerBackend")
    chainer.backends = [_fake("keyring.backends.Windows"), _fake("keyrings.alt.file", "PlaintextKeyring")]
    with pytest.raises(KeyringBackendError):
        assert_os_backend(chainer)
    chainer.backends = [_fake("keyring.backends.Windows")]
    assert_os_backend(chainer)
    chainer.backends = []
    with pytest.raises(KeyringBackendError):
        assert_os_backend(chainer)


def test_default_source_checks_backend(monkeypatch):
    monkeypatch.setattr(keys_mod.keyring, "get_keyring", lambda: _fake("keyrings.alt.file", "PlaintextKeyring"))
    monkeypatch.setattr(keys_mod.keyring, "get_password", lambda s, n: "should-not-be-read-123456")
    with pytest.raises(KeyringBackendError):
        KeyringKeySource().get("llm-key")


# ---------------------------------------------------------------- per-provider slots bound to hosts (N2)
def test_default_slots_per_provider(monkeypatch):
    monkeypatch.setattr(keys_mod, "assert_os_backend", lambda backend=None: None)
    v = constant_time_verifier(lambda: TOKEN)
    g = VoiceGateway.from_keyring(token_verifier=v)
    assert (g._llm._key_name, g._stt._key_name, g._tts._key_name, g._search._key_name) == (
        "xai-key", "xai-key", "xai-key", "brave-key",
    )  # fmt: skip
    g2 = VoiceGateway.from_keyring(token_verifier=v, stt="openai", tts="openai", search="tavily")
    assert (g2._stt._key_name, g2._tts._key_name, g2._search._key_name) == ("openai-key", "openai-key", "tavily-key")
    g3 = VoiceGateway.from_keyring(
        token_verifier=v, config=VoiceConfig(llm_base_url="https://llm.example/v1"), stt="openai",
        stt_base_url="https://stt.example/v1",
    )  # fmt: skip
    assert g3._llm._key_name == "llm-key" and g3._stt._key_name == "stt-key"


@pytest.mark.parametrize(
    "slot,host",
    [("xai-key", "api.openai.com"), ("xai-key", "evil.example"), ("openai-key", "api.x.ai"),
     ("brave-key", "api.tavily.com"), ("llm-key", "api.x.ai"), ("stt-key", "api.openai.com")],
)  # fmt: skip
def test_slot_never_sent_to_another_host(slot, host):
    src = KeyringKeySource(getter=lambda s, n: "k" * 24, check_backend=False)
    with pytest.raises(KeyMissingError):
        src.get(slot, host=host)


def test_xai_provider_refuses_non_xai_base_url():
    keys = KeyringKeySource(getter=lambda s, n: "k" * 24, check_backend=False)
    for cls in (XaiSTT, XaiTTS):
        with pytest.raises(KeyMissingError):
            cls(keys=keys, transport=transport(Counter()), base_url="https://api.openai.com/v1")


def test_xai_key_never_reaches_openai_on_the_wire():
    hosts = []

    def h(req):
        hosts.append((req.url.host, req.headers.get("authorization")))
        return httpx.Response(200, json={"text": "hi"})

    slots = {"xai-key": "xai-SLOT-aaaaaaaaaaaaaaaa", "openai-key": "sk-SLOT-bbbbbbbbbbbbbbbb"}  # gitleaks:allow
    keys = KeyringKeySource(getter=lambda s, n: slots.get(n), check_backend=False)
    from aai.voice.providers import OpenAICompatSTT

    OpenAICompatSTT(keys=keys, transport=transport(h)).transcribe(b"a", mime="audio/webm")
    XaiSTT(keys=keys, transport=transport(h)).transcribe(b"a", mime="audio/webm")
    assert hosts == [("api.openai.com", f"Bearer {slots['openai-key']}"), ("api.x.ai", f"Bearer {slots['xai-key']}")]


# ---------------------------------------------------------------- B2: non-ASCII / control characters in a key
BAD_KEYS = [
    "xai-\u200bZWSPKEYzzzzzzzzzzzzzzzz",  # zero-width space pasted from a web page
    "xai-\u201cSMARTQUOTEzzzzzzzzzzzzzz",
    "xai-é-ACCENTzzzzzzzzzzzzzzzzz",
    "xai-abc\ndef-NEWLINEzzzzzzzzzz",
    "xai-\x00NULzzzzzzzzzzzzzzzzzzz",
    "xai-has space-zzzzzzzzzzzzzzzz",
]


@pytest.mark.parametrize("bad", BAD_KEYS)
def test_non_printable_ascii_key_rejected_without_echo(bad):
    with pytest.raises(KeyMissingError) as ei:
        KeyringKeySource(getter=lambda s, n: bad, check_backend=False).get("xai-key")
    text = str(ei.value) + repr(ei.value)
    assert bad.strip() not in text and "ZWSP" not in text and "zzzz" not in text
    assert "xai-key" in str(ei.value)


@pytest.mark.parametrize("bad", BAD_KEYS)
def test_bad_key_never_reaches_network_through_gateway(bad, monkeypatch):
    counter = Counter()
    monkeypatch.setattr(keys_mod.keyring, "get_password", lambda s, n: bad)
    monkeypatch.setattr(keys_mod, "assert_os_backend", lambda backend=None: None)
    gw = VoiceGateway.from_keyring(token_verifier=constant_time_verifier(lambda: TOKEN), transport=transport(counter))
    with pytest.raises(KeyMissingError) as ei:
        gw.ask("hi", {}, hud_token=TOKEN)
    assert counter.n == 0 and "zzzz" not in repr(ei.value)
