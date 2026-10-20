"""Recompute FV-REF-001 evidence without importing FlyVis, PyTorch or NumPy."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.flyvis_reference import verify_run  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    result = verify_run(args.directory, ROOT / "experiments/flyvis_trained_reference/registration.json")
    print(json.dumps(result, sort_keys=True))
    if result["status"] != "PASS_SCOPED_REFERENCE_CHECK":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
