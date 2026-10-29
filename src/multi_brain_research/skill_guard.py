"""Skill file is refused if it says anything else.
"""
from __future__ import annotations

import json
from pathlib import Path


def check(path: Path) -> dict:
    text = path.read_text().strip()
    if text != "NOT_ESTABLISHED":
        raise ValueError("SKILL_OPEN")
    return {"skill": text, "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/workspace/artifacts/skill.txt")
    path.write_text("NOT_ESTABLISHED\n")
    return check(path)


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
