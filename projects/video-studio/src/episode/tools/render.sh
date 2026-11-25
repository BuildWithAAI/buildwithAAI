#!/usr/bin/env bash
# Render one Episode or EpisodeShort through the audio pipeline, from projects/video-studio:
#
#   src/episode/tools/render.sh <channel>/<slug> --lang <lang> [--short <id>] [--bundle <dir>] --out <path>.mp4
#   src/episode/tools/render.sh <channel>/<slug> --lang <lang> --audio-track [--bundle <dir>] --out <path>.m4a   # a dub's audio track
#
#   1. plan      the audio-plan CLI writes <out>.audio-plan.json and <out>.cues.md and prints the plan's hash;
#   2. picture   Remotion renders the picture WITHOUT audio and writes the mix beside it, lossless (--separate-audio-to:
#                pcm-16, the same audio path as --codec=wav), in one pass; the render refuses to start unless its own
#                plan has the same hash (a stale bundle, or a storyboard or timeline changed in between);
#   3. voice     the voice stem: the same composition with only the narration, no picture, no fonts;
#   4. master    src/audio/tools/master_mix.py: 20 Hz high-pass, -14 LUFS-I, true-peak limiter, libfdk_aac 320 kb/s,
#                the video stream copied, re-measured after the encode and after AAC/Opus 128 kb/s re-encodes;
#   5. gate      src/episode/tools/audio_check.py: the render is the plan (a null test), Zoo on top, the duck follows
#                the voice, voice-free changes and transitions, the effects, the delivery (<out>.audio.json).
#
# Only <out> has sound (the picture render has none), so an unmastered mix cannot be shipped by mistake. Keep the
# reports with the delivery: <out>.master.json, <out>.audio.json, <out>.cues.md (the owner listens with the cue sheet).
# Bundle AFTER the voice step (the bundle copies public/), once per batch: npx remotion bundle src/episode/index.ts --out-dir=<dir>
# Exit: 0 delivered and passed (warnings allowed); 1 the gate failed (files kept, the report path printed); 2 bad input or
# a step failed.
set -euo pipefail
cd "$(dirname "$0")/../../.."

usage() { echo "usage: $0 <channel>/<slug> --lang <lang> [--short <id>] [--audio-track] [--bundle <dir>] --out <path>.mp4|.m4a" >&2; exit 2; }
TARGET="" LANG_="" SHORT="" BUNDLE="" OUT="" TRACK=0
while [ $# -gt 0 ]; do
	case "$1" in
		--lang) LANG_="${2:-}"; shift 2 ;;
		--short) SHORT="${2:-}"; shift 2 ;;
		--bundle) BUNDLE="${2:-}"; shift 2 ;;
		--out) OUT="${2:-}"; shift 2 ;;
		--audio-track) TRACK=1; shift ;;
		-*) usage ;;
		*) TARGET="$1"; shift ;;
	esac
done
[[ "$TARGET" =~ ^[^/]+/[^/]+$ ]] && [ -n "$LANG_" ] && [ -n "$OUT" ] || usage
CHANNEL="${TARGET%%/*}" SLUG="${TARGET#*/}"
if [ "$TRACK" = 1 ]; then
	[ -z "$SHORT" ] || { echo "render: --audio-track is for the Episode, not a Short" >&2; exit 2; }
	[[ "$OUT" == *.m4a || "$OUT" == *.wav ]] || { echo "render: an audio track is delivered as .m4a or .wav" >&2; exit 2; }
else
	[[ "$OUT" == *.mp4 ]] || { echo "render: the delivery is an .mp4 (or use --audio-track)" >&2; exit 2; }
fi
# every derived path is absolute and resolved once (critic F16: Remotion resolves a relative --separate-audio-to
# against the Remotion root, and "$PWD/" broke an absolute --out)
OUT_ABS="$(realpath -m "$OUT")"
O="${OUT_ABS%.*}"
mkdir -p "$(dirname "$OUT_ABS")"
COMP=Episode
[ -n "$SHORT" ] && COMP=EpisodeShort
NODE=(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON)
WAVCFG=src/audio/remotion.wav.config.ts

echo "== plan"
PLAN_ARGS=("$TARGET" --lang "$LANG_" --out "$O.audio-plan.json" --cues "$O.cues.md")
[ -n "$SHORT" ] && PLAN_ARGS+=(--short "$SHORT")
PLAN_LOG="$("${NODE[@]}" src/episode/dev/audioPlan.ts "${PLAN_ARGS[@]}")" || { echo "$PLAN_LOG" >&2; exit 2; }
echo "$PLAN_LOG" | sed '$d'
HASH="$(echo "$PLAN_LOG" | tail -1)"
[[ "$HASH" =~ ^[0-9a-f]{64}$ ]] || { echo "render: the audio-plan CLI printed no hash" >&2; exit 2; }

CLEAN_BUNDLE=""
if [ -z "$BUNDLE" ]; then
	echo "== bundle (pass --bundle to reuse one across renders)"
	BUNDLE="$(mktemp -d)/bundle"
	CLEAN_BUNDLE="$(dirname "$BUNDLE")"
	npx remotion bundle src/episode/index.ts --out-dir="$BUNDLE" --log=error >/dev/null
fi
cleanup() { [ -n "$CLEAN_BUNDLE" ] && rm -rf "$CLEAN_BUNDLE"; return 0; }
trap cleanup EXIT

props() { # $1: extra JSON members (may be empty)
	local p="{\"channel\":\"$CHANNEL\",\"slug\":\"$SLUG\",\"lang\":\"$LANG_\",\"audioPlanHash\":\"$HASH\""
	[ -n "$SHORT" ] && p="$p,\"shortId\":\"$SHORT\""
	[ -n "${1:-}" ] && p="$p,$1"
	echo "$p}"
}

T0=$SECONDS
if [ "$TRACK" = 1 ]; then
	echo "== mix (audio only, lossless)"
	npx remotion render "$BUNDLE" "$COMP" "$O.mix.wav" --codec=wav --config="$WAVCFG" --props="$(props)" --log=error || exit 2
else
	echo "== picture (no audio) + the lossless mix beside it"
	npx remotion render "$BUNDLE" "$COMP" "$O.picture.mp4" --separate-audio-to="$O.mix.wav" --props="$(props)" --log=error || exit 2
fi
T1=$SECONDS
echo "== voice stem (no picture)"
npx remotion render "$BUNDLE" "$COMP" "$O.voice.wav" --codec=wav --config="$WAVCFG" --props="$(props '"audioStems":["voice"]')" --log=error || exit 2
T2=$SECONDS
echo "   render times: $((T1 - T0)) s for the $( [ "$TRACK" = 1 ] && echo mix || echo picture and mix ), $((T2 - T1)) s for the voice stem"

echo "== master"
MASTER=(.venv-audio/bin/python src/audio/tools/master_mix.py --wav "$O.mix.wav" --out "$OUT_ABS" --wav-out "$O.master.wav" --report "$O.master.json")
[ "$TRACK" = 1 ] || MASTER+=(--video "$O.picture.mp4")
set +e
"${MASTER[@]}"
MS=$?
set -e
[ "$MS" -le 1 ] || exit 2

echo "== gate"
GATE=(.venv-audio/bin/python src/episode/tools/audio_check.py --plan "$O.audio-plan.json" --mix "$O.mix.wav" --voice "$O.voice.wav" --delivered "$OUT_ABS" --master "$O.master.json" --report "$O.audio.json")
[ "$TRACK" = 1 ] || GATE+=(--picture "$O.picture.mp4")
set +e
"${GATE[@]}"
GS=$?
set -e
if [ "$GS" -eq 0 ] && [ "$MS" -eq 0 ]; then
	echo "render: delivered $OUT_ABS (gate passed; listen with $O.cues.md)"
	exit 0
fi
[ "$GS" -eq 2 ] && exit 2
echo "render: $OUT_ABS FAILED the gate or the master: see $O.audio.json and $O.master.json" >&2
exit 1
