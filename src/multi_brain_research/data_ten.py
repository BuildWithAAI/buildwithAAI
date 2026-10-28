"""Ten data steps. No view. No deploy.

Hashes only. Inventory, dead veto, disagreement, pack, cooldown, cap.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"
CAP = 1_000_000

POINTS = [
    {"id": "two_row", "layer": "live", "brains": ["fly", "prior", "no_trade"], "agree": True, "pack": True, "atoms": 50_000_000, "held_days": 30},
    {"id": "dead_1", "layer": "dead", "brains": ["fly", "prior"], "agree": True, "pack": True, "atoms": 50_000_000, "held_days": 30},
    {"id": "split", "layer": "live", "brains": ["fly", "prior", "no_trade"], "agree": False, "pack": True, "atoms": 50_000_000, "held_days": 30},
]


def digest(point: dict) -> str:
    return hashlib.sha256(point["id"].encode()).hexdigest()


def hire(point: dict, seen: set[str], reserve: int) -> dict:
    if point["id"] in seen:
        return {"id": point["id"], "fee_status": "UNPAID", "reason": "COOLDOWN"}
    if point["layer"] == "dead":
        return {"id": point["id"], "fee_status": "UNPAID", "reason": "DEAD"}
    if not point["agree"]:
        return {"id": point["id"], "fee_status": "UNPAID", "reason": "DISAGREE"}
    if not point["pack"] or len(point["brains"]) < 3:
        return {"id": point["id"], "fee_status": "UNPAID", "reason": "PACK"}
    if point["atoms"] < 10_000_000 or point["held_days"] < 7:
        return {"id": point["id"], "fee_status": "UNPAID", "reason": "INVENTORY"}
    if reserve > CAP:
        return {"id": point["id"], "fee_status": "UNPAID", "reason": "CAP"}
    seen.add(point["id"])
    return {"id": point["id"], "fee_status": "PAID", "reserve": min(reserve, CAP), "hash": digest(point)}


def run(report_path: Path) -> dict:
    seen: set[str] = set()
    rows = [hire(point, seen, 500_000) for point in POINTS]
    rows.append(hire(POINTS[0], seen, 500_000))
    paid = [row["id"] for row in rows if row["fee_status"] == "PAID"]
    body = {
        "token": TOKEN,
        "hashes_only": True,
        "paid": paid,
        "rows": rows,
        "cap": CAP,
        "vercel": "SKIPPED",
        "action": "NO_EXECUTION",
    }
    report_path.write_text(json.dumps(body, indent=2))
    return body


if __name__ == "__main__":
    print(json.dumps(run(Path("/workspace/artifacts/ten_step_report.txt")), sort_keys=True))
