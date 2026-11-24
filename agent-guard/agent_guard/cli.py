"""agent-guard CLI.

  killswitch on --reason "..."        engage global kill switch (+ propagate to project kill files)
  killswitch off --confirm RESUME --reason "..."
  killswitch status
  audit verify | audit tail [-n 20]
  check-text "<text>" | check-text --file path     injection detector
  approve --agent perps --action withdraw --asset USDT --amount 100 --destination <addr> [--ttl 900]
  config-check
"""
from __future__ import annotations

import argparse
import json
import sys

from . import approvals, audit_log, config, killswitch
from .sanitize import detect_injection, max_severity


def _out(x):
    print(json.dumps(x, indent=2, default=str))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="agent-guard")
    sub = ap.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("killswitch")
    k.add_argument("state", choices=["on", "off", "status"])
    k.add_argument("--reason", default="manual")
    k.add_argument("--confirm", default="")
    k.add_argument("--actor", default="human")
    k.add_argument("--no-propagate", action="store_true")
    a = sub.add_parser("audit")
    a.add_argument("what", choices=["verify", "tail"])
    a.add_argument("-n", type=int, default=20)
    c = sub.add_parser("check-text")
    c.add_argument("text", nargs="?")
    c.add_argument("--file")
    p = sub.add_parser("approve")
    for f in ("agent", "action", "asset", "destination"):
        p.add_argument(f"--{f}", required=True)
    p.add_argument("--amount", type=float, required=True)
    p.add_argument("--ttl", type=int, default=900)
    p.add_argument("--note", default="")
    sub.add_parser("config-check")
    x = ap.parse_args(argv)

    if x.cmd == "killswitch":
        if x.state == "status":
            st = killswitch.status()
            _out(st)
            return 1 if st["engaged"] else 0
        if x.state == "on":
            _out(killswitch.engage(x.reason, x.actor, propagate=not x.no_propagate))
            print("\nKill switch ON: guarded order/money code now refuses to act.\n"
                  "To also REVOKE keys fast: Bybit -> Account -> API Management -> delete/disable key; "
                  "Blofin -> Account -> API Management -> delete key; MT5 -> close the EA / disable Algo Trading "
                  "on the Windows PC; move burner-wallet funds out from your own wallet app.", file=sys.stderr)
            return 0
        if x.confirm != "RESUME":
            print("refusing: `killswitch off` requires --confirm RESUME", file=sys.stderr)
            return 2
        _out(killswitch.release(x.reason, x.actor))
        return 0
    if x.cmd == "audit":
        _out(audit_log.verify() if x.what == "verify" else audit_log.tail(x.n))
        return 0
    if x.cmd == "check-text":
        text = open(x.file).read() if x.file else (x.text if x.text is not None else sys.stdin.read())
        f = detect_injection(text)
        _out({"severity": max_severity(f), "findings": f})
        return 3 if max_severity(f) == "HIGH" else 0
    if x.cmd == "approve":
        _out(approvals.create(x.agent, x.action, x.asset, x.amount, x.destination, x.ttl, x.note))
        return 0
    if x.cmd == "config-check":
        cfg = config.load()
        _out({"ok": True, "agents": sorted(cfg["agents"]), "defaults": cfg["defaults"]})
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
