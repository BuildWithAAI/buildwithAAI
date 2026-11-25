#!/usr/bin/env python3
"""The Episode's audio gate: measures one render against the plan it was rendered from.

    .venv-audio/bin/python src/episode/tools/audio_check.py --plan X.audio-plan.json --mix X.mix.wav --voice X.voice.wav \
        --delivered X.mp4 [--picture X.picture.mp4] [--master X.master.json] [--report X.audio.json]

Inputs (src/episode/tools/render.sh makes them): the plan the render used (the audio-plan CLI's JSON; the render refused
to start on any other: its hash is in --props), Remotion's lossless mix (written beside the picture render), the voice
stem (the same composition with only the narration), the delivered file after src/audio/tools/master_mix.py and its
report.

The core, run on every render (critic F1: the gate must tell a broken mix from a good one):
  - NULL TEST: the music, stingers and effects are rebuilt offline from the plan alone (each bed looped on the plan's
    clock, split into the duck's three bands, times this file's own port of the plan's gain law, checked first against
    the TypeScript's values in plan.gainProbe; every stinger and effect at its sample and gain) and subtracted from
    mix - voice. Any difference between what was planned and what was rendered (a phase or offset error, a fade bug,
    PcmTrack, a stale bundle, a file changed between planning and rendering) leaves a residual: over -60 dBFS fails.
  - Voice on top, by the music package's band-audibility method: overall and phrase by phrase, the index and its 10th
    percentile, the share of speech frames under 3 dB in 1-4 kHz, and the worst phrase's 1-4 kHz voice-to-rest ratio.
    Lines calibrated on 60 correct mixes and 40 wrong-duck controls: every control fails duck coverage and the worst
    phrase's 1-4 kHz ratio, no correct mix fails anything (docs/EPISODE_ENGINE.md section 12.5).
  - Duck coverage (the plan's mid band at least 10 dB down on 98 % of the voice stem's voiced 10 ms frames), voice-free
    windows (every bed change, bed fade, the sting slot and every transition: voice under -60 dBFS), every effect over
    the voice (1-4 kHz voice-to-rest ratio over its first 150 ms; on the phone model for Shorts), the first second of
    speech and a spoken disclosure (voice at least 15 LU over the rest, 15 dB SNR at 1-4 kHz).
  - Delivery: loudness -14 +-0.5 LUFS-I and true peak <= -1 dBTP on our meter and ffmpeg's, DC, streams, the
    premaster's headroom, the master's gain, the platform re-encodes (AAC and Opus at 128 kb/s, from the master report).
  - The plan's own rules, re-checked independently (effect caps and spacing, the clock, fades on the last frame).
Exit 0: pass (warnings allowed); 1: a check failed; 2: bad input (including a gain port that disagrees with the plan).
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

STUDIO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(STUDIO / "scripts" / "audio"))
sys.path.insert(0, str(STUDIO / "scripts" / "audio" / "music"))
sys.path.insert(0, str(STUDIO / "src" / "audio" / "tools"))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from scipy.signal import butter, lfilter, sosfilt  # noqa: E402

from audiolib import duck as aduck, loudness  # noqa: E402
import master_mix  # noqa: E402  (its chunked meters: a 10-minute episode in a few hundred MB)
import measure_mix  # noqa: E402

SR = 48000
SPF = 1600  # samples per frame at 30 fps


# ------------------------------------------------------------------------------------------------ the gain law (port)

def rcos(u: np.ndarray) -> np.ndarray:
    u = np.clip(u, 0.0, 1.0)
    return 0.5 - 0.5 * np.cos(np.pi * u)


def fade_shape(u: np.ndarray, curve: str) -> np.ndarray:
    return np.sin(np.pi / 2 * rcos(u)) if curve == "equalPower" else rcos(u)


def merge_spans(spans: list, min_gap: float) -> list:
    """src/audio/core/envelope.ts mergeSpans: sorted, empty dropped, merged when the gap is under min_gap."""
    s = sorted([(float(a["start"]), float(a["end"])) for a in spans if a["end"] > a["start"]])
    out: list = []
    for a, b in s:
        if out and a - out[-1][1] < min_gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def duck_amount(t: np.ndarray, duck: dict, speech: list) -> np.ndarray:
    """DuckCurve.at for every time in t: raised-cosine ramps, the attack starting lookahead before each merged span."""
    attack, release = duck["attackMs"] / 1000.0, duck["releaseMs"] / 1000.0
    look = duck["lookaheadMs"] / 1000.0
    d = np.zeros_like(t)
    if t.size == 0:
        return d
    t0, t1 = float(t[0]), float(t[-1])
    for a, b in merge_spans(speech, duck["minGapMs"] / 1000.0):
        a0, a1, r0, r1 = a - look, a - look + attack, b, b + release
        if r1 <= t0 or a0 >= t1:
            continue
        i0 = int(np.searchsorted(t, a0, side="right"))
        i1 = int(np.searchsorted(t, r1, side="left"))
        if i1 <= i0:
            continue
        x = t[i0:i1]
        up = rcos((x - a0) / (a1 - a0)) if a1 > a0 else np.ones_like(x)
        down = np.where(x <= r0, 1.0, rcos((r1 - x) / (r1 - r0)) if r1 > r0 else 0.0)
        d[i0:i1] = np.maximum(d[i0:i1], np.minimum(up, down))
    return d


def bed_amplitude(t: np.ndarray, bed: dict, fps: int) -> np.ndarray:
    """BedGain.amplitude: the bed's own fades and its rests (dips to floorDb, or silence)."""
    start = bed["from"] / fps
    end = (bed["from"] + bed["durationInFrames"]) / fps
    fin = bed["fadeInFrames"] / fps
    fout = bed["fadeOutFrames"] / fps
    a = np.where((t >= start) & (t < end), 1.0, 0.0)
    if fin > 0:
        m = t < start + fin
        a[m] *= fade_shape((t[m] - start) / fin, bed["fadeInCurve"])
    if fout > 0:
        m = t > end - fout
        a[m] *= fade_shape((end - t[m]) / fout, bed["fadeOutCurve"])
    for r in sorted(bed["rests"], key=lambda x: x["start"]):
        out, inn = r["fadeOutMs"] / 1000.0, r["fadeInMs"] / 1000.0
        fl = 10 ** (r["floorDb"] / 20) if r.get("floorDb") is not None else 0.0
        m = (t > r["start"] - out) & (t < r["end"] + inn)
        before = m & (t < r["start"])
        during = m & (t >= r["start"]) & (t <= r["end"])
        after = m & (t > r["end"])
        if out > 0:
            a[before] *= fl + (1 - fl) * rcos((r["start"] - t[before]) / out)
        a[during] *= fl
        if inn > 0:
            a[after] *= fl + (1 - fl) * rcos((t[after] - r["end"]) / inn)
    return a


def bed_gains(t: np.ndarray, bed: dict, plan: dict) -> list:
    """Per-band linear gain of one bed (its levelDb included), exactly the law <MusicBed> plays."""
    a = bed_amplitude(t, bed, plan["fps"]) * 10 ** (bed["levelDb"] / 20)
    d = duck_amount(t, plan["duck"], plan["speech"])
    return [a * 10 ** (-depth * d / 20) for depth in plan["duck"]["depthsDb"]]


def check_gain_port(plan: dict) -> float:
    """Largest difference between this port and the TypeScript's gains at the probe times (plan.gainProbe)."""
    worst = 0.0
    beds = {b["key"]: b for b in plan["beds"]}
    for p in plan.get("gainProbe", []):
        t = np.asarray(p["t"], dtype=np.float64)
        ours = np.vstack(bed_gains(t, beds[p["bed"]], plan))
        theirs = np.asarray(p["gains"], dtype=np.float64).T
        worst = max(worst, float(np.abs(ours - theirs).max()) if t.size else 0.0)
    return worst


# ------------------------------------------------------------------------------------------------ rebuilding the music

_src_cache: dict = {}


def read_public(rel: str) -> np.ndarray:
    x, sr = sf.read(str(STUDIO / "public" / rel), always_2d=True, dtype="float64")
    if sr != SR:
        raise SystemExit(f"{rel}: {sr} Hz, expected {SR}")
    return x.T


def loop_bands(rel: str, crossovers: list) -> list:
    """A loop's three bands, split circularly (the loop tiled three times, the middle copy kept), like PcmTrack's."""
    key = (rel, tuple(crossovers))
    if key not in _src_cache:
        x = read_public(rel)
        if x.shape[0] == 1:
            x = np.vstack([x, x]) * math.sqrt(0.5)  # PcmTrack plays a mono source equal-power in both channels
        n = x.shape[1]
        bands = [b[:, n:2 * n] for b in aduck.split_bands(np.tile(x, (1, 3)), crossovers=tuple(crossovers))]
        _src_cache[key] = bands
    return _src_cache[key]


def rebuild_music(plan: dict, n: int, chunk: int = 10 * SR) -> np.ndarray:
    """Beds, stingers and effects of the plan, as the render must have played them (stereo, n samples, float32)."""
    out = np.zeros((2, n), dtype=np.float32)
    fps = plan["fps"]
    for bed in plan["beds"]:
        bands = loop_bands(bed["file"], plan["duck"]["crossoversHz"])
        L = bands[0].shape[1]
        s0 = bed["from"] * SPF
        m = bed["durationInFrames"] * SPF
        for c0 in range(0, m, chunk):
            c1 = min(m, c0 + chunk)
            idx = np.arange(s0 + c0, s0 + c1)
            idx = idx[(idx >= 0) & (idx < n)]
            if not idx.size:
                continue
            t = idx / SR
            pos = (bed["startAtSample"] + (idx - s0)) % L
            g = bed_gains(t, bed, plan)
            out[:, idx] += sum(b[:, pos] * gk[None, :] for b, gk in zip(bands, g))
    for item in [*({**s, "gainDb": s["levelDb"]} for s in plan["stingers"]), *plan["sfx"]]:
        x = read_public(item["file"])
        if x.shape[0] == 1:
            x = np.vstack([x, x])
        s0 = item["from"] * SPF
        k = min(x.shape[1], item["durationInFrames"] * SPF, n - s0)
        if s0 < 0 or k <= 0:
            continue
        out[:, s0:s0 + k] += x[:, :k] * 10 ** (item["gainDb"] / 20)
    _ = fps
    return out


# ------------------------------------------------------------------------------------------------ measurements

def db(x: float) -> float:
    return float(20 * np.log10(max(float(x), 1e-12)))


def read_wav(path: str) -> np.ndarray:
    """A WAV as float32 (channels, samples): exact for the 16-bit renders, half the memory of float64."""
    x, sr = sf.read(path, always_2d=True, dtype="float32")
    if sr != SR:
        raise SystemExit(f"{path}: {sr} Hz, expected {SR}")
    x = x.T
    return np.vstack([x, x]) if x.shape[0] == 1 else x


def decode(path: str, tmp: Path) -> np.ndarray:
    dec = tmp / "decoded.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-vn", "-c:a", "pcm_f32le", "-ar", str(SR), str(dec)], check=True)
    return read_wav(str(dec))


def phone(x: np.ndarray) -> np.ndarray:
    """The critic's phone-speaker model: mono sum, 4th-order HP 350 Hz, 2nd-order LP 12 kHz, +3 dB peak at 3 kHz (Q 1)."""
    m = x.mean(axis=0)
    m = sosfilt(butter(4, 350, btype="highpass", fs=SR, output="sos"), m)
    m = sosfilt(butter(2, 12000, btype="lowpass", fs=SR, output="sos"), m)
    A, w0, Q = 10 ** (3 / 40), 2 * np.pi * 3000 / SR, 1.0
    al = np.sin(w0) / (2 * Q)
    b = np.array([1 + al * A, -2 * np.cos(w0), 1 - al * A])
    a = np.array([1 + al / A, -2 * np.cos(w0), 1 - al / A])
    m = lfilter(b / a[0], a / a[0], m).astype(np.float32)
    return np.vstack([m, m])


_BAND = butter(4, [1000, 4000], btype="bandpass", fs=SR, output="sos")


def band_energy(x: np.ndarray) -> float:
    y = sosfilt(_BAND, x.mean(axis=0))
    return float(np.mean(y * y))


def voice_vs_rest(voice: np.ndarray, rest: np.ndarray, a: int, b: int) -> dict:
    """Loudness difference and 1-4 kHz SNR of the voice over everything else in samples [a, b)."""
    pad = int(0.05 * SR)  # filter warm-up before the window
    lo = max(0, a - pad)
    v, r = voice[:, lo:b], rest[:, lo:b]
    y_v = sosfilt(_BAND, v.mean(axis=0))[a - lo:]
    y_r = sosfilt(_BAND, r.mean(axis=0))[a - lo:]
    snr = 10 * np.log10((np.mean(y_v ** 2) + 1e-20) / (np.mean(y_r ** 2) + 1e-20))
    seg_v, seg_r = voice[:, a:b], rest[:, a:b]
    lu = None
    if b - a >= int(0.4 * SR):
        lv, lr = loudness.integrated(seg_v), loudness.integrated(seg_r)
        lu = float(lv - lr) if math.isfinite(lr) else 99.0
    return {"voiceOverRestLu": None if lu is None else round(lu, 2), "snr1to4kDb": round(float(snr), 2)}


_HP150 = butter(2, 150, btype="highpass", fs=SR, output="sos")


def _hop_energy(x: np.ndarray, sos: np.ndarray, hop: int) -> np.ndarray:
    """Sum of squares of the filtered mono sum per hop of `hop` samples (complete hops), filtered in float64, 10 s at a
    time with the state carried over: the same as filtering the whole file."""
    m = x.mean(axis=0)
    nh = m.size // hop
    out = np.zeros(nh)
    zi = np.zeros((sos.shape[0], 2))
    step = (master_mix.CHUNK // hop) * hop
    for s in range(0, nh * hop, step):
        e = min(nh * hop, s + step)
        y, zi = sosfilt(sos, m[s:e].astype(np.float64), zi=zi)
        out[s // hop:e // hop] = (y * y).reshape(-1, hop).sum(axis=1)
    return out


def phrase_band_snr(voice: np.ndarray, rest: np.ndarray, words: list) -> list:
    """Per spoken phrase (words merged across gaps under 0.25 s, at least 0.4 s): the median 1-4 kHz voice-to-rest ratio
    of its 32 ms frames where Zoo is loud (within 25 dB of his 95th percentile). A bed left unducked under a phrase (a
    duck built from another timeline) drops that phrase's ratio by up to the 12 dB the mid band should have ducked,
    which the episode-wide figures average away."""
    n = voice.shape[1]
    win, hop = 1536, 768  # a frame is two hops: its energy is the sum of two hop sums (no frame matrix in memory)
    hv = _hop_energy(voice, _BAND, hop)
    hr = _hop_energy(rest, _BAND, hop)
    hf = _hop_energy(voice, _HP150, hop)
    k = max(0, hv.size - 1)
    ev = (hv[:-1] + hv[1:]) / win
    er = (hr[:-1] + hr[1:]) / win
    lv = 10 * np.log10((hf[:-1] + hf[1:]) / win + 1e-20)
    centres = (np.arange(k) * hop + win / 2) / SR
    out = []
    for a, b in merge_spans(words, 0.25):
        if b - a < 0.4:
            continue
        m = (centres >= a) & (centres < b)
        if not m.any():
            continue
        loud = m & (lv > np.percentile(lv[m], 95) - 25)
        snr = 10 * np.log10((ev[loud] + 1e-20) / (er[loud] + 1e-20))
        out.append({"fromSec": round(a, 2), "toSec": round(b, 2), "snr1to4kMedianDb": round(float(np.median(snr)), 2)})
    return out


def ffmpeg_ebur128(path: str) -> dict:
    return measure_mix.ffmpeg_ebur128(Path(path))


def ffprobe(path: str) -> dict:
    p = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path], capture_output=True, text=True, check=True)
    return json.loads(p.stdout)


def video_md5(path: str) -> str:
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-c", "copy", "-f", "md5", "-"], capture_output=True, text=True, check=True)
    return p.stdout.strip()


# ------------------------------------------------------------------------------------------------ the gate

class Report:
    def __init__(self):
        self.checks: list = []

    def add(self, cid: str, name: str, ok: bool, detail: str, warn: bool = False, value=None):
        level = "pass" if ok and not warn else ("warn" if ok else "fail")
        self.checks.append({"id": cid, "check": name, "level": level, "pass": ok, "detail": detail, "value": value})

    @property
    def failed(self) -> bool:
        return any(c["level"] == "fail" for c in self.checks)


def plan_rules(plan: dict, rep: Report) -> None:
    """The plan's own rules, re-checked from its JSON (independent of the TypeScript that wrote it)."""
    fps, gate = plan["fps"], plan["gate"]
    sfx = sorted(plan["sfx"], key=lambda c: c["at"])
    bad = []
    for i, c in enumerate(sfx):
        if i and c["at"] - sfx[i - 1]["at"] < 6:
            bad.append(f"{c['id']}@{c['at']} 6-frame spacing")
        if sum(1 for x in sfx if c["at"] - 10 * fps < x["at"] <= c["at"]) > 3:
            bad.append(f"{c['id']}@{c['at']} more than 3 in 10 s")
        if sum(1 for x in sfx if c["at"] - 60 * fps < x["at"] <= c["at"]) > 6:
            bad.append(f"{c['id']}@{c['at']} more than 6 in a minute")
    if plan["scenes"]:
        s0 = plan["scenes"][0]
        for c in sfx:
            if s0["from"] <= c["at"] < s0["from"] + s0["frames"]:
                bad.append(f"{c['id']}@{c['at']} in the opening scene")
    for p in plan["protect"]:
        if p["why"] != "disclosure":
            continue
        for c in sfx:
            a0, a1 = c["from"] / fps, (c["from"] + c["durationInFrames"]) / fps
            if a0 < p["end"] + 0.5 and a1 > p["start"] - 0.5:
                bad.append(f"{c['id']}@{c['at']} within 0.5 s of the disclosure")
    L = 64 * SR
    for b in plan["beds"]:
        if (plan["clock"]["offsetSamples"] + b["from"] * SPF) % L != b["startAtSample"]:
            bad.append(f"bed {b['key']} is off the clock")
        if b["fadeInFrames"] + b["fadeOutFrames"] > b["durationInFrames"] + 1:
            bad.append(f"bed {b['key']}'s fades overlap")
    ends = [b for b in plan["beds"] if b["from"] + b["durationInFrames"] >= plan["durationInFrames"]]
    for b in ends:
        if b["fadeOutFrames"] < 2:
            bad.append(f"bed {b['key']} stops on the last frame without a fade")
    rep.add("plan-rules", "the plan's rules (effect caps and spacing, no effect in the opening scene or near a disclosure, the clock, final fades)", not bad,
            "; ".join(bad) if bad else f"{len(sfx)} effects, {len(plan['beds'])} bed segments, all on the clock")
    _ = gate


def run(a) -> int:
    plan = json.loads(Path(a.plan).read_text())
    rep = Report()
    out: dict = {"plan": {"hash": plan["hash"], "lang": plan["lang"], "format": plan["format"], "shortId": plan["shortId"], "durationInFrames": plan["durationInFrames"]}}
    gate = plan["gate"]
    if plan.get("silent"):
        print("audio check: the plan is silent (a mock timeline): nothing to measure")
        return 2
    port = check_gain_port(plan)
    out["gainPort"] = {"maxAbsDiff": port}
    if port > 1e-6:
        print(f"audio check: this gate's port of the gain law differs from the plan's TypeScript by {port:.2e}: fix tools/audio_check.py before trusting it", file=sys.stderr)
        return 2
    mix = read_wav(a.mix)
    voice = read_wav(a.voice)
    n = min(mix.shape[1], voice.shape[1])
    want_n = plan["durationInFrames"] * SPF
    if abs(n - want_n) > SPF:
        print(f"audio check: the mix has {n} samples, the plan {want_n}", file=sys.stderr)
        return 2
    mix, voice = mix[:, :n], voice[:, :n]
    rest = mix - voice

    # 1. the null test: the render is the plan
    want = rebuild_music(plan, n)
    res = rest - want
    peak = float(np.abs(res).max())
    hop = int(0.1 * SR)
    win = np.sqrt(np.mean(res[:, : (n // hop) * hop].reshape(2, -1, hop) ** 2, axis=(0, 2))) if n >= hop else np.zeros(1)
    worst_at = int(np.argmax(win)) * hop
    out["nullTest"] = {"residualPeakDbfs": round(db(peak), 2), "residualRmsDbfs": round(db(np.sqrt(np.mean(res ** 2))), 2), "worst100msAtSec": round(worst_at / SR, 2),
                       "musicRmsDbfs": round(db(np.sqrt(np.mean(want ** 2))), 2)}
    rep.add("null", "the render is the plan: mix - voice - (beds, stingers and effects rebuilt from the plan)", db(peak) <= gate["nullResidualMaxDbfs"],
            f"residual peak {db(peak):.1f} dBFS (line {gate['nullResidualMaxDbfs']}), worst 100 ms at {worst_at / SR:.2f} s", value=round(db(peak), 2))

    # 2. voice on top (the AudioDemo gate, phrase by phrase, recalibrated)
    words = {"bed": {"speech": plan["words"]}}
    v = measure_mix.voice_on_top(voice, rest, words)
    out["voiceOnTop"] = v
    rep.add("voice-over-rest", "Zoo over everything else under speech", v["voiceOverRestLu"] >= gate["voiceOverRestMinLu"], f"{v['voiceOverRestLu']} LU (line {gate['voiceOverRestMinLu']}, warn under {gate['voiceOverRestWarnLu']})",
            warn=v["voiceOverRestLu"] < gate["voiceOverRestWarnLu"], value=v["voiceOverRestLu"])
    wp = v["worstPhraseVoiceOverRestLu"]
    rep.add("worst-phrase", "the worst phrase", wp is None or wp >= gate["worstPhraseMinLu"], f"{wp} LU (line {gate['worstPhraseMinLu']}, warn under {gate['worstPhraseWarnLu']})",
            warn=wp is not None and wp < gate["worstPhraseWarnLu"], value=wp)
    rep.add("index", "band-audibility index", v["index"] >= gate["indexMin"], f"{v['index']} (line {gate['indexMin']})", value=v["index"])
    rep.add("index-p10", "band-audibility index, 10th percentile", v["indexP10"] >= gate["indexP10Min"], f"{v['indexP10']} (line {gate['indexP10Min']})", value=v["indexP10"])
    rep.add("under-3db", "speech frames under 3 dB SNR at 1-4 kHz", v["framesUnder3dB"] <= gate["framesUnder3dBMax"], f"{100 * v['framesUnder3dB']:.1f} % (line {100 * gate['framesUnder3dBMax']:.0f} %)", value=v["framesUnder3dB"])
    ph = phrase_band_snr(voice, rest, plan["words"])
    out["phrases1to4k"] = ph
    wph = min(ph, key=lambda x: x["snr1to4kMedianDb"]) if ph else None
    wps = wph["snr1to4kMedianDb"] if wph else None
    rep.add("worst-phrase-snr", "the worst phrase at 1-4 kHz (Zoo's consonants against everything else)", wps is None or wps >= gate["worstPhraseSnrMinDb"],
            f"{wps} dB at {wph['fromSec']} s (line {gate['worstPhraseSnrMinDb']}, warn under {gate['worstPhraseSnrWarnDb']})" if wph else "no phrase of 0.4 s or more",
            warn=wps is not None and wps < gate["worstPhraseSnrWarnDb"], value=wps)
    vp = measure_mix.voice_on_top(phone(voice), phone(rest), words)
    out["voiceOnTopPhone"] = {k: vp[k] for k in ("index", "voiceOverRestLu", "worstPhraseVoiceOverRestLu", "framesUnder3dB")}
    rep.add("phone", "the same on the phone-speaker model", True, f"{vp['voiceOverRestLu']} LU (warn under {gate['phoneVoiceOverRestWarnLu']}), worst phrase {vp['worstPhraseVoiceOverRestLu']}",
            warn=vp["voiceOverRestLu"] < gate["phoneVoiceOverRestWarnLu"], value=vp["voiceOverRestLu"])

    # 3. duck coverage: the plan's mid band against the voice that plays
    act = aduck.voice_activity(voice.mean(axis=0), SR, min_gap=0.0)
    hop10 = int(0.01 * SR)
    starts = np.arange(0, n - hop10, hop10)
    voiced = np.array([act[i:i + hop10].any() for i in starts])
    t = (starts + hop10 / 2) / SR
    d = duck_amount(t, plan["duck"], plan["speech"])
    plays = np.zeros_like(t, dtype=bool)
    for b in plan["beds"]:
        plays |= bed_amplitude(t, b, plan["fps"]) > 0
    mid = plan["duck"]["depthsDb"][1] * d
    covered = (mid >= 10.0 - 1e-9) | ~plays
    cov = float(covered[voiced].mean()) if voiced.any() else 1.0
    out["duckCoverage"] = {"voicedHops": int(voiced.sum()), "share": round(cov, 4)}
    rep.add("duck-coverage", "the bed's mid band at least 10 dB down while Zoo is heard", cov >= gate["duckCoverageMin"], f"{100 * cov:.1f} % of {int(voiced.sum())} voiced 10 ms frames (line {100 * gate['duckCoverageMin']:.0f} %)", value=round(cov, 4))

    # 4. voice-free windows (bed changes and fades, the sting slot, every transition)
    worst_vf = (-200.0, None)
    for w in plan["voiceFree"]:
        a0, a1 = w["from"] * SPF, min(n, w["to"] * SPF)
        seg = voice[:, a0:a1]
        if seg.shape[1] < hop10:
            continue
        k = seg.shape[1] // hop10
        r = float(np.sqrt(np.mean(seg[:, :k * hop10].reshape(2, k, hop10) ** 2, axis=(0, 2))).max())
        if db(r) > worst_vf[0]:
            worst_vf = (db(r), w)
    rep.add("voice-free", "no voice in any bed change, bed fade, sting slot or transition", worst_vf[0] <= gate["voiceFreeMaxDbfs"],
            f"loudest 10 ms {worst_vf[0]:.1f} dBFS" + (f" ({worst_vf[1]['why']}, frames {worst_vf[1]['from']}-{worst_vf[1]['to']})" if worst_vf[1] else "") + f" over {len(plan['voiceFree'])} windows", value=round(worst_vf[0], 1))

    # 5. every effect that overlaps the voice leaves Zoo's consonants clear (critic F2; the phone model for Shorts)
    masks = []
    for c in plan["sfx"]:
        a0 = c["from"] * SPF
        a1 = min(n, a0 + int(0.15 * SR))
        if a1 <= a0 or db(np.sqrt(np.mean(voice[:, a0:a1] ** 2))) < -45:
            continue
        r = voice_vs_rest(phone(voice) if gate["phone"] else voice, phone(rest) if gate["phone"] else rest, a0, a1)
        masks.append({"id": c["id"], "at": c["at"], "snr1to4kDb": r["snr1to4kDb"]})
    worst_mask = min((m["snr1to4kDb"] for m in masks), default=None)
    out["sfxOverVoice"] = masks
    rep.add("sfx-masking", "effects over the voice: 1-4 kHz voice-to-rest ratio, first 150 ms" + (" (phone model)" if gate["phone"] else ""),
            worst_mask is None or worst_mask >= gate["sfxMaskFailDb"], f"{len(masks)} effect(s) over the voice" + (f", worst {worst_mask} dB (pass {gate['sfxMaskPassDb']}, fail under {gate['sfxMaskFailDb']})" if masks else ""),
            warn=worst_mask is not None and worst_mask < gate["sfxMaskPassDb"], value=worst_mask)

    # 6. the first second of speech and a spoken disclosure (critics F5, F19)
    out["protect"] = []
    for p in plan["protect"]:
        a0, a1 = int(p["start"] * SR), min(n, int(p["end"] * SR))
        r = voice_vs_rest(voice, rest, a0, max(a1, a0 + int(0.4 * SR)))
        out["protect"].append({**p, **r})
        ok = (r["voiceOverRestLu"] is None or r["voiceOverRestLu"] >= gate["protectVoiceOverRestLu"]) and r["snr1to4kDb"] >= gate["protectSnr1to4kDb"]
        rep.add(f"protect-{p['why']}", f"{'the first second of speech' if p['why'] == 'hook' else 'the spoken disclosure'}: voice over the rest and 1-4 kHz SNR", ok,
                f"{r['voiceOverRestLu']} LU, {r['snr1to4kDb']} dB (lines {gate['protectVoiceOverRestLu']} LU, {gate['protectSnr1to4kDb']} dB)")

    # 7. the premaster, the master and the delivery
    sp = float(np.abs(mix).max())
    out["premaster"] = {"samplePeakDbfs": round(db(sp), 2), "integratedLufs": round(master_mix.integrated_lufs(mix), 2)}
    rep.add("premaster-peak", "Remotion's mix has headroom (it sums with no limiter)", db(sp) < -0.1, f"sample peak {db(sp):.2f} dBFS")
    master = json.loads(Path(a.master).read_text()) if a.master and Path(a.master).exists() else None
    if master:
        m = master["rounds"][-1]["master"]
        lim = m.get("limiter", {})
        out["master"] = {"gainDb": m["gainDb"], "limiterMaxDb": lim.get("grMaxDb"), "limiterOver1dBPct": lim.get("grOver1dBPct"), "streams": master["rounds"][-1].get("streams", {})}
        rep.add("master-gain", "the master's static gain within +-3 dB (a speech-led mix needs little)", abs(m["gainDb"]) <= 3, f"{m['gainDb']:+.2f} dB")
        over = lim.get("grOver1dBPct", 0) or 0
        rep.add("limiter", "the limiter works on transients only", True, f"over 1 dB on {over} % of 10 ms blocks (warn over 1 %)", warn=over > 1)
        streams = master["rounds"][-1].get("streams", {})
        tps = {k: v["truePeakDbtp"] for k, v in streams.items() if "truePeakDbtp" in v}
        worst_tp = max(tps.values(), default=None)
        rep.add("platform-reencode", "true peak after AAC and Opus 128 kb/s re-encodes", worst_tp is None or worst_tp <= gate["streamFailDbtp"],
                ", ".join(f"{k} {v} dBTP" for k, v in tps.items()) or "not measured", warn=worst_tp is not None and worst_tp > gate["streamWarnDbtp"], value=worst_tp)
        dlg = master_mix.integrated_lufs(voice[:, measure_mix.speech_mask(words, n)] * np.float32(10 ** (m["gainDb"] / 20)))
        out["dialogueLufsAfterMaster"] = round(float(dlg), 2)
        rep.add("dialogue", "dialogue loudness after the master", True, f"{dlg:.2f} LUFS (warn outside -15.0 to -12.5)", warn=not (-15.0 <= dlg <= -12.5), value=round(float(dlg), 2))
    with tempfile.TemporaryDirectory() as td:
        y = decode(a.delivered, Path(td))
    li, tp = master_mix.integrated_lufs(y), master_mix.true_peak_dbtp(y)
    ff = ffmpeg_ebur128(a.delivered)
    out["delivered"] = {"integratedLufs": round(li, 2), "truePeakDbtp": round(tp, 2), "ffmpeg": ff, "dcMax": round(float(np.abs(y.mean(axis=1)).max()), 6)}
    tol = gate["loudnessTolLu"]
    rep.add("loudness", f"delivered loudness {gate['loudnessLufs']} +-{tol} LUFS-I (ours and ffmpeg's)", abs(li - gate["loudnessLufs"]) <= tol and abs(ff.get("integratedLufs", 99) - gate["loudnessLufs"]) <= tol,
            f"{li:.2f} LUFS (ffmpeg {ff.get('integratedLufs')})", value=round(li, 2))
    rep.add("true-peak", f"delivered true peak <= {gate['truePeakMaxDbtp']} dBTP (ours and ffmpeg's)", tp <= gate["truePeakMaxDbtp"] and ff.get("truePeakDbtp", 99) <= gate["truePeakMaxDbtp"],
            f"{tp:.2f} dBTP (ffmpeg {ff.get('truePeakDbtp')})", value=round(tp, 2))
    rep.add("dc", "delivered DC offset <= 0.001", out["delivered"]["dcMax"] <= 0.001, f"{out['delivered']['dcMax']}")
    if a.delivered.lower().endswith(".mp4"):
        info = ffprobe(a.delivered)
        aud = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
        vid = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
        ok = bool(aud and aud.get("codec_name") == "aac" and aud.get("profile") == "LC" and int(aud.get("sample_rate", 0)) == SR and int(aud.get("channels", 0)) == 2)
        detail = f"audio {aud.get('codec_name') if aud else None} {aud.get('profile') if aud else ''} {aud.get('sample_rate') if aud else ''} Hz {aud.get('channels') if aud else ''} ch"
        if vid and aud:
            dv, da = float(vid.get("duration", 0)), float(aud.get("duration", 0))
            ok = ok and abs(dv - da) <= 1.5 / plan["fps"]
            detail += f"; video {dv:.3f} s, audio {da:.3f} s"
        if a.picture:
            same = video_md5(a.picture) == video_md5(a.delivered)
            ok = ok and same
            detail += "; video stream identical to the picture render" if same else "; VIDEO STREAM DIFFERS from the picture render"
        rep.add("streams", "AAC-LC 48 kHz stereo, the picture copied untouched, audio as long as the video", ok, detail)

    # 8. the plan's own rules
    plan_rules(plan, rep)

    out["checks"] = rep.checks
    out["pass"] = not rep.failed
    if a.report:
        Path(a.report).write_text(json.dumps(out, indent=1) + "\n")
    for c in rep.checks:
        print(f"{c['level'].upper():4s} {c['check']}: {c['detail']}")
    print(f"audio check: {'PASS' if out['pass'] else 'FAIL'}" + (f" -> {a.report}" if a.report else ""))
    return 0 if out["pass"] else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--plan", required=True)
    ap.add_argument("--mix", required=True, help="Remotion's lossless mix (--separate-audio-to, or a --codec=wav render)")
    ap.add_argument("--voice", required=True, help="the voice stem (audioStems: ['voice'])")
    ap.add_argument("--delivered", required=True, help="the mastered delivery (.mp4, .m4a or .wav)")
    ap.add_argument("--picture", help="the picture render, to prove its video stream was copied untouched")
    ap.add_argument("--master", help="master_mix.py's report")
    ap.add_argument("--report", help="write the JSON report here")
    a = ap.parse_args(argv)
    try:
        return run(a)
    except (OSError, subprocess.CalledProcessError, KeyError, ValueError) as e:
        print(f"audio check: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
