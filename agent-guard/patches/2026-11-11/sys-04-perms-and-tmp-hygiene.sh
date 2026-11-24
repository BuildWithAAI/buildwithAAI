#!/usr/bin/env bash
# sys-04: loose permissions on files that hold or look like secrets, and stale scratch in /tmp.
# Default: dry run. --apply: chmod 600 the listed files. --delete-stale: also remove /tmp scratch dirs
# owned by box, older than 2 days, with no live process inside (OWNER DECISION: deletion).
set -euo pipefail
APPLY=0; DELETE=0
for a in "$@"; do case "$a" in --apply) APPLY=1;; --delete-stale) DELETE=1;; esac; done
echo "== world-readable secret-bearing files (from audit.py findings and name patterns)"
mapfile -t FILES < <(find /workspace /home/box -xdev \( -name node_modules -o -name .venv -o -name .git -o -name site-packages \) -prune -o \
  -type f \( -name '.env' -o -name '.env.local' -o -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' -o -name '*.sqlite' -o -name '*.db' -o -path '*/agent-tools/*.txt' \) \
  -perm -o=r -print 2>/dev/null | grep -v -E '\.example$|/tests?/fixtures/|cacert\.pem$')
for f in "${FILES[@]}"; do echo "$(stat -c '%a' "$f") $f"; done
echo "== stale /tmp scratch (box-owned, >2 days, no process cwd inside)"
mapfile -t STALE < <(find /tmp -mindepth 1 -maxdepth 1 -type d -user "$(id -un)" -mtime +2 \
  \( -name 'lumen-*' -o -name 'zsec*' -o -name 'aai-chrome-*' -o -name 'hud-shot-profile' -o -name 'ai-portals' -o -name 'tmp*' \) 2>/dev/null)
LIVE=$(for p in /proc/[0-9]*; do readlink "$p/cwd" 2>/dev/null; done | sort -u)
for d in "${STALE[@]}"; do
  if echo "$LIVE" | grep -q "^$d"; then echo "in use: $d"; else echo "stale: $d ($(du -sh "$d" 2>/dev/null | cut -f1))"; fi
done
if [ "$APPLY" -eq 1 ]; then for f in "${FILES[@]}"; do chmod 600 "$f"; done; echo "chmod 600 applied to ${#FILES[@]} files"; fi
if [ "$DELETE" -eq 1 ]; then
  for d in "${STALE[@]}"; do echo "$LIVE" | grep -q "^$d" || { rm -rf -- "$d"; echo "removed $d"; }; done
fi
[ "$APPLY" -eq 1 ] || [ "$DELETE" -eq 1 ] || echo "DRY RUN. --apply to chmod, --delete-stale to remove stale scratch."
