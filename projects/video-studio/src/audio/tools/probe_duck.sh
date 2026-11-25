#!/usr/bin/env bash
# Why PcmTrack: renders the AudioProbe (a 12 dB duck, 120 ms attack, 450 ms release, on bed-show-neutral-underscore)
# through Remotion's per-frame <Html5Audio volume> and through PcmTrack, and compares both with the ideal per-sample duck.
# About 1 minute. Results: out/audio/integration/probe/compare.json.
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=out/audio/integration/probe
CFG=src/audio/remotion.wav.config.ts
mkdir -p "$OUT"
BUNDLE="$OUT/bundle"
rm -rf "$BUNDLE"
npx remotion bundle src/audio/index.ts --out-dir="$BUNDLE" --log=error >/dev/null
for mode in html5 pcm; do
	npx remotion render "$BUNDLE" AudioProbe "$OUT/$mode.wav" --codec=wav --config="$CFG" --log=error --props="{\"mode\":\"$mode\"}"
done
rm -rf "$BUNDLE"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/audio/tools/probe_gain.ts "$OUT/gain.f32"
.venv-audio/bin/python src/audio/tools/probe_compare.py --render "$OUT/html5.wav" --render "$OUT/pcm.wav" --gain "$OUT/gain.f32" --json "$OUT/compare.json"
