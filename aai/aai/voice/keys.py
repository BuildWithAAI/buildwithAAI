"""Keys come ONLY from the OS keyring (service ``zoora-voice``). No env var, no file, no default.

On Windows that is Credential Manager (keyring's WinVaultKeyring). A missing key, an empty key, a key that is
not printable ASCII, a keyring error, or a non-OS keyring backend (plaintext/file/null) all fail closed.

Key slots are per provider and bound to that provider's host, so the xAI key can only ever be sent to
api.x.ai and the OpenAI key only to api.openai.com:

  xai-key     -> api.x.ai               (LLM, STT and TTS on xAI)
  openai-key  -> api.openai.com         (OpenAI STT/TTS/LLM, only if explicitly selected)
  brave-key   -> api.search.brave.com
  tavily-key  -> api.tavily.com
  llm-key / stt-key / tts-key -> a custom OpenAI-compatible host (never one of the hosts above)
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import keyring

from .errors import KeyMissingError, KeyringBackendError
from .redact import register_secret

SERVICE = "zoora-voice"

# Slot -> the only hosts that slot may be sent to.
BOUND_SLOTS: dict[str, frozenset[str]] = {
    "xai-key": frozenset({"api.x.ai"}),
    "openai-key": frozenset({"api.openai.com"}),
    "brave-key": frozenset({"api.search.brave.com"}),
    "tavily-key": frozenset({"api.tavily.com"}),
}
# Slots for a custom OpenAI-compatible endpoint; refused for any host that has its own bound slot.
CUSTOM_SLOTS: frozenset[str] = frozenset({"llm-key", "stt-key", "tts-key"})
KEY_NAMES: frozenset[str] = frozenset(BOUND_SLOTS) | CUSTOM_SLOTS
_BOUND_HOSTS: frozenset[str] = frozenset(h for hosts in BOUND_SLOTS.values() for h in hosts)

_MAX_KEY_LEN = 512

# keyring backends that are real OS credential stores. Anything else (keyrings.alt file/plaintext backends,
# keyring.backends.fail, keyring.backends.null, third-party plugins) is refused.
_OS_BACKEND_MODULES: tuple[str, ...] = (
    "keyring.backends.Windows",
    "keyring.backends.macOS",
    "keyring.backends.SecretService",
    "keyring.backends.libsecret",
    "keyring.backends.kwallet",
)

Getter = Callable[[str, str], str | None]


def slot_for_host(host: str, *, custom_slot: str) -> str:
    """The key slot for an https host: its bound slot if it has one, else the given custom slot."""
    h = host.lower()
    for slot, hosts in BOUND_SLOTS.items():
        if h in hosts:
            return slot
    if custom_slot not in CUSTOM_SLOTS:
        raise KeyMissingError(f"{custom_slot!r} is not a custom key slot")
    return custom_slot


def check_slot_host(name: str, host: str) -> None:
    """Raise unless key slot ``name`` may be sent to ``host``."""
    h = host.lower()
    if name in BOUND_SLOTS:
        if h not in BOUND_SLOTS[name]:
            raise KeyMissingError(f"key slot {name!r} may only be sent to {sorted(BOUND_SLOTS[name])}")
    elif name in CUSTOM_SLOTS:
        if h in _BOUND_HOSTS:
            raise KeyMissingError(f"key slot {name!r} may not be sent to {h}; that host has its own slot")
    else:
        raise KeyMissingError(f"unknown Zoora voice key name {name!r}")


def _leaf_backends(backend: Any) -> list[Any]:
    inner = getattr(backend, "backends", None)
    if type(backend).__name__ == "ChainerBackend" and isinstance(inner, (list, tuple)):
        out: list[Any] = []
        for b in inner:
            out.extend(_leaf_backends(b))
        return out
    return [backend]


def assert_os_backend(backend: Any | None = None) -> None:
    """Raise KeyringBackendError unless every active keyring backend is an OS credential store."""
    if backend is None:
        backend = keyring.get_keyring()
    leaves = _leaf_backends(backend)
    if not leaves:
        raise KeyringBackendError("no OS keyring backend available; refusing to read Zoora voice keys")
    for b in leaves:
        mod = type(b).__module__
        if not any(mod == m or mod.startswith(m + ".") for m in _OS_BACKEND_MODULES):
            raise KeyringBackendError(
                f"keyring backend {type(b).__name__} ({mod}) is not an OS credential store; refusing to read keys"
            )


class KeyringKeySource:
    """Reads a named key from the OS keyring on every call (nothing cached on the instance)."""

    def __init__(self, *, getter: Getter | None = None, check_backend: bool = True) -> None:
        self._getter: Getter = getter if getter is not None else keyring.get_password
        self._check_backend = check_backend

    def get(self, name: str, *, host: str | None = None) -> str:
        """Return the key in slot ``name``. Providers pass ``host`` so a slot can't go to the wrong provider."""
        if name not in KEY_NAMES:
            raise KeyMissingError(f"unknown Zoora voice key name {name!r}")
        if host is not None:
            check_slot_host(name, host)
        if self._check_backend:
            assert_os_backend()
        try:
            value = self._getter(SERVICE, name)
        except Exception:  # noqa: BLE001 - never surface backend detail; fail closed
            raise KeyMissingError(
                f"could not read {name!r} from the OS keyring (service {SERVICE!r}); Zoora voice is disabled"
            ) from None
        if not isinstance(value, str) or not value.strip():
            raise KeyMissingError(
                f"{name!r} is not set in the OS keyring (service {SERVICE!r}). "
                f"Set it with: py -m keyring set {SERVICE} {name}"
            )
        value = value.strip()
        # Interior non-ASCII (zero-width space, smart quote) or control characters would make httpx raise an
        # encoding error whose repr contains the whole header. Refuse without ever echoing the value.
        if not (value.isascii() and value.isprintable()) or " " in value or len(value) > _MAX_KEY_LEN:
            raise KeyMissingError(
                f"{name!r} in the OS keyring contains characters an API key can't have (non-ASCII, spaces or "
                f"control characters). Re-enter it with: py -m keyring set {SERVICE} {name}"
            )
        register_secret(value)
        return value
