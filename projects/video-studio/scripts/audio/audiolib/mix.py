"""The mix bus.

    mix = Mix(length=20.0, room="plate")
    mix.add(Strip("piano", piano_audio, fader_db=-2, eq=[...], comp=Compressor(...), send_db=-10))
    mix.add(Strip("bass", bass_audio, fader_db=-4, pan=0, sat={"drive_db": 4}, width=0))
    out, report = mix.render()

Strip order: gain staging (each raw stem to `stage_lufs`, so thresholds and faders mean the same
on every stem) -> EQ -> compressor -> saturation -> pedalboard inserts -> width (mid/side, with
optional bass mono) -> pan/balance -> fader -> post-fader reverb send.

Bus: sum of strips + reverb return (one shared convolution reverb, see reverb.py, with its own
return EQ) -> bus EQ ->
glue compressor (linked, RMS, sidechain high-pass so the kick and bass do not pump the whole mix)
-> optional bus saturation. The result is the pre-master mix; master.py sets the final loudness.

Plugin host: `inserts` takes any pedalboard plugins (Chorus, Phaser, Delay, LadderFilter, ...), run
in float32 on that strip. EQ, compression and saturation are this package's own float64,
stereo-linked and oversampled implementations, because pedalboard's built-in high/low-pass
filters are first order (6 dB/oct), its compressor detects each channel separately (an image
shift on stereo material) and its Distortion is not oversampled (aliasing at -15 dB on a 5 kHz
sine driven 20 dB). Those were measured on pedalboard 0.9.26; the true-peak limiter in master.py
is pedalboard's BrickwallLimiter.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import dsp, loudness
from .core import SR, as_stereo, db_to_lin, pad_to
from .dynamics import Compressor
from .reverb import PRESETS as ROOMS
from .reverb import Room, convolve, impulse_response

STAGE_LUFS = -20.0


@dataclass
class Strip:
    name: str
    audio: np.ndarray
    fader_db: float = 0.0
    pan: float = 0.0
    eq: list = field(default_factory=list)
    comp: Compressor | None = None
    sat: dict | None = None
    inserts: list = field(default_factory=list)
    width: float = 1.0
    bass_mono_hz: float | None = None
    send_db: float | None = None
    stage_lufs: float | None = STAGE_LUFS
    mute: bool = False


@dataclass
class Mix:
    length: float
    sr: int = SR
    room: object = "plate"  # a reverb preset name, a reverb.Room, or None for no reverb
    return_db: float = 0.0
    return_eq: list = field(default_factory=list)  # EQ on the reverb return (e.g. scoop the 300-600 Hz build-up)
    bus_eq: list = field(default_factory=list)
    glue: Compressor | None = field(default_factory=lambda: Compressor(threshold_db=-22.0, ratio=2.0, attack_ms=30.0, release_ms=200.0, knee_db=6.0, detector="rms", rms_ms=25.0, sidechain_hp_hz=90.0))
    glue_stage_lufs: float = -18.0
    bus_sat: dict | None = None
    strips: list = field(default_factory=list)

    def add(self, strip: Strip) -> Strip:
        if any(s.name == strip.name for s in self.strips):
            raise ValueError(f"strip {strip.name!r} exists")
        self.strips.append(strip)
        return strip

    @property
    def n(self) -> int:
        return int(round(self.length * self.sr))

    def process_strip(self, s: Strip):
        """Return (post-fader audio, send signal or None, report)."""
        a = pad_to(as_stereo(s.audio), self.n)
        rep = {"name": s.name}
        if s.stage_lufs is not None:
            i = loudness.integrated(a, self.sr)
            if np.isfinite(i):
                g = s.stage_lufs - i
                a = a * float(db_to_lin(g))
                rep["stageGainDb"] = round(float(g), 2)
        if s.eq:
            a = dsp.eq(a, s.eq, self.sr)
        if s.comp is not None:
            a, gr = s.comp.process(a, self.sr)
            rep["compGrMaxDb"] = round(float(-gr.min()), 2)
            rep["compGrMeanDb"] = round(float(-gr.mean()), 2)
        if s.sat:
            a = dsp.saturate(a, **s.sat)
        if s.inserts:
            import pedalboard

            a = pedalboard.Pedalboard(list(s.inserts))(a.astype(np.float32), self.sr).astype(np.float64)
        if s.width != 1.0 or s.bass_mono_hz:
            a = dsp.width(a, s.width, s.bass_mono_hz, self.sr)
        if s.pan:
            a = dsp.balance(a, s.pan)
        a = a * float(db_to_lin(s.fader_db))
        send = None
        if s.send_db is not None:
            send = a * float(db_to_lin(s.send_db))
        rep["postFaderLufs"] = round(float(loudness.integrated(a, self.sr)), 2)
        return a, send, rep

    def render(self, return_stems: bool = False):
        """Mix everything. Returns (mix, report) or (mix, report, stems) with stems = post-fader
        strips plus 'reverb' (the return), all the same length; their sum equals the bus input."""
        n = self.n
        bus = np.zeros((2, n))
        sends = np.zeros((2, n))
        stems = {}
        reps = []
        for s in self.strips:
            if s.mute:
                continue
            a, send, rep = self.process_strip(s)
            bus += a
            if send is not None:
                sends += send
            stems[s.name] = a
            reps.append(rep)
        report = {"strips": reps}
        if self.room is not None and np.any(sends):
            room = ROOMS[self.room] if isinstance(self.room, str) else self.room
            if not isinstance(room, Room):
                raise TypeError("room must be a preset name or a reverb.Room")
            ir = impulse_response(room, self.sr)
            wet = convolve(sends, ir)[:, :n] * float(db_to_lin(self.return_db))
            if self.return_eq:
                wet = dsp.eq(wet, self.return_eq, self.sr)
            bus += wet
            stems["reverb"] = wet
            report["reverb"] = {"rt60": room.rt60, "predelayMs": room.predelay_ms, "returnLufs": round(float(loudness.integrated(wet, self.sr)), 2)}
        if self.bus_eq:
            bus = dsp.eq(bus, self.bus_eq, self.sr)
        if self.glue is not None:
            i = loudness.integrated(bus, self.sr)
            stage = (self.glue_stage_lufs - i) if np.isfinite(i) else 0.0
            staged = bus * float(db_to_lin(stage))
            glued, gr = self.glue.process(staged, self.sr)
            bus = glued * float(db_to_lin(-stage))
            report["glue"] = {"grMaxDb": round(float(-gr.min()), 2), "grMeanDb": round(float(-gr.mean()), 2), "stageDb": round(float(stage), 2)}
        if self.bus_sat:
            bus = dsp.saturate(bus, **self.bus_sat)
        report["busLufs"] = round(float(loudness.integrated(bus, self.sr)), 2)
        report["busTruePeak"] = round(float(loudness.true_peak(bus)), 2)
        if return_stems:
            return bus, report, stems
        return bus, report
