"""Capture one anonymized real block for AAI.fun.

Ticker hidden. Time and transaction count kept.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from solana_research.anon_tape import from_slot, self_check
from solana_research.rpc import DEFAULT_PUBLIC_RPC, rpc_call


def main() -> None:
    check = self_check()
    current = rpc_call(DEFAULT_PUBLIC_RPC, "getBlocks", [1, 1])
    # getSlot is not in the read-only allowlist. Use a recent finalized slot from getBlocks
    # over a small window ending near a known slot is not available. Ask getBlocks for the
    # latest available by using a wide recent window only if the caller passes a slot.
    slot = int(sys.argv[1]) if len(sys.argv) > 1 else None
    out = Path("research/aai-fun/sim/real.jsonl")
    if slot is None:
        report = {"check": check, "reason": "SLOT_REQUIRED", "action": "NO_EXECUTION", "probe": current.get("result")}
    else:
        report = {"check": check, "row": from_slot(DEFAULT_PUBLIC_RPC, slot, out), "action": "NO_EXECUTION"}
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
