"""Zoora voice: a standalone push-to-talk voice gateway (STT -> LLM with web_search only -> TTS).

It can never reach trading, spending, transfers, the signer, ledger writes or Zoora world edits: it imports
nothing from any other ``aai`` package (enforced by tests/voice/test_denylist.py).
"""

from __future__ import annotations

from .config import VoiceConfig
from .errors import (
    InputRejectedError,
    InsecureURLError,
    KeyMissingError,
    KeyringBackendError,
    ProviderError,
    UnauthorizedError,
    VoiceError,
)
from .gateway import (
    AskResult,
    VoiceGateway,
    ask,
    constant_time_verifier,
    set_default_gateway,
    synthesize,
    transcribe,
)

__all__ = [
    "AskResult",
    "InputRejectedError",
    "InsecureURLError",
    "KeyMissingError",
    "KeyringBackendError",
    "ProviderError",
    "UnauthorizedError",
    "VoiceConfig",
    "VoiceError",
    "VoiceGateway",
    "ask",
    "constant_time_verifier",
    "set_default_gateway",
    "synthesize",
    "transcribe",
]
