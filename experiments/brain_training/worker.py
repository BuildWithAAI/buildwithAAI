"""Pinned frozen FlyVis activity -> actual fitted readout on a synthetic market fixture."""
from __future__ import annotations

import json
from pathlib import Path
import resource
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from frozen_runtime import (  # noqa: E402
    ENCODER, activity as frozen_activity, load_core, state_hash,
)
from multi_brain_research.flyvis_reference import (  # noqa: E402
    CONNECTOME_SHA256, UPSTREAM_COMMIT, sha256,
)
from multi_brain_research.training_lab import (  # noqa: E402
    demo_data, digest, observation, require, run, verify, write_json,
)


def main():
    started = time.monotonic()
    source, output, archive, license_path = [Path(value).resolve() for value in sys.argv[1:5]]
    network, registration, before, selected, labels = load_core(source, archive, license_path)
    data, plan = demo_data()

    def activity(episode):
        rows = [observation(episode, index, plan)["features"] for index in range(len(episode["quotes"]))]
        return frozen_activity(network, selected, rows)

    features = {}
    for episode in data["episodes"]:
        features[episode["episode_id"]] = activity(episode)
        print(json.dumps({"phase": "frozen_activity", "episode": episode["episode_id"]}), flush=True)
    first = data["episodes"][0]
    repeat = activity(first)
    require(repeat == features[first["episode_id"]], "EPISODE_STATE_NOT_RESET")
    changed = json.loads(json.dumps(first))
    for quote in changed["quotes"][-3:]:
        quote["bid"] //= 2
        quote["ask"] //= 2
    changed_activity = activity(changed)
    require(changed_activity[:-3] == features[first["episode_id"]][:-3], "FUTURE_SUFFIX_CHANGED_PREFIX")
    after = state_hash(network.state_dict())
    require(before == after, "BIOLOGICAL_CORE_CHANGED")
    bundle = {"protocol": "AAI_FEATURE_EXPORT_V1", "dataset_sha256": digest(data),
              "pipeline": {"kind": "FROZEN_FLYVIS_ACTIVITY",
                           "source_sha256": registration["model_member_sha256"],
                           "encoder_sha256": digest(ENCODER), "core_state_sha256": before},
              "features": features}
    result = run(data, plan, output / "training", bundle)
    replay = verify(output / "training")
    report = json.loads((output / "training/report.json").read_text())
    require(report["readout_parameters_changed"] and report["metrics"]["train"]["log_loss"]
            < report["initial_train_metrics"]["log_loss"], "READOUT_DID_NOT_LEARN_FIXTURE")
    usage = resource.getrusage(resource.RUSAGE_SELF)
    evidence = {"protocol": "AAI_FLYVIS_READOUT_PATH_V1", "classification": "SYNTHETIC_FIXTURE",
                "upstream_commit": UPSTREAM_COMMIT, "checkpoint_sha256": registration["model_member_sha256"],
                "connectome_sha256": CONNECTOME_SHA256, "encoder": ENCODER,
                "worker_sha256": sha256(Path(__file__).read_bytes()),
                "runtime_sha256": sha256(Path(__file__).with_name("frozen_runtime.py").read_bytes()),
                "training_code_sha256": sha256((ROOT / "src/multi_brain_research/training_lab.py").read_bytes()),
                "core_before_sha256": before, "core_after_sha256": after,
                "readout_cell_types": labels, "input_cell_types_excluded": True,
                "episode_reset_reproduced": True, "future_suffix_prefix_check": True,
                "training": result, "replay": replay, "device": "cpu", "weights_only": True,
                "nodes": network.n_nodes, "edges": network.n_edges,
                "wall_seconds": time.monotonic() - started, "peak_rss_mib": usage.ru_maxrss / 1024,
                "trained_components": ["LOGISTIC_READOUT"], "biological_core_weights_updated": False,
                "market_validation_established": False, "multiple_brains_connected": False,
                "live_execution_allowed": False,
                "isolation": "Sanitized environment and accidental-call guards; not an OS sandbox"}
    write_json(output / "evidence.json", evidence)
    print("FLYVIS_READOUT_EVIDENCE " + json.dumps(evidence, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
