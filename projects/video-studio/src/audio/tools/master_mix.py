#!/usr/bin/env python3
"""Master a rendered mix for delivery: -14 LUFS integrated, true peak under -1 dBTP after the AAC encode.

    .venv-audio/bin/python src/audio/tools/master_mix.py --wav mix.wav --video render.mp4 --out final.mp4 [--wav-out mastered.wav]
    .venv-audio/bin/python src/audio/tools/master_mix.py --wav mix.wav --out track.m4a     # audio only (a dub's audio track)

Remotion sums its tracks with no bus processing, so a mix lands wherever its parts put it (a music-heavy
demo at -16 LUFS, a talk-heavy episode near -14) and nothing guarantees the delivery ceiling when peaks
coincide. This is the bus stage a broadcast mix ends with:

  1. the rendered mix (the same composition rendered losslessly: --codec=wav, or --separate-audio-to),
     through a subsonic high-pass (2nd-order Butterworth, 20 Hz: -0.4 dB at D1 36.7 Hz, the lowest bass
     note in the music package). It removes DC: the voice step's Kokoro narration carries a DC component
     that switches on with speech (a 50 ms mean of about +0.17 while Zoo talks, 0 in pauses), which
     thumps at every phrase and wastes headroom;
  2. one static gain to -14 LUFS-I (BS.1770-4, the audio engine's meter, which agrees with ffmpeg's ebur128
     within 0.02 LU), into the engine's true-peak limiter (pedalboard BrickwallLimiter in true-peak mode,
     5 ms lookahead, verified by the engine's 4x-oversampled meter) at -1.5 dBTP; the gain is re-aimed
     (secant steps) until the LIMITED result is within 0.05 LU of the target;
  3. AAC with the encoder Remotion itself uses (libfdk_aac, 320 kb/s, 18 kHz cutoff, via `npx remotion
     ffmpeg`), muxed with the render's video stream copied untouched;
  4. the delivered MP4 is decoded and measured again; if the codec pushed the true peak over -1 dBTP the
     ceiling drops by the overshoot and steps 2-4 repeat;
  5. (added 2026-11-25, episode critic) the mastered mix is also encoded the way the platforms re-encode an upload,
     AAC-LC 128 kb/s (ffmpeg's encoder) and Opus 128 kb/s (libopus), decoded and measured: over 0 dBTP on either
     drops the ceiling and repeats too (over -0.5 dBTP is reported as a warning). Transients (whooshes, pops,
     jingle hits) overshoot more at 128 kb/s than at our 320 kb/s.

Audio-only delivery (dub audio tracks, added 2026-11-25): leave out --video and give --out a .wav (24-bit) or .m4a
(libfdk_aac 320 kb/s); every other step is the same.

Nothing else is touched: no EQ, no compression (the high-pass works below the music and the voice). On a speech-led mix the voice never reaches the limiter
(it peaks near -4 dBTP after the stereo upmix), so only stingers' and effects' transients are caught.
Prints and writes a JSON report (--report). Exit codes: 0 delivered in spec, 1 not, 2 bad input.
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

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from audiolib import loudness  # noqa: E402

SR = 48000
SUBSONIC_HZ = 20.0


# ------------------------------------------------------------------------------------------------ meters in chunks
# Added 2026-11-25 (episode audio, a 12.75-minute probe): the engine's meters and limiter verification hold whole-file
# float64 copies (the true-peak meter a 4x oversampled one: 2.4 GB for 13 minutes of stereo), so the master and the gate
# ran out of memory on a 10-minute episode. These run the same computations 10 s at a time, filter states carried
# across chunks, and return the same numbers (tests/test_tools.py compares them with audiolib's meters).
CHUNK = 10 * SR
_TP_PAD = 2048  # input samples of context around each true-peak chunk; the resampling filter reaches 16


def _ch(x) -> np.ndarray:
    a = np.asarray(x)
    return a[None, :] if a.ndim == 1 else a


def integrated_lufs(x, sr: int = SR) -> float:
    """loudness.integrated (BS.1770-4: K-weighting, 400 ms blocks every 100 ms, absolute and relative gates), in chunks."""
    from scipy.signal import sosfilt

    a = _ch(x)
    n = a.shape[1]
    win, hop = int(round(0.4 * sr)), int(round(0.1 * sr))
    if n < win:
        return float("-inf")
    sos = loudness.k_weighting_sos(sr)
    zi = np.zeros((sos.shape[0], a.shape[0], 2))
    nseg = n // hop
    seg = np.zeros(nseg)
    step = (CHUNK // hop) * hop
    for s in range(0, nseg * hop, step):
        e = min(nseg * hop, s + step)
        y, zi = sosfilt(sos, a[:, s:e].astype(np.float64), axis=1, zi=zi)
        seg[s // hop:e // hop] = (y * y).sum(axis=0).reshape(-1, hop).sum(axis=1)
    blocks = (seg[:-3] + seg[1:-2] + seg[2:-1] + seg[3:]) / win
    return loudness._gated(blocks)


def true_peak_dbtp(x, factor: int = 4) -> float:
    """loudness.true_peak (4x oversampled, the same resampling filter) in chunks with context on both sides."""
    from audiolib.dsp import oversample

    a = _ch(x)
    n = a.shape[1]
    peak = 0.0
    for s in range(0, n, CHUNK):
        e = min(n, s + CHUNK)
        s0, e0 = max(0, s - _TP_PAD), min(n, e + _TP_PAD)
        up = oversample(a[:, s0:e0].astype(np.float64), factor)
        peak = max(peak, float(np.abs(up[:, (s - s0) * factor:(e - s0) * factor]).max()), float(np.abs(a[:, s:e]).max()))
    return 20.0 * math.log10(peak) if peak > 0 else float("-inf")


def _block_peaks(a: np.ndarray, k: int) -> np.ndarray:
    n = a.shape[1] // k * k
    out = np.empty(n // k)
    step = (CHUNK // k) * k
    for s in range(0, n, step):
        e = min(n, s + step)
        out[s // k:e // k] = np.abs(a[:, s:e]).max(axis=0).reshape(-1, k).max(axis=1)
    return out


def gain_reduction(before: np.ndarray, after: np.ndarray, block_ms: float = 10.0) -> dict:
    """audiolib.dynamics.gain_reduction_stats in chunks: 10 ms block peaks before and after the limiter."""
    k = max(1, int(round(block_ms * SR / 1000)))
    pb, pc = _block_peaks(_ch(before), k), _block_peaks(_ch(after), k)
    m = min(pb.size, pc.size)
    if m == 0:
        return {"grMaxDb": 0.0, "grMeanDb": 0.0, "grOver1dBPct": 0.0}
    pb, pc = pb[:m], pc[:m]
    active = pb > 1e-6
    gr = np.zeros_like(pb)
    gr[active] = np.maximum(0.0, 20 * np.log10(pb[active] / np.maximum(pc[active], 1e-12)))
    return {"grMaxDb": round(float(gr.max()), 2), "grMeanDb": round(float(gr[active].mean()) if active.any() else 0.0, 2), "grOver1dBPct": round(100.0 * float((gr > 1.0).mean()), 2)}


def limit(audio: np.ndarray, ceiling_dbtp: float, release_ms: float = 120.0, lookahead_ms: float = 5.0, margin_db: float = 0.3, max_passes: int = 4) -> tuple[np.ndarray, dict]:
    """audiolib.dynamics.limit (pedalboard's true-peak brick-wall limiter, verified with the 4x meter and re-aimed until
    the result is under the ceiling), with float32 buffers and the chunked meters. Same algorithm, same report keys."""
    import pedalboard

    a = np.ascontiguousarray(_ch(audio), dtype=np.float32)
    internal = ceiling_dbtp - margin_db
    out = a
    tp = true_peak_dbtp(a)
    passes = 0
    if tp > ceiling_dbtp - 0.05:
        while passes < max_passes:
            passes += 1
            lim = pedalboard.BrickwallLimiter(ceiling_db=internal, release_ms=release_ms, lookahead_ms=lookahead_ms, true_peak=True)
            out = lim(a, SR)
            tp = true_peak_dbtp(out)
            if tp <= ceiling_dbtp - 0.02:
                break
            internal -= (tp - ceiling_dbtp) + 0.1
    trim = 0.0
    if tp > ceiling_dbtp - 0.02:
        trim = (ceiling_dbtp - 0.05) - tp
        out = (out * np.float32(10 ** (trim / 20))).astype(np.float32)
        tp = true_peak_dbtp(out)
    rep = gain_reduction(a, out)
    rep.update({"ceiling": ceiling_dbtp, "internalCeiling": round(internal, 3), "passes": passes, "truePeak": round(tp, 3), "trimDb": round(trim, 3)})
    return out, rep


def subsonic(x: np.ndarray, fc: float = SUBSONIC_HZ) -> np.ndarray:
    """2nd-order Butterworth high-pass (causal, as a mastering DC/subsonic filter): no DC, nothing audible lost.
    Filtered in float64, 10 s at a time with the state carried over; returned as float32."""
    from scipy.signal import butter, sosfilt

    if fc <= 0:
        return x
    a = _ch(x)
    sos = butter(2, fc, btype="highpass", fs=SR, output="sos")
    zi = np.zeros((sos.shape[0], a.shape[0], 2))
    out = np.empty(a.shape, dtype=np.float32)
    for s in range(0, a.shape[1], CHUNK):
        y, zi = sosfilt(sos, a[:, s:s + CHUNK].astype(np.float64), axis=1, zi=zi)
        out[:, s:s + CHUNK] = y
    return out


def remotion_ffmpeg(args: list[str]) -> subprocess.CompletedProcess:
    p = subprocess.run(["npx", "remotion", "ffmpeg", "-hide_banner", "-v", "error", *args], cwd=STUDIO, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {' '.join(args)}\n{p.stderr[-2000:]}")
    return p


def master_audio(x: np.ndarray, target: float, ceiling: float, release_ms: float = 80.0, tol: float = 0.05) -> tuple[np.ndarray, dict]:
    x = np.asarray(x, dtype=np.float32)
    i0 = integrated_lufs(x)
    if not math.isfinite(i0):
        raise ValueError("cannot master silence")
    g = target - i0
    tries = []
    out, rep = x, {}
    for _ in range(8):
        staged = x * np.float32(10 ** (g / 20))
        out, rep = limit(staged, ceiling, release_ms=release_ms)
        del staged
        got = integrated_lufs(out)
        tries.append((round(g, 3), round(got, 3)))
        err = target - got
        if abs(err) <= tol:
            break
        slope = 1.0
        if len(tries) >= 2 and abs(tries[-1][0] - tries[-2][0]) > 1e-6:
            slope = min(1.0, max(0.25, (tries[-1][1] - tries[-2][1]) / (tries[-1][0] - tries[-2][0])))
        g += err / slope
    return out, {"inputIntegratedLufs": round(i0, 2), "inputTruePeakDbtp": round(true_peak_dbtp(x), 2), "gainDb": round(g, 2), "gainSteps": tries,
                 "ceilingDbtp": ceiling, "limiter": rep, "integratedLufs": round(integrated_lufs(out), 2), "truePeakDbtp": round(true_peak_dbtp(out), 2)}


STREAM_CODECS = {"aac128": ["-c:a", "aac", "-b:a", "128k"], "opus128": ["-c:a", "libopus", "-b:a", "128k"]}
STREAM_FAIL_DBTP = 0.0  # a platform re-encode over full scale: the ceiling drops and the master repeats
STREAM_WARN_DBTP = -0.5


def stream_peaks(wav: Path, tmp: Path) -> dict:
    """True peak (4x oversampled) of the mastered mix after the encodes the platforms make of an upload: AAC 128 kb/s
    and Opus 128 kb/s, with the system ffmpeg. {name: {"truePeakDbtp": x}}; a codec the ffmpeg build lacks is skipped."""
    out = {}
    for name, args in STREAM_CODECS.items():
        enc = tmp / (f"{name}.m4a" if name.startswith("aac") else f"{name}.opus")
        p = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-y", "-i", str(wav), *args, str(enc)], capture_output=True, text=True)
        if p.returncode != 0:
            out[name] = {"skipped": p.stderr.strip()[-300:]}
            continue
        out[name] = {"truePeakDbtp": measure_mp4(enc, tmp)["truePeakDbtp"]}
    return out


def stream_summary(streams: dict) -> str:
    """One line for the log: "aac128 -1.6 dBTP, opus128 -1.4 dBTP"."""
    parts = []
    for name, v in streams.items():
        parts.append(f"{name} {v['truePeakDbtp']} dBTP" if "truePeakDbtp" in v else f"{name} skipped")
    return ", ".join(parts)


def measure_mp4(path: Path, tmp: Path) -> dict:
    # decode with the system ffmpeg: Remotion's build has no float PCM encoder, and a 16-bit decode would round the peaks
    dec = tmp / "decoded.wav"
    p = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-y", "-i", str(path), "-vn", "-c:a", "pcm_f32le", "-ar", str(SR), str(dec)], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"could not decode {path}: {p.stderr[-1000:]}")
    y, sr = sf.read(str(dec), always_2d=True, dtype="float32")
    y = y.T
    return {"integratedLufs": round(integrated_lufs(y), 2), "truePeakDbtp": round(true_peak_dbtp(y), 2), "durationSec": round(y.shape[1] / SR, 3)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--wav", required=True, help="the rendered mix, lossless (Remotion --codec=wav)")
    ap.add_argument("--video", help="the rendered MP4 (its video stream is copied); omit for an audio-only delivery")
    ap.add_argument("--out", required=True, help="the delivered MP4 (with --video), else a .wav (24-bit) or .m4a (AAC 320 kb/s)")
    ap.add_argument("--wav-out", help="also write the mastered mix here (48 kHz, 24-bit)")
    ap.add_argument("--target", type=float, default=-14.0)
    ap.add_argument("--ceiling", type=float, default=-1.5, help="limiter ceiling before the codec (dBTP)")
    ap.add_argument("--delivery-ceiling", type=float, default=-1.0, help="true peak the delivered MP4 must stay under (dBTP)")
    ap.add_argument("--bitrate", default="320k")
    ap.add_argument("--subsonic-hz", type=float, default=SUBSONIC_HZ, help="high-pass corner before mastering (0 = off)")
    ap.add_argument("--report", help="write the JSON report here")
    ap.add_argument("--no-stream-check", action="store_true", help="skip the AAC 128k / Opus 128k re-encode peak check")
    a = ap.parse_args(argv)
    audio_only = a.video is None
    if audio_only and not a.out.lower().endswith((".wav", ".m4a")):
        print(f"master: without --video the output must be a .wav or .m4a, not {a.out}", file=sys.stderr)
        return 2
    try:
        x, sr = sf.read(a.wav, always_2d=True, dtype="float32")
    except (RuntimeError, OSError) as e:
        print(f"master: cannot read {a.wav}: {e}", file=sys.stderr)
        return 2
    if sr != SR:
        print(f"master: {a.wav} is {sr} Hz, expected {SR}", file=sys.stderr)
        return 2
    x = x.T
    if x.shape[0] == 1:
        x = np.vstack([x, x]) * math.sqrt(0.5)
    dc_in = float(np.abs(x.mean(axis=1)).max())
    x = subsonic(x, a.subsonic_hz)
    ceiling = a.ceiling
    rounds = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for _ in range(5):
            y, rep = master_audio(x, a.target, ceiling)
            wav = tmp / "mastered.wav"
            sf.write(str(wav), y.T, SR, subtype="PCM_24")
            if not audio_only:
                remotion_ffmpeg(["-y", "-i", a.video, "-i", str(wav), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "libfdk_aac", "-b:a", a.bitrate,
                                 "-cutoff", "18000", "-movflags", "+faststart", a.out])
            elif a.out.lower().endswith(".m4a"):
                # Remotion's ffmpeg has the mp4 muxer but not ipod, the one ffmpeg picks for .m4a: name it
                remotion_ffmpeg(["-y", "-i", str(wav), "-c:a", "libfdk_aac", "-b:a", a.bitrate, "-cutoff", "18000", "-movflags", "+faststart", "-f", "mp4", a.out])
            else:
                sf.write(a.out, y.T, SR, subtype="PCM_24")
            got = measure_mp4(Path(a.out), tmp)
            streams = {} if a.no_stream_check else stream_peaks(wav, tmp)
            rounds.append({"master": rep, "delivered": got, "streams": streams})
            over = got["truePeakDbtp"] - a.delivery_ceiling
            stream_tp = max((v["truePeakDbtp"] for v in streams.values() if "truePeakDbtp" in v), default=-math.inf)
            stream_over = stream_tp - STREAM_FAIL_DBTP
            if over <= -0.05 and stream_over <= 0:
                break
            # a codec overshot (ours, or a platform's re-encode over full scale): aim the limiter lower and redo
            ceiling -= max(over + 0.1 if over > -0.05 else 0.0, stream_over + 0.1 if stream_over > 0 else 0.0)
        if a.wav_out:
            sf.write(a.wav_out, y.T, SR, subtype="PCM_24")
    final = rounds[-1]["delivered"]
    streams = rounds[-1]["streams"]
    stream_tp = max((v["truePeakDbtp"] for v in streams.values() if "truePeakDbtp" in v), default=None)
    ok = abs(final["integratedLufs"] - a.target) <= 0.5 and final["truePeakDbtp"] <= a.delivery_ceiling and (stream_tp is None or stream_tp <= STREAM_FAIL_DBTP)
    warnings = [f"{k}: true peak {v['truePeakDbtp']} dBTP after a platform-style re-encode (warn over {STREAM_WARN_DBTP})"
                for k, v in streams.items() if v.get("truePeakDbtp", -math.inf) > STREAM_WARN_DBTP]
    report = {"target": {"integratedLufs": a.target, "deliveryCeilingDbtp": a.delivery_ceiling, "codec": f"libfdk_aac {a.bitrate}" if not a.out.lower().endswith(".wav") else "pcm 24-bit",
                         "streamFailDbtp": STREAM_FAIL_DBTP, "streamWarnDbtp": STREAM_WARN_DBTP},
              "audioOnly": audio_only,
              "subsonic": {"hz": a.subsonic_hz, "order": 2, "dcInMax": round(dc_in, 6), "dcOutMax": round(float(np.abs(y.mean(axis=1)).max()), 7)},
              "rounds": rounds, "warnings": warnings, "ok": ok}
    if a.report:
        Path(a.report).write_text(json.dumps(report, indent=1) + "\n")
    m = rounds[-1]["master"]
    lim = m["limiter"]
    print(f"master: {m['inputIntegratedLufs']} LUFS / {m['inputTruePeakDbtp']} dBTP in -> gain {m['gainDb']:+.2f} dB, limiter max {lim.get('grMaxDb', 0)} dB "
          f"(>1 dB on {lim.get('grOver1dBPct', 0)}% of 10 ms blocks) -> {final['integratedLufs']} LUFS / {final['truePeakDbtp']} dBTP delivered"
          + (f"; platform re-encodes {stream_summary(streams)}" if streams else "")
          + f" ({'ok' if ok else 'OUT OF SPEC'})")
    for w in warnings:
        print(f"master: warning: {w}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
