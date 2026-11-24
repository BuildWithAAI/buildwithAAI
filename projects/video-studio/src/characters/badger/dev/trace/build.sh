#!/usr/bin/env bash
# Regenerate the traced BADGER geometry + spots.ts. Run from anywhere.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
python3 "$here/gen_left.py" "$here/../../parts/rigLeft.ts" "$tmp/spots_left.json"
python3 "$here/gen_heads.py" "$here/../../parts/heads/headGeom.ts" "$tmp/heads.json"
python3 "$here/emit_spots.py" "$tmp/spots_left.json" "$tmp/heads.json" "$here/../../spots.ts"
rm -rf "$tmp"
