"""Voice step tests (stdlib unittest). From projects/video-studio:

    .venv-voice/bin/python -m unittest discover -s scripts/voice/tests -t scripts/voice -v

The unit tests need only the stdlib. test_e2e synthesizes real audio and needs scripts/voice/setup.sh;
it skips itself when the venv or the model files are missing. VOICE_SKIP_E2E=1 skips it on purpose,
VOICE_SAMPLES_DIR=<dir> keeps a copy of each language's narration.wav.
"""
