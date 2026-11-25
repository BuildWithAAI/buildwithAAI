#!/usr/bin/env bash
# Build, render and measure the AudioDemo (src/audio/demo). Run from anywhere; a few minutes (the MP4 dominates).
#   src/audio/tools/demo.sh    # voice (if missing), plan, WAV master + 4 stems, MP4, measurement (exit 1 if a check fails)
# Outputs in out/audio/integration/ (gitignored): audio-demo.mp4 (delivered, mastered), audio-demo.wav (the mastered mix,
# 48 kHz 24-bit), audio-demo.raw.mp4 + audio-demo.premaster.wav (Remotion's own mix), stem-*.wav, plan.json, bed_gains.f32,
# master.json, report.json.
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=out/audio/integration
NARR=generated/zoora-security/_audio-demo/en
CFG=src/audio/remotion.wav.config.ts
mkdir -p "$OUT"

if [ ! -f "public/$NARR/timeline.json" ]; then
	echo "== voice: Kokoro im_nicola (two lines)"
	.venv-voice/bin/python scripts/voice/build.py src/audio/dev/fixtures/zoora-security/_audio-demo --lang en --voice im_nicola
fi

echo "== plan"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/audio/tools/plan_dump.ts "$NARR" "$OUT"

echo "== bundle"
BUNDLE="$OUT/bundle"
rm -rf "$BUNDLE"
npx remotion bundle src/audio/index.ts --out-dir="$BUNDLE" --log=error >/dev/null

render_wav() { # $1 output, $2 props json
	npx remotion render "$BUNDLE" AudioDemo "$1" --codec=wav --config="$CFG" --props="$2" --log=error
}

echo "== render: the mix (lossless) and its stems"
render_wav "$OUT/audio-demo.premaster.wav" "{\"narrationDir\":\"$NARR\",\"stems\":null}"
for s in voice bed stings sfx; do
	render_wav "$OUT/stem-$s.wav" "{\"narrationDir\":\"$NARR\",\"stems\":[\"$s\"]}"
done

echo "== render: MP4 (project config: PNG frames, CRF 12, H.264 + AAC; Remotion's own mix)"
npx remotion render "$BUNDLE" AudioDemo "$OUT/audio-demo.raw.mp4" --props="{\"narrationDir\":\"$NARR\",\"stems\":null}" --log=error
rm -rf "$BUNDLE"

echo "== master: -14 LUFS-I, true-peak limited, AAC as Remotion encodes it, video copied"
.venv-audio/bin/python src/audio/tools/master_mix.py --wav "$OUT/audio-demo.premaster.wav" --video "$OUT/audio-demo.raw.mp4" \
	--out "$OUT/audio-demo.mp4" --wav-out "$OUT/audio-demo.wav" --report "$OUT/master.json"

echo "== measure"
.venv-audio/bin/python src/audio/tools/measure_mix.py --dir "$OUT"
