"""Human-approval tokens for (a) orders above caps and (b) ANY off-exchange money movement.

A token is a JSON file in approvals/pending/<id>.json created by the HUMAN with
`agent-guard approve ...` (interactive TTY + typed confirmation). It is single-use (moved to
approvals/used/ when consumed), expires (default 15 min), and must match agent, action, asset,
amount (exact, or <= for orders) and destination exactly.

LIMITATION (stated plainly): every agent on this box runs as the same Unix user, so an agent could
technically write a token file. This layer stops mistakes and naive/prompt-injected agents and
leaves an audit trail; the real backstop for withdrawals is exchange-side: API keys with
withdrawal permission OFF + IP whitelist + exchange withdrawal address whitelist with 2FA.
"""
from __future__ import annotations

import json
import os
import secrets
import sys
import time
from pathlib import Path

from . import audit_log, paths
from .errors import ApprovalRequired


def _dirs() -> tuple[Path, Path]:
    d = paths.approvals_dir()
    p, u = d / "pending", d / "used"
    p.mkdir(parents=True, exist_ok=True)
    u.mkdir(parents=True, exist_ok=True)
    return p, u


def create(agent: str, action: str, asset: str, amount: float, destination: str, ttl_sec: int = 900,
           note: str = "", interactive: bool = True) -> dict:
    if interactive:
        if not sys.stdin.isatty():
            raise ApprovalRequired("approvals must be created by a human at an interactive terminal")
        phrase = f"APPROVE {action} {amount} {asset} TO {destination}"
        print(f"Type exactly to approve:\n  {phrase}")
        if input("> ").strip() != phrase:
            raise ApprovalRequired("confirmation phrase mismatch; nothing approved")
    pend, _ = _dirs()
    tid = secrets.token_hex(8)
    tok = {"id": tid, "agent": agent, "action": action, "asset": asset, "amount": float(amount),
           "destination": destination, "created_at": time.time(), "expires_at": time.time() + ttl_sec,
           "note": note, "approved_by": "human-cli"}
    f = pend / f"{tid}.json"
    f.write_text(json.dumps(tok))
    os.chmod(f, 0o600)
    audit_log.append("approval_created", "human", {k: v for k, v in tok.items()})
    return tok


def consume(token_id: str | None, *, agent: str, action: str, asset: str, amount: float, destination: str) -> dict:
    pend, used = _dirs()
    if not token_id or not all(c in "0123456789abcdef" for c in str(token_id)):
        raise ApprovalRequired("no valid approval token id supplied")
    src = pend / f"{token_id}.json"
    claimed = used / f"{token_id}.json"
    try:
        os.rename(src, claimed)  # atomic claim => single use
    except FileNotFoundError:
        audit_log.append("approval_rejected", agent, {"token": token_id, "reason": "not found/already used"}, "denied")
        raise ApprovalRequired(f"approval token {token_id} not found or already used")
    tok = json.loads(claimed.read_text())
    problems = []
    if time.time() > float(tok.get("expires_at", 0)):
        problems.append("expired")
    for k, v in (("agent", agent), ("action", action), ("asset", asset), ("destination", destination)):
        if str(tok.get(k)) != str(v):
            problems.append(f"{k} mismatch")
    amt_ok = (float(amount) <= float(tok.get("amount", -1)) + 1e-9) if action == "order" \
        else abs(float(amount) - float(tok.get("amount", -1))) < 1e-9
    if not amt_ok:
        problems.append("amount mismatch")
    if problems:
        audit_log.append("approval_rejected", agent, {"token": token_id, "problems": problems}, "denied")
        raise ApprovalRequired(f"approval token {token_id} rejected: {', '.join(problems)}")
    audit_log.append("approval_consumed", agent, {"token": token_id, "action": action, "asset": asset,
                                                  "amount": amount, "destination": destination})
    return tok
