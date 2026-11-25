#!/usr/bin/env python3
"""Offline mixes and measurements straight from audio-plan JSON (no Remotion render): the gate's own rebuild of the
music, stingers and effects plus the narration, measured with the gate's checks. For calibrating the gate's lines,
comparing clock offsets, the wrong-duck control and the owner's A/B listening clips.

    .venv-audio/bin/python src/episode/tools/audio_sim.py --plan P.json [--plan P2.json ...] [--narration N.wav | --voice V.wav]
        [--duck-from OTHER.json] [--wav-out mix.wav] [--json out.json]

  --narration   the voice step's narration.wav (24 kHz mono): upsampled 2x and played equal-power in both channels, as
                Remotion plays it (default: the plan's language's public/generated/<channel>/<slug>/<lang>/narration.wav;
                a Short's scenes are cut from it at their windows)
  --voice       a rendered voice stem instead (exact)
  --duck-from   the negative control: rebuild the music with ANOTHER plan's duck (e.g. the English duck under the
                Spanish voice), to prove the gate's lines catch it
  --master      also master the mix (master_mix.master_audio: -14 LUFS-I, true-peak limited) before --wav-out
Prints one line per plan; --json writes every measurement.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STUDIO = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(STUDIO / "src" / "audio" / "tools"))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from scipy.signal import resample_poly  # noqa: E402

import audio_check as ac  # noqa: E402
import measure_mix  # noqa: E402
from audiolib import duck as aduck, loudness  # noqa: E402

SR = ac.SR
SPF = ac.SPF


def narration_voice(plan: dict, path: str | None) -> np.ndarray:
    """The narration as the render plays it, on the plan's frames (a Short: each scene's window at its new frame)."""
    rel = path or str(STUDIO / "public" / "generated" / plan["channel"] / plan["slug"] / plan["lang"] / "narration.wav")
    x, sr = sf.read(rel, always_2d=True, dtype="float64")
    m = x.T.mean(axis=0)
    if sr != SR:
        g = math.gcd(SR, sr)
        m = resample_poly(m, SR // g, sr // g)
    n = plan["durationInFrames"] * SPF
    out = np.zeros(n)
    if plan["format"] == "vertical":
        tl = json.loads((STUDIO / "public" / "generated" / plan["channel"] / plan["slug"] / plan["lang"] / "timeline.json").read_text())
        by_id = {s["id"]: s for s in tl["scenes"]}
        for s in plan["scenes"]:
            src0 = int(round(by_id[s["id"]]["startMs"] / 1000 * SR))
            k = s["frames"] * SPF
            seg = m[src0:src0 + k]
            out[s["from"] * SPF:s["from"] * SPF + seg.size] = seg
    else:
        k = min(n, m.size)
        out[:k] = m[:k]
    return np.vstack([out, out]) * math.sqrt(0.5)


def measure(plan: dict, voice: np.ndarray, music: np.ndarray, built: dict | None = None) -> dict:
    """The gate's acoustic measurements of one mix; `built` is the plan the music was rebuilt from (another plan's duck
    for the negative control), so the duck coverage is the coverage of the music actually in the mix."""
    built = built or plan
    n = min(voice.shape[1], music.shape[1])
    voice, music = voice[:, :n], music[:, :n]
    mix = voice + music
    words = {"bed": {"speech": plan["words"]}}
    v = measure_mix.voice_on_top(voice, music, words)
    vp = measure_mix.voice_on_top(ac.phone(voice), ac.phone(music), words)
    act = aduck.voice_activity(voice.mean(axis=0), SR, min_gap=0.0)
    hop = int(0.01 * SR)
    starts = np.arange(0, n - hop, hop)
    voiced = np.array([act[i:i + hop].any() for i in starts])
    t = (starts + hop / 2) / SR
    d = ac.duck_amount(t, built["duck"], built["speech"])
    plays = np.zeros_like(t, dtype=bool)
    for b in built["beds"]:
        plays |= ac.bed_amplitude(t, b, built["fps"]) > 0
    covered = (built["duck"]["depthsDb"][1] * d >= 10.0 - 1e-9) | ~plays
    i_pre = ac.master_mix.integrated_lufs(mix)
    ph = ac.phrase_band_snr(voice, music, plan["words"])
    return {
        "worstPhraseSnr1to4kDb": min((x["snr1to4kMedianDb"] for x in ph), default=None),
        "lang": plan["lang"], "format": plan["format"], "offsetPhrase": plan["clock"]["offsetPhrase"],
        "voiceOverRestLu": v["voiceOverRestLu"], "worstPhraseLu": v["worstPhraseVoiceOverRestLu"], "index": v["index"], "indexP10": v["indexP10"],
        "framesUnder3dB": v["framesUnder3dB"], "snr1to4kMedianDb": v["snr1to4kMedianDb"],
        "phoneVoiceOverRestLu": vp["voiceOverRestLu"], "phoneWorstPhraseLu": vp["worstPhraseVoiceOverRestLu"],
        "duckCoverage": round(float(covered[voiced].mean()) if voiced.any() else 1.0, 4),
        "premasterLufs": round(i_pre, 2), "premasterTruePeakDbtp": round(ac.master_mix.true_peak_dbtp(mix), 2), "masterGainDb": round(-14.0 - i_pre, 2),
    }


def gate_lines(plan: dict, m: dict) -> list:
    """The gate's acoustic fail lines this mix would fail."""
    g = plan["gate"]
    fails = []
    if m["voiceOverRestLu"] < g["voiceOverRestMinLu"]:
        fails.append("voice over rest")
    if m["worstPhraseLu"] is not None and m["worstPhraseLu"] < g["worstPhraseMinLu"]:
        fails.append("worst phrase")
    if m["index"] < g["indexMin"]:
        fails.append("index")
    if m["indexP10"] < g["indexP10Min"]:
        fails.append("index P10")
    if m["framesUnder3dB"] > g["framesUnder3dBMax"]:
        fails.append("frames under 3 dB")
    if m["worstPhraseSnr1to4kDb"] is not None and m["worstPhraseSnr1to4kDb"] < g["worstPhraseSnrMinDb"]:
        fails.append("worst phrase SNR")
    if m["duckCoverage"] < g["duckCoverageMin"]:
        fails.append("duck coverage")
    return fails


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--plan", action="append", required=True)
    ap.add_argument("--narration")
    ap.add_argument("--voice")
    ap.add_argument("--duck-from")
    ap.add_argument("--master", action="store_true")
    ap.add_argument("--wav-out")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    rows = []
    for p in a.plan:
        plan = json.loads(Path(p).read_text())
        voice = ac.read_wav(a.voice) if a.voice else narration_voice(plan, a.narration)
        n = plan["durationInFrames"] * SPF
        if voice.shape[1] < n:
            voice = np.pad(voice, ((0, 0), (0, n - voice.shape[1])))
        voice = voice[:, :n]
        build = dict(plan)
        if a.duck_from:
            other = json.loads(Path(a.duck_from).read_text())
            build = {**plan, "speech": other["speech"], "duck": other["duck"]}
        music = ac.rebuild_music(build, n)
        m = measure(plan, voice, music, build)
        m["plan"] = Path(p).name
        m["duckFrom"] = Path(a.duck_from).name if a.duck_from else None
        m["fails"] = gate_lines(plan, m)
        rows.append(m)
        print(f"{m['plan']:28s} k={m['offsetPhrase']} duck={m['duckFrom'] or 'own':12s} over {m['voiceOverRestLu']:6.2f} worst {m['worstPhraseLu']} idx {m['index']:.3f} P10 {m['indexP10']:.3f} "
              f"u3 {100 * m['framesUnder3dB']:5.1f}% phSNR {m['worstPhraseSnr1to4kDb']} cov {100 * m['duckCoverage']:5.1f}% phone {m['phoneVoiceOverRestLu']:6.2f} pre {m['premasterLufs']} / {m['premasterTruePeakDbtp']} dBTP"
              f" -> fails: {', '.join(m['fails']) or 'none'}")
        if a.wav_out:
            mix = voice + music
            if a.master:
                import master_mix  # noqa: E402

                mix, _ = master_mix.master_audio(master_mix.subsonic(mix), -14.0, -1.5)
            sf.write(a.wav_out, mix.T, SR, subtype="PCM_24")
    if a.json:
        Path(a.json).write_text(json.dumps(rows, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
