"""Never let secret values reach logs. fingerprint() = first 4 chars + length (no hash, no tail)."""
from __future__ import annotations

import re
from typing import Any

REDACTED = "[" + "REDACTED" + "]"

SECRET_KEY_RE = re.compile(
    r"(?i)(api[_-]?key|api[_-]?secret|secret|passphrase|password|passwd|token|private[_-]?key|"
    r"priv[_-]?key|mnemonic|seed|signature|auth|cookie|webhook|bearer|credential)")
SECRET_VALUE_RES = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)"),
    re.compile(r"(?i)\b0x[a-f0-9]{64}\b"),                       # raw EVM private key / 32-byte secret
    re.compile(r"\[(\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]"),         # Solana keypair byte array
    re.compile(r"(?i)(api-key=|apikey=|key=|token=|secret=)[^&\s\"']+"),
    re.compile(r"https://(discord|discordapp)\.com/api/webhooks/\S+"),
]


def fingerprint(value: Any) -> str:
    s = "" if value is None else str(value)
    if not s:
        return "<empty>"
    return f"{s[:4]}…(len {len(s)})"


def redact_text(s: str) -> str:
    for r in SECRET_VALUE_RES:
        s = r.sub(REDACTED, s)
    return s


def redact(obj: Any, _depth: int = 0) -> Any:
    """Recursively redact dict values whose KEY looks secret, and secret-looking substrings in strings."""
    if _depth > 20:
        return "[DEPTH]"
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if isinstance(k, str) and SECRET_KEY_RE.search(k) and not isinstance(v, (dict, list, bool)) \
                    and v is not None and not k.endswith(("_fp", "_fingerprint", "_id")):
                out[k] = fingerprint(v) if k.lower() not in ("seed", "mnemonic", "private_key", "privkey") else REDACTED
            else:
                out[k] = redact(v, _depth + 1)
        return out
    if isinstance(obj, (list, tuple)):
        return [redact(v, _depth + 1) for v in obj]
    if isinstance(obj, str):
        return redact_text(obj)
    return obj
