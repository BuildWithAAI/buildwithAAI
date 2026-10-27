"""Supervise a pinned CPU FlyVis-to-readout integration; no market service or signer."""
import argparse
import json
import os
from pathlib import Path
import platform
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.flyvis_reference import (  # noqa: E402
    LOCK_SHA256, download_assets, load_registration, sha256, verify_assets,
)
from multi_brain_research.training_lab import require, verify  # noqa: E402
from run_flyvis_reference import supervise  # noqa: E402
from run_flyvis_smoke import verified_checkout  # noqa: E402


def run(source, python, output):
    require(platform.system() == "Linux", "PINNED_LINUX_ENVIRONMENT_REQUIRED")
    source, python, output = source.resolve(), python.absolute(), output.absolute()
    verified_checkout(source)
    require(sha256((ROOT / "experiments/flyvis_cpu_smoke/requirements-linux-py312.lock").read_bytes())
            == LOCK_SHA256, "DEPENDENCY_LOCK_CHANGED")
    registration = load_registration(ROOT / "experiments/flyvis_trained_reference/registration.json")
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    work = output / "work"
    work.mkdir()
    try:
        archive, license_path = download_assets(output / "assets", registration)
        verify_assets(archive, license_path, registration)
        environment = {"PATH": str(python.parent) + os.pathsep + "/usr/bin:/bin", "LANG": "C.UTF-8",
                       "TZ": "UTC", "TIMEZONE": "UTC", "CUDA_VISIBLE_DEVICES": "",
                       "PYTHON_DOTENV_DISABLED": "1", "PYTHONDONTWRITEBYTECODE": "1", "MPLBACKEND": "Agg",
                       "MPLCONFIGDIR": str(work / "matplotlib"), "FLYVIS_ROOT_DIR": str(work / "flyvis-data"),
                       "NUMBA_CACHE_DIR": str(work / "numba"), "OMP_NUM_THREADS": "1",
                       "OPENBLAS_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"}
        command = [str(python), "-I", str(ROOT / "experiments/brain_training/worker.py"),
                   str(source), str(output), str(archive.resolve()), str(license_path.resolve())]
        supervise(command, work, environment, output / "worker.log")
        verified_checkout(source)
        evidence = json.loads((output / "evidence.json").read_text())
        require(evidence["core_before_sha256"] == evidence["core_after_sha256"]
                and evidence["trained_components"] == ["LOGISTIC_READOUT"]
                and evidence["classification"] == "SYNTHETIC_FIXTURE"
                and evidence["live_execution_allowed"] is False, "EVIDENCE_SCOPE_CHANGED")
        verified = verify(output / "training")
        require(verified["model_sha256"] == evidence["training"]["model_sha256"], "READOUT_MODEL_PIN")
    except Exception:
        log = output / "worker.log"
        if log.is_file():
            print("TRAINING_WORKER_DIAGNOSTIC " + log.read_bytes()[-6000:].decode("utf-8", errors="replace"),
                  file=sys.stderr, flush=True)
        (output / "incomplete.json").write_text(json.dumps({
            "status": "INCOMPLETE", "market_validation_established": False, "live_execution_allowed": False}) + "\n")
        raise
    print(json.dumps({"verified": verified, "classification": "SYNTHETIC_FIXTURE",
                      "core_before_sha256": evidence["core_before_sha256"],
                      "core_after_sha256": evidence["core_after_sha256"],
                      "episode_reset_reproduced": evidence["episode_reset_reproduced"],
                      "future_suffix_prefix_check": evidence["future_suffix_prefix_check"],
                      "wall_seconds": evidence["wall_seconds"], "peak_rss_mib": evidence["peak_rss_mib"],
                      "biological_core_weights_updated": False, "live_execution_allowed": False}, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("source", "python", "output"):
        parser.add_argument("--" + field, type=Path, required=True)
    args = parser.parse_args()
    run(args.source, args.python, args.output)
