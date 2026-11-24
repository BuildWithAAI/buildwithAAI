"""Append-only, hash-chained JSONL audit log (state/audit.jsonl, mode 0600).

Every guard decision (order allowed/denied, key use, money-movement attempt, kill switch change,
injection flag) is appended. Each line carries prev-hash + hash so edits/deletions are detectable
with verify(). Values are passed through redact() first: secrets never land in the log.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

from . import paths
from .redact import fingerprint, redact

GENESIS = "0" * 64


def _h(prev: str, body: dict) -> str:
    return hashlib.sha256((prev + json.dumps(body, sort_keys=True, separators=(",", ":"))).encode()).hexdigest()


def _last(path: Path) -> tuple[int, str]:
    if not path.exists() or path.stat().st_size == 0:
        return 0, GENESIS
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - 65536))
        lines = [ln for ln in f.read().splitlines() if ln.strip()]
    rec = json.loads(lines[-1])
    return int(rec["seq"]), rec["hash"]


def append(event: str, agent: str, data: dict | None = None, outcome: str = "ok", path: Path | None = None) -> dict:
    path = Path(path or paths.audit_file())
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        seq, prev = _last(path)
        body = {"seq": seq + 1, "ts": round(time.time(), 6),
                "ts_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "agent": str(agent), "event": str(event), "outcome": str(outcome),
                "data": redact(data or {}), "pid": os.getpid()}
        body["prev"] = prev
        body["hash"] = _h(prev, {k: v for k, v in body.items() if k not in ("hash",)})
        os.write(fd, (json.dumps(body, sort_keys=True, ensure_ascii=False) + "\n").encode())
        os.fsync(fd)
        return body
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def log_key_use(agent: str, venue: str, key_id: str, purpose: str, path: Path | None = None) -> dict:
    """Record that an agent used an exchange/API key. Only a fingerprint of the key id is stored."""
    return append("key_use", agent, {"venue": venue, "key_fp": fingerprint(key_id), "purpose": purpose}, path=path)


def verify(path: Path | None = None) -> dict:
    path = Path(path or paths.audit_file())
    if not path.exists():
        return {"ok": True, "entries": 0, "broken_at": None, "note": "no audit log yet"}
    prev, n = GENESIS, 0
    with open(path) as f:
        for line in f:
            if not line.strip():
                continue
            n += 1
            try:
                rec = json.loads(line)
            except ValueError:
                return {"ok": False, "entries": n, "broken_at": n, "reason": "unparseable line"}
            h = rec.get("hash")
            body = {k: v for k, v in rec.items() if k != "hash"}
            if rec.get("prev") != prev or _h(prev, body) != h or rec.get("seq") != n:
                return {"ok": False, "entries": n, "broken_at": n, "reason": "hash chain mismatch"}
            prev = h
    return {"ok": True, "entries": n, "broken_at": None}


def tail(n: int = 20, path: Path | None = None) -> list[dict]:
    path = Path(path or paths.audit_file())
    if not path.exists():
        return []
    with open(path) as f:
        lines = [ln for ln in f if ln.strip()]
    return [json.loads(x) for x in lines[-n:]]
