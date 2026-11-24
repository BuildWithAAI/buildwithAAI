"""Zoora AI voice step: narration -> Kokoro audio -> word timings -> ZOO's mouth shapes.

Entry point: scripts/voice/build.py. Modules:
  langs      language table (Kokoro voice, G2P engine, number conventions)
  markup     {display|spoken} and [src:id] narration markup
  normalize  per-language numbers, currencies, percentages, dates and symbols -> words
  words      narration -> display/spoken word list
  g2p        words -> phoneme string fed to Kokoro, with each word's phoneme span
  align      phonetic alignment of espeak's contextual output to the spoken words
  visemes    IPA phonemes -> ZOO's MouthShape track, one shape per video frame
  timing     scene durations on the frame/ms grid, fit-to-master speed maths
  audio      WAV I/O, per-frame RMS, ffmpeg two-pass loudnorm
  schema     validator for the Timeline contract (src/episode/types.ts)
  synth      Kokoro (kokoro-onnx) wrapper with model sha256 verification
  pipeline   the build itself
The pure modules (markup, normalize, words, align, visemes, timing, schema) use only the stdlib,
so their unit tests run with any Python 3.10+.
"""

__version__ = "1.0.0"
