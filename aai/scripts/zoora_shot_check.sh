#!/bin/sh
# usage: scripts/zoora_shot_check.sh [OUTDIR]
# Out-of-band HUD layout regression: takes a fresh headless shot of each layout in aai/shotcheck.py LAYOUTS
# (desk 1440x2600, phone 390x844; both /zoora?nosse=1) and records the grid-diff verdict vs the blessed baseline
# (docs/screenshots/baseline/<layout>.png) in data/shotdiff_last.json, which the healthcheck row and the HUD
# pipelines row read. Shots take 1-3 min each on the shared box, so run this after a restart, not inside the HUD.
# To accept an intended layout change: .venv/bin/aai shot-check bless LAYOUT PNG
cd "$(dirname "$0")/.." || exit 1
OUT="${1:-/tmp/zoora-shot-check}"
mkdir -p "$OUT" || exit 1
rc=0
for spec in "desk 1440 2600" "phone 390 844"; do
  set -- $spec
  png="$OUT/$1-$(date +%Y%m%d-%H%M).png"
  if scripts/zoora_shot.sh "$2" "$3" "$png" "?nosse=1"; then
    .venv/bin/aai shot-check check "$1" "$png" | .venv/bin/python -c 'import json,sys;d=json.load(sys.stdin);print(sys.argv[1], d.get("verdict"), d.get("reason"), d.get("changed_frac")); sys.exit(0 if d.get("verdict") == "PASS" else 1)' "$1" || rc=1
  else
    echo "$1: screenshot failed" >&2; rc=1
  fi
done
exit $rc
