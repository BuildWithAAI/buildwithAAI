"""Provider protocols and the concrete HTTPS providers for Zoora voice.

Endpoints (see README for doc links):
  LLM  xAI  POST https://api.x.ai/v1/chat/completions   (OpenAI-compatible; any compatible base_url works)
  STT  xAI  POST https://api.x.ai/v1/stt                 (multipart, model grok-voice-transcribe-2.0)
  TTS  xAI  POST https://api.x.ai/v1/tts                 (JSON {text, voice_id, language} -> audio)
  STT  OpenAI-compatible POST {base}/audio/transcriptions
  TTS  OpenAI-compatible POST {base}/audio/speech
  Search Brave  POST https://api.search.brave.com/res/v1/web/search  (X-Subscription-Token)
  Search Tavily POST https://api.tavily.com/search                    (Bearer)

Each provider reads its key from a slot bound to its own host (see keys.py), so a key can't go to another provider.
"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from .errors import InsecureURLError, ProviderError
from .keys import KeyringKeySource, check_slot_host, slot_for_host
from .net import Transport, host_of, require_https


# ---------------------------------------------------------------- data types
@dataclass(frozen=True)
class Source:
    title: str
    url: str


@dataclass(frozen=True)
class SearchResult:
    answer: str
    sources: list[Source] = field(default_factory=list)


@dataclass(frozen=True)
class Transcript:
    text: str
    duration_s: float | None = None


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: str


@dataclass(frozen=True)
class ChatTurn:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)


class KeySource(Protocol):
    def get(self, name: str, *, host: str | None = None) -> str: ...


# ---------------------------------------------------------------- protocols
class STTProvider(Protocol):
    name: str

    def transcribe(self, audio: bytes, *, mime: str) -> Transcript: ...


class TTSProvider(Protocol):
    name: str

    def synthesize(self, text: str) -> bytes: ...


class ChatLLM(Protocol):
    name: str

    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ChatTurn: ...


class SearchProvider(Protocol):
    name: str

    def search(self, query: str) -> SearchResult: ...


# ---------------------------------------------------------------- helpers
_TAG = re.compile(r"<[^>]{0,200}>")


def _clean(text: Any, cap: int) -> str:
    s = _TAG.sub("", text) if isinstance(text, str) else ""
    s = " ".join(s.split())
    return s[:cap]


def _json(body: bytes, provider: str) -> Any:
    try:
        return json.loads(body)
    except ValueError:
        raise ProviderError(f"{provider} returned non-JSON") from None


def _ext_for(mime: str) -> str:
    return {
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/wave": "wav",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/ogg": "ogg",
        "audio/webm": "webm",
        "audio/mp4": "m4a",
        "audio/flac": "flac",
    }.get(mime.split(";")[0].strip().lower(), "bin")


def _https_ok(url: str) -> bool:
    try:
        require_https(url)
    except InsecureURLError:
        return False
    return True


def _https_sources(items: list[Source], cap: int) -> list[Source]:
    out: list[Source] = []
    seen: set[str] = set()
    for s in items:
        if not _https_ok(s.url) or s.url in seen:
            continue
        seen.add(s.url)
        out.append(Source(title=s.title or s.url, url=s.url))
        if len(out) >= cap:
            break
    return out


# ---------------------------------------------------------------- LLM
class OpenAICompatChatLLM:
    """OpenAI-compatible chat completions. Default: xAI (https://api.x.ai/v1, model grok-4.7)."""

    def __init__(
        self,
        *,
        keys: KeySource,
        transport: Transport,
        base_url: str = "https://api.x.ai/v1",
        model: str = "grok-4.7",
        key_name: str | None = None,
        max_completion_tokens: int = 600,
        reasoning_effort: str | None = "low",
        name: str = "xai-chat",
    ) -> None:
        self.name = name
        self._keys, self._t = keys, transport
        self._url = require_https(base_url.rstrip("/") + "/chat/completions")
        self._host = host_of(self._url)
        self._key_name = key_name or slot_for_host(self._host, custom_slot="llm-key")
        check_slot_host(self._key_name, self._host)
        self._model, self._max, self._effort = model, max_completion_tokens, reasoning_effort

    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ChatTurn:
        key = self._keys.get(self._key_name, host=self._host)  # fail closed before any network
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "max_completion_tokens": self._max,
        }
        if self._effort:
            payload["reasoning_effort"] = self._effort
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
            payload["parallel_tool_calls"] = False
        r = self._t.request(
            "POST",
            self._url,
            provider=self.name,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=payload,
        )
        data = _json(r.body, self.name)
        try:
            msg = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError):
            raise ProviderError(f"{self.name} returned no choices") from None
        content = msg.get("content") if isinstance(msg, dict) else None
        calls: list[ToolCall] = []
        raw_calls = msg.get("tool_calls") if isinstance(msg, dict) else None
        for c in raw_calls if isinstance(raw_calls, list) else []:
            if not isinstance(c, dict):
                continue
            fn = c.get("function")
            if not isinstance(fn, dict):
                fn = {}
            calls.append(
                ToolCall(
                    id=str(c.get("id", "")),
                    name=str(fn.get("name", "")),
                    arguments=str(fn.get("arguments", "") or ""),
                )
            )
        return ChatTurn(content=content if isinstance(content, str) else "", tool_calls=calls)


# ---------------------------------------------------------------- STT
class XaiSTT:
    """xAI batch speech-to-text: POST https://api.x.ai/v1/stt (multipart; file must be the last field)."""

    def __init__(
        self,
        *,
        keys: KeySource,
        transport: Transport,
        base_url: str = "https://api.x.ai/v1",
        model: str = "grok-voice-transcribe-2.0",
        language: str = "en",
    ) -> None:
        self.name = "xai-stt"
        self._keys, self._t = keys, transport
        self._url = require_https(base_url.rstrip("/") + "/stt")
        self._host, self._key_name = host_of(self._url), "xai-key"
        check_slot_host(self._key_name, self._host)
        self._model, self._lang = model, language

    def transcribe(self, audio: bytes, *, mime: str) -> Transcript:
        key = self._keys.get(self._key_name, host=self._host)
        r = self._t.request(
            "POST",
            self._url,
            provider=self.name,
            headers={"Authorization": f"Bearer {key}"},
            data={"model": self._model, "language": self._lang, "format": "true"},
            files={"file": (f"ptt.{_ext_for(mime)}", audio, mime)},
        )
        data = _json(r.body, self.name)
        text = data.get("text") if isinstance(data, dict) else None
        if not isinstance(text, str):
            raise ProviderError(f"{self.name} returned no text")
        dur = data.get("duration")
        return Transcript(text=text, duration_s=float(dur) if isinstance(dur, (int, float)) else None)


def _uses_languages(model: str) -> bool:
    """gpt-transcribe takes ``languages`` (array) and must not also get ``language`` (OpenAI docs)."""
    return model == "gpt-transcribe" or model.startswith("gpt-transcribe-")


class OpenAICompatSTT:
    """OpenAI-compatible transcription: POST {base}/audio/transcriptions (default model gpt-transcribe)."""

    def __init__(
        self,
        *,
        keys: KeySource,
        transport: Transport,
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-transcribe",
        language: str = "en",
    ) -> None:
        self.name = "openai-stt"
        self._keys, self._t = keys, transport
        self._url = require_https(base_url.rstrip("/") + "/audio/transcriptions")
        self._host = host_of(self._url)
        self._key_name = slot_for_host(self._host, custom_slot="stt-key")
        self._model, self._lang = model, language

    def _form(self) -> dict[str, str]:
        form = {"model": self._model, "response_format": "json"}
        if _uses_languages(self._model):
            form["languages[]"] = self._lang  # multipart array field with one value; never also send `language`
        else:
            form["language"] = self._lang
        return form

    def transcribe(self, audio: bytes, *, mime: str) -> Transcript:
        key = self._keys.get(self._key_name, host=self._host)
        r = self._t.request(
            "POST",
            self._url,
            provider=self.name,
            headers={"Authorization": f"Bearer {key}"},
            data=self._form(),
            files={"file": (f"ptt.{_ext_for(mime)}", audio, mime)},
        )
        data = _json(r.body, self.name)
        text = data.get("text") if isinstance(data, dict) else None
        if not isinstance(text, str):
            raise ProviderError(f"{self.name} returned no text")
        return Transcript(text=text)


# ---------------------------------------------------------------- TTS
class XaiTTS:
    """xAI text-to-speech: POST https://api.x.ai/v1/tts. Accepts raw audio or the JSON {audio: base64} envelope."""

    def __init__(
        self,
        *,
        keys: KeySource,
        transport: Transport,
        base_url: str = "https://api.x.ai/v1",
        voice_id: str = "eve",
        language: str = "en",
    ) -> None:
        self.name = "xai-tts"
        self._keys, self._t = keys, transport
        self._url = require_https(base_url.rstrip("/") + "/tts")
        self._host, self._key_name = host_of(self._url), "xai-key"
        check_slot_host(self._key_name, self._host)
        self._voice, self._lang = voice_id, language

    def synthesize(self, text: str) -> bytes:
        key = self._keys.get(self._key_name, host=self._host)
        r = self._t.request(
            "POST",
            self._url,
            provider=self.name,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"text": text, "voice_id": self._voice, "language": self._lang},
        )
        if r.content_type.lower().strip().startswith("application/json"):
            data = _json(r.body, self.name)
            b64 = data.get("audio") if isinstance(data, dict) else None
            if not isinstance(b64, str) or not b64:
                raise ProviderError(f"{self.name} returned no audio")
            ctype = data.get("content_type", "audio/mpeg")
            if not isinstance(ctype, str) or not ctype.lower().startswith("audio/"):
                raise ProviderError(f"{self.name} returned a non-audio content type")
            try:
                return base64.b64decode(b64, validate=True)
            except ValueError:
                raise ProviderError(f"{self.name} returned invalid audio") from None
        return _audio_body(r.content_type, r.body, self.name)


def _audio_body(content_type: str, body: bytes, provider: str) -> bytes:
    """Only accept an audio/* reply (a 200 text/html captive portal is not audio)."""
    if not content_type.lower().strip().startswith("audio/"):
        raise ProviderError(f"{provider} returned a non-audio content type")
    if not body:
        raise ProviderError(f"{provider} returned no audio")
    return body


class OpenAICompatTTS:
    """OpenAI-compatible speech: POST {base}/audio/speech (default gpt-4o-mini-tts; OpenAI shuts it down 2027-01-06)."""

    def __init__(
        self,
        *,
        keys: KeySource,
        transport: Transport,
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-4o-mini-tts",
        voice: str = "coral",
    ) -> None:
        self.name = "openai-tts"
        self._keys, self._t = keys, transport
        self._url = require_https(base_url.rstrip("/") + "/audio/speech")
        self._host = host_of(self._url)
        self._key_name = slot_for_host(self._host, custom_slot="tts-key")
        self._model, self._voice = model, voice

    def synthesize(self, text: str) -> bytes:
        key = self._keys.get(self._key_name, host=self._host)
        r = self._t.request(
            "POST",
            self._url,
            provider=self.name,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": self._model, "input": text, "voice": self._voice, "response_format": "mp3"},
        )
        return _audio_body(r.content_type, r.body, self.name)


# ---------------------------------------------------------------- search
class BraveSearch:
    """Brave Search API: POST https://api.search.brave.com/res/v1/web/search (JSON body keeps the question out of URLs)."""

    URL = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, *, keys: KeySource, transport: Transport, count: int = 5) -> None:
        self.name = "brave-search"
        self._keys, self._t, self._count = keys, transport, count
        self._host, self._key_name = host_of(self.URL), "brave-key"

    def search(self, query: str) -> SearchResult:
        key = self._keys.get(self._key_name, host=self._host)
        r = self._t.request(
            "POST",
            self.URL,
            provider=self.name,
            headers={"X-Subscription-Token": key, "Accept": "application/json", "Content-Type": "application/json"},
            json={"q": query, "count": self._count, "safesearch": "moderate"},
        )
        data = _json(r.body, self.name)
        web = data.get("web") if isinstance(data, dict) else None
        results = web.get("results") if isinstance(web, dict) else None
        if not isinstance(results, list):
            results = []
        sources: list[Source] = []
        snippets: list[str] = []
        for item in results[: self._count]:
            if not isinstance(item, dict):
                continue
            url = item.get("url")
            if isinstance(url, str):
                sources.append(Source(title=_clean(item.get("title"), 200), url=url))
            d = _clean(item.get("description"), 300)
            if d:
                snippets.append(d)
        return SearchResult(answer=" ".join(snippets)[:1500], sources=_https_sources(sources, self._count))


class TavilySearch:
    """Tavily: POST https://api.tavily.com/search with Bearer auth and include_answer."""

    URL = "https://api.tavily.com/search"

    def __init__(self, *, keys: KeySource, transport: Transport, max_results: int = 5) -> None:
        self.name = "tavily-search"
        self._keys, self._t, self._max = keys, transport, max_results
        self._host, self._key_name = host_of(self.URL), "tavily-key"

    def search(self, query: str) -> SearchResult:
        key = self._keys.get(self._key_name, host=self._host)
        r = self._t.request(
            "POST",
            self.URL,
            provider=self.name,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"query": query, "max_results": self._max, "include_answer": True, "search_depth": "basic"},
        )
        data = _json(r.body, self.name)
        if not isinstance(data, dict):
            raise ProviderError(f"{self.name} returned unexpected JSON")
        sources = [
            Source(title=_clean(i.get("title"), 200), url=i["url"])
            for i in (data.get("results") or [])
            if isinstance(i, dict) and isinstance(i.get("url"), str)
        ]
        answer = _clean(data.get("answer"), 1500)
        if not answer:
            answer = " ".join(
                _clean(i.get("content"), 300) for i in (data.get("results") or []) if isinstance(i, dict)
            )[:1500]
        return SearchResult(answer=answer, sources=_https_sources(sources, self._max))


__all__ = [
    "BraveSearch",
    "ChatLLM",
    "ChatTurn",
    "KeySource",
    "KeyringKeySource",
    "OpenAICompatChatLLM",
    "OpenAICompatSTT",
    "OpenAICompatTTS",
    "STTProvider",
    "SearchProvider",
    "SearchResult",
    "Source",
    "TTSProvider",
    "TavilySearch",
    "ToolCall",
    "Transcript",
    "XaiSTT",
    "XaiTTS",
]
