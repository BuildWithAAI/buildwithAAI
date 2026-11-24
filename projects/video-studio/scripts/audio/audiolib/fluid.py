"""Render GM parts through fluidsynth, one stem per part, at 48 kHz.

Each stem is its own fluidsynth run (one MIDI file holding the tempo track and that part), so
every stem can be processed on its own strip in the mix. Settings:
- 48 kHz, 32-bit float output (no clipping or quantisation inside the renderer);
- fluidsynth's own reverb and chorus OFF (the mix bus adds a better reverb);
- 7th-order interpolation (`interp 7`; the default is 4th order), polyphony 1024;
- every track is extended by `tail` seconds so release tails are rendered, and the result is cut
  or padded to exactly the requested length, so all stems line up sample for sample.
Measured on fluidsynth 2.3.4: a note at time 0 starts 70 samples (1.5 ms) into the file; the
same offset applies to every fluidsynth stem, so they stay aligned with each other.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from .core import SR, as_stereo, pad_to
from .midi import GM, Score
from .paths import soundfont

INTERP = 7
DEFAULT_GAIN = 0.5


def need_fluidsynth() -> str:
    exe = shutil.which("fluidsynth")
    if not exe:
        raise RuntimeError("fluidsynth not found: run scripts/audio/setup.sh")
    return exe


def render_midi(midi_path, soundfont_path, out_wav, sr: int = SR, gain: float = DEFAULT_GAIN, polyphony: int = 1024) -> Path:
    exe = need_fluidsynth()
    out_wav = Path(out_wav)
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".cfg", delete=False) as cfg:
        cfg.write(f"interp {INTERP}\n")
        cfg_path = cfg.name
    try:
        cmd = [
            exe, "-q", "-n", "-i", "-R", "0", "-C", "0",
            "-r", str(sr), "-g", f"{gain:.4f}",
            "-o", f"synth.polyphony={polyphony}", "-o", "synth.lock-memory=0", "-o", "synth.cpu-cores=1",
            "-O", "float", "-T", "wav", "-F", str(out_wav), "-f", cfg_path,
            str(soundfont_path), str(midi_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "LANG": "C"})
    finally:
        os.unlink(cfg_path)
    err = (proc.stderr or "") + (proc.stdout or "")
    if proc.returncode != 0 or not out_wav.exists():
        raise RuntimeError(f"fluidsynth failed ({proc.returncode}): {err[-1500:]}")
    bad = [ln for ln in err.splitlines() if "error" in ln.lower() and "jack" not in ln.lower()]
    if bad:
        raise RuntimeError("fluidsynth reported errors:\n" + "\n".join(bad[:10]))
    return out_wav


def render_part(score: Score, name: str, length: float, tail: float = 3.0, sr: int = SR, gain: float = DEFAULT_GAIN, workdir=None) -> np.ndarray:
    """Render one GM part to a stereo stem of exactly `length` seconds."""
    from .io import read

    part = score.parts[name]
    if not isinstance(part.instrument, GM):
        raise TypeError(f"part {name!r} is not a GM part")
    sf = soundfont(part.instrument.soundfont)
    tmp = Path(workdir) if workdir else Path(tempfile.mkdtemp(prefix="fluid-"))
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        mid = score.save_midi(tmp / f"{name}.mid", parts=[name], tail_seconds=tail)
        wav = render_midi(mid, sf.path, tmp / f"{name}.wav", sr=sr, gain=gain)
        audio = as_stereo(read(wav, sr=sr))
    finally:
        if not workdir:
            shutil.rmtree(tmp, ignore_errors=True)
    return pad_to(audio, int(round(length * sr)))


def split_drums(score: Score, name: str, groups: dict) -> list:
    """Split a GM drum part into sub-parts by key, e.g. {"kick": [35, 36], "snare": [37, 38, 40],
    "hats": [42, 44, 46]}, so each drum gets its own stem and strip. Keys not listed stay in a
    '<name>_rest' part (dropped when empty). Hi-hats must stay together: the open hat is choked by
    the closed and pedal hats only inside one fluidsynth channel. Returns the new part names."""
    part = score.parts[name]
    used = set()
    made = []
    for sub, keys in groups.items():
        keys = set(keys)
        used |= keys
        p = part.copy(f"{name}_{sub}")
        p.notes = [n for n in p.notes if n.pitch in keys]
        score.parts[p.name] = p
        made.append(p.name)
    rest = part.copy(f"{name}_rest")
    rest.notes = [n for n in rest.notes if n.pitch not in used]
    if rest.notes:
        score.parts[rest.name] = rest
        made.append(rest.name)
    return made
