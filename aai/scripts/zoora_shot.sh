#!/bin/sh
# usage: scripts/zoora_shot.sh WIDTH HEIGHT OUT [URLSUFFIX]
# When the HUD is locked, `aai hud-ticket` swaps the token for a single-use 60 s login URL, so the token
# never appears on Chrome's command line (headless Chrome uses a throwaway profile; the cookie dies with it).
cd "$(dirname "$0")/.." || exit 1
URL=$(.venv/bin/aai hud-ticket "/zoora$4") || exit 1
# headless Chrome sometimes writes the PNG and then never exits (SSE keeps the page busy): cap it, then judge by the file.
rm -f "$3"
timeout -k 5 "${SHOT_TIMEOUT:-240}" google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=${DPR:-1} \
  --window-size=$1,$2 --virtual-time-budget=${VT:-7000} --screenshot="$3" "$URL" >/dev/null 2>&1
[ -s "$3" ] || { echo "zoora_shot: no screenshot written to $3" >&2; exit 1; }
