"""Import the closed pass, tape, and stress from the local tree.

Reports the first break. Does not send.
"""
from __future__ import annotations

import importlib
import json


def check() -> dict:
    broken = []
    for name in (
        "multi_brain_research.closed_pass",
        "multi_brain_research.tape_pass",
        "multi_brain_research.specialist_stress",
        "multi_brain_research.curve_account_decode",
        "multi_brain_research.unfilled_stress",
    ):
        try:
            importlib.import_module(name)
        except Exception as err:
            broken.append({"module": name, "error": type(err).__name__})
    return {"imported": 5 - len(broken), "broken": broken, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(check(), sort_keys=True))
