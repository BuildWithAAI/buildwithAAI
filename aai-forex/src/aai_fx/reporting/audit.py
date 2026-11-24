"""Append-only, hash-chained audit log (JSON Lines).

Each record: {seq, ts, run_id, event, payload, prev, hash} where
hash = sha256(prev + canonical_json(record_without_hash)). Any edit, deletion
or reordering of earlier lines breaks the chain and is detected by
``verify_audit_log``. The file is only ever opened in append mode.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GENESIS = "0" * 64


def _canon(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _last_line(path: Path) -> str | None:
    if not path.exists() or path.stat().st_size == 0:
        return None
    with open(path, "rb") as fh:
        fh.seek(0, os.SEEK_END)
        pos = fh.tell() - 1
        buf = b""
        while pos >= 0:
            fh.seek(pos)
            ch = fh.read(1)
            if ch == b"\n" and buf:
                break
            buf = ch + buf
            pos -= 1
    return buf.decode().strip() or None


class AuditLog:
    def __init__(self, path: str | Path, run_id: str = "") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.run_id = run_id
        last = _last_line(self.path)
        if last:
            rec = json.loads(last)
            self._prev, self._seq = rec["hash"], int(rec["seq"])
        else:
            self._prev, self._seq = GENESIS, 0
        self._fh = open(self.path, "a", encoding="utf-8")
        self.count = 0

    def append(self, event: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._seq += 1
        rec = {"seq": self._seq, "ts": datetime.now(timezone.utc).isoformat(), "run_id": self.run_id,
               "event": event, "payload": payload, "prev": self._prev}
        h = hashlib.sha256((self._prev + _canon(rec)).encode()).hexdigest()
        rec["hash"] = h
        self._fh.write(_canon(rec) + "\n")
        self._fh.flush()
        self._prev = h
        self.count += 1
        return rec

    def close(self) -> None:
        if not self._fh.closed:
            self._fh.flush()
            os.fsync(self._fh.fileno())
            self._fh.close()

    def __enter__(self) -> "AuditLog":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def verify_audit_log(path: str | Path) -> tuple[bool, int, str]:
    """Return (ok, records_checked, message)."""
    prev, n = GENESIS, 0
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            h = rec.pop("hash")
            if rec.get("prev") != prev:
                return False, n, f"chain break at seq {rec.get('seq')}: prev mismatch"
            if hashlib.sha256((prev + _canon(rec)).encode()).hexdigest() != h:
                return False, n, f"hash mismatch at seq {rec.get('seq')} (record altered)"
            prev = h
            n += 1
    return True, n, "ok"
