"""Append-only, hash-chained audit log. Every decision is recorded with its inputs, outcome and reasons."""
from __future__ import annotations
import hashlib, json, time
from .store import Store, dumps

GENESIS = "0" * 64


def _hash(prev, ts, actor, event, ref, inputs, outcome, reasons) -> str:
    body = dumps([prev, round(ts, 6), actor, event, ref, inputs, outcome, reasons])
    return hashlib.sha256(body.encode()).hexdigest()


def record(store: Store, event: str, *, actor: str = "system", ref: str | None = None,
           inputs=None, outcome: str = "ok", reasons=None) -> int:
    inputs = inputs if inputs is not None else {}
    reasons = reasons if reasons is not None else []
    with store._lock:
        last = store.one("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1")
        prev = last["hash"] if last else GENESIS
        ts = round(time.time(), 6)
        h = _hash(prev, ts, actor, event, ref, json.loads(dumps(inputs)), outcome, json.loads(dumps(reasons)))
        cur = store.execute("INSERT INTO audit_log(ts,actor,event,ref,inputs,outcome,reasons,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)",
                            (ts, actor, event, ref, dumps(inputs), outcome, dumps(reasons), prev, h))
        return cur.lastrowid


def verify(store: Store) -> dict:
    """Recompute the chain. Returns {'ok': bool, 'entries': n, 'broken_at': seq|None}."""
    prev = GENESIS
    n = 0
    for r in store.query("SELECT * FROM audit_log ORDER BY seq"):
        n += 1
        h = _hash(prev, r["ts"], r["actor"], r["event"], r["ref"], json.loads(r["inputs"]), r["outcome"], json.loads(r["reasons"]))
        if r["prev_hash"] != prev or r["hash"] != h:
            return {"ok": False, "entries": n, "broken_at": r["seq"]}
        prev = h
    return {"ok": True, "entries": n, "broken_at": None}


def tail(store: Store, n: int = 50, ref: str | None = None) -> list[dict]:
    q, p = "SELECT * FROM audit_log", ()
    if ref:
        q, p = q + " WHERE ref=?", (ref,)
    rows = store.query(q + " ORDER BY seq DESC LIMIT ?", p + (n,))
    for r in rows:
        r["inputs"] = json.loads(r["inputs"]); r["reasons"] = json.loads(r["reasons"])
    return rows
