"""One command for the twenty training upgrades.
"""
from __future__ import annotations

import json

from .aai_train import self_check as train
from .labeled_tape import self_check as tape
from .shape_features import self_check as shapes
from .train_board import self_check as board
from .train_pack import self_check as pack


def run() -> dict:
    return {
        "tape": tape()["reason"],
        "rug": shapes()["rug"],
        "launch": shapes()["launch"],
        "hold": shapes()["hold"],
        "scratch": train()["scratch"],
        "prior": train()["prior"],
        "skill": train()["skill"],
        "pack": pack()["paid"],
        "vault": pack()["vault"],
        "board": board()["board"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
