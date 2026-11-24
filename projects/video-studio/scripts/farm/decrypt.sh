#!/usr/bin/env bash
# Decrypt render-farm artifacts (docs/RENDER_FARM.md).
#
#   scripts/farm/decrypt.sh [--out DIR] [--key-file FILE] [--force] INPUT...
#
# INPUT is an artifact .zip downloaded from the run page, a folder (for example from `gh run download`), or .enc files.
# Every *.enc file is decrypted into DIR (default: ./decrypted), keeping its folder layout and dropping ".enc"; then
# every decrypted *.sha256 checksum file is verified. The key is $RENDER_ARTIFACT_KEY, else the first line of
# --key-file FILE, else a hidden prompt; it reaches openssl through the environment, never as an argument.
#
# Cipher: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 (OpenSSL 3, or LibreSSL 3 on macOS).
# Exit codes: 0 all decrypted and verified; 1 a file failed to decrypt or a checksum did not match; 2 bad usage.
set -euo pipefail

out="decrypted"
key_file=""
force=0
inputs=()

usage() { sed -n '4,13p' "$0" | sed 's/^# \{0,1\}//'; }
die() { printf 'decrypt: %s\n' "$*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out) [ $# -ge 2 ] || die "--out needs a folder"; out="$2"; shift 2 ;;
    --out=*) out="${1#--out=}"; shift ;;
    --key-file) [ $# -ge 2 ] || die "--key-file needs a file"; key_file="$2"; shift 2 ;;
    --key-file=*) key_file="${1#--key-file=}"; shift ;;
    --force) force=1; shift ;;
    -h | --help) usage; exit 0 ;;
    --) shift; while [ $# -gt 0 ]; do inputs+=("$1"); shift; done ;;
    -*) usage >&2; die "unknown option $1" ;;
    *) inputs+=("$1"); shift ;;
  esac
done
[ "${#inputs[@]}" -gt 0 ] || { usage >&2; exit 2; }
command -v openssl >/dev/null 2>&1 || die "openssl is not installed"

key="${RENDER_ARTIFACT_KEY:-}"
if [ -z "$key" ] && [ -n "$key_file" ]; then
  [ -r "$key_file" ] || die "cannot read $key_file"
  IFS= read -r key < "$key_file" || true
  key="${key%$'\r'}"
fi
if [ -z "$key" ] && [ -t 0 ]; then
  printf 'RENDER_ARTIFACT_KEY (hidden): ' >&2
  IFS= read -r -s key || true
  printf '\n' >&2
fi
[ -n "$key" ] || die "no key: set RENDER_ARTIFACT_KEY, pass --key-file FILE, or run in a terminal to be asked"
export FARM_DECRYPT_KEY="$key"
unset key

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

count=0
failed=0

# dec SRC DST: decrypt one file; a wrong key or damaged file leaves nothing behind.
dec() {
  local src="$1" dst="$2" tmp
  if [ -e "$dst" ] && [ "$force" != 1 ]; then
    printf 'SKIP  %s exists (use --force to replace it)\n' "$dst" >&2
    return 1
  fi
  mkdir -p "$(dirname "$dst")"
  tmp="$dst.part.$$"
  if openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -in "$src" -out "$tmp" -pass env:FARM_DECRYPT_KEY 2>/dev/null; then
    mv -f "$tmp" "$dst"
    printf 'ok    %s\n' "$dst"
  else
    rm -f "$tmp"
    printf 'FAIL  %s (wrong key or damaged file)\n' "$src" >&2
    return 1
  fi
}

for input in "${inputs[@]}"; do
  if [ -d "$input" ]; then
    root="${input%/}"
  elif [ -f "$input" ] && [[ "$input" == *.zip ]]; then
    root="$work/zip-$count-$RANDOM"
    mkdir -p "$root"
    if command -v unzip >/dev/null 2>&1; then
      unzip -q "$input" -d "$root"
    else
      python3 -I -m zipfile -e "$input" "$root"
    fi
  elif [ -f "$input" ] && [[ "$input" == *.enc ]]; then
    count=$((count + 1))
    name="$(basename "$input")"
    dec "$input" "$out/${name%.enc}" || failed=1
    continue
  else
    die "$input is not a folder, a .zip or a .enc file"
  fi
  while IFS= read -r -d '' f; do
    rel="${f#"$root"/}"
    count=$((count + 1))
    dec "$f" "$out/${rel%.enc}" || failed=1
  done < <(find "$root" -type f -name '*.enc' -print0 | sort -z)
done

if [ "$count" -eq 0 ]; then
  printf 'decrypt: no .enc files found (unencrypted test artifacts need no decrypting)\n' >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  check() { sha256sum -c --quiet "$1"; }
elif command -v shasum >/dev/null 2>&1; then
  check() { shasum -a 256 -c "$1"; }
else
  check() { printf 'no sha256sum or shasum to verify %s\n' "$1" >&2; return 1; }
fi
if [ -d "$out" ]; then
  while IFS= read -r -d '' s; do
    if (cd "$(dirname "$s")" && check "$(basename "$s")"); then
      printf 'ok    checksums in %s\n' "$s"
    else
      printf 'FAIL  checksums in %s do not match\n' "$s" >&2
      failed=1
    fi
  done < <(find "$out" -type f -name '*.sha256' -print0 | sort -z)
fi

if [ "$failed" -ne 0 ]; then
  printf 'decrypt: finished with errors\n' >&2
  exit 1
fi
printf 'decrypt: %d file(s) decrypted into %s\n' "$count" "$out"
