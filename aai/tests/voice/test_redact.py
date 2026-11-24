from __future__ import annotations

import logging

import httpx
import pytest

from aai.voice import ProviderError, VoiceGateway, constant_time_verifier, redact
from aai.voice.keys import KeyringKeySource
from aai.voice.net import Transport
from aai.voice.providers import OpenAICompatChatLLM

from .fakes import TOKEN, FakeSTT, FakeTTS

SECRET = "zv-llm-SECRET-9f8e7d6c5b4a3210"  # gitleaks:allow (fake fixture key)


@pytest.fixture(autouse=True)
def _clean():
    redact._clear_for_tests()
    yield
    redact._clear_for_tests()


def test_registered_key_is_scrubbed(caplog):
    KeyringKeySource(getter=lambda s, n: SECRET, check_backend=False).get("llm-key")
    log = redact.get_logger()
    with caplog.at_level(logging.DEBUG, logger="aai.voice"):
        log.warning("oops key=%s", SECRET)
        log.info(f"inline {SECRET} again")
        try:
            raise RuntimeError(f"boom {SECRET}")
        except RuntimeError:
            log.exception("failed")
    text = caplog.text + "".join((r.exc_text or "") for r in caplog.records)
    assert SECRET not in text and redact.REDACTED in text


@pytest.mark.parametrize(
    "line",
    [
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
        "X-Subscription-Token: BSAabcdefghijklmnop",
        "key xai-abcdefghijklmnopqrstuv in text",
        "tvly-abcdefghijklmnopqrst",
        "sk-proj_abcdefghijklmnopqrst",
        '{"authorization": "Bearer zzzzzzzzzzzzzzzz"}',
    ],
)
def test_credential_shapes_scrubbed_even_if_unregistered(line):
    out = redact.scrub(line)
    assert redact.REDACTED in out
    assert "abcdefghijklmnop" not in out and "zzzzzzzzzzzzzzzz" not in out


def test_hud_token_scrubbed_after_use(caplog, make_gw):
    gw = make_gw()
    gw.synthesize("hi", hud_token=TOKEN)
    with caplog.at_level(logging.INFO, logger="aai.voice"):
        redact.get_logger().info("token was %s", TOKEN)
    assert TOKEN not in caplog.text


def test_scrub_filter_installed_once():
    redact.get_logger()
    redact.get_logger()
    assert sum(isinstance(f, redact.ScrubFilter) for f in logging.getLogger("aai.voice").filters) == 1


def test_full_failure_path_never_logs_key(caplog):
    """Provider echoes the key in a 401 body; neither the exception nor any log line may contain it."""
    keys = KeyringKeySource(getter=lambda s, n: SECRET, check_backend=False)
    t = Transport(
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda r: httpx.Response(401, text=f"invalid key {r.headers['authorization']}")
            ),
            trust_env=False,
        )
    )
    gw = VoiceGateway(
        token_verifier=constant_time_verifier(lambda: TOKEN),
        llm=OpenAICompatChatLLM(keys=keys, transport=t),
        stt=FakeSTT(),
        tts=FakeTTS(),
    )
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(ProviderError) as ei:
            gw.ask("hi", {}, hud_token=TOKEN)
        logging.getLogger("aai.voice").error("ask failed: %s", ei.value)
    assert SECRET not in str(ei.value) and SECRET not in caplog.text


def test_http_client_loggers_kept_at_warning():
    import aai.voice  # noqa: F401

    redact.get_logger()
    assert logging.getLogger("httpx").level >= logging.WARNING
    assert logging.getLogger("httpcore").level >= logging.WARNING
