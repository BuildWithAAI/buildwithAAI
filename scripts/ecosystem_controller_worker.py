"""Cold-process execution and deliberate crash probes for the controller research lab."""
from __future__ import annotations

import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import controller as c  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402


def main():
    action, packet = sys.argv[1], ev.read(Path(sys.argv[2]))
    c.lab.require(action in ("apply", "hold", "hold-before-commit", "die-before-commit", "die-after-commit"),
                  "CONTROLLER_WORKER_ACTION")
    controller = c.ControlledJournal(packet["database"], packet["rules"], packet["plan"], packet["upstream_sha256"])
    with controller.acquire(packet["expected"], recover=packet["recover"]) as session:
        if action == "hold":
            ev.write(Path(sys.argv[3]), {"status": "OWNED"})
            if sys.stdin.readline().strip() != "release":
                raise ValueError("CONTROLLER_RELEASE_REQUIRED")
            return 0
        if action in ("die-before-commit", "hold-before-commit"):
            normal_check = c.check_size

            def interrupt(connection):
                normal_check(connection)
                if action == "die-before-commit":
                    os._exit(73)
                ev.write(Path(sys.argv[3]), {"status": "UNCOMMITTED"})
                if sys.stdin.readline().strip() != "release":
                    raise ValueError("CONTROLLER_RELEASE_REQUIRED")

            c.check_size = interrupt
        result = session.apply(packet["index"], packet["expected"])
        if action == "die-after-commit":
            os._exit(74)
    print(ev.canonical({"verified": True, **result, "live_execution_allowed": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
