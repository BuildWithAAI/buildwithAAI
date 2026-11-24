#!/usr/bin/env python3
"""Voice step: narration -> Kokoro audio -> word timings -> ZOO's mouth shapes.

  python scripts/voice/build.py content/<channel>/<slug> --lang <lang> [--fit-to <masterLang>] [--voice <id>] [--speed 1.0]

Reads storyboard.json (or storyboard.<lang>.json) and writes public/generated/<channel>/<slug>/<lang>/:
narration.wav (loudness-normalized), timeline.json (src/episode/types.ts Timeline), scenes/<id>.wav,
phonemes.json (debug). Languages: en es pt-br hi it zh ja. Run scripts/voice/setup.sh first; this script
re-executes itself inside .venv-voice when that exists.

Exit codes: 0 ok; 1 error; 2 bad arguments; 3 --fit-to overflow (outputs written, the translation must
be shortened; see timeline.warnings and scenes[].overflowMs).
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, "..", ".."))
VENV = os.path.join(PROJECT, ".venv-voice")
VENV_PY = os.path.join(VENV, "bin", "python")


def _ensure_venv() -> None:
    in_venv = os.path.realpath(sys.prefix) == os.path.realpath(VENV)
    if in_venv or os.environ.get("VOICE_NO_REEXEC") == "1":
        return
    if os.path.exists(VENV_PY):
        os.execv(VENV_PY, [VENV_PY, os.path.abspath(__file__), *sys.argv[1:]])
    try:
        import kokoro_onnx  # noqa: F401
        import numpy  # noqa: F401
    except ImportError:
        sys.exit("voice: dependencies missing. Run scripts/voice/setup.sh first (it creates .venv-voice).")


def main(argv: list[str] | None = None) -> int:
    import argparse

    sys.path.insert(0, HERE)
    from voicelib import langs, pipeline, timing

    ap = argparse.ArgumentParser(prog="build.py", description=__doc__.split("\n\n")[0])
    ap.add_argument("content", help="content/<channel>/<slug> (holds storyboard.json / storyboard.<lang>.json)")
    ap.add_argument("--lang", required=True, choices=langs.SUPPORTED)
    ap.add_argument("--fit-to", dest="fit_to", choices=langs.SUPPORTED, help="fit every scene into this language's timeline (multi-track dubbing)")
    ap.add_argument("--voice", help="Kokoro voice id (default: ZOO's voice for the language)")
    ap.add_argument("--speed", type=float, default=1.0, help="Kokoro speed (fit mode: the starting speed, clamped to 0.85-1.15)")
    ap.add_argument("--out-root", help="public/ folder to write into (default: <project>/public)")
    ap.add_argument("--model-dir", help="folder with the Kokoro model files (default: <project>/.cache/kokoro)")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--tail-ms", type=float, default=timing.DEFAULT_TAIL_MS, help="silence after each scene's speech")
    ap.add_argument("--last-tail-ms", type=float, default=timing.DEFAULT_LAST_TAIL_MS, help="silence after the last scene's speech")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args(argv)

    content = args.content if os.path.isabs(args.content) else os.path.join(os.getcwd(), args.content)
    if not os.path.isdir(content):
        alt = os.path.join(PROJECT, args.content)
        content = alt if os.path.isdir(alt) else content
    opts = pipeline.Options(
        content_dir=content,
        lang=args.lang,
        fit_to=args.fit_to,
        voice=args.voice,
        speed=args.speed,
        out_root=args.out_root,
        model_dir=args.model_dir,
        fps=args.fps,
        tail_ms=args.tail_ms,
        last_tail_ms=args.last_tail_ms,
        log=(lambda _m: None) if args.quiet else (lambda m: print(m, flush=True)),
    )
    try:
        result = pipeline.build(opts)
    except (pipeline.BuildError, ValueError, RuntimeError, FileNotFoundError) as e:
        print(f"voice: {e}", file=sys.stderr)
        return 1
    for w in result.warnings:
        print(f"voice: warning: {w}", file=sys.stderr)
    return 3 if result.overflow else 0


if __name__ == "__main__":
    _ensure_venv()
    sys.exit(main())
