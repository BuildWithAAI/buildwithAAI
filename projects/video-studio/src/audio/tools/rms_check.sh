#!/usr/bin/env bash
# Proves the speech-RMS duck (<MusicBed duck={{narration}}>, read in the render tab) renders exactly the samples of the
# same duck from spans computed in Node: two audio-only renders of AudioDuckRms, compared byte for byte. About 1 minute.
#   src/audio/tools/rms_check.sh [narration under public/]
set -euo pipefail
cd "$(dirname "$0")/../../.."
NARR=${1:-generated/zoora-security/_audio-demo/en/narration.wav}
OUT=out/audio/integration/rms
CFG=src/audio/remotion.wav.config.ts
mkdir -p "$OUT"
[ -f "public/$NARR" ] || { echo "no public/$NARR: run the voice step first (src/audio/tools/demo.sh does)"; exit 2; }
BUNDLE="$OUT/bundle"
rm -rf "$BUNDLE"
npx remotion bundle src/audio/index.ts --out-dir="$BUNDLE" --log=error >/dev/null
SPEECH=$(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/audio/tools/rms_spans.ts "$NARR" 1)
npx remotion render "$BUNDLE" AudioDuckRms "$OUT/narration.wav" --codec=wav --config="$CFG" --log=error \
	--props="{\"mode\":\"narration\",\"narration\":\"$NARR\",\"offsetSec\":1}"
npx remotion render "$BUNDLE" AudioDuckRms "$OUT/speech.wav" --codec=wav --config="$CFG" --log=error --props="$SPEECH"
rm -rf "$BUNDLE"
if cmp -s "$OUT/narration.wav" "$OUT/speech.wav"; then
	echo "PASS: the RMS duck read in the render equals the Node-computed spans, byte for byte ($(stat -c %s "$OUT/speech.wav") bytes)"
else
	echo "FAIL: the two renders differ"; cmp "$OUT/narration.wav" "$OUT/speech.wav" | head -3; exit 1
fi
