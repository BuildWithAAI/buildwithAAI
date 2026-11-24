#!/usr/bin/env python3
"""Check music beds against Zoo's voice (composer/voicegate.py).

    python3 scripts/audio/music/voicegate.py public/audio/music/bed-show-neutral-underscore.flac [...]
    python3 scripts/audio/music/voicegate.py --make-profile public/generated/_dev/engine-demo/en/narration.wav

For each bed: the band-audibility index of the reference narration over the bed, with the planned
band-split duck and the broadband 6 dB duck, against speech-shaped noise at the same loudness, plus
the voice-over-bed loudness and the 1-4 kHz SNR. Gate: index >= 0.75 and not below the noise.
--make-profile re-measures the reference narration into voiceref/zoo-im_nicola.json.
Exit codes: 0 every bed passed (or the profile was written), 1 a bed failed, 2 bad arguments.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from audiolib.venv import ensure_venv  # noqa: E402

ensure_venv()

from audiolib import io  # noqa: E402
from composer import voicegate  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Check music beds against Zoo's voice.")
    ap.add_argument("beds", nargs="*")
    ap.add_argument("--make-profile", metavar="NARRATION", help="measure a narration WAV into the voice profile")
    ap.add_argument("--profile", default=str(voicegate.PROFILE))
    ap.add_argument("--json", action="store_true", help="print the full results as JSON")
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    if args.make_profile:
        if not Path(args.make_profile).is_file():
            print(f"voicegate: {args.make_profile} not found", file=sys.stderr)
            return 2
        doc = voicegate.make_profile(args.make_profile, args.profile)
        print(f"wrote {args.profile}: {doc['frames']} frames, {len(doc['activity'])} speech spans, voice {doc['voiceLufsUnderSpeech']} LUFS under speech")
        return 0
    if not args.beds:
        ap.print_usage(sys.stderr)
        return 2
    ok = True
    ref = voicegate.voice(args.profile)
    for b in args.beds:
        if not Path(b).is_file():
            print(f"voicegate: {b} not found", file=sys.stderr)
            return 2
        r = voicegate.evaluate(io.read(b), ref)
        passed = r["index"] >= voicegate.INDEX_MIN and r["indexMinusSsn"] >= 0
        ok &= passed
        if args.json:
            print(json.dumps({"file": b, "pass": passed, **r}))
            continue
        s, w, n = r["split"], r["broadband6"], r["ssnAtSplitLoudness"]
        print(f"{'PASS' if passed else 'FAIL'} {Path(b).name}: index {s['index']:.3f} (broadband 6 dB {w['index']:.3f}, speech-shaped noise {n['index']:.3f}); "
              f"voice over bed {s['voiceOverBedLu']} LU; 1-4 kHz SNR median {s['snr1to4kMedianDb']} dB, {100 * s['framesUnder3dB']:.0f} % of frames under 3 dB; "
              f"narrowest {s['narrowestBand']['hz']} Hz at {s['narrowestBand']['snrDb']} dB")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
