"""Sample playback for VCSL (CC0) and any folder of WAV one-shots or multisamples.

File names are parsed token by token (split on "_"): a note token (C4, F#2, A#0), a velocity
layer token (vl3 or v3), a round-robin token (rr2); every other token forms the articulation key.
Examples from VCSL: JHPiano_Sus_Close_C4_vl2_rr1.wav -> note 60, layer 2, rr 1, articulation
"JHPiano_Sus_Close"; Snare2_HitSN_v5_rr2_Mid.wav -> unpitched, layer 5, rr 2, "Snare2_HitSN_Mid".

Playback:
- the nearest sampled root at or below the note (whole-tone sets shift at most +1 semitone; the
  root above is used only when nothing is below); pitch shift and the 44.1 -> 48 kHz conversion
  happen in one polyphase windowed-sinc pass (io.resample_ratio);
- velocity picks the layer (equal ranges over 1..127 unless `layer_ranges` is given) and sets
  the gain: amplitude = (velocity / 127) ** velocity_power (1.7 = about -10 dB at velocity 64);
- round robins rotate per key and layer, so repeated notes never machine-gun;
- note-off applies a damper release that is pitch dependent (`release_for`), sustain-pedal
  intervals defer note-offs, the pedal-down articulation is chosen when the pedal is down at
  note-on, and a new strike on a sounding key chokes the old voice over 40 ms;
- optional release samples (piano damper noise) fire at note-off, quieter the longer the note
  was held;
- the head of each sample is trimmed to 1 ms before its first sample above -50 dB of its peak,
  so onsets land on the beat;
- drum kits map keys to banks, with choke groups (an open hi-hat is cut by the closed and
  pedal hats).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .core import SR, as_stereo, note_number

_NOTE_TOKEN = re.compile(r"^([A-Ga-g])(#|b)?(-?\d)$")
_VEL_TOKEN = re.compile(r"^v(?:l)?(\d+)$", re.I)
_RR_TOKEN = re.compile(r"^rr(\d+)$", re.I)


@dataclass(frozen=True)
class Zone:
    path: Path
    root: int | None
    layer: int
    rr: int
    articulation: str


def parse_name(path) -> Zone:
    p = Path(path)
    root = None
    layer = 1
    rr = 1
    art = []
    for tok in p.stem.split("_"):
        m = _NOTE_TOKEN.match(tok)
        if m and root is None:
            root = note_number(m.group(1).upper() + (m.group(2) or "") + m.group(3))
            continue
        m = _VEL_TOKEN.match(tok)
        if m:
            layer = int(m.group(1))
            continue
        m = _RR_TOKEN.match(tok)
        if m:
            rr = int(m.group(1))
            continue
        art.append(tok)
    return Zone(p, root, layer, rr, "_".join(art))


class SampleBank:
    """A set of zones (one instrument articulation, or several)."""

    def __init__(self, zones):
        self.zones = list(zones)
        if not self.zones:
            raise ValueError("empty sample bank")

    @classmethod
    def from_folder(cls, folder, include: str | None = None, exclude: str | None = None, recursive: bool = True) -> "SampleBank":
        folder = Path(folder)
        files = sorted(folder.rglob("*.wav") if recursive else folder.glob("*.wav"))
        if include:
            files = [f for f in files if re.search(include, f.name)]
        if exclude:
            files = [f for f in files if not re.search(exclude, f.name)]
        if not files:
            raise FileNotFoundError(f"no .wav files in {folder} matching include={include!r} exclude={exclude!r}")
        return cls(parse_name(f) for f in files)

    def articulations(self) -> list:
        return sorted({z.articulation for z in self.zones})

    def select(self, pattern: str) -> "SampleBank":
        z = [x for x in self.zones if re.search(pattern, x.articulation)]
        if not z:
            raise ValueError(f"no articulation matches {pattern!r}; have {self.articulations()}")
        return SampleBank(z)

    def layers(self) -> list:
        return sorted({z.layer for z in self.zones})

    def roots(self) -> list:
        return sorted({z.root for z in self.zones if z.root is not None})

    @property
    def pitched(self) -> bool:
        return any(z.root is not None for z in self.zones)


@dataclass
class Sampler:
    """A pitched or unpitched sampled instrument.

    bank: sustain zones; pedal_bank: zones used while the sustain pedal is down (optional);
    release_bank: release-noise zones (optional)."""

    bank: SampleBank
    pedal_bank: SampleBank | None = None
    release_bank: SampleBank | None = None
    velocity_power: float = 1.7
    layer_ranges: list | None = None  # [(lo_vel, hi_vel), ...] per layer in ascending order
    release_gain_db: float = -6.0
    release_decay_s: float = 2.0
    damper: tuple = (0.45, 0.10, 88)  # bass release s, treble release s, highest damped key
    tune: float = 0.0  # semitones, unpitched banks only (pitched banks follow the note)
    gain_db: float = 0.0
    trim_db: float = -50.0
    one_shot: bool = False  # True: ignore note-off and play the whole sample (drums)
    normalize_layers: str | None = None  # None | "per_layer" | "per_zone" (see _zone_gain)
    seed: str = "sampler"
    _cache: dict = field(default_factory=dict, repr=False)
    _trim: dict = field(default_factory=dict, repr=False)
    _gain: dict = field(default_factory=dict, repr=False)

    # ---------------------------------------------------------------- selection
    def release_for(self, key: int) -> float:
        """Damper release time (s, to -60 dB) for a key: bass slower than treble; keys above the
        highest damped key ring on (piano strings above about E6 have no dampers)."""
        lo, hi, top = self.damper
        if key > top:
            return 4.0
        t = (min(max(key, 21), top) - 21) / max(1, top - 21)
        return lo * (hi / lo) ** t

    def _layer_for(self, bank: SampleBank, vel: int) -> int:
        layers = bank.layers()
        if self.layer_ranges and len(self.layer_ranges) == len(layers):
            for lay, (lo, hi) in zip(layers, self.layer_ranges):
                if lo <= vel <= hi:
                    return lay
            return layers[-1]
        i = min(len(layers) - 1, int((vel - 1) * len(layers) / 127))
        return layers[i]

    def pick(self, bank: SampleBank, key: int | None, vel: int, counter: dict):
        layer = self._layer_for(bank, vel)
        cands = [z for z in bank.zones if z.layer == layer]
        shift = 0.0
        if bank.pitched and key is not None:
            roots = sorted({z.root for z in cands if z.root is not None})
            # "at or below" within half a semitone: a measured root (fractional, e.g. 62.04 for a
            # sample 4 cents sharp) still plays its own key, instead of the root below shifted up
            below = [r for r in roots if r <= key + 0.5]
            root = below[-1] if below else roots[0]
            cands = [z for z in cands if z.root == root]
            shift = float(key - root)
        else:
            shift = float(self.tune)
        cands = sorted(cands, key=lambda z: (z.rr, str(z.path)))
        ck = (id(bank), key if bank.pitched else None, layer)
        i = counter.get(ck, 0)
        counter[ck] = i + 1
        return cands[i % len(cands)], shift

    # ---------------------------------------------------------------- audio
    def _onset(self, zone: Zone) -> int:
        if zone.path not in self._trim:
            raw = _head(zone.path, 2.0)
            env = np.max(np.abs(raw), axis=0)
            pk = float(env.max()) if env.size else 0.0
            if pk <= 0:
                self._trim[zone.path] = 0
            else:
                idx = int(np.argmax(env >= pk * 10 ** (self.trim_db / 20)))
                sr_file = _file_sr(zone.path)
                self._trim[zone.path] = max(0, idx - int(0.001 * sr_file))
        return self._trim[zone.path]

    def _zone_lufs(self, zone: Zone) -> float:
        """Loudness (BS.1770 weighting) of the first 400 ms after the onset."""
        from . import loudness

        raw = _head(zone.path, 3.0)
        sr_file = _file_sr(zone.path)
        o = self._onset(zone)
        seg = raw[:, o : o + int(0.4 * sr_file)]
        if seg.shape[1] < int(0.4 * sr_file):
            seg = np.pad(seg, ((0, 0), (0, int(0.4 * sr_file) - seg.shape[1])))
        p = loudness._weighted_power(seg, sr_file).mean(axis=1).sum()
        return -0.691 + 10 * math.log10(max(p, 1e-30))

    def _zone_gain(self, bank: SampleBank, zone: Zone) -> float:
        """Linear gain that levels velocity layers, so dynamics come from `velocity_power` and the
        layers only change timbre. 'per_layer': one gain per layer = the median (over keys) of how
        much quieter that layer is than the loudest layer of the same key; the keyboard's own
        voicing is kept. 'per_zone': every zone matched to the loudest layer of its key.
        Natural-dynamics sets (VCSL Kawai: about 37 dB from v1 to v4) need this, or a velocity that
        crosses a layer boundary jumps 8-17 dB."""
        if not self.normalize_layers:
            return 1.0
        key = (id(bank), self.normalize_layers)
        if key not in self._gain:
            lufs = {z: self._zone_lufs(z) for z in bank.zones}
            by_root = {}
            for z, v in lufs.items():
                by_root.setdefault((z.articulation, z.root), []).append((z, v))
            ref = {k: max(v for _, v in items) for k, items in by_root.items()}
            gains = {}
            if self.normalize_layers == "per_zone":
                for z, v in lufs.items():
                    gains[z] = 10 ** ((ref[(z.articulation, z.root)] - v) / 20)
            elif self.normalize_layers == "per_layer":
                diffs = {}
                for z, v in lufs.items():
                    diffs.setdefault(z.layer, []).append(ref[(z.articulation, z.root)] - v)
                layer_gain = {lay: 10 ** (float(np.median(d)) / 20) for lay, d in diffs.items()}
                for z in lufs:
                    gains[z] = layer_gain[z.layer]
            else:
                raise ValueError("normalize_layers must be None, 'per_layer' or 'per_zone'")
            self._gain[key] = gains
        return self._gain[key].get(zone, 1.0)

    def _audio(self, zone: Zone, shift: float, out_len: int, sr: int) -> np.ndarray:
        """Converted (pitch-shifted, 48 kHz) audio of a zone, at least `out_len` samples long unless
        the whole sample is shorter. Cached per (zone, shift); a longer request re-converts."""
        from .io import read, resample_ratio

        key = (zone.path, round(shift, 6), sr)
        hit = self._cache.get(key)
        if hit is not None and (hit[1] or hit[0].shape[1] >= out_len):
            return hit[0]
        raw = as_stereo(read(zone.path, sr=None))
        raw = raw[:, self._onset(zone):]
        file_sr = _file_sr(zone.path)
        ratio = 2 ** (shift / 12.0) * file_sr / sr
        margin = 4096  # input samples beyond what is needed, so the filter edge is never used
        need_in = min(raw.shape[1], int(math.ceil(out_len * ratio)) + margin)
        full = need_in >= raw.shape[1]
        conv = resample_ratio(raw[:, :need_in], ratio)
        if not full:
            conv = conv[:, : max(1, conv.shape[1] - int(margin / ratio / 2))]
        conv = np.ascontiguousarray(conv)
        conv.setflags(write=False)
        self._cache[key] = (conv, full)
        return conv

    def render_events(self, events, length: float, sr: int = SR, pedal=None) -> np.ndarray:
        """events: [(key, start_s, end_s, velocity)], pedal: [(down_s, up_s)]. Stereo output."""
        n = int(round(length * sr))
        out = np.zeros((2, n))
        counter = {}
        pedal = sorted(pedal or [])
        plan = []
        for key, start, end, vel in sorted(events, key=lambda e: (e[1], e[0])):
            down = _pedal_down(pedal, start)
            bank = self.pedal_bank if (down and self.pedal_bank is not None) else self.bank
            zone, shift = self.pick(bank, key, vel, counter)
            off = end
            if not self.one_shot:
                for d, u in pedal:
                    if d <= end < u:
                        off = u
                        break
            plan.append((key, start, off, end, vel, zone, shift))
        # same-key retrigger: a voice is choked when the same key strikes again
        plan.sort(key=lambda p: p[1])
        next_strike = {}
        for i in range(len(plan) - 1, -1, -1):
            k = plan[i][0]
            plan[i] = plan[i] + (next_strike.get(k),)
            next_strike[k] = plan[i][1]
        for key, start, off, end, vel, zone, shift, choke_at in plan:
            s0 = int(round(start * sr))
            if s0 >= n:
                continue
            bank_used = self.pedal_bank if (self.pedal_bank is not None and zone in self.pedal_bank.zones) else self.bank
            amp = (max(1, vel) / 127.0) ** self.velocity_power * 10 ** (self.gain_db / 20)
            note_amp = amp * self._zone_gain(bank_used, zone)
            rel = self.release_for(key) if (key is not None and not self.one_shot) else 0.0
            if self.one_shot:
                gate = n - s0
                tail = 0
            else:
                gate = max(1, int(round((off - start) * sr)))
                tail = int(round(rel * sr)) + int(0.003 * sr)
            want = min(n - s0, gate + tail)
            if choke_at is not None:
                want = min(want, int(round((choke_at - start) * sr)) + int(0.045 * sr))
            if want <= 0:
                continue
            audio = self._audio(zone, shift, want, sr)
            seg_len = min(want, audio.shape[1])
            seg = audio[:, :seg_len] * note_amp
            env = np.ones(seg_len)
            if not self.one_shot and gate < seg_len:
                t = np.arange(seg_len - gate)
                env[gate:] = np.exp(-6.907755 * t / max(1.0, rel * sr))
            if choke_at is not None:
                c = int(round((choke_at - start) * sr))
                if c < seg_len:
                    k = int(0.04 * sr)
                    env[c : c + k] *= np.linspace(1, 0, min(k, seg_len - c))
                    env[c + k :] = 0.0
            # never end on a non-zero sample: 3 ms fade at the very end of the segment
            k3 = min(seg_len, int(0.003 * sr))
            env[seg_len - k3 :] *= np.linspace(1, 0, k3)
            out[:, s0 : s0 + seg_len] += seg * env
            if self.release_bank is not None and not self.one_shot and off - start > 0.02:
                held = off - start
                rz, rshift = self.pick(self.release_bank, key, vel, counter)
                r0 = int(round(off * sr))
                if r0 < n:
                    ra = self._audio(rz, rshift, n - r0, sr)
                    rl = min(n - r0, ra.shape[1])
                    g = amp * self._zone_gain(self.release_bank, rz) * 10 ** (self.release_gain_db / 20) * math.exp(-held / self.release_decay_s)
                    renv = np.ones(rl)
                    k3 = min(rl, int(0.003 * sr))
                    renv[rl - k3 :] = np.linspace(1, 0, k3)
                    out[:, r0 : r0 + rl] += ra[:, :rl] * g * renv
        return out

    def render(self, part, score, length: float, sr: int = SR) -> np.ndarray:
        events = [(n.pitch, score.seconds(n.start), score.seconds(n.end), n.vel) for n in part.notes]
        pedal = [(score.seconds(d), score.seconds(u) if math.isfinite(u) else float("inf")) for d, u in part.pedal_intervals()]
        return self.render_events(events, length, sr, pedal)


def _head(path, seconds: float) -> np.ndarray:
    """The first `seconds` of a file at its own rate, (channels, samples) float64."""
    import soundfile as sf

    info = sf.info(str(path))
    data, _ = sf.read(str(path), frames=int(seconds * info.samplerate), dtype="float64", always_2d=True)
    return np.ascontiguousarray(data.T)


def _file_sr(path) -> int:
    import soundfile as sf

    return int(sf.info(str(path)).samplerate)


def _pedal_down(pedal, t: float) -> bool:
    return any(d <= t < u for d, u in pedal)


@dataclass
class Kit:
    """A drum kit of one-shot samplers keyed by MIDI drum key, with choke groups.

    pieces: {36: Sampler(...one_shot=True), 38: ...}; chokes: [[42, 44, 46], ...]: a hit on any
    key of a group cuts the sounding voices of the other keys in it over 25 ms."""

    pieces: dict
    chokes: list = field(default_factory=list)

    def render(self, part, score, length: float, sr: int = SR, only=None) -> np.ndarray:
        n = int(round(length * sr))
        out = np.zeros((2, n))
        hits = sorted((score.seconds(x.start), x.pitch, x.vel) for x in part.notes if (only is None or x.pitch in only))
        group_of = {}
        for gi, grp in enumerate(self.chokes):
            for k in grp:
                group_of[k] = gi
        # the time each hit gets cut: the next hit in its choke group on a different key
        cut = []
        for i, (t, k, v) in enumerate(hits):
            c = None
            if k in group_of:
                for t2, k2, _ in hits[i + 1 :]:
                    if group_of.get(k2) == group_of[k] and k2 != k:
                        c = t2
                        break
            cut.append(c)
        counters = {}
        for (t, k, v), c in zip(hits, cut):
            piece = self.pieces.get(k)
            if piece is None:
                raise KeyError(f"kit has no sample for drum key {k}")
            s0 = int(round(t * sr))
            if s0 >= n:
                continue
            zone, shift = piece.pick(piece.bank, None, v, counters.setdefault(k, {}))
            amp = (max(1, v) / 127.0) ** piece.velocity_power * 10 ** (piece.gain_db / 20) * piece._zone_gain(piece.bank, zone)
            want = n - s0
            if c is not None:
                want = min(want, int(round((c - t) * sr)) + int(0.025 * sr))
            audio = piece._audio(zone, shift, want, sr)
            seg_len = min(want, audio.shape[1])
            env = np.ones(seg_len)
            if c is not None:
                cc = int(round((c - t) * sr))
                if cc < seg_len:
                    k25 = int(0.025 * sr)
                    env[cc : cc + k25] *= np.linspace(1, 0, min(k25, seg_len - cc))
                    env[cc + k25 :] = 0.0
            k3 = min(seg_len, int(0.003 * sr))
            env[seg_len - k3 :] *= np.linspace(1, 0, k3)
            out[:, s0 : s0 + seg_len] += audio[:, :seg_len] * amp * env
        return out
