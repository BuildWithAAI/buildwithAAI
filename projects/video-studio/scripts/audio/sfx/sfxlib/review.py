"""Review sheets: one PNG per family with a panel per sound, for looking at what was made.

Each panel: a log-frequency spectrogram (40 Hz-20 kHz, 90 dB range, STFT window sized to the
sound), the 30 fps frame grid (faint vertical lines every 1600 samples), the sync point (teal) and
event marks (white ticks), and under it the peak envelope in dB (-60..0 dBFS, with the -6 dBFS
line). Every panel of a sheet shares one time scale, so variations compare directly. Labels are
drawn by ffmpeg's drawtext (DejaVu Sans Mono); without ffmpeg or the font the sheet is unlabelled.
No imaging library is needed: the PNG is encoded here with zlib.
"""

from __future__ import annotations

import shutil
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path

import numpy as np

from audiolib.core import SR, as_stereo

from .core import FRAME

W = 1400
H_SPEC = 190
H_ENV = 50
LABEL_H = 22
GAP = 6
FMIN, FMAX, DRANGE = 40.0, 20000.0, 90.0
FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")

_CMAP = np.array([[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]], dtype=np.float64)
TEAL = np.array([41, 184, 173], dtype=np.float64)
SLATE = np.array([22, 26, 33], dtype=np.uint8)
SILVER = np.array([201, 206, 214], dtype=np.uint8)


def colormap(v: np.ndarray) -> np.ndarray:
    x = np.clip(v, 0.0, 1.0) * (len(_CMAP) - 1)
    i = np.minimum(np.floor(x).astype(int), len(_CMAP) - 2)
    f = (x - i)[..., None]
    return (_CMAP[i] * (1 - f) + _CMAP[i + 1] * f).astype(np.uint8)


def panel(audio, dur_s: float, sync_s: float | None = None, events_s=()) -> np.ndarray:
    mid = as_stereo(audio).mean(axis=0)
    total = max(int(round(dur_s * SR)), mid.size)
    hop = max(1, total // W)
    win = int(np.clip(4 * hop, 256, 2048)) // 2 * 2
    pad = np.concatenate([np.zeros(win // 2), mid, np.zeros(total - mid.size + win + hop * 2)])
    idx = np.arange(W)[:, None] * hop + np.arange(win)[None, :]
    frames = pad[idx] * np.hanning(win)[None, :]
    p = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    fr = np.fft.rfftfreq(win, 1 / SR)
    rows = FMAX * (FMIN / FMAX) ** (np.arange(H_SPEC) / (H_SPEC - 1))
    edges = np.sqrt(rows[:-1] * rows[1:])
    edges = np.concatenate([[rows[0] * 1.02], edges, [rows[-1] / 1.02]])
    img_p = np.zeros((H_SPEC, W))
    for r in range(H_SPEC):
        hi, lo = edges[r], edges[r + 1]
        m = (fr >= lo) & (fr < hi)
        img_p[r] = p[:, m].max(axis=1) if m.any() else _interp_rows(p, fr, rows[r])
    ref = float(img_p.max()) or 1.0
    db = 10 * np.log10(img_p / ref + 1e-30)
    img = colormap((db + DRANGE) / DRANGE)
    for f in (100, 1000, 10000):  # frequency guides
        r = int(round((H_SPEC - 1) * np.log(FMAX / f) / np.log(FMAX / FMIN)))
        img[r] = (img[r] * 0.6 + 90 * 0.4).astype(np.uint8)
    for k in range(1, total // FRAME + 1):  # 30 fps frame grid
        x = int(round(k * FRAME / hop))
        if x < W:
            img[:, x] = (img[:, x] * 0.7 + 150 * 0.3).astype(np.uint8)
    for t in events_s:
        x = int(round(t * SR / hop))
        if 0 <= x < W:
            img[:10, max(0, x - 1) : x + 2] = 255
    if sync_s is not None:
        x = int(round(sync_s * SR / hop))
        if 0 <= x < W:
            img[:, max(0, x - 1) : x + 1] = TEAL.astype(np.uint8)
    # envelope strip: peak per column in dBFS, -60..0
    envp = np.zeros(W)
    a = np.abs(mid)
    for c in range(W):
        seg = a[c * hop : (c + 1) * hop]
        envp[c] = seg.max() if seg.size else 0.0
    edb = 20 * np.log10(np.maximum(envp, 1e-9))
    strip = np.zeros((H_ENV, W, 3), dtype=np.uint8)
    strip[:] = SLATE
    hgt = np.clip((edb + 60) / 60, 0, 1) * (H_ENV - 1)
    yy = np.arange(H_ENV)[:, None]
    fill = yy >= (H_ENV - 1 - hgt)[None, :]
    strip[fill] = SILVER
    y6 = int(round((H_ENV - 1) * 6 / 60))
    strip[y6, ::4] = TEAL.astype(np.uint8)
    return np.concatenate([img, strip], axis=0)


def _interp_rows(p, fr, f):
    k = int(np.searchsorted(fr, f))
    k = min(max(k, 1), fr.size - 1)
    w = (f - fr[k - 1]) / (fr[k] - fr[k - 1])
    return p[:, k - 1] * (1 - w) + p[:, k] * w


def write_png(path, img: np.ndarray) -> Path:
    img = np.ascontiguousarray(img, dtype=np.uint8)
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    return path


def sheet(items: list, out_png) -> Path:
    """items: [{"audio", "label", "sync_s", "events_s"}]. One shared time scale (the longest)."""
    dur = max(as_stereo(it["audio"]).shape[1] for it in items) / SR
    blocks = []
    for it in items:
        lab = np.zeros((LABEL_H, W, 3), dtype=np.uint8)
        lab[:] = SLATE
        blocks += [lab, panel(it["audio"], dur, it.get("sync_s"), it.get("events_s", ())), np.full((GAP, W, 3), 255, dtype=np.uint8)]
    img = np.concatenate(blocks, axis=0)
    out = write_png(out_png, img)
    _label(out, [it["label"] + f"   [sheet scale {dur * 1000:.0f} ms]" if i == 0 else it["label"] for i, it in enumerate(items)])
    return out


def _label(png: Path, labels: list) -> None:
    if not (shutil.which("ffmpeg") and FONT.exists()):
        return
    with tempfile.TemporaryDirectory() as td:
        filters = []
        for i, text in enumerate(labels):
            tf = Path(td) / f"l{i}.txt"
            tf.write_text(text, encoding="utf-8")
            y = i * (LABEL_H + H_SPEC + H_ENV + GAP) + 4
            filters.append(f"drawtext=fontfile={FONT}:textfile={tf}:x=8:y={y}:fontsize=14:fontcolor=white")
        tmp = png.with_suffix(".tmp.png")
        proc = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(png), "-vf", ",".join(filters), "-frames:v", "1", str(tmp)], capture_output=True, text=True)
        if proc.returncode == 0:
            tmp.replace(png)
        elif tmp.exists():
            tmp.unlink()
