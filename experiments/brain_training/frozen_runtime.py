"""Shared pinned CPU model loading and frozen activity; heavyweight imports are lazy."""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import resource
import socket
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from src.multi_brain_research.flyvis_reference import (  # noqa: E402
    CONNECTOME_SHA256, load_registration, sha256, verify_assets,
)
from src.multi_brain_research.neural_features import (  # noqa: E402
    HEX_ENCODER as ENCODER, check_input_rows,
)
from src.multi_brain_research.training_lab import require  # noqa: E402


def refuse(*args, **kwargs):
    raise RuntimeError("frozen model worker forbids network and additional checkpoint loads")


def state_hash(state):
    result = hashlib.sha256()
    for key, tensor in sorted(state.items()):
        value = tensor.detach().cpu().contiguous().numpy()
        result.update(json.dumps([key, str(value.dtype), list(value.shape)]).encode())
        result.update(b"\0")
        result.update(value.tobytes(order="C"))
    return result.hexdigest()


def load_core(source, archive, license_path):
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
    require(isinstance(checkpoint, dict) and set(checkpoint) == {"network", "decoder"}, "CHECKPOINT_LAYOUT")
    weights = checkpoint["network"]
    shapes = {"nodes_bias": (65,), "nodes_time_const": (65,), "edges_sign": (604,),
              "edges_syn_count": (2355,), "edges_syn_strength": (604,)}
    require(isinstance(weights, dict) and set(weights) == set(shapes), "WEIGHT_KEYS")
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
    selected = [int(index) for index, label in zip(central, all_labels, strict=True)
                if label not in {f"R{i}" for i in range(1, 9)}]
    labels = [label for label in all_labels if label not in {f"R{i}" for i in range(1, 9)}]
    require(len(selected) == 57, "READOUT_CELL_COUNT")
    return network, registration, before, selected, labels


def activity(network, selected, rows):
    check_input_rows(rows)
    import numpy as np
    import torch

    frames = [[[ENCODER["baseline"] + ENCODER["amplitude"] * row[j % 5]
                for j in range(ENCODER["hexals"])]] for row in rows]
    movie = torch.tensor([frames], dtype=torch.float32)
    with torch.inference_mode():
        response = network.simulate(movie, ENCODER["dt"], initial_state=None)
        require(tuple(response.shape) == (1, len(frames), 45669), "ACTIVITY_SHAPE")
        values = response[0, :, selected].detach().cpu().numpy()
    require(bool(np.isfinite(values).all()) and float(np.max(np.abs(values))) <= 1e6,
            "ACTIVITY_NONFINITE_OR_BOUND")
    return values.tolist()
