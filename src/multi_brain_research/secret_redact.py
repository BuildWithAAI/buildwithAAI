"""Strip secrets before a record leaves a module.

Receipts, offers, and dispute notes must not carry keys, tokens, or seeds.
Redaction replaces the value. It does not log the original.
"""
from __future__ import annotations

import json
import re

SECRET_KEYS = {
    "api_key", "apikey", "authorization", "bearer", "credential", "password",
    "private_key", "secret", "seed", "token", "mnemonic",
}
SECRET_VALUE = re.compile(r"(sk-test|sk-live|ghp_|gho_|github_pat_|bearer\s+)[A-Za-z0-9_\-]{8,}", re.I)
REDACTED = "[REDACTED]"


def redact(value):
    if type(value) is dict:
        clean = {}
        for key, item in value.items():
            if type(key) is str and key.lower() in SECRET_KEYS:
                clean[key] = REDACTED
            else:
                clean[key] = redact(item)
        return clean
    if type(value) is list:
        return [redact(item) for item in value]
    if type(value) is str and SECRET_VALUE.search(value):
        return REDACTED
    return value


def self_check() -> dict:
    clean = redact({"note": "ok", "token": "ghp_abcdefghijklmnopqrstuvwxyz", "nested": {"seed": "abc"}})
    if clean["token"] != REDACTED or clean["nested"]["seed"] != REDACTED or clean["note"] != "ok":
        raise RuntimeError("REDACT_FAILED")
    return {"redacted": True, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
