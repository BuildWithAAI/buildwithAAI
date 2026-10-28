"""Pin separate same-repository component checkouts before importing adapters."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess

from ..multi_brain_research import training_lab as lab
from .handoff import LOCK_PATH, validate_lock
from ..solana_research import coin_evidence as ev


def lock():
    return validate_lock(ev.read(LOCK_PATH))


def verify_checkout(path, component):
    path = Path(path).resolve()
    lab.require(path.is_dir(), "COMPONENT_CHECKOUT_REQUIRED")
    expected = lock()["components"][component]["commit"]
    head = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"],
                                   text=True, timeout=20).strip()
    lab.require(head == expected, "COMPONENT_COMMIT_MISMATCH")
    tracked = subprocess.check_output(["git", "-C", str(path), "diff", "--no-ext-diff", "HEAD", "--"],
                                      timeout=20)
    untracked = subprocess.check_output(["git", "-C", str(path), "ls-files", "--others"],
                                        timeout=20)
    lab.require(not tracked and not untracked, "COMPONENT_CHECKOUT_CHANGED")
    return {"commit": head, "component": component, "package": lock()["components"][component]["package"]}


def worker_environment():
    result = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8",
              "TZ": "UTC", "PYTHONDONTWRITEBYTECODE": "1", "PYTHON_DOTENV_DISABLED": "1",
              "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"}
    if os.name == "nt" and "SYSTEMROOT" in os.environ:
        result["SYSTEMROOT"] = os.environ["SYSTEMROOT"]
    return result
