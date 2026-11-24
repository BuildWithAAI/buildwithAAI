"""Zoora voice error types. Messages never carry keys, tokens, audio or provider response bodies."""

from __future__ import annotations


class VoiceError(Exception):
    """Base class for every Zoora voice failure."""


class UnauthorizedError(VoiceError):
    """The localhost HUD token was missing or wrong."""


class KeyMissingError(VoiceError):
    """A required key is not in the OS keyring (fail closed)."""


class KeyringBackendError(VoiceError):
    """The active keyring backend is not an OS credential store."""


class InputRejectedError(VoiceError):
    """Input failed validation (type, empty, too large, too long)."""


class InsecureURLError(VoiceError):
    """A provider URL was not https."""


class ProviderError(VoiceError):
    """An upstream provider failed. Carries only provider name and HTTP status."""
