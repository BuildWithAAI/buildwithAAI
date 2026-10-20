"""Pinned-source FV-REF-001 worker. Run only through the bounded supervisor."""

from __future__ import annotations

import gc
import hashlib
import importlib.metadata
import io
import json
import platform
import resource
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.flyvis_reference import (  # noqa: E402
    CONNECTOME_SHA256, EXPERIMENT_ID, LOCK_SHA256, REGISTRATION_SHA256,
    UPSTREAM_COMMIT, evaluate_arrays, load_registration, sha256, verify_assets,
)


def refuse(*args, **kwargs):
    raise RuntimeError("FV-REF-001 forbids network calls and additional checkpoint loading")


def digest_state(state) -> str:
    digest = hashlib.sha256()
    for name, tensor in sorted(state.items()):
        value = tensor.detach().cpu().contiguous().numpy()
        digest.update(json.dumps([name, str(value.dtype), list(value.shape)]).encode())
        digest.update(b"\0")
        digest.update(value.tobytes(order="C"))
    return digest.hexdigest()


def main():
    started = time.monotonic()
    source, output, archive, license_path = [Path(x).resolve() for x in sys.argv[1:5]]
    registration = load_registration(Path(__file__).with_name("registration.json"))
    members = verify_assets(archive, license_path, registration)
    resource.setrlimit(resource.RLIMIT_CPU, (850, 850))
    resource.setrlimit(resource.RLIMIT_FSIZE, (4_000_000, 4_000_000))
    # Accidental-call guards, not an OS sandbox. Only audited pinned code is imported.
    socket.create_connection = refuse
    socket.socket.connect = refuse
    socket.socket.connect_ex = refuse
    sys.path.insert(0, str(source))
    import numpy as np
    import torch
    import xarray as xr
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
    if not isinstance(checkpoint, dict) or set(checkpoint) != {"network", "decoder"}:
        raise RuntimeError("unexpected checkpoint layout")
    state = checkpoint["network"]
    expected_shapes = {"nodes_bias": (65,), "nodes_time_const": (65,),
                       "edges_sign": (604,), "edges_syn_count": (2355,),
                       "edges_syn_strength": (604,)}
    if not isinstance(state, dict) or set(state) != set(expected_shapes):
        raise RuntimeError("unexpected network state keys")
    for key, shape in expected_shapes.items():
        tensor = state[key]
        if (type(tensor) is not torch.Tensor or tensor.dtype != torch.float32
                or tuple(tensor.shape) != shape or not torch.isfinite(tensor).all()
                or tensor.device.type != "cpu"):
            raise RuntimeError("invalid network tensor: " + key)
    raw_state_hash = digest_state(state)
    metadata = yaml.safe_load(members[registration["config_member"]])
    config = metadata["config"]["network"]
    if config["connectome"] != {"type": "ConnectomeFromAvgFilters", "file": "fib25-fib19_v2.2.json",
                                "extent": 15, "n_syn_fill": 1}:
        raise RuntimeError("unregistered model architecture")
    # Only instantiate the registered network, never the checkpoint task/decoder.
    import flyvis
    from flyvis.datasets.flashes import Flashes
    from flyvis.analysis.flash_responses import flash_response_index

    if Path(flyvis.__file__).resolve() != source / "flyvis/__init__.py" or flyvis.device.type != "cpu":
        raise RuntimeError("wrong FlyVis import or device")
    connectome = source / "flyvis/connectome/fib25-fib19_v2.2.json"
    if sha256(connectome.read_bytes()) != CONNECTOME_SHA256:
        raise RuntimeError("connectome checksum mismatch")
    # Absolute path avoids searching for an alternate connectome in working data.
    config["connectome"]["file"] = str(connectome)
    outputs, hashes, upstream_values = [], [], []
    labels = indices = None
    for repeat in range(2):
        torch.manual_seed(0)
        np.random.seed(0)
        network = flyvis.Network(**config).eval()
        if (network.n_nodes, network.n_edges) != (45669, 1513231):
            raise RuntimeError("graph dimensions differ from registration")
        parameters = sum(p.numel() for p in network.parameters())
        learned = sum(p.numel() for p in network.parameters() if p.requires_grad)
        if (parameters, learned) != (3693, 734):
            raise RuntimeError("parameter counts differ from registration")
        network.load_state_dict(state, strict=True)
        # Upstream clamp checks requires_grad, so apply it before freezing gradients.
        network.clamp()
        network.requires_grad_(False)
        before = digest_state(network.state_dict())
        central = network.connectome.central_cells_index[:]
        current_labels = network.connectome.nodes.type[:][central].astype(str).tolist()
        current_indices = central.tolist()
        if current_labels != registration["network"]["labels"]:
            raise RuntimeError("central cell labels differ from registration")
        if labels is not None and (current_labels != labels or current_indices != indices):
            raise RuntimeError("cell ordering changed between repeats")
        labels, indices = current_labels, current_indices
        dataset = Flashes(dynamic_range=[0, 1], radius=[-1, 6], alternations=(0, 1, 0),
                          t_pre=1.0, t_stim=1.0, dt=0.005)
        if list(zip(dataset.arg_df.intensity, dataset.arg_df.radius)) != [(0, -1), (0, 6), (1, -1), (1, 6)]:
            raise RuntimeError("stimulus sample order differs from registration")
        print(json.dumps({"phase": "simulation", "repeat": repeat + 1,
                          "nodes": network.n_nodes, "edges": network.n_edges}), flush=True)
        with torch.inference_mode():
            batches = []
            for stimulus, responses in network.stimulus_response(
                    dataset, 0.005, t_pre=1.0, t_fade_in=0.0, batch_size=4):
                if responses.shape != (4, 600, 45669):
                    raise RuntimeError("unexpected full response dimensions")
                # Only the registered central cells are retained as evidence.
                batches.append(np.take(responses, central, axis=-1))
                del responses, stimulus
            values = np.ascontiguousarray(np.concatenate(batches, axis=0), dtype="<f4")
        if values.shape != (4, 600, 65) or not np.isfinite(values).all():
            raise RuntimeError("invalid central cell responses")
        after = digest_state(network.state_dict())
        if before != after:
            raise RuntimeError("parameters changed during inference")
        hashes.append(after)
        path = output / f"run-{repeat + 1}.npy"
        np.save(path, values, allow_pickle=False)
        outputs.append(path.read_bytes())
        # Match the original xarray wrapper's time and sample coordinates exactly.
        reference = xr.Dataset(
            {"responses": (("network_id", "sample", "frame", "neuron"), values[None].copy())},
            coords={"time": ("frame", np.arange(600).astype(float) * 0.005 - 1.0),
                    "radius": ("sample", dataset.arg_df.radius.values),
                    "intensity": ("sample", dataset.arg_df.intensity.values),
                    "sample": np.arange(4), "frame": np.arange(600),
                    "neuron": np.arange(65), "network_id": [0],
                    "cell_type": ("neuron", labels)},
            attrs={"config": {"dt": 0.005, "t_stim": 1.0, "alternations": [0, 1, 0]}})
        upstream_values.append(flash_response_index(reference, radius=6).values.reshape(-1).tolist())
        del network, values, reference, dataset, batches
        gc.collect()
    if len(set(hashes)) != 1:
        raise RuntimeError("model state differs across repeats")
    (output / "cells.json").write_text(json.dumps({"labels": labels, "central_indices": indices}) + "\n")
    metrics = evaluate_arrays(outputs[0], outputs[1], labels, upstream_values[0], registration)
    usage = resource.getrusage(resource.RUSAGE_SELF)
    report = {
        "schema_version": 1, "experiment_id": EXPERIMENT_ID, "status": metrics["status"],
        "registration_sha256": REGISTRATION_SHA256, "upstream_commit": UPSTREAM_COMMIT,
        "connectome_sha256": CONNECTOME_SHA256, "dependency_lock_sha256": LOCK_SHA256,
        "archive_sha256": registration["archive"]["sha256"],
        "license_sha256": registration["license"]["sha256"],
        "checkpoint_sha256": registration["model_member_sha256"],
        "config_sha256": registration["config_member_sha256"], "selected_model": "000",
        "integration_commit": subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip(),
        "worker_sha256": sha256(Path(__file__).read_bytes()),
        "verifier_sha256": sha256((ROOT / "src/multi_brain_research/flyvis_reference.py").read_bytes()),
        "raw_network_state_sha256": raw_state_hash, "inference_state_sha256": hashes[0],
        "weights_only": True, "strict_state_dict": True, "device": "cpu", "torch_threads": 1,
        "nodes": 45669, "edges": 1513231, "parameters_including_fixed": parameters,
        "learned_parameters": learned, "repeats_completed": 2,
        "python_version": platform.python_version(), "platform": platform.platform(),
        "package_versions": {d.metadata["Name"]: d.version for d in importlib.metadata.distributions()},
        "upstream_fri": upstream_values[0], "metrics": metrics,
        "wall_time_seconds": time.monotonic() - started,
        "cpu_time_seconds": usage.ru_utime + usage.ru_stime,
        "peak_rss_mib": usage.ru_maxrss / 1024,
        "training_performed": False, "full_paper_replication_established": False,
        "market_validation_established": False, "live_execution_allowed": False,
        "isolation": "Sanitized environment, Python guards and process limits; not an OS security sandbox",
        "artifact_sha256": {name: sha256((output / name).read_bytes())
                            for name in ("run-1.npy", "run-2.npy", "cells.json")},
    }
    (output / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(json.dumps({"phase": "complete", "status": metrics["status"],
                      "correct": metrics["known_non_input_correct"]}), flush=True)


if __name__ == "__main__":
    main()
