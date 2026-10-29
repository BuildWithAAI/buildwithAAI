"""Brain votes plus a tape row can hire. No tape cannot.
"""
from __future__ import annotations

import json
from pathlib import Path

from .council_brains import accept
from .tape_brain import read


def hire(path: Path) -> dict:
    tape = read(path)
    if tape["prediction_ppm"] is None:
        return {"hire_allowed": False, "reason": tape["reason"], "action": "NO_EXECUTION"}
    votes = [{"source": "brain", "prediction_ppm": tape["prediction_ppm"]}]
    return accept(votes)


def self_check() -> dict:
    missing = hire(Path("/tmp/aai-no-tape.jsonl"))
    path = Path("/tmp/aai-yes-tape.jsonl")
    path.write_text(json.dumps({"slot": 1}) + "\n")
    present = hire(path)
    if missing["hire_allowed"] or not present["hire_allowed"]:
        raise RuntimeError("TAPE_HIRE_MISMATCH")
    return {"missing": missing["reason"], "present": present["votes"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
