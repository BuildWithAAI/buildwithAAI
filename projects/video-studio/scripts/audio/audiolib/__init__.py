"""audiolib: the studio's code-only audio engine (music beds, stings, SFX building blocks).

Modules (import what you need):
    core      constants (SR = 48000), dB helpers, note names, seeded RNG
    io        WAV read/write (24-bit, TPDF dither), high-quality resampling
    dsp       EQ (RBJ biquads, Butterworth, Linkwitz-Riley), fades, pan, width, saturation, loops
    dynamics  linked-stereo compressor, verified true-peak limiter
    loudness  BS.1770-4 / EBU R128 (integrated, short-term, momentary, LRA, true peak)
    synth     PolyBLEP oscillators, noise, ADSR, LFO, SVF/ladder filters, pad/sub/riser/kick voices
    midi      Score / Part / Note, GM programs and drum keys, MIDI export (mido)
    theory    chord symbols, scales, voice-led voicings
    humanize  timing/velocity variance, swing, accents, rolled chords
    fluid     fluidsynth stem rendering (one stem per part, 48 kHz float)
    sampler   VCSL / WAV multisample and one-shot playback, drum kits with chokes
    reverb    synthesised-IR convolution reverb (room, plate, hall, cathedral)
    mix       channel strips + bus (reverb send, glue compressor, pedalboard inserts)
    master    presets bed / sting / standalone, export (24-bit WAV + AAC preview + report)
    analysis  the measurements behind scripts/audio/metrics.py

Scripts outside scripts/audio (e.g. scripts/audio/music/*.py) do:
    import sys, pathlib; sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    from audiolib.venv import ensure_venv; ensure_venv()   # re-exec inside .venv-audio
"""

__version__ = "1.0.0"
