"""Tests for the audio engine. Run from projects/video-studio:

    .venv-audio/bin/python -m unittest discover -s scripts/audio/tests -t scripts/audio -v

Integration tests that need fluidsynth, the pinned soundfonts or VCSL skip themselves when those
are missing (scripts/audio/setup.sh installs them).
"""

import sys
from pathlib import Path

AUDIO_DIR = Path(__file__).resolve().parents[1]
if str(AUDIO_DIR) not in sys.path:
    sys.path.insert(0, str(AUDIO_DIR))
