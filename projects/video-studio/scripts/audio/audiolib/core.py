"""Shared constants and small helpers.

Audio convention used everywhere in audiolib: a float64 numpy array shaped (channels, samples),
channels first, at SR = 48 kHz (the video standard; Remotion and YouTube both use 48 kHz audio).
Mono sources may be passed as 1-D arrays; `as_stereo` and `as_channels` normalise them.
"""

from __future__ import annotations

import hashlib

import numpy as np

SR = 48000
EPS = 1e-12


def db_to_lin(db):
    return np.power(10.0, np.asarray(db, dtype=np.float64) / 20.0)


def lin_to_db(x, floor_db: float = -300.0):
    x = np.abs(np.asarray(x, dtype=np.float64))
    with np.errstate(divide="ignore"):
        out = 20.0 * np.log10(np.maximum(x, EPS))
    return np.maximum(out, floor_db)


def power_to_db(p, floor_db: float = -300.0):
    p = np.asarray(p, dtype=np.float64)
    with np.errstate(divide="ignore"):
        out = 10.0 * np.log10(np.maximum(p, EPS * EPS))
    return np.maximum(out, floor_db)


def as_channels(x) -> np.ndarray:
    """Return a float64 (channels, samples) array. 1-D input becomes (1, n).

    A 2-D array whose first axis is longer than its second is assumed to be (samples, channels),
    the soundfile layout, and is transposed.
    """
    a = np.asarray(x, dtype=np.float64)
    if a.ndim == 1:
        return a[np.newaxis, :]
    if a.ndim != 2:
        raise ValueError(f"audio must be 1-D or 2-D, got shape {a.shape}")
    if a.shape[0] > a.shape[1]:
        a = a.T
    if a.shape[0] > 8:
        raise ValueError(f"more than 8 channels ({a.shape[0]}): is the layout (channels, samples)?")
    return np.ascontiguousarray(a)


def as_stereo(x) -> np.ndarray:
    a = as_channels(x)
    if a.shape[0] == 2:
        return a
    if a.shape[0] == 1:
        return np.vstack([a, a])
    raise ValueError(f"cannot make stereo from {a.shape[0]} channels")


def seconds_to_samples(seconds: float, sr: int = SR) -> int:
    return int(round(seconds * sr))


def pad_to(x: np.ndarray, n: int) -> np.ndarray:
    """Zero-pad or cut (channels, samples) audio to exactly n samples."""
    a = as_channels(x)
    if a.shape[1] == n:
        return a
    if a.shape[1] > n:
        return a[:, :n].copy()
    out = np.zeros((a.shape[0], n))
    out[:, : a.shape[1]] = a
    return out


def mix_into(dst: np.ndarray, src: np.ndarray, offset: int = 0, gain: float = 1.0) -> None:
    """Add src into dst (both (channels, samples)) starting at sample `offset`, clipped to dst's length.

    A negative offset drops the start of src. Channel counts must match, or src must be mono.
    """
    if offset >= dst.shape[1]:
        return
    s = src
    if offset < 0:
        s = s[:, -offset:]
        offset = 0
    n = min(s.shape[1], dst.shape[1] - offset)
    if n <= 0:
        return
    if s.shape[0] == 1 and dst.shape[0] > 1:
        dst[:, offset : offset + n] += gain * s[0, :n]
    else:
        dst[:, offset : offset + n] += gain * s[:, :n]


def seed_from(*parts) -> int:
    """A stable 63-bit seed from any printable parts (so renders are reproducible run to run)."""
    h = hashlib.sha256("\x1f".join(str(p) for p in parts).encode("utf-8")).digest()
    return int.from_bytes(h[:8], "big") >> 1


def rng(*parts) -> np.random.Generator:
    return np.random.default_rng(seed_from(*parts))


def rms(x) -> float:
    a = np.asarray(x, dtype=np.float64)
    return float(np.sqrt(np.mean(a * a))) if a.size else 0.0


def peak(x) -> float:
    a = np.asarray(x, dtype=np.float64)
    return float(np.max(np.abs(a))) if a.size else 0.0


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FLAT = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B", "Fb": "E", "E#": "F", "B#": "C"}


def note_number(name) -> int:
    """'C4' -> 60 (MIDI, C4 = middle C), 'F#2' -> 42, 'Bb3' -> 58. Integers pass through."""
    if isinstance(name, (int, np.integer)):
        n = int(name)
    else:
        s = str(name).strip()
        i = 1
        while i < len(s) and s[i] in "#b":
            i += 1
        pitch, octave = s[:i], s[i:]
        if not octave or not (octave.lstrip("-").isdigit()):
            raise ValueError(f"bad note name {name!r}")
        octave_n = int(octave)
        base = pitch[0].upper() + pitch[1:]
        # double sharps/flats: apply one semitone per accidental
        letter = base[0]
        if letter not in "CDEFGAB":
            raise ValueError(f"bad note name {name!r}")
        semis = NOTE_NAMES.index(letter) + base.count("#") - base.count("b")
        n = 12 * (octave_n + 1) + semis
    if not 0 <= n <= 127:
        raise ValueError(f"note {name!r} is outside MIDI 0..127")
    return n


def note_name(n: int) -> str:
    return f"{NOTE_NAMES[n % 12]}{n // 12 - 1}"


def midi_to_hz(n, a4: float = 440.0):
    return a4 * np.power(2.0, (np.asarray(n, dtype=np.float64) - 69.0) / 12.0)


def hz_to_midi(f, a4: float = 440.0):
    return 69.0 + 12.0 * np.log2(np.asarray(f, dtype=np.float64) / a4)
