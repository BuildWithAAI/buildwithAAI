"""Run the registered, checkpoint-free CPU experiment in a separate environment."""

from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.flyvis_smoke import (  # noqa: E402
    LOCK_SHA256,
    UPSTREAM_COMMIT,
    load_registration,
    sha256,
    verify_run,
)


def verified_checkout(source: Path) -> None:
    head = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if head != UPSTREAM_COMMIT:
        raise ValueError("upstream checkout is not the registered commit")
    subprocess.run(["git", "-C", str(source), "diff", "--exit-code", "HEAD", "--"], check=True, capture_output=True)


def run(source: Path, python: Path, output: Path) -> dict:
    if platform.system() != "Linux":
        raise ValueError("this locked worker currently supports Linux only")
    experiment = ROOT / "experiments/flyvis_cpu_smoke"
    registration = experiment / "registration.json"
    load_registration(registration)
    if sha256((experiment / "requirements-linux-py312.lock").read_bytes()) != LOCK_SHA256:
        raise ValueError("dependency lock differs from registered environment")
    source, python, output = source.resolve(), python.absolute(), output.absolute()
    verified_checkout(source)
    # Never overwrite an earlier attempt, including a failed attempt.
    output.mkdir(parents=True, exist_ok=False)
    work = output / "work"
    work.mkdir()
    environment = {
        "PATH": str(python.parent) + os.pathsep + "/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "TZ": "UTC",
        "TIMEZONE": "UTC",
        "CUDA_VISIBLE_DEVICES": "",
        "PYTHON_DOTENV_DISABLED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "MPLBACKEND": "Agg",
        "MPLCONFIGDIR": str(work / "matplotlib"),
        "FLYVIS_ROOT_DIR": str(work / "flyvis-data"),
        "NUMBA_CACHE_DIR": str(work / "numba"),
        "OMP_NUM_THREADS": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
    }
    log = output / "worker.log"
    try:
        with log.open("wb") as stream:
            subprocess.run(
                [str(python), "-I", str(experiment / "worker.py"), str(source), str(output)],
                cwd=work,
                env=environment,
                stdout=stream,
                stderr=subprocess.STDOUT,
                timeout=180,
                check=True,
            )
        verified_checkout(source)
        result = verify_run(output, registration)
    except Exception as exc:
        failure = {
            "experiment_id": "FV-SMOKE-001", "status": "INCONCLUSIVE",
            "error_type": type(exc).__name__,
            "message": "Run incomplete; inspect retained local worker.log. No scientific or live promotion.",
            "biological_replication_established": False,
            "market_validation_established": False,
            "live_execution_allowed": False,
        }
        (output / "incomplete.json").write_text(json.dumps(failure, indent=2) + "\n")
        raise
    (output / "verified.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.python, args.output), sort_keys=True))


if __name__ == "__main__":
    main()
