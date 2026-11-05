"""FlyVis market voter.

The pinned FlyVis connectome and, when the registration file checks out,
the checkpoint digest are real. This process does not run the native FlyVis
runtime and this repository has no calibrated market readout for it. The
voter abstains. It does not turn a visual model into a buy score.
"""
from __future__ import annotations

from pathlib import Path

from .flyvis_smoke import CONNECTOME_SHA256

ROOT = Path(__file__).resolve().parents[2]
REGISTRATION = ROOT / "experiments/flyvis_trained_reference/registration.json"


_DESCRIBE = None


def describe() -> dict:
    """Pinned FlyVis identity. The registration file does not change during a run."""
    global _DESCRIBE
    if _DESCRIBE is None:
        _DESCRIBE = _describe()
    body = dict(_DESCRIBE)
    body["missing"] = list(_DESCRIBE["missing"])
    return body


def _describe() -> dict:
    checkpoint = None
    try:
        from .flyvis_reference import load_registration
        registration = load_registration(REGISTRATION)
        value = registration.get("model_member_sha256")
        if type(value) is str and len(value) == 64:
            checkpoint = value
    except (OSError, ValueError, KeyError):
        checkpoint = None
    missing = ["encoder", "readout", "calibration"]
    if checkpoint is None:
        missing.insert(0, "checkpoint")
    return {
        "module_id": "flyvis_market_v1",
        "source_id": "flyvis_reference",
        "executed": False,
        "biological_model": True,
        "market_readout": "ABSENT",
        "graph_sha256": CONNECTOME_SHA256,
        "checkpoint_sha256": checkpoint,
        "missing": missing,
        "reason": "MISSING_" + "_".join(name.upper() for name in missing),
        "paper_long_support_ppm": None,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }
