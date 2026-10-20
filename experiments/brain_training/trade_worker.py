"""Actual frozen FlyVis -> AAI.fun neural exports, readout fit and native reexecution."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import resource
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from frozen_runtime import activity, load_core, state_hash  # noqa: E402
from src.multi_brain_research import neural_features as neural  # noqa: E402
from src.multi_brain_research import trade_fixture as fixture  # noqa: E402
from src.multi_brain_research import trade_learning as trade  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.multi_brain_research.flyvis_reference import sha256  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402


def main():
    started = time.monotonic()
    source, output, archive, license_path = [Path(v).resolve() for v in sys.argv[1:5]]
    phase = sys.argv[5]
    lab.require(phase in ("fit", "reexecute"), "NATIVE_PHASE")
    network, registration, before, selected, labels = load_core(source, archive, license_path)
    lab.require(before == neural.CORE_STATE_SHA256
                and labels == neural.expected_pipeline(trade.PIPELINE)["readout_cell_types"], "NATIVE_CORE_IDENTITY")

    def infer(rows):
        return activity(network, selected, rows)

    def export(data):
        trade.validate_dataset(data)
        return neural.export(data, trade.PIPELINE, trade.features, infer)

    if phase == "fit":
        archives, data, plan = fixture.demo()
        bundle = export(data)
        first = data["episodes"][0]
        rows = [trade.features(first, i) for i in range(len(first["observations"]))]
        saved = bundle["features"][first["episode_id"]]
        lab.require(infer(rows) == saved, "NATIVE_EPISODE_RESET")
        changed = deepcopy(first)
        for row in changed["observations"][-3:]:
            row["last_price"]["numerator"] *= 2
            row["quote_volume_atoms"] *= 5
        changed_rows = [trade.features(changed, i) for i in range(len(changed["observations"]))]
        lab.require(infer(changed_rows)[:-3] == saved[:-3], "NATIVE_FUTURE_SUFFIX_PREFIX")
        perturbed = deepcopy(rows)
        for row in perturbed:
            row[3] *= -1
        altered = infer(perturbed)
        delta = max(abs(a - b) for left, right in zip(saved, altered, strict=True)
                    for a, b in zip(left, right, strict=True))
        lab.require(delta > 1e-8, "NATIVE_INPUT_SENSITIVITY_MISSING")
        raw_result = trade.run(archives, plan, output / "raw-control")
        result = trade.run(archives, plan, output / "neural-training", bundle)
        verified = trade.verify(output / "neural-training")
        report = ev.read(output / "neural-training/report.json")
        model = ev.read(output / "neural-training/model.json")
        raw_report = ev.read(output / "raw-control/report.json")
        lab.require(report["readout_parameters_changed"]
                    and any(abs(w) > 1e-8 for w in model["weights"])
                    and report["metrics"]["train"]["log_loss"] < report["initial_train_metrics"]["log_loss"],
                    "NATIVE_READOUT_DID_NOT_LEARN_FIXTURE")
        comparison = {"protocol": "AAI_NEURAL_VS_RAW_CONTROL_V1", "classification": "SYNTHETIC_FIXTURE",
                      "matched_dataset_sha256": lab.digest(data), "matched_plan_sha256": lab.digest(plan),
                      "neural_metrics": report["metrics"], "raw_metrics": raw_report["metrics"],
                      "neural_minus_raw_log_loss": {
                          part: report["metrics"][part]["log_loss"] - raw_report["metrics"][part]["log_loss"]
                          for part in lab.PARTS},
                      "neural_advantage_established": False, "market_validation_established": False,
                      "live_execution_allowed": False}
        ev.write(output / "comparison.json", comparison)
        details = {"episode_reset_reproduced": True, "future_suffix_prefix_check": True,
                   "input_sensitivity_max_difference": delta, "training": result, "readout_refit": verified,
                   "raw_control": raw_result, "feature_export_sha256": lab.digest(bundle)}
    else:
        _, data = trade.load_sources(output / "neural-training")
        saved_bundle = ev.read(output / "neural-training/neural-features.json")
        repeated = export(data)
        lab.require(lab.canonical(repeated) == lab.canonical(saved_bundle), "NATIVE_REEXPORT_MISMATCH")
        details = {"native_reexecution_performed": True, "native_feature_export_exact_match": True,
                   "feature_export_sha256": lab.digest(repeated),
                   "readout_refit": trade.verify(output / "neural-training")}

    real = None
    if (output / "real-input").exists():
        _, real_data = trade.load_sources(output / "real-input")
        lab.require(real_data["classification"] == "RPC_CAPTURE", "REAL_SOURCE_CLASSIFICATION")
        real_bundle = export(real_data)
        if phase == "fit":
            ev.write(output / "real-features.json", real_bundle)
        else:
            lab.require(lab.canonical(real_bundle)
                        == lab.canonical(ev.read(output / "real-features.json")), "REAL_NATIVE_REEXPORT_MISMATCH")
        real = {**trade.assessment(real_data), "neural_inference_performed": True,
                "feature_export_sha256": lab.digest(real_bundle),
                "native_reexecution_performed": phase == "reexecute",
                "readout_training_performed": False}
    after = state_hash(network.state_dict())
    lab.require(before == after, "NATIVE_CORE_CHANGED")
    usage = resource.getrusage(resource.RUSAGE_SELF)
    evidence = {"protocol": "AAI_FLYVIS_TRADE_NATIVE_RUN_V1", "phase": phase,
                "classification": "SYNTHETIC_FIXTURE", "upstream_commit": neural.UPSTREAM_COMMIT,
                "checkpoint_sha256": registration["model_member_sha256"],
                "core_before_sha256": before, "core_after_sha256": after, "readout_cell_types": labels,
                "encoder": neural.encoder(trade.PIPELINE), "device": "cpu", "weights_only": True,
                "nodes": network.n_nodes, "edges": network.n_edges, "input_cell_types_excluded": True,
                "raw_features_appended": False,
                "worker_sha256": sha256(Path(__file__).read_bytes()),
                "runtime_sha256": sha256(Path(__file__).with_name("frozen_runtime.py").read_bytes()),
                "trade_code_sha256": sha256((ROOT / "src/multi_brain_research/trade_learning.py").read_bytes()),
                "contract_sha256": sha256((ROOT / "src/multi_brain_research/neural_features.py").read_bytes()),
                "details": details, "real_source_inference": real,
                "wall_seconds": time.monotonic() - started,
                "cpu_seconds": usage.ru_utime + usage.ru_stime, "peak_rss_mib": usage.ru_maxrss / 1024,
                "biological_core_weights_updated": False, "market_validation_established": False,
                "multiple_brains_connected": False, "live_execution_allowed": False,
                "isolation": "Sanitized environment and process limits; not an OS sandbox"}
    ev.write(output / f"{phase}-evidence.json", evidence)
    print("AAI_NATIVE_TRADE_EVIDENCE " + json.dumps(evidence, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
