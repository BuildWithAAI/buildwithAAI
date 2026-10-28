"""Refuse a download that could run.

Agents may exchange text, JSON, and pinned research fixtures. They may not
receive raw executables, scripts, or archives. A refused file is omitted,
not stored as an empty artifact.
"""
from __future__ import annotations

import json

BLOCKED_SUFFIXES = (
    ".exe", ".dll", ".so", ".dylib", ".bin", ".app",
    ".sh", ".bash", ".ps1", ".bat", ".cmd",
    ".py", ".js", ".mjs", ".wasm",
    ".zip", ".tar", ".gz", ".7z", ".rar",
)
ALLOWED_SUFFIXES = (".json", ".md", ".txt", ".csv")
MAX_BYTES = 1_048_576


class ArtifactError(ValueError):
    pass


def classify(name: str, size: int, mime: str) -> dict:
    if type(name) is not str or "/" in name or "\\" in name or name.startswith("."):
        raise ArtifactError("UNSAFE_NAME")
    lower = name.lower()
    if any(lower.endswith(suffix) for suffix in BLOCKED_SUFFIXES):
        raise ArtifactError("BLOCKED_ARTIFACT")
    if not any(lower.endswith(suffix) for suffix in ALLOWED_SUFFIXES):
        raise ArtifactError("UNLISTED_ARTIFACT")
    if type(size) is not int or not 1 <= size <= MAX_BYTES:
        raise ArtifactError("SIZE_REJECTED")
    if mime not in {"application/json", "text/plain", "text/markdown", "text/csv"}:
        raise ArtifactError("MIME_REJECTED")
    return {
        "name": name,
        "size": size,
        "mime": mime,
        "stored": True,
        "executable": False,
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    good = classify("receipt.json", 128, "application/json")
    try:
        classify("payload.sh", 20, "text/plain")
    except ArtifactError as err:
        if str(err) != "BLOCKED_ARTIFACT":
            raise
    else:
        raise ArtifactError("SCRIPT_ACCEPTED")
    return {"stored": good["stored"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
