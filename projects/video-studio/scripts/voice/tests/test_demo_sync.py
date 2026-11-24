"""Lip sync and clicks on the built engine demo (content/zoora-ai/_engine-demo), measured on what the viewer hears.

For en, es and pt-br, when public/generated/zoora-ai/_engine-demo/<lang>/ exists (it is generated and gitignored; the
test skips otherwise):
  - at every phrase end followed by 11+ quiet frames, the last open mouth frame is within 2 frames of the last voiced
    frame (the 2026-11-24 review measured 5-10 frames late at all 28 phrase ends);
  - every phrase onset the mouth was closed before opens 0-2 frames ahead of the sound (LP3: 1 frame ahead;
    the review measured up to 3 frames late); a phrase that starts with m/b/p may press the lips 1-4 frames ahead (LP3);
  - no sample next to digital silence is louder than -50 dBFS (the review found 20 ticks at -38 to -41 dBFS in pt-br).
Voiced = within 28 dB of the scene's loudest frame (voicelib/visemes.sync_landmarks). Stdlib only.
"""

import array
import json
import math
import os
import unittest
import wave

from voicelib import visemes

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DEMO = os.path.join(PROJECT, "public", "generated", "zoora-ai", "_engine-demo")
LANGS = ("en", "es", "pt-br")


def read_pcm16(path: str) -> tuple[array.array, int]:
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            raise ValueError(f"{path}: expected mono 16-bit PCM")
        sr = w.getframerate()
        data = array.array("h")
        data.frombytes(w.readframes(w.getnframes()))
    return data, sr


def frame_db(samples: array.array, start: int, n_frames: int, per: int) -> list[float]:
    out = []
    for f in range(n_frames):
        seg = samples[start + f * per : start + (f + 1) * per]
        p = sum(v * v for v in seg) / max(1, len(seg)) / (32768.0 * 32768.0)
        out.append(10 * math.log10(p) if p > 0 else -180.0)
    return out


def edge_steps(samples: array.array, sr: int, min_zero: int) -> list[tuple[float, float]]:
    out = []
    n = len(samples)
    i = 0
    while i < n:
        if samples[i] != 0:
            i += 1
            continue
        j = i
        while j < n and samples[j] == 0:
            j += 1
        if j - i >= min_zero:
            for e in (i - 1, j):
                if 0 <= e < n and samples[e] != 0:
                    out.append((e / sr, 20 * math.log10(abs(samples[e]) / 32768.0)))
        i = j
    return out


class DemoSync(unittest.TestCase):
    def built(self, lang: str) -> str:
        d = os.path.join(DEMO, lang)
        if not (os.path.isfile(os.path.join(d, "timeline.json")) and os.path.isfile(os.path.join(d, "narration.wav"))):
            self.skipTest(f"the {lang} demo is not built (python scripts/voice/build.py content/zoora-ai/_engine-demo --lang {lang} --voice im_nicola)")
        return d

    def test_mouth_closes_and_opens_with_the_voice(self):
        for lang in LANGS:
            with self.subTest(lang=lang):
                d = self.built(lang)
                with open(os.path.join(d, "timeline.json"), encoding="utf-8") as fh:
                    tl = json.load(fh)
                pcm, sr = read_pcm16(os.path.join(d, "narration.wav"))
                per = sr // tl["fps"]
                ends = starts = 0
                for sc in tl["scenes"]:
                    n = len(sc["mouth"])
                    fdb = frame_db(pcm, sc["startMs"] * sr // 1000, n, per)
                    sync = visemes.sync_landmarks(sc["mouth"], fdb)
                    ends += len(sync["offsets"])
                    starts += len(sync["onsets"])
                    self.assertTrue(all(abs(x) <= 2 for x in sync["offsets"]), (lang, sc["id"], "phrase-end lags", sync["offsets"]))
                    self.assertTrue(all(-2 <= x <= 0 for x in sync["onsets"]), (lang, sc["id"], "onset lags", sync["onsets"]))
                    # m/b/p-initial phrases: the lips press 1-4 frames before the release (LP3)
                    self.assertTrue(all(-4 <= x <= 0 for x in sync["mbpOnsets"]), (lang, sc["id"], "mbp onset lags", sync["mbpOnsets"]))
                    starts += len(sync["mbpOnsets"])
                self.assertGreaterEqual(ends, 7, f"{lang}: too few phrase ends measured ({ends})")
                self.assertGreaterEqual(starts, 7, f"{lang}: too few phrase onsets measured ({starts})")

    def test_no_tick_at_silence_edges(self):
        for lang in LANGS:
            with self.subTest(lang=lang):
                d = self.built(lang)
                pcm, sr = read_pcm16(os.path.join(d, "narration.wav"))
                loud = [s for s in edge_steps(pcm, sr, sr // 1000) if s[1] > -50.0]
                self.assertEqual(loud, [], f"{lang}: steps into or out of digital silence louder than -50 dBFS")


if __name__ == "__main__":
    unittest.main()
