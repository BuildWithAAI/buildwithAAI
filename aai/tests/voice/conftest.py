"""Zoora voice tests: fake providers only, no network, no real keys.

If the voice deps (httpx, keyring) are not installed in this interpreter, the voice tests are not collected,
so the rest of the repo's suite still runs. Install them with: pip install -r aai/voice/requirements.txt
"""

from __future__ import annotations

import importlib.util
from typing import Any

import pytest

MISSING_DEPS = [m for m in ("httpx", "keyring") if importlib.util.find_spec(m) is None]

if MISSING_DEPS:
    collect_ignore_glob = ["test_*.py"]
else:
    from aai.voice.gateway import VoiceGateway, constant_time_verifier
    from aai.voice.providers import ChatTurn

    from .fakes import TOKEN, FakeLLM, FakeSearch, FakeSTT, FakeTTS

    @pytest.fixture
    def verifier():
        return constant_time_verifier(lambda: TOKEN)

    @pytest.fixture
    def make_gw(verifier):
        def _make(**kw: Any) -> VoiceGateway:
            kw.setdefault("llm", FakeLLM([ChatTurn(content="It is 41 degrees.")]))
            kw.setdefault("stt", FakeSTT())
            kw.setdefault("tts", FakeTTS())
            kw.setdefault("search", FakeSearch())
            return VoiceGateway(token_verifier=verifier, **kw)

        return _make
