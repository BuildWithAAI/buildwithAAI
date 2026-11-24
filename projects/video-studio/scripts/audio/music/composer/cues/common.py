"""Shared building blocks: channel strips with tuned defaults, reverbs, voicings, grooves.

Mix conventions (DIRECTION.md section 6): high-pass everything but the kick, bass and sub; the
bass, sub and kick are mono; reverb returns are high-passed (the presets) and scooped at 400-600 Hz;
mid instruments get a gentle dip around 2.5 kHz so the voice and the motif keep their space.
"""

from __future__ import annotations

from audiolib import theory
from audiolib.core import note_number
from audiolib.dynamics import Compressor
from composer import instruments as I
from composer import synths as S
from composer.render import Reverb, Track

# ------------------------------------------------------------------------------------------ reverbs

def reverbs(plate_db: float = 0.0, hall_db: float = 0.0, room_db: float = 0.0) -> dict:
    return {
        "plate": Reverb("plate", plate_db, [{"kind": "peak", "f": 520, "q": 0.8, "db": -3.0}, {"kind": "highshelf", "f": 8000, "q": 0.7, "db": -2.0}]),
        "hall": Reverb("hall", hall_db, [{"kind": "peak", "f": 450, "q": 0.8, "db": -3.0}, {"kind": "highshelf", "f": 7000, "q": 0.7, "db": -2.5}]),
        "room": Reverb("room", room_db, [{"kind": "peak", "f": 600, "q": 0.9, "db": -2.0}]),
    }


# ------------------------------------------------------------------------------------------ strips

HP = lambda f, order=2: {"kind": "highpass", "f": f, "order": order}  # noqa: E731
LP = lambda f, order=2: {"kind": "lowpass", "f": f, "order": order}  # noqa: E731
PK = lambda f, db, q=1.0: {"kind": "peak", "f": f, "q": q, "db": db}  # noqa: E731
HS = lambda f, db, q=0.7: {"kind": "highshelf", "f": f, "q": q, "db": db}  # noqa: E731
LS = lambda f, db, q=0.7: {"kind": "lowshelf", "f": f, "q": q, "db": db}  # noqa: E731
LS = lambda f, db, q=0.7: {"kind": "lowshelf", "f": f, "q": q, "db": db}  # noqa: E731


def piano(name="piano", part=None, kind="kawai", fader=0.0, pan=0.0, plate=-11.0, hall=None, bright=2.5, width=1.0, eq_extra=(), pocket=False):
    sends = {"plate": plate} if plate is not None else {}
    if hall is not None:
        sends["hall"] = hall
    return Track(name, I.piano(kind), part=part, fader_db=fader, pan=pan,
                 eq=[HP(55), PK(260, -1.5, 1.0), PK(560, -2.5, 0.9), PK(2600, -2.0 if pocket else 0.5, 1.2), HS(6500, bright - (2.0 if pocket else 0.0)), *eq_extra],
                 comp=Compressor(threshold_db=-24, ratio=2.0, attack_ms=20, release_ms=180, knee_db=6, detector="rms", rms_ms=15),
                 width=width, bass_mono_hz=140, sends=sends)


def vibes(name="vibes", part=None, mallet="soft", fader=-2.0, pan=0.25, plate=None, hall=-9.0, pocket=False):
    sends = {"hall": hall} if hall is not None else {}
    if plate is not None:
        sends["plate"] = plate
    return Track(name, I.vibes(mallet), part=part, fader_db=fader, pan=pan,
                 eq=[HP(140), PK(450, -2.0, 0.9), PK(1000, -1.5, 1.2), PK(2800, -2.5 if pocket else 0.0, 1.0), HS(7000, -0.5 if pocket else 1.5)],
                 comp=Compressor(threshold_db=-22, ratio=1.8, attack_ms=12, release_ms=150, knee_db=6, detector="rms"),
                 width=1.0, sends=sends)


def ep(name="ep", part=None, fader=-3.0, pan=-0.2, plate=-12.0, brightness=0.9, drive=3.0, tremolo=0.16, pocket=False, eq_extra=()):
    return Track(name, S.TineEP(brightness=brightness, drive_db=drive, tremolo_depth=tremolo, seed=f"ep-{name}"), part=part, fader_db=fader, pan=pan,
                 eq=[HP(150 if pocket else 90), PK(300, -1.5, 1.0), PK(2500, -2.5 if pocket else 0.0, 1.0), HS(9000, -1.5 if pocket else 0.5), *eq_extra],
                 comp=Compressor(threshold_db=-24, ratio=2.0, attack_ms=15, release_ms=160, knee_db=6, detector="rms"),
                 width=0.9, sends={"plate": plate})


def pad(name="pad", part=None, fader=-8.0, cutoff=1100.0, hall=-8.0, width=1.2, seed="pad", pocket=False):
    return Track(name, S.Pad(cutoff=cutoff, seed=seed), part=part, fader_db=fader,
                 eq=[HP(160), PK(400, -2.0, 0.8), PK(2200, -3.0 if pocket else -1.0, 0.8), LP(6000)], width=width, bass_mono_hz=200, sends={"hall": hall})


def pulse(name="pulse", part=None, fader=-12.0, cutoff_hi=2200.0, plate=-14.0, delay=True, seed="pulse", pocket=False):
    import pedalboard

    ins = [pedalboard.Delay(delay_seconds=0.45, feedback=0.28, mix=0.18)] if delay else []
    return Track(name, S.Pulse(cutoff_hi=cutoff_hi, seed=seed), part=part, fader_db=fader,
                 eq=[HP(180), PK(2600, -3.0 if pocket else 0.0, 1.0), LP(7000)], inserts=ins, width=1.0, sends={"plate": plate})


def brass(name="brass", part=None, fader=-6.0, pan=0.0, hall=-11.0, seed="brass", pocket=False):
    return Track(name, S.BrassStab(seed=seed), part=part, fader_db=fader, pan=pan,
                 eq=[HP(150), PK(380, -2.0, 1.0), PK(2700, -2.5 if pocket else 0.5, 1.0), LP(9000)],
                 comp=Compressor(threshold_db=-20, ratio=2.5, attack_ms=10, release_ms=120, knee_db=6), width=1.0, sends={"hall": hall, "plate": -14.0})


def guitar(name="gtr", part=None, fader=-10.0, pan=0.45, plate=-16.0, seed="gtr", pocket=False):
    import pedalboard

    return Track(name, S.muted_guitar(seed), part=part, fader_db=fader, pan=pan,
                 eq=[HP(120), PK(800, 1.5, 1.0), PK(3000, -2.0 if pocket else 0.5, 1.2), LP(7000)],
                 sat={"drive_db": 8.0, "kind": "asym", "mix": 0.6},
                 inserts=[pedalboard.Chorus(rate_hz=0.6, depth=0.15, centre_delay_ms=7.0, feedback=0.0, mix=0.25)],
                 comp=Compressor(threshold_db=-14, ratio=2.5, attack_ms=8, release_ms=90, knee_db=6), width=0.8, sends={"plate": plate})


BASS_LP_BED = 1500.0  # under narration (beds, the end screen): nothing of the bass reaches Zoo's consonants
BASS_LP_BAND = 2500.0  # everything else: enough finger and string for definition on a phone


def bass(name="bass", part=None, fader=-1.0, t60=3.5, seed="bass", drive=2.5, lp=BASS_LP_BAND):
    """The plucked bass (BASS-FIX, critic round 1): a 24 dB/octave low-pass at `lp` (1.5 kHz under the
    voice, 2.5 kHz elsewhere; it was a 12 dB/octave 4.8 kHz with an 850 Hz lift) and light
    saturation (2.5 dB, 30 % wet; it was 6 dB, 50 %). Before the fix the bass alone matched a show
    bed's whole 1-4 kHz level."""
    return Track(name, S.fingered_bass(seed, t60), part=part, fader_db=fader,
                 eq=[HP(32, 4), PK(70, 1.5, 1.0), PK(240, -2.5, 1.2), LP(lp, 4)],
                 comp=Compressor(threshold_db=-20, ratio=3.0, attack_ms=15, release_ms=120, knee_db=6),
                 sat={"drive_db": drive, "kind": "asym", "mix": 0.3}, width=0.0)


def sub(name="sub", part=None, fader=-8.0):
    return Track(name, S.Sub(), part=part, fader_db=fader, eq=[HP(28, 4), LP(140, 4)], width=0.0)


def kick(name="kick", part="kick", fader=-1.5, f_end=55.0, gm_layer_db: float | None = -5.0, pocket: bool = False):
    """The synth kick and (optionally) the MuseScore kick as a beater layer `gm_layer_db` under it
    (KICK-FIX: -5 dB, was -9, so the attack carries on phones while the shorter body stays low).
    pocket=True (beds, under the voice): the beater's 3.2 kHz click is cut 2 dB instead of lifted 2
    dB; measured on bed-show-tension, the beater made a fifth of the bed's 1-4 kHz onsets."""
    out = [Track(name, S.SynthKick(f_end=f_end, seed=name), part=part, fader_db=fader,
                 eq=[HP(28, 4), PK(60, 1.0, 1.2), PK(320, -4.0, 1.2), PK(3500, 1.5, 1.0)],
                 comp=Compressor(threshold_db=-16, ratio=2.5, attack_ms=12, release_ms=90, knee_db=4), width=0.0)]
    if gm_layer_db is not None:
        out.append(Track(f"{name}_beater", I.GM_KIT, part=part, fader_db=fader + gm_layer_db,
                         eq=[HP(120, 2), PK(330, -3.0, 1.2), PK(3200, -2.0 if pocket else 2.0, 1.0)], width=0.0))
    return out


def kit_tracks(part="kit", style="tight", snare=-3.0, hats=-9.0, claps=-7.0, perc=-12.0, cymbals=-11.0, toms=-6.0, bdrum=-6.0,
               room=-14.0, plate=-12.0, hats_pan=0.3, pocket=False):
    k = I.kit(style)
    G = I.KIT_GROUPS
    return [
        Track("snare", k, part=part, only=G["snare"], fader_db=snare,
              eq=[HP(90), PK(200, 1.5, 1.2), PK(650, -2.0, 1.4), PK(4500, 1.0, 1.2)],
              comp=Compressor(threshold_db=-14, ratio=3.0, attack_ms=10, release_ms=100, knee_db=4), width=0.6, sends={"plate": plate, "room": room}),
        Track("hats", k, part=part, only=G["hats"], fader_db=hats, pan=hats_pan, eq=[HP(320), PK(3000, -2.0 if pocket else 0.0, 1.0), HS(9000, -1.0 if pocket else 1.0)], width=0.7, sends={"room": room - 2}),
        Track("claps", k, part=part, only=G["claps"], fader_db=claps, eq=[HP(200), PK(1200, -1.0, 1.0), PK(3000, -2.0 if pocket else 0.0, 1.2)], width=0.9, sends={"plate": plate + 2}),
        Track("perc", k, part=part, only=G["perc"], fader_db=perc, pan=-0.35, eq=[HP(300), PK(3200, -2.0 if pocket else 0.0, 1.0), HS(9000, -1.5 if pocket else 0.0), *([LP(11000)] if pocket else [])], width=0.8, sends={"room": room}),
        Track("cymbals", k, part=part, only=G["cymbals"], fader_db=cymbals, pan=-0.25, eq=[HP(280), PK(3500, -1.5 if pocket else 0.0, 1.0), HS(8000, -2.0 if pocket else 0.0)], width=1.0, sends={"hall": -14.0}),
        Track("toms", k, part=part, only=G["toms"], fader_db=toms, eq=[HP(60), PK(400, -2.0, 1.0)], width=0.7, sends={"room": room + 2, "plate": plate - 2}),
        Track("bdrum", k, part=part, only=G["bdrum"], fader_db=bdrum, eq=[HP(30, 4), PK(400, -3.0, 1.0), LP(5000)], width=0.4, sends={"hall": -12.0}),
    ]


def strings(name, section, articulation="slow", expressive=False, part=None, fader=-6.0, pan=0.0, width=0.8, hall=-8.0, eq_extra=(), pocket=False):
    eq = [HP(70 if section in ("basses", "celli") else 140), PK(400, -1.5, 0.9), PK(2400, -2.5 if pocket else 0.0, 1.0), *eq_extra]
    if section == "violins":
        eq.append(HS(7000, -1.5 if pocket else 0.0))
    return Track(name, I.strings(section, articulation, expressive), part=part, fader_db=fader, pan=pan, eq=eq,
                 width=width, bass_mono_hz=160, sends={"hall": hall}, gm_gain=0.6)


def mallets(name, sampler, part=None, fader=-6.0, pan=0.0, hall=-10.0, hp=200.0, pocket=False, width=1.0, eq_extra=()):
    return Track(name, sampler, part=part, fader_db=fader, pan=pan, eq=[HP(hp), PK(2800, -2.5 if pocket else 0.0, 1.0), HS(8000, -1.0 if pocket else 0.5), *eq_extra],
                 width=width, sends={"hall": hall})


# ------------------------------------------------------------------------------------------ bed bus

# POCKET-FIX (critic round 1): Zoo's consonants live at 1-2.5 kHz, where his voice is 18-26 dB under
# its own peak, so the bed bus dips 1.25 and 2 kHz by 3 dB each (Q 1); the old single dip at 2.5 kHz
# (-4 dB, Q 0.7) sat above his weakest band.
VOICE_POCKET = (PK(1250, -3.0, 1.0), PK(2000, -3.0, 1.0))


def audio(name, clip, fader=-6.0, hall=None, eq=None, width=1.0, pan=0.0):
    return Track(name, clip, fader_db=fader, eq=eq or [HP(200)], width=width, pan=pan, sends=({"hall": hall} if hall is not None else {}), stage_lufs=None)


# ------------------------------------------------------------------------------------------ harmony helpers

def notes(names) -> list:
    return [note_number(n) for n in (names.split() if isinstance(names, str) else names)]


def chord(part, start: float, dur: float, voicing, vel: int = 70, roll: float = 0.0, **meta) -> None:
    ns = sorted(notes(voicing))
    for i, p in enumerate(ns):
        part.note(p, start + i * roll, max(0.05, dur - i * roll), vel, **meta)


def led(symbols, low=52, high=72, max_notes=4, rootless=True):
    """Voice-led voicings for a list of chord symbols (theory.progression)."""
    return theory.progression(symbols, low, high, max_notes=max_notes, rootless=rootless)
