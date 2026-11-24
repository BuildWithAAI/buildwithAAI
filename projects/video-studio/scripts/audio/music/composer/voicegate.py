"""The voice-referenced gate for beds: how well Zoo's narration survives a bed under it.

A bed is judged by what it does to the voice it will sit under, not by its own spectrum. The old
fail gate (`spectrum.voicePocketDb`, 1-4 kHz against the bed's own tilt) passed beds that measured
worse than speech-shaped noise under Zoo's voice (critic round 1, 2026-11-24), because his voice
(Kokoro im_nicola) is unusually dark: F0 68-119 Hz and a 1-2.5 kHz band 18-26 dB under its peak.

Method (the critic's, reproduced exactly; scripts/audio/music/voiceref/README.md):
- the bed is looped to the reference narration's length and ducked as planned: the engine's
  band-split duck (audiolib.duck.split_duck: 2 / 12 / 4 dB at 700 Hz and 5 kHz) under the
  narration's speech activity; the broadband 6 dB duck is reported for reference;
- 32 ms frames (1536 points, hop 768 at 48 kHz), mono sum; per one-third-octave band 160 Hz-8 kHz the
  voice-to-bed SNR during speech frames (voice active and within 25 dB of its 95th percentile);
- band audibility = clip((SNR + 15) / 30, 0, 1), weighted by the ANSI S3.5-1997 one-third-octave
  band importance (average speech) and summed: a short-time band-audibility index (an SII without
  hearing thresholds or level distortion, so an upper bound), averaged over speech frames;
- the reference: speech-shaped noise (the narration's own long-term spectrum on seeded noise) at
  the same loudness under speech as the ducked bed, through the same measurement.

The narrations themselves are not in the repository (public/generated/ is rebuilt by the voice step),
so each `voiceref/*.json` holds what the gate needs from one narration: the voice's band levels per
frame (0.25 dB steps), its speech-frame mask, its activity spans, its loudness under speech, its
1-4 kHz level per frame and its long-term spectrum. `make_profile()` writes one from a narration WAV.

Critic round 2: the round-1 reference (the engine demo's narration) gave the highest index of the six
im_nicola narrations measured, so the gate passed beds 0.010-0.035 under what the show's own narration
measured. The gate now runs every profile in voiceref/ (the engine demo, the show's 2026-11-24 Short,
the Zoo & Badger demo and the Spanish dub of the Zoora demo) and takes the MINIMUM index; the planned
duck uses the split duck's own timing (pauses under 0.8 s filled, a 1.2 s release: audiolib.duck).

Gate (scripts/audio/music/build.py, profile `bed`): the minimum index over the narrations, with the
planned duck, >= 0.75. Speech-shaped noise at the same loudness is reported for information only:
with a split duck it is structurally easy to beat (the noise puts its energy in the speech band, the
ducked bed has moved its energy under 700 Hz), so it adds no assurance (critic round 2).
"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import numpy as np

from audiolib import duck, loudness
from audiolib.core import SR, as_stereo

VOICEREF = Path(__file__).resolve().parents[1] / "voiceref"
PROFILE = VOICEREF / "zoo-im_nicola.json"  # the round-1 reference (the engine demo's English narration)
SCHEMA = 1
NPERSEG, HOP = 1536, 768
STEP_DB = 0.25
# ANSI S3.5-1997 Table 3: one-third-octave band importance, average speech, 160 Hz - 8 kHz
SII_FC = (160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000)
SII_W = (0.0083, 0.0095, 0.0150, 0.0289, 0.0440, 0.0578, 0.0653, 0.0711, 0.0818, 0.0844, 0.0882, 0.0898, 0.0868, 0.0844, 0.0771, 0.0527, 0.0364, 0.0185)
LT_FC = (63, 80, 100, 125) + SII_FC
INDEX_MIN = 0.75


def _stft_power(mono: np.ndarray):
    from scipy.signal import stft

    f, t, Z = stft(mono, fs=SR, nperseg=NPERSEG, noverlap=NPERSEG - HOP, boundary=None, padded=False)
    return f, t, np.abs(Z) ** 2


def _band_matrix(f, fcs):
    m = np.zeros((len(fcs), f.size))
    for i, fc in enumerate(fcs):
        lo, hi = fc / 2 ** (1 / 6), fc * 2 ** (1 / 6)
        m[i] = (f >= lo) & (f < hi)
    return m


def _mono_sum(stereo: np.ndarray) -> np.ndarray:
    """The mono sum the measurement uses (a centred voice is masked by the bed's mono sum)."""
    return as_stereo(stereo).mean(axis=0) * np.sqrt(2)


def _pack(a: np.ndarray, kind=np.uint8) -> str:
    return base64.b64encode(np.ascontiguousarray(a, dtype=kind).tobytes()).decode("ascii")


def _unpack(s: str, kind=np.uint8) -> np.ndarray:
    return np.frombuffer(base64.b64decode(s), dtype=kind)


def _quantise(db: np.ndarray):
    """dB rows -> (uint8 codes, per-row offset): 0.25 dB steps over the top 63.75 dB of each row."""
    top = np.max(db, axis=1)
    off = np.floor((top - 255 * STEP_DB) * 100) / 100
    codes = np.clip(np.round((db - off[:, None]) / STEP_DB), 0, 255).astype(np.uint8)
    return codes, off


def profiles() -> list:
    """Every voice profile in voiceref/ (sorted by file name)."""
    return sorted(VOICEREF.glob("*.json"))


def make_profile(narration_path, out_path=PROFILE, label: str = "Kokoro im_nicola (Zoo)") -> dict:
    """Measure a narration WAV and write the voice profile JSON the gate reads."""
    from scipy.signal import resample_poly

    import soundfile as sf

    raw, sr = sf.read(str(narration_path), always_2d=True)
    raw = raw.T
    if sr != SR:
        raw = resample_poly(raw, SR, sr, axis=1)
    mono = raw.mean(axis=0)
    n = mono.size
    act = duck.voice_activity(raw)
    voice2 = np.vstack([mono, mono]) * 0.7071  # equal-power upmix, the duck.py convention
    f, t, pv = _stft_power(_mono_sum(voice2))
    fr_act = act[np.minimum((t * SR).astype(int), n - 1)]
    vtot = 10 * np.log10(pv.sum(axis=0) + 1e-20)
    speech = fr_act & (vtot > np.percentile(vtot[fr_act], 95) - 25)
    lv = 10 * np.log10(_band_matrix(f, SII_FC) @ pv + 1e-20)
    hb = (f >= 1000) & (f <= 4000)
    v14 = 10 * np.log10(pv[hb].sum(axis=0) + 1e-20)
    codes, off = _quantise(np.vstack([lv, v14[None, :]]))
    lt = 10 * np.log10((_band_matrix(f, LT_FC) @ pv[:, speech]).mean(axis=1) + 1e-20)
    # long-term magnitude spectrum, smoothed as the critic did (4001-bin moving average of the whole
    # file's spectrum), kept on a 1/24-octave grid for the speech-shaped noise
    from scipy.ndimage import uniform_filter1d

    V = np.abs(np.fft.rfft(mono, n=n))
    Vs = uniform_filter1d(V, size=4001)
    fq = np.fft.rfftfreq(n, 1 / SR)
    grid = 20.0 * 2 ** (np.arange(0, int(np.log2(23900 / 20) * 24) + 1) / 24)
    spec_db = 20 * np.log10(np.interp(grid, fq, Vs) + 1e-20)
    spans, on = [], None
    for i, a in enumerate(np.concatenate([act, [False]])):
        if a and on is None:
            on = i
        elif not a and on is not None:
            spans.append([int(on), int(i)])
            on = None
    parts = Path(str(narration_path)).parts
    doc = {
        "schema": SCHEMA,
        "about": "Zoo's reference narration for the bed gate (composer/voicegate.py): band levels per 32 ms frame, no audio.",
        "voice": label,
        "narration": "/".join(parts[-3:-1]) if len(parts) >= 3 else Path(str(narration_path)).stem,
        "source": {"file": str(narration_path).split("projects/video-studio/")[-1], "sha256": hashlib.sha256(Path(narration_path).read_bytes()).hexdigest(),
                   "sampleRate": int(sr), "durationSec": round(n / SR, 3)},
        "analysis": {"sampleRate": SR, "nperseg": NPERSEG, "hop": HOP, "window": "hann", "bandsHz": list(SII_FC), "weights": list(SII_W),
                     "ltBandsHz": list(LT_FC), "stepDb": STEP_DB},
        "nSamples": int(n),
        "frames": int(t.size),
        "activity": spans,
        "speechMask": base64.b64encode(np.packbits(speech.astype(np.uint8)).tobytes()).decode("ascii"),
        "voiceLufsUnderSpeech": round(float(loudness.integrated(voice2[:, act])), 3),
        "bandCodes": _pack(codes.T),  # frames x (18 bands + the 1-4 kHz level)
        "bandOffsetsDb": [round(float(x), 2) for x in off],
        "ltVoiceDb": [round(float(x), 2) for x in lt],
        "ltSpectrum": {"hz": [round(float(x), 2) for x in grid], "db": [round(float(x), 2) for x in spec_db]},
    }
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    return doc


class VoiceRef:
    """The decoded voice profile."""

    def __init__(self, path=PROFILE):
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        if d.get("schema") != SCHEMA:
            raise ValueError(f"{path}: voice profile schema {d.get('schema')} is not {SCHEMA}")
        a = d["analysis"]
        if (a["sampleRate"], a["nperseg"], a["hop"], tuple(a["bandsHz"])) != (SR, NPERSEG, HOP, SII_FC):
            raise ValueError(f"{path}: analysis settings differ from this gate's")
        self.doc = d
        self.n = int(d["nSamples"])
        self.frames = int(d["frames"])
        codes = _unpack(d["bandCodes"]).reshape(self.frames, len(SII_FC) + 1).T.astype(np.float64)
        off = np.asarray(d["bandOffsetsDb"])
        db = codes * STEP_DB + off[:, None]
        self.lv = db[: len(SII_FC)]
        self.v14 = db[len(SII_FC)]
        self.speech = np.unpackbits(np.frombuffer(base64.b64decode(d["speechMask"]), dtype=np.uint8))[: self.frames].astype(bool)
        act = np.zeros(self.n, dtype=bool)
        for s, e in d["activity"]:
            act[s:e] = True
        self.act = act
        self.voice_lufs = float(d["voiceLufsUnderSpeech"])
        self.lt_voice = np.asarray(d["ltVoiceDb"])
        self.lt_hz = np.asarray(d["ltSpectrum"]["hz"])
        self.lt_db = np.asarray(d["ltSpectrum"]["db"])


_CACHE: dict = {}


def voice(path=PROFILE) -> VoiceRef:
    key = str(path)
    if key not in _CACHE:
        _CACHE[key] = VoiceRef(path)
    return _CACHE[key]


def _ssn(ref: VoiceRef, target_lufs: float, seed: int = 7) -> np.ndarray:
    """Speech-shaped noise: the narration's long-term spectrum on seeded white noise, levelled to
    `target_lufs` under speech."""
    n = ref.n
    rng = np.random.default_rng(seed)
    W = np.fft.rfft(rng.standard_normal((2, n)), axis=1)
    fq = np.fft.rfftfreq(n, 1 / SR)
    mag = 10 ** (np.interp(np.log2(np.maximum(fq, 1.0)), np.log2(ref.lt_hz), ref.lt_db) / 20)
    x = np.fft.irfft(W * mag[None, :], n=n, axis=1)
    return x * 10 ** ((target_lufs - loudness.integrated(x[:, ref.act])) / 20)


def _measure(ref: VoiceRef, bed: np.ndarray) -> dict:
    f, t, pb = _stft_power(_mono_sum(bed))
    if t.size != ref.frames:
        raise ValueError(f"frame count {t.size} differs from the voice profile's {ref.frames}")
    lb = 10 * np.log10(_band_matrix(f, SII_FC) @ pb + 1e-20)
    sp = ref.speech
    snr = ref.lv[:, sp] - lb[:, sp]
    aud = np.clip((snr + 15) / 30, 0, 1)
    idx = (np.asarray(SII_W)[:, None] * aud).sum(axis=0)
    hb = (f >= 1000) & (f <= 4000)
    snr14 = ref.v14[sp] - 10 * np.log10(pb[hb][:, sp].sum(axis=0) + 1e-20)
    lt_b = 10 * np.log10((_band_matrix(f, LT_FC) @ pb[:, sp]).mean(axis=1) + 1e-20)
    lt_snr = {str(fc): round(float(v - b), 1) for fc, v, b in zip(LT_FC, ref.lt_voice, lt_b)}
    narrow = min((kv for kv in lt_snr.items() if 630 <= int(kv[0]) <= 2500), key=lambda kv: kv[1])
    bl = loudness.integrated(bed[:, ref.act])
    return {"index": round(float(idx.mean()), 4), "indexP10": round(float(np.percentile(idx, 10)), 4),
            "voiceOverBedLu": round(float(ref.voice_lufs - bl), 2), "snr1to4kMedianDb": round(float(np.median(snr14)), 2),
            "snr1to4kP10Db": round(float(np.percentile(snr14, 10)), 2), "framesUnder3dB": round(float(np.mean(snr14 < 3)), 4),
            "narrowestBand": {"hz": int(narrow[0]), "snrDb": narrow[1]}, "bandSnrDb": lt_snr, "bedLufsUnderSpeech": round(float(bl), 2)}


def evaluate_one(bed_audio, ref: VoiceRef) -> dict:
    """The gate's numbers for a bed (stereo, 48 kHz, as delivered) under one narration: the index with
    the planned (band-split) duck, with the broadband 6 dB duck, and for speech-shaped noise at the
    planned bed's loudness."""
    b = as_stereo(bed_audio)
    reps = int(np.ceil(ref.n / b.shape[1]))
    bed = np.tile(b, (1, reps))[:, : ref.n]
    split, _ = duck.split_duck(bed, duck.widen(ref.act, duck.SPLIT_MIN_GAP), release=duck.SPLIT_RELEASE)
    broad = duck.apply_gain(bed, duck.duck_gain(ref.act, 6.0))
    out = {"duck": {"plannedMode": "split", "crossoversHz": list(duck.VOICE_CROSSOVERS), "depthsDb": list(duck.VOICE_DEPTHS),
                    "minGapS": duck.SPLIT_MIN_GAP, "releaseS": duck.SPLIT_RELEASE},
           "split": _measure(ref, split), "broadband6": _measure(ref, broad)}
    out["ssnAtSplitLoudness"] = _measure(ref, _ssn(ref, out["split"]["bedLufsUnderSpeech"]))
    out["index"] = out["split"]["index"]
    out["indexMinusSsn"] = round(out["split"]["index"] - out["ssnAtSplitLoudness"]["index"], 4)
    out["reference"] = {"voice": ref.doc["voice"], "source": ref.doc["source"]["file"], "sha256": ref.doc["source"]["sha256"][:16]}
    return out


def label_of(ref: VoiceRef) -> str:
    return ref.doc.get("narration") or Path(ref.doc["source"]["file"]).parts[-3]


def evaluate(bed_audio, ref: VoiceRef | None = None) -> dict:
    """The gate for a bed: evaluate_one under one narration (`ref`) or, by default, under every profile
    in voiceref/, gated on the worst. The result carries the worst narration's numbers at the top
    level (index, split, broadband6, ssnAtSplitLoudness, reference) and every narration's index in
    `byNarration`."""
    if ref is not None:
        return evaluate_one(bed_audio, ref)
    per = {}
    for path in profiles():
        r = voice(path)
        per[label_of(r)] = evaluate_one(bed_audio, r)
    if not per:
        raise FileNotFoundError(f"no voice profiles in {VOICEREF}")
    worst = min(per, key=lambda k: per[k]["index"])
    out = dict(per[worst])
    out["worstNarration"] = worst
    out["byNarration"] = {k: {"index": v["index"], "indexMinusSsn": v["indexMinusSsn"], "broadbandIndex": v["broadband6"]["index"],
                              "snr1to4kMedianDb": v["split"]["snr1to4kMedianDb"], "framesUnder3dB": v["split"]["framesUnder3dB"]}
                          for k, v in sorted(per.items())}
    return out
