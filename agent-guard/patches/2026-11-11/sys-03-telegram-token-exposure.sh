#!/usr/bin/env bash
# sys-03: TELEGRAM_BOT_TOKEN and LUMEN_TELEGRAM_BOT_TOKEN (two different bot tokens) are injected into
# every process on the box: shells, browsers, VNC, npm installs and their postinstall scripts.
# Any dependency or agent subprocess can read them from its own environment or /proc/<pid>/environ.
# Default: dry run, prints names, process counts and an 8-char SHA-256 fingerprint only (never values).
# --apply: adds an unset to ~/.bashrc so new interactive shells drop both variables. Platform-injected
# process environments are not changed; the real fix is to stop injecting them box-wide.
# OWNER DECISION: revoke both tokens in @BotFather (/revoke), issue new ones, store them in the vault,
# and inject them only into the one process that needs each.
set -euo pipefail
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
python3 - <<'PY'
import glob, hashlib, collections
seen = collections.Counter(); procs = collections.Counter()
for env in glob.glob('/proc/[0-9]*/environ'):
    try: data = open(env, 'rb').read().split(b'\0')
    except Exception: continue
    for kv in data:
        if kv.startswith((b'TELEGRAM_BOT_TOKEN=', b'LUMEN_TELEGRAM_BOT_TOKEN=')):
            k, v = kv.split(b'=', 1)
            seen[(k.decode(), hashlib.sha256(v).hexdigest()[:8])] += 1
for (k, fp), n in sorted(seen.items()):
    print(f"{k}: fingerprint {fp}, present in {n} processes")
PY
LINE='unset TELEGRAM_BOT_TOKEN LUMEN_TELEGRAM_BOT_TOKEN  # agent-guard sys-03'
if grep -qF "$LINE" ~/.bashrc 2>/dev/null; then echo "~/.bashrc already unsets them"; exit 0; fi
if [ "$APPLY" -ne 1 ]; then echo "DRY RUN. --apply appends: $LINE"; exit 0; fi
cp ~/.bashrc ~/.bashrc.agentguard.bak 2>/dev/null || true
echo "$LINE" >> ~/.bashrc
echo "Appended to ~/.bashrc (backup at ~/.bashrc.agentguard.bak). Revocation is still required."
