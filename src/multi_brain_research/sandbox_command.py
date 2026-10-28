"""One command with a sandbox reject.

The hire pays nothing. The claim is still logged.
"""
from __future__ import annotations

import json
from pathlib import Path

from .functional_command import run


def run_rejected(endpoint: str, handle: str, path: Path) -> dict:
    body = run(endpoint, handle, path, rejected=True)
    if body["fee_status"] != "UNPAID" or not body["claimed"]:
        raise RuntimeError("SANDBOX_COMMAND_MISMATCH")
    return body


def self_check() -> dict:
    path = Path("/tmp/aai-sandbox-cmd.jsonl")
    if path.exists():
        path.unlink()
    return run_rejected("https://api.mainnet-beta.solana.com", "@ada2", path)


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
