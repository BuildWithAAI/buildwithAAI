#!/usr/bin/env python3
"""Measure the AudioDemo mix: loudness and true peak of the delivered MP4 and of the WAV master, the
voice against everything else under speech, the bed against its per-sample plan, SFX sync.

    .venv-audio/bin/python src/audio/tools/measure_mix.py [--dir out/audio/integration] [--json report.json]

Reads (written by src/audio/tools/demo.sh): audio-demo.mp4 (delivered: mastered by master_mix.py),
audio-demo.wav (the mastered mix), audio-demo.raw.mp4 and audio-demo.premaster.wav (Remotion's own mix,
16-bit), stem-voice.wav, stem-bed.wav, stem-stings.wav, stem-sfx.wav (the same composition with only that
stem), plan.json and bed_gains.f32 (src/audio/tools/plan_dump.ts: the plan and the bed's per-band gain
per sample, computed by the same TypeScript the composition runs).

Checks (exit 1 when one fails):
  - MP4 (AAC as delivered): integrated loudness -14 +-1 LUFS, true peak <= -1 dBTP (our BS.1770-4 meter
    and ffmpeg's ebur128 must both agree);
  - the stems sum to the mix (null test under -80 dBFS: nothing else is in the mix);
  - the rendered bed equals its plan per sample (ideal = the bed looped from its start offset, split at
    700 Hz / 5 kHz by the audio engine's own split_bands, times the plan's per-band gains): residual at
    the 16-bit floor, also across the loop seam;
  - the voice is on top under speech: band-audibility index (ANSI S3.5 weights, the music package's
    voice-gate method) >= 0.75 and the voice at least 10 LU over everything else;
  - every SFX lands on its planned sample (cross-correlation of the file with the SFX stem): within 1 ms.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

STUDIO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(STUDIO / "scripts" / "audio"))
sys.path.insert(0, str(STUDIO / "scripts" / "audio" / "music"))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from audiolib import duck, loudness  # noqa: E402
from composer import voicegate  # noqa: E402

SR = 48000
TARGET_I, TOL_I, CEIL_TP = -14.0, 1.0, -1.0
INDEX_MIN, VOICE_OVER_MIN_LU = 0.75, 10.0


def db(x: float) -> float:
    return float(20 * np.log10(max(float(x), 1e-12)))


def read(path: Path) -> np.ndarray:
    x, sr = sf.read(str(path), always_2d=True, dtype="float64")
    if sr != SR:
        raise SystemExit(f"{path}: {sr} Hz, expected {SR}")
    return x.T


def decode_mp4(mp4: Path, out: Path) -> np.ndarray:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp4), "-vn", "-c:a", "pcm_f32le", "-ar", str(SR), str(out)], check=True)
    return read(out)


def ffmpeg_ebur128(path: Path) -> dict:
    p = subprocess.run(["ffmpeg", "-nostats", "-hide_banner", "-i", str(path), "-vn", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], capture_output=True, text=True)
    tail = p.stderr[p.stderr.rfind("Summary:"):]
    out = {}
    for line in tail.splitlines():
        line = line.strip()
        if line.startswith("I:"):
            out["integratedLufs"] = float(line.split()[1])
        elif line.startswith("LRA:"):
            out["lraLu"] = float(line.split()[1])
        elif line.startswith("Peak:"):
            out["truePeakDbtp"] = float(line.split()[1])
    return out


def level_summary(x: np.ndarray) -> dict:
    return {"integratedLufs": round(loudness.integrated(x), 2), "lraLu": round(loudness.loudness_range(x), 2),
            "truePeakDbtp": round(loudness.true_peak(x), 2), "samplePeakDbfs": round(loudness.sample_peak(x), 2),
            "durationSec": round(x.shape[1] / SR, 3)}


def speech_mask(plan: dict, n: int) -> np.ndarray:
    """Samples where Zoo speaks, from the plan's word spans (the same spans the duck uses)."""
    m = np.zeros(n, dtype=bool)
    for s in plan["bed"]["speech"]:
        m[int(round(s["start"] * SR)):int(round(s["end"] * SR))] = True
    return m


def voice_on_top(voice: np.ndarray, rest: np.ndarray, plan: dict) -> dict:
    """The music package's voice-gate measurement (composer/voicegate.py), on the actual stems: 32 ms frames,
    one-third-octave SNR 160 Hz-8 kHz during speech frames, band audibility clip((SNR+15)/30), ANSI S3.5 weights."""
    n = voice.shape[1]
    act = speech_mask(plan, n)
    f, t, pv = voicegate._stft_power(voicegate._mono_sum(voice))
    _, _, pr = voicegate._stft_power(voicegate._mono_sum(rest))
    fr_act = act[np.minimum((t * SR).astype(int), n - 1)]
    vtot = 10 * np.log10(pv.sum(axis=0) + 1e-20)
    sp = fr_act & (vtot > np.percentile(vtot[fr_act], 95) - 25)
    bm = voicegate._band_matrix(f, voicegate.SII_FC)
    lv = 10 * np.log10(bm @ pv + 1e-20)
    lr = 10 * np.log10(bm @ pr + 1e-20)
    snr = lv[:, sp] - lr[:, sp]
    idx = (np.asarray(voicegate.SII_W)[:, None] * np.clip((snr + 15) / 30, 0, 1)).sum(axis=0)
    hb = (f >= 1000) & (f <= 4000)
    snr14 = 10 * np.log10(pv[hb][:, sp].sum(axis=0) + 1e-20) - 10 * np.log10(pr[hb][:, sp].sum(axis=0) + 1e-20)
    vl = loudness.integrated(voice[:, act])
    rl = loudness.integrated(rest[:, act])
    # phrase by phrase (word spans merged across gaps under 0.25 s): the worst phrase matters more than the average
    phrases = []
    for a, b in _runs(duck.activity_from_intervals([(x["start"], x["end"]) for x in plan["bed"]["speech"]], n, SR, min_gap=0.25)):
        if b - a < int(0.4 * SR):
            continue
        pv_, pr_ = voice[:, a:b], rest[:, a:b]
        phrases.append({"fromSec": round(a / SR, 2), "toSec": round(b / SR, 2), "voiceOverRestLu": round(float(loudness.integrated(pv_) - loudness.integrated(pr_)), 2)})
    return {"speechFrames": int(sp.sum()), "index": round(float(idx.mean()), 4), "indexP10": round(float(np.percentile(idx, 10)), 4),
            "voiceLufsUnderSpeech": round(float(vl), 2), "restLufsUnderSpeech": round(float(rl), 2), "voiceOverRestLu": round(float(vl - rl), 2),
            "worstPhraseVoiceOverRestLu": min((p["voiceOverRestLu"] for p in phrases), default=None), "phrases": phrases,
            "snr1to4kMedianDb": round(float(np.median(snr14)), 2), "snr1to4kP10Db": round(float(np.percentile(snr14, 10)), 2),
            "framesUnder3dB": round(float(np.mean(snr14 < 3)), 4)}


def _runs(mask: np.ndarray) -> list:
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.nonzero(d == 1)[0].tolist(), np.nonzero(d == -1)[0].tolist()))


def ideal_bed(plan: dict) -> tuple[np.ndarray, int]:
    """The bed as planned: looped from its start offset, split into the duck's bands, times the per-band gains."""
    bed = plan["bed"]
    src = read(STUDIO / "public" / bed["file"])
    n = int(bed["gainSamples"])
    g = np.fromfile(STUDIO / "out" / "audio" / "integration" / "bed_gains.f32", dtype=np.float32).astype(np.float64).reshape(int(bed["bands"]), n)
    L = src.shape[1]
    off = int(round(bed["startAtSec"] * SR))
    reps = int(np.ceil((off + n) / L)) + 2
    tiled = np.tile(src, (1, reps))
    bands = duck.split_bands(tiled) if int(bed["bands"]) == 3 else [tiled]
    start = L + off  # take the window from the second copy: no filter edge effects
    out = sum(b[:, start:start + n] * gk[None, :] for b, gk in zip(bands, g))
    return out, L - off  # the loop seam, in samples from the bed's start


def sfx_sync(plan: dict, stem: np.ndarray) -> dict:
    mono = stem.mean(axis=0)
    offsets = []
    for c in plan["sfx"]:
        x, sr = sf.read(str(STUDIO / "public" / c["file"]), always_2d=True, dtype="float64")
        ref = x.T.mean(axis=0) * 10 ** (c["gainDb"] / 20)
        k = min(ref.size, int(0.08 * SR))
        ref = ref[:k]
        start = int(round(c["from"] * SR / plan["fps"]))
        w = int(0.01 * SR)
        lo = max(0, start - w)
        seg = mono[lo:start + w + k]
        if seg.size < k:
            continue
        corr = np.correlate(seg, ref, mode="valid")
        lag = int(np.argmax(corr)) + lo - start
        offsets.append({"id": c["id"], "label": c["label"], "frame": c["at"], "offsetMs": round(lag / SR * 1000, 3)})
    worst = max((abs(o["offsetMs"]) for o in offsets), default=0.0)
    return {"cues": len(offsets), "worstOffsetMs": worst, "offsets": offsets}


def section_loudness(mix: np.ndarray, plan: dict) -> list:
    out = []
    for s in plan["sections"]:
        a, b = int(s["from"] * SR / plan["fps"]), int(s["to"] * SR / plan["fps"])
        seg = mix[:, a:b]
        st = loudness.short_term(seg) if seg.shape[1] > 3 * SR else np.array([loudness.integrated(seg)])
        st = st[np.isfinite(st)]
        out.append({"id": s["id"], "fromSec": round(a / SR, 2), "toSec": round(b / SR, 2), "integratedLufs": round(float(loudness.integrated(seg)), 2),
                    "shortTermMaxLufs": round(float(st.max()), 2) if st.size else None})
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dir", default=str(STUDIO / "out" / "audio" / "integration"))
    ap.add_argument("--json", help="write the report here (default: <dir>/report.json)")
    a = ap.parse_args(argv)
    d = Path(a.dir)
    plan = json.loads((d / "plan.json").read_text())
    checks = []

    def check(name: str, ok: bool, detail: str):
        checks.append({"check": name, "pass": bool(ok), "detail": detail})

    report: dict = {"plan": {"durationSec": round(plan["durationSec"], 3), "sfxCues": len(plan["sfx"]), "speechSpans": len(plan["bed"]["speech"])}}

    mp4 = decode_mp4(d / "audio-demo.mp4", d / "audio-demo.mp4.decoded.wav")
    report["mp4"] = {**level_summary(mp4), "ffmpegEbur128": ffmpeg_ebur128(d / "audio-demo.mp4")}
    m = report["mp4"]
    check("mp4 loudness -14 +-1 LUFS", abs(m["integratedLufs"] - TARGET_I) <= TOL_I and abs(m["ffmpegEbur128"]["integratedLufs"] - TARGET_I) <= TOL_I,
          f"{m['integratedLufs']} LUFS (ffmpeg {m['ffmpegEbur128']['integratedLufs']})")
    check("mp4 true peak <= -1 dBTP", m["truePeakDbtp"] <= CEIL_TP and m["ffmpegEbur128"]["truePeakDbtp"] <= CEIL_TP,
          f"{m['truePeakDbtp']} dBTP (ffmpeg {m['ffmpegEbur128']['truePeakDbtp']})")
    check("mp4 length 30-45 s", 30 <= m["durationSec"] <= 45, f"{m['durationSec']} s")

    report["masteredWav"] = {**level_summary(read(d / "audio-demo.wav")), "ffmpegEbur128": ffmpeg_ebur128(d / "audio-demo.wav")}
    if (d / "audio-demo.raw.mp4").exists():
        raw = decode_mp4(d / "audio-demo.raw.mp4", d / "audio-demo.raw.mp4.decoded.wav")
        report["rawMp4"] = {**level_summary(raw), "note": "Remotion's own mix before the master step"}
    mix = read(d / "audio-demo.premaster.wav")
    report["premasterWav"] = level_summary(mix)

    stems = {k: read(d / f"stem-{k}.wav") for k in ("voice", "bed", "stings", "sfx")}
    n = min(mix.shape[1], *(s.shape[1] for s in stems.values()))
    total = sum(s[:, :n] for s in stems.values())
    res = mix[:, :n] - total
    report["nullTest"] = {"residualRmsDbfs": round(db(np.sqrt(np.mean(res ** 2))), 2), "residualPeakDbfs": round(db(np.abs(res).max()), 2)}
    check("stems sum to the mix", report["nullTest"]["residualPeakDbfs"] < -80, f"residual peak {report['nullTest']['residualPeakDbfs']} dBFS")
    report["stems"] = {k: level_summary(v) for k, v in stems.items()}

    rest = stems["bed"][:, :n] + stems["stings"][:, :n] + stems["sfx"][:, :n]
    report["voiceOnTop"] = voice_on_top(stems["voice"][:, :n], rest, plan)
    v = report["voiceOnTop"]
    check("voice on top: band-audibility index >= 0.75", v["index"] >= INDEX_MIN, f"index {v['index']} (P10 {v['indexP10']})")
    check("voice on top: >= 10 LU over everything else under speech", v["voiceOverRestLu"] >= VOICE_OVER_MIN_LU, f"{v['voiceOverRestLu']} LU")

    want, seam = ideal_bed(plan)
    s0 = int(plan["bed"]["startSample"])
    got = stems["bed"][:, s0:s0 + want.shape[1]]
    r = got - want[:, :got.shape[1]]
    win = r[:, max(0, seam - 2400):seam + 2400]
    report["bedVsPlan"] = {"residualRmsDbfs": round(db(np.sqrt(np.mean(r ** 2))), 2), "residualPeakDbfs": round(db(np.abs(r).max()), 2),
                           "loopSeamAtSec": round((s0 + seam) / SR, 3), "residualPeakAtSeamDbfs": round(db(np.abs(win).max()), 2) if win.size else None}
    check("bed = its per-sample plan (16-bit floor)", report["bedVsPlan"]["residualPeakDbfs"] < -80, f"residual peak {report['bedVsPlan']['residualPeakDbfs']} dBFS, at the loop seam {report['bedVsPlan']['residualPeakAtSeamDbfs']}")

    report["sfxSync"] = sfx_sync(plan, stems["sfx"])
    check("every SFX on its planned sample (+-1 ms)", report["sfxSync"]["worstOffsetMs"] <= 1.0, f"worst {report['sfxSync']['worstOffsetMs']} ms over {report['sfxSync']['cues']} cues")

    report["sections"] = section_loudness(mix, plan)
    report["checks"] = checks
    report["pass"] = all(c["pass"] for c in checks)
    out = Path(a.json) if a.json else d / "report.json"
    out.write_text(json.dumps(report, indent=1) + "\n")
    for c in checks:
        print(("PASS " if c["pass"] else "FAIL ") + c["check"] + ": " + c["detail"])
    print(f"report -> {out}")
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
