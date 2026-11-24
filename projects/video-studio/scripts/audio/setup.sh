#!/usr/bin/env bash
# Audio engine setup. Idempotent: safe to re-run; it only does what is missing, then verifies everything.
#   1. system packages (Ubuntu 24.04 "noble" pins): fluidsynth, MuseScore_General (lossy .sf3 and the
#      lossless .sf2), FluidR3_GM. Installed with apt-get when missing and running as root; otherwise the
#      exact command is printed and the script fails.
#   2. projects/video-studio/.venv-audio (gitignored) with the hash-pinned requirements.txt
#   3. sha256 + size check of every soundfont file the engine may load; a mismatch fails the script
#   4. VCSL (CC0 samples) shallow-fetched at a pinned commit into .cache/vcsl (gitignored, about 9.6 GB:
#      3.8 GB of git objects plus a 5.8 GB checkout); HEAD and the root tree hash are verified
#   5. import + fluidsynth smoke checks
#
#   scripts/audio/setup.sh
#   AUDIO_SKIP_LOSSLESS=1 scripts/audio/setup.sh   # skip the 362 MB lossless MuseScore .sf2 (the engine
#                                                 # then falls back to the lossy .sf3)
#   AUDIO_SKIP_VCSL=1 scripts/audio/setup.sh       # no sample library (the sampler will refuse to load)
#   PYTHON=python3.13 scripts/audio/setup.sh       # pick the interpreter
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
VENV="$ROOT/.venv-audio"
VCSL="$ROOT/.cache/vcsl"
PY="${PYTHON:-python3}"

VCSL_URL="https://github.com/sgossner/VCSL"
VCSL_COMMIT="c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e"
VCSL_TREE="aee077dea292930ede43d557a4c5e9edb2a6ceaf"

say() { printf '[audio-setup] %s\n' "$*"; }
die() { printf '[audio-setup] ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 1. system packages
APT_PKGS=(
  "fluidsynth=2.3.4-1build3"
  "musescore-general-soundfont=0.2.1-1"
  "fluid-soundfont-gm=3.1-5.3"
)
if [ "${AUDIO_SKIP_LOSSLESS:-0}" != "1" ]; then
  APT_PKGS+=("musescore-general-soundfont-lossless=0.2.1-1")
fi

missing=()
for spec in "${APT_PKGS[@]}"; do
  name="${spec%%=*}"; want="${spec#*=}"
  have="$(dpkg-query -W -f='${Version}' "$name" 2>/dev/null || true)"
  if [ "$have" = "$want" ]; then
    say "ok $name $have"
  else
    [ -n "$have" ] && say "$name is $have, pinned $want"
    missing+=("$spec")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  command -v apt-get >/dev/null 2>&1 || die "apt-get not found; install ${missing[*]} by hand (Ubuntu 24.04 names)"
  if [ "$(id -u)" != "0" ]; then
    die "run as root, or first: sudo apt-get install -y --no-install-recommends ${missing[*]}"
  fi
  say "installing ${missing[*]}"
  export DEBIAN_FRONTEND=noninteractive
  if ! apt-get install -y --no-install-recommends --allow-downgrades "${missing[@]}"; then
    say "apt-get install failed; refreshing the package lists once"
    apt-get update
    apt-get install -y --no-install-recommends --allow-downgrades "${missing[@]}" || die "could not install ${missing[*]}"
  fi
fi
command -v fluidsynth >/dev/null 2>&1 || die "fluidsynth is not on PATH"
command -v ffmpeg >/dev/null 2>&1 || die "ffmpeg is not on PATH (metrics and loudness checks need it)"
fsv="$(fluidsynth --version 2>/dev/null | sed -n 's/^FluidSynth runtime version //p' | head -n1)"
[ "$fsv" = "2.3.4" ] || say "warning: fluidsynth runtime $fsv; the engine was verified with 2.3.4"

# ---------------------------------------------------------------- 2. virtualenv
command -v "$PY" >/dev/null 2>&1 || die "$PY not found (set PYTHON=...)"
ver="$("$PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
[ "$ver" = "3.13" ] || say "warning: verified with Python 3.13, using $ver"
if [ ! -x "$VENV/bin/python" ]; then
  say "creating $VENV"
  "$PY" -m venv "$VENV"
fi
VPY="$VENV/bin/python"
say "installing requirements.txt (hash-checked)"
"$VPY" -m pip install --disable-pip-version-check --quiet --require-hashes -r "$HERE/requirements.txt"

# ---------------------------------------------------------------- 3. soundfonts by sha256
sha_of() { "$VPY" -c 'import hashlib,sys
h=hashlib.sha256()
with open(sys.argv[1],"rb") as f:
    for b in iter(lambda: f.read(1<<22), b""): h.update(b)
print(h.hexdigest())' "$1"; }
size_of() { "$VPY" -c 'import os,sys; print(os.path.getsize(sys.argv[1]))' "$1"; }
check_sf() {
  local path="$1" want="$2" size="$3" optional="${4:-}"
  if [ ! -f "$path" ]; then
    [ -n "$optional" ] && { say "skip $path (not installed)"; return; }
    die "$path is missing"
  fi
  local gotsize got
  gotsize="$(size_of "$path")"
  [ "$gotsize" = "$size" ] || die "$path is $gotsize bytes, pinned $size; refusing it"
  got="$(sha_of "$path")"
  [ "$got" = "$want" ] || die "$path has sha256 $got, pinned $want; refusing it"
  say "ok $(basename "$path") (sha256 verified)"
}
check_sf /usr/share/sounds/sf3/MuseScore_General_Full.sf3 f9a37b36655f23e167c66ec91bef6097c8e99be29286219a54062919eb41aeae 85967114
check_sf /usr/share/sounds/sf2/FluidR3_GM.sf2 74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0 148398306
lossless_flag=""
[ "${AUDIO_SKIP_LOSSLESS:-0}" = "1" ] && lossless_flag="optional"
check_sf /usr/share/sounds/sf2/MuseScore_General_Full.sf2 59287cbb0f424ec76d1bc269eee40dfe0b02252588d72eb016b5d2382e710a8f 489519900 $lossless_flag

# ---------------------------------------------------------------- 4. VCSL at a pinned commit
if [ "${AUDIO_SKIP_VCSL:-0}" = "1" ]; then
  say "skip VCSL (AUDIO_SKIP_VCSL=1)"
else
  command -v git >/dev/null 2>&1 || die "git not found"
  head_now=""
  [ -d "$VCSL/.git" ] && head_now="$(git -C "$VCSL" rev-parse HEAD 2>/dev/null || true)"
  if [ "$head_now" != "$VCSL_COMMIT" ]; then
    say "fetching VCSL $VCSL_COMMIT (shallow; about 3.8 GB of objects)"
    mkdir -p "$VCSL"
    [ -d "$VCSL/.git" ] || git -C "$VCSL" init -q
    git -C "$VCSL" remote get-url origin >/dev/null 2>&1 || git -C "$VCSL" remote add origin "$VCSL_URL"
    git -C "$VCSL" fetch --depth 1 --quiet origin "$VCSL_COMMIT" || die "could not fetch VCSL $VCSL_COMMIT"
    git -C "$VCSL" -c advice.detachedHead=false checkout --quiet --force "$VCSL_COMMIT"
  fi
  [ "$(git -C "$VCSL" rev-parse HEAD)" = "$VCSL_COMMIT" ] || die "VCSL HEAD is not $VCSL_COMMIT"
  tree="$(git -C "$VCSL" rev-parse 'HEAD^{tree}')"
  [ "$tree" = "$VCSL_TREE" ] || die "VCSL tree is $tree, pinned $VCSL_TREE"
  if [ -n "$(git -C "$VCSL" status --porcelain --untracked-files=no)" ]; then
    die "VCSL checkout has local modifications; run: git -C $VCSL checkout --force $VCSL_COMMIT"
  fi
  grep -q "CC0 1.0 Universal" "$VCSL/LICENSE" || die "VCSL LICENSE is not CC0 1.0"
  say "ok VCSL $VCSL_COMMIT (tree $tree, clean, CC0)"
fi

# ---------------------------------------------------------------- 5. smoke checks
"$VPY" -c 'import pedalboard, mido, numpy, scipy, soundfile' || die "the pinned packages do not import"
"$VPY" "$HERE/selfcheck.py" || die "selfcheck failed"
vcsl_state="pinned"; [ "${AUDIO_SKIP_VCSL:-0}" = "1" ] && vcsl_state="skipped"
say "done: $VENV ready; soundfonts verified; VCSL $vcsl_state"
