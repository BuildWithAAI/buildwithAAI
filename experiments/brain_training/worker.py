"""Pinned frozen FlyVis activity -> actual fitted readout on a synthetic market fixture."""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import resource
import socket
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.flyvis_reference import (  # noqa: E402
    CONNECTOME_SHA256, UPSTREAM_COMMIT, load_registration, sha256, verify_assets,
)
from multi_brain_research.training_lab import (  # noqa: E402
    demo_data, digest, observation, require, run, verify, write_json,
)

ENCODER = {"version": "CAUSAL_HEX_STRIPES_V1", "dt": 0.005, "hexals": 721,
           "feature_cycle": 5, "baseline": 0.5, "amplitude": 0.45,
           "reset": "UPSTREAM_INITIAL_STATE_PER_EPISODE_NO_GRAY_WARMUP",
           "neural_time_is_market_time": False}


def refuse(*args, **kwargs):
    raise RuntimeError("training worker forbids network and additional checkpoint loads")


def state_hash(state):
    result = hashlib.sha256()
    for key, tensor in sorted(state.items()):
        value = tensor.detach().cpu().contiguous().numpy()
        result.update(json.dumps([key, str(value.dtype), list(value.shape)]).encode())
        result.update(b"\0")
        result.update(value.tobytes(order="C"))
    return result.hexdigest()


def main():
    started = time.monotonic()
    source, output, archive, license_path = [Path(value).resolve() for value in sys.argv[1:5]]
    registration = load_registration(ROOT / "experiments/flyvis_trained_reference/registration.json")
    members = verify_assets(archive, license_path, registration)
    resource.setrlimit(resource.RLIMIT_CPU, (850, 850))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024**2, 64 * 1024**2))
    socket.create_connection = refuse
    socket.socket.connect = refuse
    socket.socket.connect_ex = refuse
    sys.path.insert(0, str(source))
    import numpy as np
    import torch
    import yaml

    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.set_default_device("cpu")
    checkpoint = torch.load(io.BytesIO(members[registration["model_member"]]),
                            map_location="cpu", weights_only=True)
    torch.load = refuse
    torch.jit.load = refuse
    torch.hub.load = refuse
    require(type(checkpoint) is dict and set(checkpoint) == {"network", "decoder"}, "CHECKPOINT_LAYOUT")
    weights = checkpoint["network"]
    shapes = {"nodes_bias": (65,), "nodes_time_const": (65,), "edges_sign": (604,),
              "edges_syn_count": (2355,), "edges_syn_strength": (604,)}
    require(type(weights) is dict and set(weights) == set(shapes), "WEIGHT_KEYS")
    for key, shape in shapes.items():
        tensor = weights[key]
        require(type(tensor) is torch.Tensor and tensor.dtype == torch.float32
                and tuple(tensor.shape) == shape and tensor.device.type == "cpu"
                and bool(torch.isfinite(tensor).all()), "WEIGHT_TENSOR")
    config = yaml.safe_load(members[registration["config_member"]])["config"]["network"]
    require(config["connectome"] == {"type": "ConnectomeFromAvgFilters", "file": "fib25-fib19_v2.2.json",
                                     "extent": 15, "n_syn_fill": 1}, "MODEL_CONFIG")
    import flyvis

    require(Path(flyvis.__file__).resolve() == source / "flyvis/__init__.py"
            and flyvis.device.type == "cpu", "MODEL_IMPORT")
    connectome = source / "flyvis/connectome/fib25-fib19_v2.2.json"
    require(sha256(connectome.read_bytes()) == CONNECTOME_SHA256, "CONNECTOME_PIN")
    config["connectome"]["file"] = str(connectome)
    torch.manual_seed(0)
    np.random.seed(0)
    network = flyvis.Network(**config).eval()
    require((network.n_nodes, network.n_edges) == (45669, 1513231), "NETWORK_SIZE")
    network.load_state_dict(weights, strict=True)
    network.clamp()
    network.requires_grad_(False)
    require(not network.training and all(not p.requires_grad for p in network.parameters()), "CORE_NOT_FROZEN")
    before = state_hash(network.state_dict())
    central = network.connectome.central_cells_index[:]
    all_labels = network.connectome.nodes.type[:][central].astype(str).tolist()
    require(all_labels == registration["network"]["labels"], "CELL_ORDER")
    selected = [int(index) for index, label in zip(central, all_labels)
                if label not in {f"R{i}" for i in range(1, 9)}]
    labels = [label for label in all_labels if label not in {f"R{i}" for i in range(1, 9)}]
    require(len(selected) == 57, "READOUT_CELL_COUNT")
    data, plan = demo_data()

    def activity(episode):
        frames = []
        for index in range(len(episode["quotes"])):
            values = observation(episode, index, plan)["features"]
            frames.append([[ENCODER["baseline"] + ENCODER["amplitude"] * values[j % 5]
                            for j in range(ENCODER["hexals"])]])
        movie = torch.tensor([frames], dtype=torch.float32)
        with torch.inference_mode():
            response = network.simulate(movie, ENCODER["dt"], initial_state=None)
            require(tuple(response.shape) == (1, len(frames), 45669), "ACTIVITY_SHAPE")
            values = response[0, :, selected].detach().cpu().numpy()
        require(bool(np.isfinite(values).all()) and float(np.max(np.abs(values))) <= 1e6,
                "ACTIVITY_NONFINITE_OR_BOUND")
        return values.tolist()

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
