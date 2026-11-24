"""Tests for the SFX library. Run from projects/video-studio:

    .venv-audio/bin/python -m unittest discover -s scripts/audio/sfx/tests -t scripts/audio/sfx
"""

import sys
from pathlib import Path

_SFX = Path(__file__).resolve().parents[1]
for p in (_SFX, _SFX.parent):  # scripts/audio/sfx (sfxlib) and scripts/audio (audiolib)
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
