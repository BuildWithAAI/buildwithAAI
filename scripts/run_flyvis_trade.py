"""Supervise AAI.fun native neural extraction, fitting and independent neural reexecution."""
import argparse
import json
import os
from pathlib import Path
import platform
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.multi_brain_research import neural_features as neural  # noqa: E402
from src.multi_brain_research import trade_learning as trade  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.multi_brain_research.flyvis_reference import (  # noqa: E402
    LOCK_SHA256, download_assets, load_registration, sha256, verify_assets,
)
from src.solana_research import coin_evidence as ev  # noqa: E402
from run_flyvis_reference import supervise  # noqa: E402
from run_flyvis_smoke import verified_checkout  # noqa: E402


def run(source, python, output, real_source=None):
    lab.require(platform.system() == "Linux", "PINNED_LINUX_ENVIRONMENT_REQUIRED")
    source, python, output = source.resolve(), python.absolute(), output.absolute()
    verified_checkout(source)
    lab.require(sha256((ROOT / "experiments/flyvis_cpu_smoke/requirements-linux-py312.lock").read_bytes())
                == LOCK_SHA256, "DEPENDENCY_LOCK_CHANGED")
    registration = load_registration(ROOT / "experiments/flyvis_trained_reference/registration.json")
    real_archives = None
    if real_source is not None:
        real_archives, real_data = trade.load_sources(real_source)
        lab.require(real_data["classification"] == "RPC_CAPTURE", "REAL_SOURCE_CLASSIFICATION")
        neural.check_bounds(real_data)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    work = output / "work"
    work.mkdir()
    try:
        if real_archives is not None:
            trade.prepare(real_archives, output / "real-input")
        archive, license_path = download_assets(output / "assets", registration)
        verify_assets(archive, license_path, registration)
        for phase in ("fit", "reexecute"):
            cache = work / phase
            cache.mkdir()
            environment = {"PATH": str(python.parent) + os.pathsep + "/usr/bin:/bin", "LANG": "C.UTF-8",
                           "TZ": "UTC", "TIMEZONE": "UTC", "CUDA_VISIBLE_DEVICES": "",
                           "PYTHON_DOTENV_DISABLED": "1", "PYTHONDONTWRITEBYTECODE": "1", "MPLBACKEND": "Agg",
                           "MPLCONFIGDIR": str(cache / "matplotlib"),
                           "FLYVIS_ROOT_DIR": str(cache / "flyvis-data"),
                           "NUMBA_CACHE_DIR": str(cache / "numba"), "OMP_NUM_THREADS": "1",
                           "OPENBLAS_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"}
            command = [str(python), "-I", str(ROOT / "experiments/brain_training/trade_worker.py"),
                       str(source), str(output), str(archive.resolve()), str(license_path.resolve()), phase]
            supervise(command, work, environment, output / f"{phase}.log")
            verified_checkout(source)
        first, second = [ev.read(output / f"{phase}-evidence.json") for phase in ("fit", "reexecute")]
        for evidence in (first, second):
            lab.require(evidence["core_before_sha256"] == evidence["core_after_sha256"]
                        == neural.CORE_STATE_SHA256 and evidence["raw_features_appended"] is False
                        and evidence["biological_core_weights_updated"] is False
                        and evidence["live_execution_allowed"] is False, "NATIVE_EVIDENCE_SCOPE")
        lab.require(first["details"]["feature_export_sha256"] == second["details"]["feature_export_sha256"]
                    and second["details"]["native_feature_export_exact_match"] is True,
                    "NATIVE_REEXECUTION_BINDING")
        verified = trade.verify(output / "neural-training")
        lab.require(verified["model_sha256"] == first["details"]["training"]["model_sha256"],
                    "NATIVE_MODEL_BINDING")
        if real_archives is not None:
            lab.require(first["real_source_inference"]["feature_export_sha256"]
                        == second["real_source_inference"]["feature_export_sha256"]
                        and second["real_source_inference"]["native_reexecution_performed"] is True,
                        "REAL_NATIVE_REEXECUTION_BINDING")
        summary = {"protocol": "AAI_NATIVE_TRADE_INTEGRATION_SUMMARY_V1",
                   "synthetic_readout_fit": verified, "native_feature_reexecution_exact": True,
                   "core_state_sha256": neural.CORE_STATE_SHA256,
                   "future_suffix_prefix_check": first["details"]["future_suffix_prefix_check"],
                   "input_sensitivity_max_difference": first["details"]["input_sensitivity_max_difference"],
                   "real_source_inference": second["real_source_inference"],
                   "worker_wall_seconds": [first["wall_seconds"], second["wall_seconds"]],
                   "worker_peak_rss_mib": [first["peak_rss_mib"], second["peak_rss_mib"]],
                   "market_validation_established": False, "live_execution_allowed": False}
        ev.write(output / "summary.json", summary)
    except Exception:
        for phase in ("fit", "reexecute"):
            log = output / f"{phase}.log"
            if log.is_file():
                print(f"NATIVE_{phase}_DIAGNOSTIC " + log.read_bytes()[-6000:].decode("utf-8", errors="replace"),
                      file=sys.stderr, flush=True)
        ev.write(output / "incomplete.json", {"status": "INCOMPLETE", "market_validation_established": False,
                                             "live_execution_allowed": False})
        raise
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("source", "python", "output"):
        parser.add_argument("--" + field, type=Path, required=True)
    parser.add_argument("--real-source", type=Path)
    args = parser.parse_args()
    run(args.source, args.python, args.output, args.real_source)
