"""Structured JSON-lines logging to stderr. Secrets (api keys / tokens in URLs or fields) are redacted."""
from __future__ import annotations
import json, logging, os, re, sys

_SECRET_RE = re.compile(r"((?:api[-_]?key|apikey|token|secret|signature|sign|passphrase)=)[^&\s\"]+", re.I)
_SECRET_FIELDS = {"api_key", "apikey", "secret", "token", "passphrase", "signature", "private_key"}


def redact(s: str) -> str:
    return _SECRET_RE.sub(r"\1***", s)


class JsonFormatter(logging.Formatter):
    def format(self, r: logging.LogRecord) -> str:
        d = {"ts": round(r.created, 3), "level": r.levelname, "logger": r.name, "msg": redact(r.getMessage())}
        for k, v in getattr(r, "fields", {}).items():
            d[k] = "***" if k.lower() in _SECRET_FIELDS else (redact(v) if isinstance(v, str) else v)
        if r.exc_info:
            d["exc"] = self.formatException(r.exc_info)
        return json.dumps(d, default=str)


def setup(level: str | None = None) -> None:
    lvl = (level or os.environ.get("AAI_LOG_LEVEL") or "WARNING").upper()
    root = logging.getLogger("aai")
    if getattr(root, "_aai_configured", False):
        root.setLevel(lvl); return
    h = logging.StreamHandler(sys.stderr)
    h.setFormatter(JsonFormatter())
    root.addHandler(h); root.setLevel(lvl); root.propagate = False
    root._aai_configured = True


def get(name: str) -> logging.Logger:
    return logging.getLogger(f"aai.{name}")


def event(logger: logging.Logger, msg: str, level=logging.INFO, **fields) -> None:
    logger.log(level, msg, extra={"fields": fields})
