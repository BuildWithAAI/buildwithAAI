#!/usr/bin/env bash
# Voice step setup. Idempotent: safe to re-run; it only does what is missing.
#   1. creates projects/video-studio/.venv-voice (gitignored) and installs the pinned requirements
#      (requirements.txt; plus requirements-cjk.txt for ja/zh unless VOICE_SKIP_CJK=1)
#   2. downloads the Kokoro v1.0 model files into projects/video-studio/.cache/kokoro/ and verifies
#      their size and sha256; a mismatch is refused (the file is deleted and the script fails)
#
#   scripts/voice/setup.sh
#   KOKORO_LOCAL_DIR=/path/with/model/files scripts/voice/setup.sh   # copy instead of download (still verified)
#   PYTHON=python3.13 scripts/voice/setup.sh                         # pick the interpreter
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
VENV="$ROOT/.venv-voice"
MODELS="$ROOT/.cache/kokoro"
PY="${PYTHON:-python3}"
BASE_URL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"

say() { printf '[voice-setup] %s\n' "$*"; }
die() { printf '[voice-setup] ERROR: %s\n' "$*" >&2; exit 1; }

pinned_sha() {
  case "$1" in
    kokoro-v1.0.int8.onnx) echo "ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c" ;;
    voices-v1.0.bin) echo "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d" ;;
    *) die "unknown model file $1" ;;
  esac
}
pinned_size() {
  case "$1" in
    kokoro-v1.0.int8.onnx) echo 114119327 ;;
    voices-v1.0.bin) echo 28214398 ;;
  esac
}

command -v "$PY" >/dev/null 2>&1 || die "$PY not found (set PYTHON=...)"
ver="$("$PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
[ "$ver" = "3.13" ] || say "warning: tested with Python 3.13, using $ver"
command -v ffmpeg >/dev/null 2>&1 || say "warning: ffmpeg is not on PATH; build.py needs it for loudness normalization"

# 1. virtualenv + pinned packages
if [ ! -x "$VENV/bin/python" ]; then
  say "creating $VENV"
  "$PY" -m venv "$VENV"
fi
VPY="$VENV/bin/python"
say "installing requirements.txt"
"$VPY" -m pip install --disable-pip-version-check --quiet -r "$HERE/requirements.txt"
if [ "${VOICE_SKIP_CJK:-0}" != "1" ]; then
  say "installing requirements-cjk.txt (ja/zh G2P)"
  if ! "$VPY" -m pip install --disable-pip-version-check --quiet -r "$HERE/requirements-cjk.txt"; then
    say "warning: the ja/zh G2P did not install; --lang ja and --lang zh will refuse to build"
  fi
fi

# 2. model files, verified
sha_of() { "$VPY" -c 'import hashlib,sys
h=hashlib.sha256()
with open(sys.argv[1],"rb") as f:
    for b in iter(lambda: f.read(1<<20), b""): h.update(b)
print(h.hexdigest())' "$1"; }
size_of() { "$VPY" -c 'import os,sys; print(os.path.getsize(sys.argv[1]))' "$1"; }

fetch() {
  local name="$1" want size dest tmp got
  want="$(pinned_sha "$name")"; size="$(pinned_size "$name")"
  dest="$MODELS/$name"; tmp="$dest.part"
  if [ -f "$dest" ] && [ "$(size_of "$dest")" = "$size" ] && [ "$(sha_of "$dest")" = "$want" ]; then
    say "ok $name (sha256 verified)"
    return
  fi
  [ -f "$dest" ] && say "$name does not match the pin; fetching it again"
  rm -f "$tmp"
  if [ -n "${KOKORO_LOCAL_DIR:-}" ] && [ -f "$KOKORO_LOCAL_DIR/$name" ]; then
    say "copying $name from $KOKORO_LOCAL_DIR"
    cp "$KOKORO_LOCAL_DIR/$name" "$tmp"
  else
    say "downloading $name"
    if [ -t 2 ]; then progress="--progress-bar"; else progress="-sS"; fi
    curl -fL "$progress" --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 -o "$tmp" "$BASE_URL/$name" || { rm -f "$tmp"; die "download of $name failed"; }
  fi
  got="$(sha_of "$tmp")"
  gotsize="$(size_of "$tmp")"
  if [ "$got" != "$want" ] || [ "$gotsize" != "$size" ]; then
    rm -f "$tmp" "$dest"
    die "$name has sha256 $got and $gotsize bytes, not the pinned $want and $size bytes; refusing it"
  fi
  mv -f "$tmp" "$dest"
  say "ok $name (sha256 verified)"
}
mkdir -p "$MODELS"
fetch kokoro-v1.0.int8.onnx
fetch voices-v1.0.bin

# 3. import check
"$VPY" -c 'import kokoro_onnx, phonemizer, soundfile, numpy, espeakng_loader' || die "the base packages do not import"
if "$VPY" -c 'import misaki.ja, misaki.zh' >/dev/null 2>&1; then cjk="ja/zh G2P ready"; else cjk="ja/zh G2P NOT available"; fi
say "done: $VENV, models in $MODELS, $cjk"
