from __future__ import annotations

import base64
import json

import httpx
import pytest

from aai.voice import InsecureURLError, ProviderError
from aai.voice.keys import KeyringKeySource
from aai.voice.net import Transport, require_https
from aai.voice.providers import (
    BraveSearch,
    OpenAICompatChatLLM,
    OpenAICompatSTT,
    OpenAICompatTTS,
    TavilySearch,
    XaiSTT,
    XaiTTS,
)

KEY = "xai-TESTKEY-abcdefghijklmnop0123"  # gitleaks:allow (fake fixture key)
KEYS = KeyringKeySource(getter=lambda s, n: KEY, check_backend=False)


def mk(handler, **kw) -> Transport:
    return Transport(client=httpx.Client(transport=httpx.MockTransport(handler), trust_env=False), **kw)


def test_xai_chat_request_shape():
    seen: dict = {}

    def h(req: httpx.Request) -> httpx.Response:
        seen["url"], seen["auth"], seen["body"] = str(req.url), req.headers["authorization"], json.loads(req.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "hello"}}]})

    tool = {"type": "function", "function": {"name": "web_search", "parameters": {}}}
    turn = OpenAICompatChatLLM(keys=KEYS, transport=mk(h)).complete([{"role": "user", "content": "q"}], [tool])
    assert turn.content == "hello" and turn.tool_calls == []
    assert seen["url"] == "https://api.x.ai/v1/chat/completions"
    assert seen["auth"] == f"Bearer {KEY}"
    assert seen["body"]["model"] == "grok-4.7" and seen["body"]["tools"] == [tool]
    assert seen["body"]["parallel_tool_calls"] is False


def test_chat_parses_tool_calls_and_ignores_garbage():
    def h(req):
        calls = [{"id": "a", "type": "function", "function": {"name": "web_search", "arguments": "{}"}}, "junk"]
        return httpx.Response(200, json={"choices": [{"message": {"content": None, "tool_calls": calls}}]})

    turn = OpenAICompatChatLLM(keys=KEYS, transport=mk(h)).complete([], [])
    assert [c.name for c in turn.tool_calls] == ["web_search"] and turn.content == ""


def test_xai_stt_multipart():
    seen: dict = {}

    def h(req: httpx.Request) -> httpx.Response:
        seen["url"], seen["body"] = str(req.url), req.content
        return httpx.Response(200, json={"text": "hello zoora", "language": "en", "duration": 1.5})

    t = XaiSTT(keys=KEYS, transport=mk(h)).transcribe(b"RIFFdata", mime="audio/wav")
    assert t.text == "hello zoora" and t.duration_s == 1.5
    assert seen["url"] == "https://api.x.ai/v1/stt"
    body = seen["body"]
    assert b"grok-voice-transcribe-2.0" in body and b'filename="ptt.wav"' in body
    assert body.index(b'name="model"') < body.index(b'name="file"')  # file is the last field


def test_xai_tts_raw_and_json_envelope():
    raw = mk(lambda r: httpx.Response(200, content=b"ID3audio", headers={"content-type": "audio/mpeg"}))
    assert XaiTTS(keys=KEYS, transport=raw).synthesize("hi") == b"ID3audio"
    env = {"audio": base64.b64encode(b"ID3b64").decode(), "content_type": "audio/mpeg"}
    js = mk(lambda r: httpx.Response(200, json=env))
    assert XaiTTS(keys=KEYS, transport=js).synthesize("hi") == b"ID3b64"
    seen = {}

    def h(req):
        seen["body"], seen["url"] = json.loads(req.content), str(req.url)
        return httpx.Response(200, content=b"x", headers={"content-type": "audio/mpeg"})

    XaiTTS(keys=KEYS, transport=mk(h)).synthesize("hello")
    assert seen["url"] == "https://api.x.ai/v1/tts"
    assert seen["body"] == {"text": "hello", "voice_id": "eve", "language": "en"}


def test_openai_compat_audio_endpoints():
    urls = []

    def h(req):
        urls.append(str(req.url))
        if req.url.path.endswith("/transcriptions"):
            return httpx.Response(200, json={"text": "hi"})
        return httpx.Response(200, content=b"mp3", headers={"content-type": "audio/mpeg"})

    t = mk(h)
    assert OpenAICompatSTT(keys=KEYS, transport=t).transcribe(b"a", mime="audio/webm").text == "hi"
    assert OpenAICompatTTS(keys=KEYS, transport=t).synthesize("x") == b"mp3"
    assert urls == ["https://api.openai.com/v1/audio/transcriptions", "https://api.openai.com/v1/audio/speech"]


def test_brave_search_parses_and_filters():
    seen = {}

    def h(req):
        seen["tok"], seen["url"], seen["method"] = req.headers["x-subscription-token"], str(req.url), req.method
        seen["body"] = json.loads(req.content)
        return httpx.Response(
            200,
            json={
                "web": {
                    "results": [
                        {
                            "title": "<strong>NWS</strong>",
                            "url": "https://weather.gov",
                            "description": "41F <b>rain</b>",
                        },
                        {"title": "Plain", "url": "http://insecure.example", "description": "x"},
                        {"title": "JS", "url": "javascript:alert(1)", "description": "y"},
                    ]
                }
            },
        )

    r = BraveSearch(keys=KEYS, transport=mk(h)).search("chicago weather")
    assert seen["tok"] == KEY and seen["method"] == "POST"
    assert seen["url"] == "https://api.search.brave.com/res/v1/web/search"  # the question is not in the URL
    assert seen["body"]["q"] == "chicago weather"
    assert [(s.title, s.url) for s in r.sources] == [("NWS", "https://weather.gov")]
    assert "41F rain" in r.answer


def test_tavily_search_parses():
    def h(req):
        assert str(req.url) == "https://api.tavily.com/search"
        assert json.loads(req.content)["include_answer"] is True
        return httpx.Response(
            200,
            json={"answer": "It is 41F.", "results": [{"title": "NWS", "url": "https://weather.gov", "content": "c"}]},
        )

    r = TavilySearch(keys=KEYS, transport=mk(h)).search("q")
    assert r.answer == "It is 41F." and r.sources[0].url == "https://weather.gov"


@pytest.mark.parametrize("url", ["http://api.x.ai/v1", "ftp://x", "https://", "file:///etc/passwd", "api.x.ai/v1"])
def test_https_only(url):
    with pytest.raises(InsecureURLError):
        require_https(url)
    if url.startswith("http"):
        with pytest.raises(InsecureURLError):
            OpenAICompatChatLLM(keys=KEYS, transport=mk(lambda r: httpx.Response(200)), base_url=url)


def test_redirects_not_followed_and_error_has_no_body_or_key():
    def h(req):
        return httpx.Response(302, headers={"location": "http://evil.example/"}, text=f"echo {KEY}")

    with pytest.raises(ProviderError) as ei:
        XaiTTS(keys=KEYS, transport=mk(h)).synthesize("hi")
    assert "302" in str(ei.value) and KEY not in str(ei.value)

    def h401(req):
        return httpx.Response(401, text=f"bad key {KEY}")

    with pytest.raises(ProviderError) as ei:
        OpenAICompatChatLLM(keys=KEYS, transport=mk(h401)).complete([], [])
    assert KEY not in str(ei.value) and "401" in str(ei.value)


def test_response_size_cap():
    t = mk(lambda r: httpx.Response(200, content=b"x" * 5000), max_response_bytes=1000)
    with pytest.raises(ProviderError, match="exceeded"):
        XaiTTS(keys=KEYS, transport=t).synthesize("hi")


def test_timeout_maps_to_provider_error():
    def h(req):
        raise httpx.ReadTimeout("slow", request=req)

    with pytest.raises(ProviderError, match="timed out"):
        XaiSTT(keys=KEYS, transport=mk(h)).transcribe(b"a", mime="audio/wav")


def test_default_transport_ignores_env_and_redirects():
    t = Transport()
    assert t._client.follow_redirects is False and t._client._trust_env is False
    assert t._client.timeout.connect == 5.0 and t._client.timeout.read == 30.0
    t.close()


# ---------------------------------------------------------------- B2 at the transport layer
class RawKeys:
    """Bypasses KeyringKeySource validation to prove Transport itself never leaks a key in an exception."""

    def __init__(self, key: str) -> None:
        self.key = key

    def get(self, name: str, *, host: str | None = None) -> str:
        return self.key


@pytest.mark.parametrize("bad", ["xai-\u200bZWSPKEYzzzzzzzzzzzzzzzz", "xai-é-ACCENTzzzzzzzzzzzzzzzzz"])
def test_transport_wraps_header_encoding_errors_without_key(bad):
    import traceback

    llm = OpenAICompatChatLLM(keys=RawKeys(bad), transport=mk(lambda r: httpx.Response(200, json={})))
    with pytest.raises(ProviderError) as ei:
        llm.complete([], [])
    e = ei.value
    tb = "".join(traceback.format_exception(e))
    assert "zzzz" not in str(e) and "zzzz" not in repr(e) and "zzzz" not in tb
    assert e.__cause__ is None and e.__context__ is None  # raised outside the except: no raw exception chained
    assert "could not be built" in str(e)


def test_transport_wraps_type_and_value_errors():
    t = mk(lambda r: httpx.Response(200, json={}))
    with pytest.raises(ProviderError):
        t.request("POST", "https://api.x.ai/v1/x", provider="p", headers={}, json={"x": object()})


# ---------------------------------------------------------------- N2: gpt-transcribe uses `languages`, not `language`
def test_gpt_transcribe_sends_languages_not_language():
    bodies = []

    def h(req):
        bodies.append(req.content)
        return httpx.Response(200, json={"text": "hi"})

    OpenAICompatSTT(keys=KEYS, transport=mk(h)).transcribe(b"a", mime="audio/webm")
    OpenAICompatSTT(keys=KEYS, transport=mk(h), model="whisper-1").transcribe(b"a", mime="audio/webm")
    assert b'name="languages[]"' in bodies[0] and b'name="language"' not in bodies[0]
    assert b'name="language"' in bodies[1] and b"languages" not in bodies[1]


def test_openai_models_configurable_via_from_keyring():
    from aai.voice import VoiceConfig, VoiceGateway

    cfg = VoiceConfig(openai_stt_model="whisper-1", openai_tts_model="tts-x", openai_tts_voice="v")
    g = VoiceGateway.from_keyring(token_verifier=lambda s: False, stt="openai", tts="openai", config=cfg)
    assert (g._stt._model, g._tts._model, g._tts._voice) == ("whisper-1", "tts-x", "v")


def test_xai_chat_sends_low_reasoning_effort():
    seen = {}

    def h(req):
        seen.update(json.loads(req.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "x"}}]})

    OpenAICompatChatLLM(keys=KEYS, transport=mk(h)).complete([], [])
    assert seen["reasoning_effort"] == "low"
    seen.clear()
    OpenAICompatChatLLM(keys=KEYS, transport=mk(h), reasoning_effort=None).complete([], [])
    assert "reasoning_effort" not in seen


# ---------------------------------------------------------------- N6: TTS must return audio
@pytest.mark.parametrize(
    "ctype,body",
    [("text/html", b"<html>captive portal</html>"), ("", b"ID3"), ("application/octet-stream", b"ID3"),
     ("audio/mpeg", b"")],
)  # fmt: skip
def test_tts_requires_audio_content_type(ctype, body):
    t = mk(lambda r: httpx.Response(200, content=body, headers={"content-type": ctype}))
    with pytest.raises(ProviderError):
        XaiTTS(keys=KEYS, transport=t).synthesize("hi")
    with pytest.raises(ProviderError):
        OpenAICompatTTS(keys=KEYS, transport=t).synthesize("hi")


def test_tts_json_envelope_must_be_audio():
    env = {"audio": base64.b64encode(b"<html>").decode(), "content_type": "text/html"}
    with pytest.raises(ProviderError):
        XaiTTS(keys=KEYS, transport=mk(lambda r: httpx.Response(200, json=env))).synthesize("hi")


# ---------------------------------------------------------------- N1: per-call deadline
def test_deadline_caps_request_timeout_and_slow_drip():
    import time

    from aai.voice import net

    seen = {}

    def h(req):
        seen["timeout"] = req.extensions["timeout"]
        return httpx.Response(200, content=b"ID3", headers={"content-type": "audio/mpeg"})

    with net.deadline(2.0):
        XaiTTS(keys=KEYS, transport=mk(h)).synthesize("hi")
    assert seen["timeout"]["read"] <= 2.0

    class Drip(httpx.SyncByteStream):
        def __iter__(self):
            for _ in range(50):
                time.sleep(0.02)
                yield b"x"

    slow = mk(lambda r: httpx.Response(200, stream=Drip(), headers={"content-type": "audio/mpeg"}))
    with net.deadline(0.2), pytest.raises(ProviderError, match="time limit"):
        XaiTTS(keys=KEYS, transport=slow).synthesize("hi")
