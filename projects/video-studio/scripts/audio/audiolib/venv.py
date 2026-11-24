"""Re-execute the current script inside projects/video-studio/.venv-audio when it exists.

Call `ensure_venv()` at the top of a CLI script before importing numpy/scipy/pedalboard, so the
script runs with the pinned packages even when started with the system python3.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

VENV = Path(__file__).resolve().parents[3] / ".venv-audio"


def ensure_venv() -> None:
    py = VENV / "bin" / "python"
    if not py.exists():
        return  # setup.sh has not run: let the imports fail with a clear message later
    try:
        inside = Path(sys.prefix).resolve() == VENV.resolve()
    except OSError:
        inside = False
    if inside or os.environ.get("AUDIOLIB_NO_REEXEC") == "1":
        return
    os.environ["AUDIOLIB_NO_REEXEC"] = "1"
    os.execv(str(py), [str(py), *sys.argv])
