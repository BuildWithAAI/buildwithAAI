#!/usr/bin/env bash
# sys-05: packages with a published fix (OSV, Nov 11 2026).
#  - zlib1g 1:1.3.dfsg+really1.3.1-1+b1 -> +deb13u1 (DEBIAN-CVE-2026-27171, -76844, -85091)
#  - libreoffice 4:25.2.3-2+deb13u8 -> +deb13u9 (DEBIAN-CVE-2026-76181)
#  - pip 25.1.1 in 5 venvs (12 GHSA advisories incl. GHSA-4xh5-x5gv-qwph)
#  - kernel 6.12.113+ is the host's; only the platform can update it.
# Default: dry run. --apply: apt-get update + only-upgrade the listed packages, and upgrade pip in each venv.
set -euo pipefail
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
VENVS=(/workspace/aai/.venv /workspace/fa-venv /workspace/security-pipeline/.venv /workspace/solana-meme-risk/.venv /workspace/tiktok/.venv)
APT_PKGS=$(dpkg-query -W -f='${db:Status-Abbrev} ${binary:Package}\n' 'zlib1g*' 'libreoffice*' 2>/dev/null | awk '$1=="ii"{print $2}' | sort -u | tr '\n' ' ')
echo "== apt packages to upgrade: $APT_PKGS"
dpkg-query -W -f='${binary:Package} ${Version}\n' zlib1g 2>/dev/null || true
for v in "${VENVS[@]}"; do [ -x "$v/bin/python" ] && echo "pip in $v: $("$v/bin/python" -m pip --version 2>/dev/null | cut -d' ' -f2)"; done
if [ "$APPLY" -ne 1 ]; then echo "DRY RUN. --apply runs apt-get update/--only-upgrade and pip install -U pip."; exit 0; fi
sudo -n apt-get update -qq
# shellcheck disable=SC2086
sudo -n apt-get install -y --only-upgrade $APT_PKGS
for v in "${VENVS[@]}"; do [ -x "$v/bin/python" ] && "$v/bin/python" -m pip install -q -U pip; done
echo "done"
