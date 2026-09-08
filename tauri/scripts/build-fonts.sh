#!/usr/bin/env bash
# Regenerate the bundled UI fonts in src/assets/fonts/.
#
# "Aetherium Sans" = Noto Sans, "Aetherium Mono" = JetBrains Mono.
# Both are subsetted to Latin + common punctuation to keep the bundle small
# (~150KB total for 6 faces). Widen UNICODES below if the app ever needs more
# script coverage in chrome text (prose falls back to system fonts anyway).
#
# Requires: fonttools (pyftsubset) with brotli. On a PEP-668 system:
#   python3 -m venv /tmp/fontvenv && /tmp/fontvenv/bin/pip install fonttools brotli
#   PYFTSUBSET=/tmp/fontvenv/bin/pyftsubset ./scripts/build-fonts.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PYFTSUBSET="${PYFTSUBSET:-pyftsubset}"
OUT="src/assets/fonts"
mkdir -p "$OUT"

# Source TTFs. Override via env if your distro puts them elsewhere.
NOTO_REGULAR="${NOTO_REGULAR:-/usr/share/fonts/noto/NotoSans-Regular.ttf}"
NOTO_MEDIUM="${NOTO_MEDIUM:-/usr/share/fonts/noto/NotoSans-Medium.ttf}"
NOTO_BOLD="${NOTO_BOLD:-/usr/share/fonts/noto/NotoSans-Bold.ttf}"
NOTO_ITALIC="${NOTO_ITALIC:-/usr/share/fonts/noto/NotoSans-Italic.ttf}"
JBM_REGULAR="${JBM_REGULAR:-/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf}"
JBM_BOLD="${JBM_BOLD:-/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Bold.ttf}"

UNICODES="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD,U+2026,U+00B7,U+2018-201F"

gen() {
  "$PYFTSUBSET" "$1" \
    --unicodes="$UNICODES" \
    --layout-features='kern,liga,calt,tnum' \
    --flavor=woff2 \
    --desubroutinize --notdef-outline \
    --output-file="$OUT/$2"
  echo "  $OUT/$2"
}

echo "Generating bundled fonts:"
gen "$NOTO_REGULAR" NotoSans-Regular.woff2
gen "$NOTO_MEDIUM"  NotoSans-Medium.woff2
gen "$NOTO_BOLD"    NotoSans-Bold.woff2
gen "$NOTO_ITALIC"  NotoSans-Italic.woff2
gen "$JBM_REGULAR"  JetBrainsMono-Regular.woff2
gen "$JBM_BOLD"     JetBrainsMono-Bold.woff2
echo "Done."
