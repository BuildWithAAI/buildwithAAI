"""sfxlib: the studio's SFX library (sound designer), built on the audio engine (scripts/audio/audiolib).

Modules:
    core      constants (48 kHz, 30 fps = 1600 samples a frame, -6 dBFS peak), the Sound record, mix roles
    prims     synthesis primitives: modal bodies, pulses, noise bursts, sweeps, chirps, stick-slip, pan
    vcsl      VCSL (CC0) one-shots: load, trim, measured pitch, pitch shift, varispeed along a curve
    space     the shared small rooms that make the family sit in one place
    rig       Zoo's typing rig (fingerLift strike frames) and a frame-locked typing rhythm
    finish    finishing chain: high/low-pass, clean tail, -6 dBFS peak, sync on a frame boundary
    measure   per-file analysis for the manifest and the QA checks (transient, sync, loudness, resonances)
    manifest  manifest entries and the public manifest.json
    review    spectrogram/waveform review sheets with frame grid lines (PNG, no extra dependencies)
    families  one module per family of effects (whoosh, ui, keyboard, desk, notify, rekt, badger)

Every family is deterministic: the same code renders the same files, bit for bit.
"""

from __future__ import annotations

import sys
from pathlib import Path

_AUDIO_DIR = Path(__file__).resolve().parents[2]  # scripts/audio (audiolib lives here)
if str(_AUDIO_DIR) not in sys.path:
    sys.path.insert(0, str(_AUDIO_DIR))

__version__ = "1.0.0"
