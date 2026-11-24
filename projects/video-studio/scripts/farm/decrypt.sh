#!/usr/bin/env bash
# Decrypt render-farm artifacts (docs/RENDER_FARM.md, "Getting the files").
#
#   scripts/farm/decrypt.sh --key ~/.zoora/farm-owner.key [--out DIR] [--force] INPUT...
#
# INPUT is an artifact .zip downloaded from the run page, a folder (for example from `gh run download`), or .enc
# files. Zips are unzipped into a temporary folder; then scripts/farm/decrypt.ts decrypts every *.enc file into DIR
# (default ./decrypted), keeping its folder layout, and checks every decrypted *.sha256 file.
# Outputs and logs are encrypted to the owner's PUBLIC key, so --key is the owner's private key (never commit it).
#
# Exit codes: 0 all decrypted and verified; 1 a file failed to decrypt or a checksum did not match; 2 bad usage.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
die() { printf 'decrypt: %s\n' "$*" >&2; exit 2; }
command -v node >/dev/null 2>&1 || die "node (22 or later) is not installed"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

args=()
n=0
while [ $# -gt 0 ]; do
  case "$1" in
    --key | --out) [ $# -ge 2 ] || die "$1 needs a value"; args+=("$1" "$2"); shift 2 ;;
    *.zip)
      [ -f "$1" ] || die "$1 does not exist"
      n=$((n + 1))
      dir="$work/zip-$n"
      mkdir -p "$dir"
      if command -v unzip >/dev/null 2>&1; then
        unzip -q "$1" -d "$dir"
      else
        python3 -I -m zipfile -e "$1" "$dir"
      fi
      args+=("$dir")
      shift ;;
    *) args+=("$1"); shift ;;
  esac
done

exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$here/decrypt.ts" "${args[@]}"
