"""Structured (JSON-lines) logging to stderr. Never logs secrets (API keys are redacted from URLs)."""
import json, logging, os, re, sys, time

_KEY_RE = re.compile(r"(api-key=)[^&\s\"]+")


class JsonFormatter(logging.Formatter):
    def format(self, r: logging.LogRecord) -> str:
        d = {"ts": round(r.created, 3), "level": r.levelname, "logger": r.name, "msg": _KEY_RE.sub(r"\1***", r.getMessage())}
        for k, v in getattr(r, "fields", {}).items():
            d[k] = _KEY_RE.sub(r"\1***", v) if isinstance(v, str) else v
        if r.exc_info:
            d["exc"] = self.formatException(r.exc_info)
        return json.dumps(d, default=str)


def setup(level: str | None = None) -> None:
    lvl = (level or os.environ.get("SMR_LOG_LEVEL") or "WARNING").upper()
    root = logging.getLogger("smr")
    if getattr(root, "_smr_configured", False):
        root.setLevel(lvl); return
    h = logging.StreamHandler(sys.stderr)
    h.setFormatter(JsonFormatter())
    root.addHandler(h); root.setLevel(lvl); root.propagate = False
    root._smr_configured = True


def get(name: str) -> logging.Logger:
    return logging.getLogger(f"smr.{name}")


def event(logger: logging.Logger, msg: str, level=logging.INFO, **fields) -> None:
    logger.log(level, msg, extra={"fields": fields})
