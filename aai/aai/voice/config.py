"""Zoora voice limits and provider settings. Safe defaults: nothing stored, small caps, short timeouts."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class VoiceConfig:
    # Audio input (push-to-talk clip handed in by the HUD).
    max_audio_bytes: int = 10 * 1024 * 1024
    max_audio_seconds: float = 60.0
    # Text caps.
    max_question_chars: int = 2_000
    max_context_chars: int = 4_000
    max_answer_chars: int = 1_500
    max_speak_chars: int = 600
    max_tts_chars: int = 1_000
    max_transcript_chars: int = 2_000
    # Tool use: web_search is the ONLY tool.
    max_tool_rounds: int = 2
    max_search_calls: int = 3
    max_search_query_chars: int = 300
    max_sources: int = 8
    # Overall wall-clock budget per public call (covers every LLM/search/STT/TTS request inside it).
    ask_deadline_s: float = 45.0
    call_deadline_s: float = 40.0
    # Network (per request; never more than what is left of the call's budget).
    timeout_s: float = 30.0
    connect_timeout_s: float = 5.0
    max_response_bytes: int = 20 * 1024 * 1024
    # Storage: OFF by default. Opt-in only; audio and transcripts are separate switches.
    store_transcripts: bool = False
    store_audio: bool = False
    store_dir: Path | None = None
    # Provider defaults (all overridable).
    llm_base_url: str = "https://api.x.ai/v1"
    llm_model: str = "grok-4.7"
    llm_max_completion_tokens: int = 600
    llm_reasoning_effort: str | None = "low"  # grok-4.7 defaults to high; low keeps voice answers fast
    stt_model: str = "grok-voice-transcribe-2.0"
    tts_voice: str = "eve"
    language: str = "en"
    # Explicit OpenAI choice only (stt="openai"/tts="openai"); uses the separate openai-key slot.
    openai_stt_model: str = "gpt-transcribe"
    openai_tts_model: str = "gpt-4o-mini-tts"  # OpenAI shuts this model down on 2027-01-06
    openai_tts_voice: str = "coral"

    def __post_init__(self) -> None:
        if (self.store_transcripts or self.store_audio) and self.store_dir is None:
            raise ValueError("store_transcripts/store_audio require an explicit store_dir")
        positive_ints = {
            "max_audio_bytes": self.max_audio_bytes,
            "max_answer_chars": self.max_answer_chars,
            "max_speak_chars": self.max_speak_chars,
            "max_tts_chars": self.max_tts_chars,
        }
        for name, iv in positive_ints.items():
            if iv <= 0:
                raise ValueError(f"{name} must be positive")
        if not (math.isfinite(self.max_audio_seconds) and 0 < self.max_audio_seconds <= 60):
            raise ValueError("max_audio_seconds must be in (0, 60]")
        seconds = {
            "ask_deadline_s": self.ask_deadline_s,
            "call_deadline_s": self.call_deadline_s,
            "timeout_s": self.timeout_s,
            "connect_timeout_s": self.connect_timeout_s,
        }
        for name, v in seconds.items():
            if not (math.isfinite(v) and v > 0):
                raise ValueError(f"{name} must be a positive number")
