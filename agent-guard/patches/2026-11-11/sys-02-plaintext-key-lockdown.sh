#!/usr/bin/env bash
# sys-02: plaintext private key and a key-like transcript are world-readable (0644).
# This script NEVER opens, prints, copies or deletes the files. It only stats and (with --apply) chmods them.
# OWNER DECISION: rotate the RSA key wherever its public half is registered (deploy key, SSH, signing).
# A key that sat at 0644 in a shared workspace for days should be treated as exposed.
set -euo pipefail
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
FILES=(
  /workspace/agent-tools/2955f96f-ed4d-4358-920f-017bff5a4b7d.txt
  /home/box/.cursor/projects/workspace/agent-tools/7ac38f83-1261-40e9-b553-1b57f89d90b6.txt
)
for f in "${FILES[@]}"; do
  if [ -e "$f" ]; then
    echo "$(stat -c '%a %U:%G %s bytes' "$f")  $f"
    if [ "$APPLY" -eq 1 ]; then chmod 600 "$f" && echo "  -> chmod 600 done"; else echo "  -> would chmod 600"; fi
  else
    echo "missing: $f"
  fi
done
[ "$APPLY" -eq 1 ] || echo "DRY RUN. Re-run with --apply to chmod 600. Rotation and deletion stay with the owner."
