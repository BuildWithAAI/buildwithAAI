#!/bin/sh
# restart the localhost-only HUD (127.0.0.1:57025); pid recorded in data/hud.json
# Loads AAI_HUD_TOKEN from $AAI_HUD_TOKEN_FILE (default /home/box/.config/aai/hud_token, mode 0600)
# when the variable is unset. The token value is never printed or logged.
# LUMEN_TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_TOKEN are dropped from the HUD process environment.
cd /workspace/aai
TOKEN_FILE="${AAI_HUD_TOKEN_FILE:-/home/box/.config/aai/hud_token}"
if [ -z "${AAI_HUD_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
  AAI_HUD_TOKEN=$(tr -d '\n' < "$TOKEN_FILE")
  export AAI_HUD_TOKEN
fi
if [ -z "${AAI_HUD_TOKEN:-}" ]; then
  echo "AAI_HUD_TOKEN is not set and $TOKEN_FILE is missing; refusing to start the HUD unlocked" >&2
  exit 1
fi
echo "AAI_HUD_TOKEN is set (value not printed); starting HUD without Telegram/LUMEN bot tokens"
P=$(python3 -c "import json;print(json.load(open('data/hud.json'))['pid'])" 2>/dev/null)
[ -n "$P" ] && kill $P 2>/dev/null
sleep 1.5
# env -u drops inherited bot tokens even if this shell still has them
setsid env -u LUMEN_TELEGRAM_BOT_TOKEN -u TELEGRAM_BOT_TOKEN \
  nohup .venv/bin/aai hud --port 57025 > logs/hud.log 2>&1 < /dev/null &
sleep 3; cat data/hud.json; echo
