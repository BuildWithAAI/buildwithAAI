"""Lock-file convention for automated improvement runs: /workspace/aai/.improve.lock

A run MUST `acquire` before touching the repo and `release` when done (also on failure). Creation is atomic
(O_CREAT|O_EXCL). A lock older than its ttl is stale and may be taken over; the takeover is recorded in the file.
Contents: {"owner", "pid", "host", "acquired_at", "ttl_sec", "expires_at", "took_over"} plus, after a `refresh`,
{"refreshed_at", "refreshes"}. A long run extends its own lock with `refresh` (same owner only); `acquire` by the same
owner still answers "held" (exit 3) so the contract's "exit 3 means stop" stays unambiguous.
"""
from __future__ import annotations
import json, os, socket, time
from .config import ROOT

LOCK = ROOT / ".improve.lock"


def _read():
    try:
        return json.loads(LOCK.read_text())
    except (OSError, ValueError):
        return None


def status() -> dict:
    d = _read()
    if not d:
        return {"ok": True, "held": False, "path": str(LOCK)}
    return {"ok": True, "held": True, "stale": time.time() > d.get("expires_at", 0), "path": str(LOCK), **d}


def acquire(owner: str, ttl: int = 1800) -> dict:
    now = time.time()
    rec = {"owner": owner, "pid": os.getpid(), "host": socket.gethostname(), "acquired_at": now, "ttl_sec": ttl,
           "expires_at": now + ttl, "took_over": None}
    for _ in range(2):
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
            with os.fdopen(fd, "w") as f:
                json.dump(rec, f)
            return {"ok": True, "acquired": True, "path": str(LOCK), **rec}
        except FileExistsError:
            cur = _read() or {}
            if cur and now <= cur.get("expires_at", 0):
                return {"ok": False, "acquired": False, "reason": "held", "holder": cur}
            # stale or unreadable: take over by atomic replace of a freshly written temp file
            rec["took_over"] = cur or "unreadable"
            tmp = LOCK.with_suffix(f".{os.getpid()}.tmp")
            tmp.write_text(json.dumps(rec))
            os.replace(tmp, LOCK)
            return {"ok": True, "acquired": True, "path": str(LOCK), **rec}
    return {"ok": False, "acquired": False, "reason": "race"}


def refresh(owner: str, ttl: int = 1800) -> dict:
    """Extend a lock this owner already holds: expires_at = now + ttl, records refreshed_at / refreshes.

    Never creates a lock and never takes over another owner's lock (stale or not). If our own lock went stale but nobody
    took it over, it is still ours, so the refresh is allowed and reported with was_stale=True. The write is an atomic
    replace; a takeover can only happen once the lock is stale, so read-then-replace cannot steal a live lock."""
    now = time.time()
    cur = _read()
    if not cur:
        return {"ok": False, "refreshed": False, "reason": "not held"}
    if cur.get("owner") != owner:
        return {"ok": False, "refreshed": False, "reason": f"held by {cur.get('owner')}", "holder": cur}
    ttl = max(1, int(ttl))
    was_stale = now > cur.get("expires_at", 0)
    rec = {**cur, "ttl_sec": ttl, "expires_at": now + ttl, "refreshed_at": now,
           "refreshes": int(cur.get("refreshes") or 0) + 1}
    tmp = LOCK.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(rec))
    os.replace(tmp, LOCK)
    return {"ok": True, "refreshed": True, "was_stale": was_stale, "path": str(LOCK), **rec}


def release(owner: str, force: bool = False) -> dict:
    cur = _read()
    if not cur:
        return {"ok": True, "released": False, "reason": "not held"}
    if cur.get("owner") != owner and not force:
        return {"ok": False, "released": False, "reason": f"held by {cur.get('owner')}"}
    try:
        LOCK.unlink()
    except FileNotFoundError:
        pass
    return {"ok": True, "released": True}
