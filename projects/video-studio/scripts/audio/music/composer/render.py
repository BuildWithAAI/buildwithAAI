"""From a written score to a mastered cue: stems -> (loop folding) -> mix with several reverbs -> master.

Seamless loops by construction (a loop cue has `loop=True`, `length` = one cycle):
1. every stem is rendered for one cycle plus `tail` seconds (release and ring past the cycle end);
2. the tail is folded onto the start (y[:tail] += y[L:L+tail]), so the stem is exactly periodic:
   what rings past bar N lands on bar 1, as it would when the loop plays again;
3. the periodic stems are padded with `wrap` seconds of their own end and start, mixed (reverbs,
   delays and compressors see the seam), and the middle cycle is kept;
4. the master runs with loop=True (the engine pads the wrap-around for the compressor and limiter).
So the cue plays back-to-back with no seam, sample for sample.

Several reverbs: tracks send to any of `Arrangement.reverbs` by name (e.g. a short room for drums
and a hall for strings); each return has its own EQ and level. The bus then gets an EQ, the glue
compressor (staged like the engine's Mix) and optional saturation.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from audiolib import dsp, fluid, io, loudness, master
from audiolib.core import SR, as_stereo, db_to_lin, pad_to
from audiolib.dynamics import Compressor
from audiolib.midi import GM, Score
from audiolib.mix import Mix, Strip
from audiolib.reverb import PRESETS as ROOMS
from audiolib.reverb import Room, convolve, impulse_response

class SafeCompressor(Compressor):
    """The engine's compressor with a -140 dBFS floor in the detector path only.

    Workaround for an engine edge case (audiolib 1.0.0, dynamics.Compressor with detector="rms"):
    uniform_filter1d's running mean of x**2 can dip a few ulp below zero in digital silence after
    loud passages, np.sqrt then returns NaN and the NaN gain spreads through the mix. A DC-free
    +-1e-7 alternating floor in the sidechain keeps the mean square positive and changes the
    detected level by nothing measurable (it is 140 dB down)."""

    def process(self, audio, sr: int = SR, sidechain=None):
        from audiolib.core import as_channels

        a = as_channels(audio)
        sc = as_channels(sidechain) if sidechain is not None else a
        floor = np.where(np.arange(sc.shape[1]) % 2 == 0, 1e-7, -1e-7)
        return super().process(a, sr, sidechain=sc + floor)


def safe(comp):
    """Wrap any engine Compressor as a SafeCompressor (same settings)."""
    if comp is None or isinstance(comp, SafeCompressor):
        return comp
    from dataclasses import asdict

    return SafeCompressor(**asdict(comp))


def safe_preset(name: str):
    from dataclasses import replace

    p = master.PRESETS[name]
    return replace(p, comp=safe(p.comp))


DEFAULT_GLUE = dict(threshold_db=-22.0, ratio=2.0, attack_ms=30.0, release_ms=200.0, knee_db=6.0, detector="rms", rms_ms=25.0, sidechain_hp_hz=90.0)


@dataclass
class Reverb:
    room: object = "plate"  # preset name or audiolib.reverb.Room
    return_db: float = 0.0
    return_eq: list = field(default_factory=list)


@dataclass
class Track:
    """One mixer channel. `source` is a GM preset (rendered by fluidsynth), any object with
    render(part, score, length) (Sampler, PluckString, composer.synths voices), a Kit (with `only`),
    or a ready (2, n) array (positioned audio such as swells; it is padded or cut to length)."""

    name: str
    source: object
    part: str | None = None
    only: set | None = None
    fader_db: float = 0.0
    pan: float = 0.0
    eq: list = field(default_factory=list)
    comp: Compressor | None = None
    sat: dict | None = None
    inserts: list = field(default_factory=list)
    width: float = 1.0
    bass_mono_hz: float | None = None
    sends: dict = field(default_factory=dict)
    stage_lufs: float | None = -20.0
    gm_gain: float = fluid.DEFAULT_GAIN


@dataclass
class Arrangement:
    cue_id: str
    score: Score
    length: float
    tracks: list
    preset: str = "standalone"
    loop: bool = False
    tail: float = 8.0
    wrap: float = 8.0
    reverbs: dict = field(default_factory=lambda: {"plate": Reverb("plate")})
    bus_eq: list = field(default_factory=list)
    glue: Compressor | None = field(default_factory=lambda: SafeCompressor(**DEFAULT_GLUE))
    glue_stage_lufs: float = -18.0
    bus_sat: dict | None = None
    fade_in: float = 0.0
    fade_out: float = 0.0
    fade_curve: str = "sine"


# ------------------------------------------------------------------------------------------ helpers for writing

def cc_curve(part, controller: int, start: float, end: float, v0: int, v1: int, steps_per_beat: int = 8, shape: float = 1.0) -> None:
    """Write a CC ramp from v0 to v1 over [start, end] beats (shape > 1 = slow start, < 1 = fast start)."""
    steps = max(2, int(math.ceil((end - start) * steps_per_beat)))
    last = None
    for i in range(steps + 1):
        x = i / steps
        v = int(round(v0 + (v1 - v0) * x**shape))
        if v != last:
            part.cc(controller, max(0, min(127, v)), start + (end - start) * x)
            last = v


def swell(part, start: float, end: float, v0: int, v1: int, shape: float = 1.0) -> None:
    """Dynamics for the expressive (CC2) string banks."""
    cc_curve(part, 2, start, end, v0, v1, shape=shape)


def humanize_part(part, score, timing_ms: float = 5.0, drift_ms: float = 3.0, velocity: float = 4.0, seed: str = "h",
                  swing: float | None = None, swing_grid: float = 0.5, roll_ms: float | None = None, lay_back_ms: float = 0.0) -> None:
    from audiolib import humanize

    if roll_ms:
        part.notes = humanize.roll(part.notes, roll_ms, score)
    if swing:
        part.notes = humanize.swing(part.notes, amount=swing, grid=swing_grid)
    part.notes = humanize.humanize(part.notes, score, timing_ms=timing_ms, drift_ms=drift_ms, velocity=velocity, seed=seed)
    if lay_back_ms:
        for n in part.notes:
            n.start += score.ms_to_beats(lay_back_ms, n.start)


def _score_with(score: Score, part, instrument) -> Score:
    s = Score(bpm=score._bpm[0], time_sig=score.time_sig, tempo_changes=list(zip(score._beats[1:], score._bpm[1:])), key=score.key)
    p = part.copy(part.name)
    p.instrument = instrument
    s.parts[p.name] = p
    return s


# ------------------------------------------------------------------------------------------ rendering

CACHE_VERSION = "1"


def _source_key(src) -> str:
    """A stable description of an instrument for the stem cache (settings, not object identity)."""
    if isinstance(src, GM):
        return f"GM({src.program},{src.bank},{src.soundfont},{src.drums})"
    if hasattr(src, "pieces"):  # Kit
        return "Kit(" + ",".join(f"{k}:{_source_key(v)}" for k, v in sorted(src.pieces.items())) + f";{src.chokes})"
    if hasattr(src, "bank") and hasattr(src, "velocity_power"):  # Sampler
        zones = sorted(str(z.path.name) for z in src.bank.zones)
        h = hashlib.sha256("|".join(zones).encode()).hexdigest()[:16]
        return (f"Sampler({src.seed},{h},{src.velocity_power},{src.normalize_layers},{src.damper},{src.release_gain_db},"
                f"{src.one_shot},{src.gain_db},{src.pedal_bank is not None},{src.release_bank is not None})")
    fields = getattr(src, "__dataclass_fields__", None)
    if fields:
        return type(src).__name__ + "(" + ",".join(f"{k}={getattr(src, k)!r}" for k in fields if not k.startswith("_")) + ")"
    return repr(src)


def _stem_key(arr: Arrangement, tr: Track, total: float) -> str:
    part = arr.score.parts[tr.part or tr.name]
    notes = [(n.pitch, round(n.start, 6), round(n.dur, 6), n.vel) for n in part.notes]
    payload = json.dumps([CACHE_VERSION, _source_key(tr.source), sorted(tr.only) if tr.only else None, tr.gm_gain, round(total, 6),
                          arr.score._beats, arr.score._bpm, notes, sorted(part.ccs), sorted(part.bends)], default=str)
    return hashlib.sha256(payload.encode()).hexdigest()[:24]


def render_stems(arr: Arrangement, workdir: Path, cache: Path | None = None) -> dict:
    """Raw stems, each (2, n) with n = length (+ tail for loops). With `cache`, stems whose notes and
    instrument settings are unchanged are reused (mix-only iterations are then fast)."""
    total = arr.length + (arr.tail if arr.loop else 0.0)
    n = int(round(total * SR))
    stems = {}
    for tr in arr.tracks:
        src = tr.source
        if isinstance(src, np.ndarray):
            stems[tr.name] = pad_to(as_stereo(src), n)
            continue
        part = arr.score.parts[tr.part or tr.name]
        cpath = None
        if cache is not None:
            cpath = Path(cache) / f"{tr.name}-{_stem_key(arr, tr, total)}.npy"
            if cpath.exists():
                stems[tr.name] = pad_to(np.load(cpath), n)
                continue
        if isinstance(src, GM):
            s = _score_with(arr.score, part, src)
            a = fluid.render_part(s, part.name, total, tail=3.0, gain=tr.gm_gain, workdir=workdir / "fluid" / tr.name)
        elif hasattr(src, "pieces"):  # Kit
            a = src.render(part, arr.score, total, only=tr.only)
        else:
            a = src.render(part, arr.score, total)
        stems[tr.name] = pad_to(as_stereo(a), n)
        if cpath is not None:
            cpath.parent.mkdir(parents=True, exist_ok=True)
            np.save(cpath, stems[tr.name].astype(np.float32))
    return stems


def fold(stems: dict, length: float) -> dict:
    """Make every stem exactly periodic with period `length` (see the module docstring)."""
    L = int(round(length * SR))
    out = {}
    for k, a in stems.items():
        y = a[:, :L].copy()
        tail = a[:, L:]
        pos = 0
        while pos < tail.shape[1]:  # a tail longer than the cycle wraps more than once
            seg = tail[:, pos : pos + L]
            y[:, : seg.shape[1]] += seg
            pos += L
        out[k] = y
    return out


def _wrap(a: np.ndarray, k: int) -> np.ndarray:
    if k <= 0:
        return a
    reps = int(math.ceil(k / a.shape[1]))
    big = np.concatenate([a] * (2 * reps + 1), axis=1)
    mid = reps * a.shape[1]
    return big[:, mid - k : mid + a.shape[1] + k]


_JOB: dict = {}


def _strip_worker(i: int):
    out, _, rep = _JOB["engine"].process_strip(_JOB["strips"][i])
    return i, out, rep


def _process_strips(engine: Mix, strips: list) -> list:
    """Channel strips are independent, so they run in parallel (fork, MUSIC_JOBS workers, default
    min(4, CPUs)); MUSIC_JOBS=1 runs them in this process. Results come back in order."""
    import multiprocessing as mp
    import os

    jobs = int(os.environ.get("MUSIC_JOBS", min(4, os.cpu_count() or 1)))
    if jobs <= 1 or len(strips) < 2:
        return [engine.process_strip(st)[0::2] for st in strips]
    _JOB["engine"], _JOB["strips"] = engine, strips
    try:
        with mp.get_context("fork").Pool(processes=min(jobs, len(strips))) as pool:
            res = sorted(pool.map(_strip_worker, range(len(strips))), key=lambda r: r[0])
    finally:
        _JOB.clear()
    return [(out, rep) for _, out, rep in res]


def mix(arr: Arrangement, stems: dict):
    """Returns (premaster, report, post_fader_stems). For loops the stems must already be folded."""
    L = int(round(arr.length * SR))
    pad = int(round(arr.wrap * SR)) if arr.loop else 0
    N = L + 2 * pad
    engine = Mix(length=N / SR, room=None, glue=None)
    bus = np.zeros((2, N))
    sends = {name: np.zeros((2, N)) for name in arr.reverbs}
    post = {}
    reps = []
    strips = []
    for tr in arr.tracks:
        a = stems[tr.name]
        a = _wrap(a[:, :L], pad) if arr.loop else pad_to(a, N)
        if not np.any(a):
            continue
        strips.append((tr, Strip(tr.name, a, fader_db=tr.fader_db, pan=tr.pan, eq=tr.eq, comp=safe(tr.comp), sat=tr.sat, inserts=tr.inserts,
                                 width=tr.width, bass_mono_hz=tr.bass_mono_hz, send_db=None, stage_lufs=tr.stage_lufs)))
    for (tr, _), (out, rep) in zip(strips, _process_strips(engine, [st for _, st in strips])):
        for rv, db in tr.sends.items():
            if rv not in sends:
                raise KeyError(f"track {tr.name!r} sends to unknown reverb {rv!r}")
            sends[rv] += out * float(db_to_lin(db))
        bus += out
        post[tr.name] = out
        reps.append(rep)
    report = {"strips": reps, "reverbs": {}}
    for name, rv in arr.reverbs.items():
        if not np.any(sends[name]):
            continue
        room = ROOMS[rv.room] if isinstance(rv.room, str) else rv.room
        if not isinstance(room, Room):
            raise TypeError("reverb room must be a preset name or a Room")
        ir = impulse_response(room, SR)
        wet = convolve(sends[name], ir)[:, :N] * float(db_to_lin(rv.return_db))
        if rv.return_eq:
            wet = dsp.eq(wet, rv.return_eq, SR)
        bus += wet
        post[f"reverb_{name}"] = wet
        report["reverbs"][name] = {"rt60": room.rt60, "returnLufs": round(float(loudness.integrated(wet[:, pad : pad + L])), 2)}
    if arr.bus_eq:
        bus = dsp.eq(bus, arr.bus_eq, SR)
    if arr.glue is not None:
        i = loudness.integrated(bus[:, pad : pad + L])
        stage = (arr.glue_stage_lufs - i) if np.isfinite(i) else 0.0
        glued, gr = safe(arr.glue).process(bus * float(db_to_lin(stage)), SR)
        bus = glued * float(db_to_lin(-stage))
        g = gr[pad : pad + L]
        report["glue"] = {"grMaxDb": round(float(-g.min()), 2), "grMeanDb": round(float(-g.mean()), 2)}
    if arr.bus_sat:
        bus = dsp.saturate(bus, **arr.bus_sat)
    pre = bus[:, pad : pad + L]
    post = {k: v[:, pad : pad + L] for k, v in post.items()}
    if not arr.loop and (arr.fade_in or arr.fade_out):
        pre = dsp.fade(pre, arr.fade_in, arr.fade_out, SR, curve=arr.fade_curve)
    report["busLufs"] = round(float(loudness.integrated(pre)), 2)
    report["busTruePeak"] = round(float(loudness.true_peak(pre)), 2)
    return pre, report, post


@dataclass
class Rendered:
    arrangement: Arrangement
    premaster: np.ndarray
    master: np.ndarray
    master_report: dict
    mix_report: dict
    stems: dict
    timings: dict


def render(arr: Arrangement, workdir: Path, cache: Path | None = None) -> Rendered:
    t0 = time.time()
    raw = render_stems(arr, Path(workdir), cache)
    t1 = time.time()
    stems = fold(raw, arr.length) if arr.loop else raw
    pre, mrep, post = mix(arr, stems)
    t2 = time.time()
    out, rep = master.master(pre, safe_preset(arr.preset), loop=arr.loop)
    if not np.all(np.isfinite(out)):
        raise RuntimeError(f"{arr.cue_id}: the master contains NaN or Inf")
    t3 = time.time()
    return Rendered(arr, pre, out, rep, mrep, post, {"stemsS": round(t1 - t0, 1), "mixS": round(t2 - t1, 1), "masterS": round(t3 - t2, 1)})


def write_flac(path, audio, bits: int = 16, seed: int = 0) -> Path:
    """Lossless FLAC (16-bit with TPDF dither, or 24-bit), 48 kHz."""
    import soundfile as sf

    a = as_stereo(audio)
    if np.max(np.abs(a)) > 1.0:
        raise ValueError("over full scale")
    q = io.quantize(a, bits, dither=True, seed=seed)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), q.T, SR, subtype=f"PCM_{bits}", format="FLAC")
    return path


def save_json(path, obj) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=_default) + "\n", encoding="utf-8")
    return path


def _default(o):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, Compressor):
        return {k: getattr(o, k) for k in ("threshold_db", "ratio", "attack_ms", "release_ms")}
    if isinstance(o, set):
        return sorted(o)
    return str(o)


def deepcopy_score(score: Score) -> Score:
    return copy.deepcopy(score)
