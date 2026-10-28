"""One command for these ten functional steps.
"""
from __future__ import annotations

import json
from pathlib import Path

from .cap_command import run as cap_run
from .cooldown_command import twice
from .dead_command import run_dead
from .dispute_command import next_after_dispute
from .dispute_pack_command import self_check as dispute_pack
from .mixed_command import run as mixed
from .reserved_command import run as reserved
from .thin_command import run as thin
from .vault_pack import self_check as vault


def run() -> dict:
    return {
        "dispute": next_after_dispute(50)["reason"],
        "dead": run_dead()["reason"],
        "vault_pack": vault()["refused"],
        "cooldown": twice()["second"],
        "cap": cap_run(2_000_000)["fee_status"],
        "thin": thin()["reason"],
        "reserved": reserved(Path("/tmp/aai-ten-reserved.jsonl"))["reason"],
        "dispute_pack": dispute_pack()["complete"],
        "unpaid": mixed()["unpaid"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
