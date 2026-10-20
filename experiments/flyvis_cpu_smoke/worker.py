"""Trusted-source, untrained FlyVis worker. Invoke through the supervisor."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import platform
import resource
import socket
import subprocess
import sys
import time
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY / "src"))
from multi_brain_research.flyvis_smoke import (  # noqa: E402
    CONNECTOME_SHA256,
    EXPERIMENT_ID,
    LOCK_SHA256,
    REGISTRATION_SHA256,
    UPSTREAM_COMMIT,
    evaluate_arrays,
    load_registration,
    sha256,
)


def refuse(*_args, **_kwargs):
    raise RuntimeError("FV-SMOKE-001 forbids network access and checkpoint loading")


def digest_state(state) -> str:
    digest = hashlib.sha256()
    for name, tensor in sorted(state.items()):
        value = tensor.detach().cpu().contiguous().numpy()
        digest.update(json.dumps([name, str(value.dtype), list(value.shape)]).encode())
        digest.update(b"\0")
        digest.update(value.tobytes(order="C"))
    return digest.hexdigest()


def main() -> None:
    started = time.monotonic()
    source, output = map(lambda p: Path(p).resolve(), sys.argv[1:3])
    registration = load_registration(Path(__file__).with_name("registration.json"))
    resource.setrlimit(resource.RLIMIT_CPU, (170, 170))
    resource.setrlimit(resource.RLIMIT_FSIZE, (4_000_000, 4_000_000))
    # These Python guards prevent accidental calls; they are not an OS sandbox.
    socket.create_connection = refuse
    socket.socket.connect = refuse
    socket.socket.connect_ex = refuse
    sys.path.insert(0, str(source))

    import numpy as np
    import torch

    torch.load = refuse
    torch.jit.load = refuse
    torch.hub.load = refuse
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.set_default_device("cpu")

    import flyvis

    if Path(flyvis.__file__).resolve() != source / "flyvis" / "__init__.py":
        raise RuntimeError("FlyVis import did not use the verified checkout")
    if flyvis.device.type != "cpu":
        raise RuntimeError("CPU-only execution required")
    connectome = source / registration["upstream"]["connectome_path"]
    if sha256(connectome.read_bytes()) != CONNECTOME_SHA256:
        raise RuntimeError("bundled connectome changed")
    config = registration["inputs"]
    outputs, state_hashes = [], []
    node_types = None
    model_config = None
    node_count = edge_count = parameters = None
    for repeat in range(registration["repeats_per_seed"]):
        torch.manual_seed(0)
        np.random.seed(0)
        network = flyvis.Network(connectome={
            "type": "ConnectomeFromAvgFilters",
            "file": str(connectome),
            "extent": 3,
            "n_syn_fill": 0,
        }).eval().requires_grad_(False)
        node_count, edge_count = network.n_nodes, network.n_edges
        if not (0 < node_count <= 5000 and 0 < edge_count <= 1_000_000):
            raise RuntimeError("constructed graph exceeds registration")
        if 3 * config["frames"] * node_count > 600_000:
            raise RuntimeError("activity allocation exceeds registration")
        types = network.connectome.nodes.type[:].astype(str).tolist()
        if node_types is not None and types != node_types:
            raise RuntimeError("node order changed between repeats")
        node_types = types
        pixels = network.stimulus.n_input_elements
        movie = torch.full((3, config["frames"], 1, pixels), 0.5, dtype=torch.float32)
        movie[1, 10:30] = 1.0
        movie[2, 10:30] = 0.0
        before = digest_state(network.state_dict())
        with torch.inference_mode():
            state = network.steady_state(0.2, 0.01, 3)
            activity = network.simulate(movie, 0.01, initial_state=state)
        after = digest_state(network.state_dict())
        if before != after:
            raise RuntimeError("network parameters changed during inference")
        state_hashes.append(after)
        array = activity.detach().cpu().numpy().astype("<f4", copy=False)
        if array.shape != (3, 40, node_count) or not np.isfinite(array).all():
            raise RuntimeError("invalid activity tensor")
        path = output / f"run-{repeat + 1}.npy"
        np.save(path, np.ascontiguousarray(array), allow_pickle=False)
        outputs.append(path.read_bytes())
        model_config = network.config
        parameters = sum(p.numel() for p in network.parameters())
        del network, activity, array, movie, state
    if len(set(state_hashes)) != 1:
        raise RuntimeError("model parameters differ across repeats")
    metrics = evaluate_arrays(outputs[0], outputs[1], node_types)
    nodes_path = output / "nodes.json"
    nodes_path.write_text(json.dumps({"node_types": node_types}, separators=(",", ":")) + "\n")
    package_versions = {
        item.metadata["Name"]: item.version for item in importlib.metadata.distributions()
    }
    report = {
        "schema_version": 1,
        "experiment_id": EXPERIMENT_ID,
        "status": metrics["status"],
        "registration_sha256": REGISTRATION_SHA256,
        "dependency_lock_sha256": LOCK_SHA256,
        "upstream_commit": UPSTREAM_COMMIT,
        "connectome_sha256": CONNECTOME_SHA256,
        "integration_commit": subprocess.check_output(
            ["git", "-C", str(REPOSITORY), "rev-parse", "HEAD"], text=True
        ).strip(),
        "worker_sha256": sha256(Path(__file__).read_bytes()),
        "verifier_sha256": sha256((REPOSITORY / "src/multi_brain_research/flyvis_smoke.py").read_bytes()),
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "package_versions": package_versions,
        "device": "cpu",
        "torch_threads": 1,
        "weights": "UNTRAINED_UPSTREAM_INITIALIZATION",
        "model_config": model_config,
        "model_state_sha256": state_hashes[0],
        "nodes": node_count,
        "edges": edge_count,
        "parameters_including_fixed": parameters,
        "conditions": ["gray", "on_flash", "off_flash"],
        "metrics": metrics,
        "wall_time_seconds": time.monotonic() - started,
        "peak_rss_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
        "checkpoint_loading_allowed": False,
        "biological_replication_established": False,
        "market_validation_established": False,
        "live_execution_allowed": False,
        "isolation": "Sanitized environment, private working directory, Python loading/network guards and process limits; not an OS security sandbox",
        "artifact_sha256": {
            name: sha256((output / name).read_bytes())
            for name in ("run-1.npy", "run-2.npy", "nodes.json")
        },
    }
    (output / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
