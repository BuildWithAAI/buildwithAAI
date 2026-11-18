"""Vet subprocess stub. The mode is chosen with VET_STUB_MODE. No network."""

from __future__ import annotations

import json
import os
import sys
import time


def main() -> int:
    mode = os.environ.get("VET_STUB_MODE", "pass")
    mint = sys.argv[1] if len(sys.argv) > 1 else ""
    now = time.time()
    if mode == "sleep":
        time.sleep(30)
    if mode == "bad_json":
        sys.stdout.write("{")
        return 0
    verdict = "PASS"
    allow = True
    code = 0
    config = "vetcfg-20261117-v6"
    evaluated = now
    reasons: list[dict[str, str]] = []
    if mode == "fail":
        verdict, allow, code = "FAIL", False, 1
        reasons = [{"code": "TOP10_TOO_HIGH"}]
    elif mode == "unknown":
        verdict, allow, code = "UNKNOWN", False, 2
        reasons = [{"code": "TIMEOUT_BUDGET"}]
    elif mode == "exit3":
        verdict, allow, code = "UNKNOWN", False, 3
    elif mode == "config":
        config = "vetcfg-other"
    elif mode == "stale":
        evaluated = 1
    elif mode == "wrong_mint":
        mint = "So11111111111111111111111111111111111111112"
    elif mode == "name":
        pass
    body: dict[str, object] = {
        "schema": "vet/1",
        "mint": mint,
        "verdict": verdict,
        "allow": allow,
        "evaluated_at": evaluated,
        "config_version": config,
        "code_version": "stub",
        "reasons": reasons,
        "name": "DO_NOT_LOG",
        "symbol": "DO_NOT_LOG",
        "uri": "DO_NOT_LOG",
    }
    if mode == "bad_sig":
        body["sig"] = "00"
    sys.stdout.write(json.dumps(body))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
