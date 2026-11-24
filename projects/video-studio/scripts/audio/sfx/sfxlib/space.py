"""The shared spaces that make the SFX sound like one family in one place.

The narration (Kokoro, dry) has no room of its own, so the effects stay close and dry too: a
small amount of one of three tiny synthesised rooms (audiolib.reverb IRs, seeded) is enough to
take the "in the head" edge off foley without putting it in a different space from the voice.

- desk: a few close reflections off a desk top and a monitor, 0.16 s; for keys, clicks, mug, paws
- set:  the talk-show set, a small treated studio, 0.3 s; for chair creaks and tail thumps
- air:  a short diffuse tail for whooshes, swipes and the tonal UI sounds, 0.45 s
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np

from audiolib import reverb
from audiolib.core import as_stereo
from audiolib.reverb import Room

ROOMS = {
    "desk": Room(rt60=0.16, predelay_ms=1.2, er_ms=8, er_level_db=0.0, build_ms=2, damping=0.7, low_ratio=1.0, width=0.5, hp_hz=300, lp_hz=7000, seed="sfx-desk"),
    "set": Room(rt60=0.30, predelay_ms=3, er_ms=16, er_level_db=-2.0, build_ms=5, damping=0.65, low_ratio=1.0, width=0.8, hp_hz=200, lp_hz=7500, seed="sfx-set"),
    "air": Room(rt60=0.45, predelay_ms=8, er_ms=20, er_level_db=-6.0, build_ms=12, damping=0.5, low_ratio=0.9, width=1.0, hp_hz=350, lp_hz=9000, seed="sfx-air"),
}


@lru_cache(maxsize=None)
def impulse(name: str) -> np.ndarray:
    if name not in ROOMS:
        raise ValueError(f"unknown room {name!r}; known: {sorted(ROOMS)}")
    ir = reverb.impulse_response(ROOMS[name])
    ir.setflags(write=False)
    return ir


def add_room(x, name: str, wet_db: float) -> np.ndarray:
    """Dry signal plus `wet_db` of the room (the IR has unit energy per channel, so wet_db is the
    energy of the reflected sound relative to the dry sound). The result is longer by the IR."""
    dry = as_stereo(x)
    wet = reverb.convolve(dry, impulse(name)) * 10 ** (wet_db / 20.0)
    out = wet.copy()
    out[:, : dry.shape[1]] += dry
    return out
