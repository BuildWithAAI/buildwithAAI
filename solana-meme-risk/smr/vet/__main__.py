"""CLI: python -m smr.vet <MINT> [--budget-s 60] [--no-cache] [--pretty]
Prints one vet/1 JSON object on stdout. Exit code: 0 PASS, 1 FAIL, 2 UNKNOWN, 3 usage/internal error.
Callers must treat any non-zero exit, missing/unparseable JSON, or a timeout as FAIL."""
from __future__ import annotations
import argparse, json, sys


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m smr.vet", description="coin vetting gate (read-only, design reference)")
    ap.add_argument("mint")
    ap.add_argument("--budget-s", type=float, default=None)
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--pretty", action="store_true")
    a = ap.parse_args(argv)
    try:
        from dataclasses import replace
        from . import vet, VetConfig
        cfg = VetConfig() if a.budget_s is None else replace(VetConfig(), budget_s=a.budget_s)
        r = vet(a.mint, cfg=cfg, use_cache=not a.no_cache)
        d = r.to_dict()
    except Exception as e:   # internal error: fail closed
        print(json.dumps({"schema": "vet/1", "verdict": "UNKNOWN", "allow": False, "error": f"{type(e).__name__}"}))
        return 3
    print(json.dumps(d, indent=2 if a.pretty else None, default=str))
    return {"PASS": 0, "FAIL": 1}.get(d["verdict"], 2)


if __name__ == "__main__":
    sys.exit(main())
