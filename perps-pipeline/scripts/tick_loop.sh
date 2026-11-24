#!/usr/bin/env bash
# Fallback scheduler used when cron is unavailable on the box (added 2026-11-09).
# Fires `perps tick` at minute 1,6,11,... like the cron line in README.
cd /workspace/perps-pipeline || exit 1
while true; do
  now=$(date +%s); m=$(( (now/60) % 5 )); s=$(( now % 60 ))
  wait=$(( ((1 - m + 5) % 5) * 60 - s + 1 ))
  [ "$wait" -le 0 ] && wait=$(( wait + 300 ))
  sleep "$wait"
  timeout 280 .venv/bin/perps tick --quiet >> state/arena/cron.log 2>&1
done
