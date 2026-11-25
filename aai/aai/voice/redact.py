"""Log scrubbing for Zoora voice. Every key read from the keyring is registered here and redacted from logs."""

from __future__ import annotations

import logging
import re
import threading

REDACTED = "[" + "REDACTED" + "]"
_MIN_SECRET_LEN = 8
_lock = threading.Lock()
_secrets: set[str] = set()

# Shapes of credentials that must never reach a log even if they were never registered.
_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=\-]{6,}"),
    re.compile(r"(?i)(x-subscription-token[\"']?\s*[:=]\s*[\"']?)[A-Za-z0-9._\-]{6,}"),
    re.compile(r"(?i)(authorization[\"']?\s*[:=]\s*[\"']?)[^\s\"',}]{6,}"),
    re.compile(r"()\b(?:xai|sk|tvly|BSA)[-_][A-Za-z0-9_\-]{12,}"),
)

LOGGER_NAME = "aai.voice"


def register_secret(value: str) -> None:
    """Remember a secret so scrub() removes it. Short values are ignored (too likely to be ordinary text)."""
    if isinstance(value, str) and len(value) >= _MIN_SECRET_LEN:
        with _lock:
            _secrets.add(value)


def _clear_for_tests() -> None:
    with _lock:
        _secrets.clear()


def scrub(text: str) -> str:
    """Return text with every registered secret and every credential-shaped token replaced."""
    with _lock:
        known = sorted(_secrets, key=len, reverse=True)
    for s in known:
        if s in text:
            text = text.replace(s, REDACTED)
    for pat in _PATTERNS:
        text = pat.sub(lambda m: m.group(1) + REDACTED, text)
    return text


class ScrubFilter(logging.Filter):
    """Rewrites each record's message (and formatted traceback) through scrub()."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # noqa: BLE001 - a bad format string must not leak args
            msg = str(record.msg)
        record.msg = scrub(msg)
        record.args = None
        if record.exc_info:
            formatter = logging.Formatter()
            record.exc_text = scrub(formatter.formatException(record.exc_info))
            record.exc_info = None
        if record.stack_info:
            record.stack_info = scrub(record.stack_info)
        return True


def quiet_http_loggers() -> None:
    """httpx/httpcore log request URLs at INFO/DEBUG; keep them at WARNING so questions never reach a log."""
    for name in ("httpx", "httpcore"):
        lg = logging.getLogger(name)
        if lg.level < logging.WARNING:
            lg.setLevel(logging.WARNING)


def get_logger() -> logging.Logger:
    """The single logger every aai.voice module uses, with the scrub filter installed exactly once."""
    quiet_http_loggers()
    log = logging.getLogger(LOGGER_NAME)
    if not any(isinstance(f, ScrubFilter) for f in log.filters):
        log.addFilter(ScrubFilter())
    return log
