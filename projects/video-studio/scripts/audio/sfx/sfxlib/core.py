"""Constants, mix roles and the Sound record shared by every SFX family.

Frame sync: the studio renders at 30 fps and 48 kHz, so one video frame is exactly 1600 samples.
Every designed sync point (a whoosh's pass-by, a key strike in a typing burst, the end of a
reverse whoosh) sits on a multiple of 1600 samples, and every impact starts its transient within
the first millisecond. Placing a file at frame F in Remotion therefore puts its sync point exactly
on frame F + syncFrame, with no sub-frame drift. 1600 is also a multiple of 800, so the same holds
at 60 fps.

Levels: every file is peak-normalised to -6 dBFS (sample peak). Perceived loudness then differs
with the sound's shape, so each manifest entry carries `suggestedGainDb`: the gain that brings the
file's short-window loudness (BS.1770 K-weighted power in a 200 ms window, maximised over the
file) to its role's target in a show mixed with narration at -14 LUFS-I, capped so the file's
true peak never goes above -6 dBTP (Remotion sums tracks without a limiter; -6 dBTP is also the
engine's ceiling for beds, "headroom for summing with voice and SFX"). Why 200 ms and not the EBU momentary 400 ms window: loudness
integrates energy over roughly the first 200 ms of a sound (below that, equal energy sounds equally
loud), so a 400 ms window under-reads a 20 ms click by about 3 dB more than our ears do; measured
over this library, M400 put a key click's suggested gain 6.8 dB up, which would have pushed its
peak to +0.8 dBFS. LUFS-M (400 ms) and a 100 ms reading are reported next to it in the manifest.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from audiolib.core import SR

FPS = 30
FRAME = SR // FPS  # 1600 samples per frame at 30 fps
assert FRAME * FPS == SR
PEAK_DBFS = -6.0
BIT_DEPTH = 24

# Mix roles: target short-window loudness (LUFS, 200 ms window, max) at the suggested gain.
# Narration is normalised to -14 LUFS-I (its 200 ms peaks sit about -9); the bed sits about
# -26 LUFS-S and ducks a further 6 dB under speech. Starting values for the mix: tune by ear.
GAIN_WINDOW_S = 0.2
TRUE_PEAK_CAP_DBTP = -6.0  # the engine's bed ceiling: headroom to sum with the voice (Remotion mixes without a limiter)
ROLES = {
    "transition": {"targetLufs": -18.0, "use": "whooshes and swells at cuts and reveals, usually in a gap between lines"},
    "meter": {"targetLufs": -22.0, "use": "Rekt Meter needle and alarm rise: a feature moment, still under the voice"},
    "notify": {"targetLufs": -21.0, "use": "ding, success, error, DEVELOPING pulse: clear but never startling"},
    "ui": {"targetLufs": -24.0, "use": "pops, plops, ticks, swipes: often under narration"},
    "foley": {"targetLufs": -28.0, "use": "keyboard, mouse, mug, chair, Badger's paws and tail: natural, background"},
}

SYNC_KINDS = ("transient", "hit", "peak", "end", "start")


@dataclass
class Sound:
    """One designed effect before finishing.

    audio: (2, n) or (n,) float64 at 48 kHz, any level (finishing normalises it).
    sync: what the sync point is: 'transient' (an impact at the very start), 'hit' (an impact at
    sync_s after a lead-in, e.g. a mug slid into place), 'peak' (a whoosh's pass-by), 'end' (the
    top of a reverse whoosh or a rise), 'start' (motion that starts with the file).
    sync_s: the designed sync time in seconds (a multiple of 1/30 s); None means the measured
    transient (impacts start within the first millisecond).
    events: timed sub-events for multi-hit sounds, e.g. [{"t": 0.1333, "kind": "key"}]; every
    event time is a multiple of 1/30 s unless `frame_locked` is False.
    """

    id: str
    group: str
    category: str
    role: str
    audio: np.ndarray
    description: str
    tags: list
    sync: str = "transient"
    sync_s: float | None = None
    events: list = field(default_factory=list)
    frame_locked: bool = True
    sources: list = field(default_factory=list)
    pitch: str | None = None
    loop: bool = False
    hp_hz: float | None = 40.0
    lp_hz: float | None = 16000.0
    rig: dict | None = None
    extra: dict = field(default_factory=dict)

    def __post_init__(self):
        if self.role not in ROLES:
            raise ValueError(f"{self.id}: unknown role {self.role!r}; known: {sorted(ROLES)}")
        if self.sync not in SYNC_KINDS:
            raise ValueError(f"{self.id}: unknown sync kind {self.sync!r}")
        if not self.tags:
            raise ValueError(f"{self.id}: tags are required")


SYNTH_SOURCE = {"kind": "synthesis", "by": "scripts/audio/sfx (this repo)", "licence": "original work, owned"}


def frames_to_s(frames: float) -> float:
    return frames / FPS


def s_to_samples(seconds: float) -> int:
    return int(round(seconds * SR))


def on_frame(seconds: float, tol_samples: int = 0) -> bool:
    """True when a time lies on a 30 fps frame boundary (a multiple of 1600 samples)."""
    k = s_to_samples(seconds)
    r = k % FRAME
    return min(r, FRAME - r) <= tol_samples
