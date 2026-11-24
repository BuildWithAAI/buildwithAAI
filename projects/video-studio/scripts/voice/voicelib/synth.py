"""Kokoro v1.0 (kokoro-onnx 0.6.1) wrapper. Refuses to run on model files whose sha256 differs from
the pinned release assets (the same pins setup.sh downloads against).

Phonemes are always passed with is_phonemes=True: the G2P runs in g2p.py, so the exact phoneme string
(and therefore the timing of every character) is known.
"""

import hashlib
import os
from dataclasses import dataclass

MODEL_FILE = "kokoro-v1.0.int8.onnx"
VOICES_FILE = "voices-v1.0.bin"
PINS = {
    MODEL_FILE: (114_119_327, "ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c"),
    VOICES_FILE: (28_214_398, "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"),
}
SAMPLE_RATE = 24000


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(model_dir: str) -> dict[str, str]:
    """sha256 of both model files; raises if missing or not the pinned bytes."""
    out = {}
    for name, (size, digest) in PINS.items():
        path = os.path.join(model_dir, name)
        if not os.path.isfile(path):
            raise RuntimeError(f"{path} is missing. Run scripts/voice/setup.sh to download the Kokoro model files.")
        if os.path.getsize(path) != size:
            raise RuntimeError(f"{path} is {os.path.getsize(path)} bytes, expected {size}. Delete it and run scripts/voice/setup.sh.")
        got = sha256(path)
        if got != digest:
            raise RuntimeError(f"{path} sha256 {got} does not match the pinned {digest}. Refusing to use it.")
        out[name] = got
    return out


@dataclass
class Take:
    audio: object  # numpy float32 array, mono, SAMPLE_RATE
    timings: list[tuple[str, float, float]]  # (phoneme char, start s, end s)
    speed: float

    @property
    def ms(self) -> float:
        return len(self.audio) * 1000.0 / SAMPLE_RATE


class Synth:
    def __init__(self, model_dir: str):
        self.digests = verify(model_dir)
        from kokoro_onnx import Kokoro

        self.kokoro = Kokoro(os.path.join(model_dir, MODEL_FILE), os.path.join(model_dir, VOICES_FILE))
        if not self.kokoro.has_timings:
            raise RuntimeError("this Kokoro export has no duration output, so it cannot report phoneme timings")
        self.voices = set(self.kokoro.get_voices())

    def check_voice(self, voice: str) -> None:
        if voice not in self.voices:
            raise ValueError(f"voice {voice!r} is not in {VOICES_FILE}; male voices: " + ", ".join(sorted(v for v in self.voices if v[1:2] == "m")))

    def speak(self, phonemes: str, voice: str, speed: float) -> Take:
        audio, sr, timings = self.kokoro.create_timed(phonemes, voice, speed=speed, lang="en-us", is_phonemes=True)
        if sr != SAMPLE_RATE:
            raise RuntimeError(f"unexpected sample rate {sr}")
        return Take(audio, [(t.phoneme, t.start, t.end) for t in timings], speed)


def char_times(phonemes: str, timings: list[tuple[str, float, float]]) -> list[tuple[float, float] | None]:
    """Timing of each character of `phonemes`. kokoro-onnx returns one timing per vocabulary character,
    except the space it drops where it splits a long text into batches."""
    out: list[tuple[float, float] | None] = [None] * len(phonemes)
    i = 0
    for ch, start, end in timings:
        while i < len(phonemes) and phonemes[i] != ch and phonemes[i] == " ":
            i += 1
        if i >= len(phonemes) or phonemes[i] != ch:
            raise ValueError(f"Kokoro timings diverge from the phoneme string at {i}: {ch!r}")
        out[i] = (start, end)
        i += 1
    return out
