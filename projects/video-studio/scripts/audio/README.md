# scripts/audio: the audio engine

Music beds, stings and SFX made in code, mixed, mastered and measured. Full guide: [`docs/AUDIO.md`](../../docs/AUDIO.md). Licences and evidence: [`docs/AUDIO_LICENSES.md`](../../docs/AUDIO_LICENSES.md).

```bash
scripts/audio/setup.sh                                   # once per machine (idempotent)
python3 scripts/audio/render_reference.py                # 20 s reference trio -> out/audio/reference/
python3 scripts/audio/metrics.py FILE.wav --profile standalone|sting|bed|sfx [--loop]
python3 scripts/audio/duck.py --bed BED.wav --voice NARRATION.wav --out DUCKED.wav [--frames GAIN.json]
.venv-audio/bin/python -m unittest discover -s scripts/audio/tests -t scripts/audio
```

| Path | Owner |
| --- | --- |
| `audiolib/`, `*.py`, `setup.sh`, `requirements.txt`, `targets.json`, `tests/` | audio engine |
| `music/` | composer |
| `sfx/` | sound designer |
