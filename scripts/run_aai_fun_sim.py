"""Run the AAI.fun volume simulator.

Writes synthetic shapes and, if the allowlisted RPC answers, one REAL curve row.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from solana_research.aai_fun_sim import real_row, self_check, shape


def main() -> None:
    out = Path("research/aai-fun/sim")
    out.mkdir(parents=True, exist_ok=True)
    shapes = [shape("launch"), shape("rug"), shape("long_term")]
    (out / "shapes.json").write_text(json.dumps(shapes, indent=2))
    live = real_row("https://api.mainnet-beta.solana.com", out / "real.jsonl")
    report = {"check": self_check(), "live": live, "action": "NO_EXECUTION"}
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
