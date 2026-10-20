"""Acquire pinned public assets and supervise the registered Linux CPU reference check."""

from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.flyvis_reference import (  # noqa: E402
    LOCK_SHA256, download_assets, load_registration, sha256, verify_assets, verify_run,
)
from run_flyvis_smoke import verified_checkout  # noqa: E402


def supervise(command, work, environment, log):
    """Enforce wall time and Linux RSS while preserving output from failed attempts."""
    started = time.monotonic()
    with log.open("wb") as stream:
        process = subprocess.Popen(command, cwd=work, env=environment, stdout=stream,
                                   stderr=subprocess.STDOUT)
        try:
            while process.poll() is None:
                if time.monotonic() - started > 900:
                    raise RuntimeError("registered wall-time limit exceeded")
                try:
                    status = Path(f"/proc/{process.pid}/status").read_text()
                    rss = next((int(line.split()[1]) for line in status.splitlines()
                                if line.startswith("VmRSS:")), 0)
                    if rss > 6144 * 1024:
                        raise RuntimeError("registered RSS limit exceeded")
                except FileNotFoundError:
                    pass  # The worker exited between poll and status read.
                if log.stat().st_size > 4_000_000:
                    raise RuntimeError("worker log exceeds output limit")
                time.sleep(0.2)
            if process.returncode:
                raise subprocess.CalledProcessError(process.returncode, command)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()


def run(source, python, output, archive=None, license_path=None):
    if platform.system() != "Linux":
        raise ValueError("the locked FV-REF-001 worker currently supports Linux only")
    experiment = ROOT / "experiments/flyvis_trained_reference"
    registration_path = experiment / "registration.json"
    registration = load_registration(registration_path)
    lock = ROOT / "experiments/flyvis_cpu_smoke/requirements-linux-py312.lock"
    if sha256(lock.read_bytes()) != LOCK_SHA256:
        raise ValueError("dependency lock changed")
    source, python, output = source.resolve(), python.absolute(), output.absolute()
    verified_checkout(source)
    output.mkdir(parents=True, exist_ok=False)
    work = output / "work"
    work.mkdir()
    try:
        if (archive is None) != (license_path is None):
            raise ValueError("supply both archive and model license, or neither")
        if archive is None:
            archive, license_path = download_assets(output / "assets", registration)
        verify_assets(archive, license_path, registration)
        environment = {
            "PATH": str(python.parent) + os.pathsep + "/usr/bin:/bin", "LANG": "C.UTF-8",
            "TZ": "UTC", "TIMEZONE": "UTC", "CUDA_VISIBLE_DEVICES": "",
            "PYTHON_DOTENV_DISABLED": "1", "PYTHONDONTWRITEBYTECODE": "1", "MPLBACKEND": "Agg",
            "MPLCONFIGDIR": str(work / "matplotlib"), "FLYVIS_ROOT_DIR": str(work / "flyvis-data"),
            "NUMBA_CACHE_DIR": str(work / "numba"), "OMP_NUM_THREADS": "1",
            "OPENBLAS_NUM_THREADS": "1", "MKL_NUM_THREADS": "1",
        }
        command = [str(python), "-I", str(experiment / "worker.py"), str(source), str(output),
                   str(archive.resolve()), str(license_path.resolve())]
        supervise(command, work, environment, output / "worker.log")
        verified_checkout(source)
        result = verify_run(output, registration_path)
    except Exception as exc:
        (output / "incomplete.json").write_text(json.dumps({
            "experiment_id": "FV-REF-001", "status": "INCONCLUSIVE", "error_type": type(exc).__name__,
            "message": "Inspect retained worker.log; incomplete run cannot establish a scientific result.",
            "full_paper_replication_established": False, "market_validation_established": False,
            "live_execution_allowed": False}, indent=2) + "\n")
        raise
    (output / "verified.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "python", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--license", type=Path, dest="license_path")
    args = parser.parse_args()
    result = run(args.source, args.python, args.output, args.archive, args.license_path)
    print(json.dumps(result, sort_keys=True))
    if result["status"] != "PASS_SCOPED_REFERENCE_CHECK":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
