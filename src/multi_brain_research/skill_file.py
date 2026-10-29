"""Skill file records NOT_ESTABLISHED even after a clean pass.
"""
from __future__ import annotations

import json
from pathlib import Path

from .pay_not_skill import self_check as paid


def self_check() -> dict:
    body = paid()
    path = Path("/workspace/artifacts/skill.txt")
    path.write_text(body["skill"] + "\n")
    if path.read_text().strip() != "NOT_ESTABLISHED":
        raise RuntimeError("SKILL_FILE_OPEN")
    return {"skill": body["skill"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
