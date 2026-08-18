#!/bin/sh

set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_root="$project_root/_exhibition-source"
output_root="$project_root/po3/assets/images"

if ! command -v cwebp >/dev/null 2>&1; then
  echo "cwebp is required. Install it with: brew install webp" >&2
  exit 1
fi

mkdir -p "$output_root/editorial" "$output_root/looks"

for input in "$source_root"/editorial/editorial-*; do
  [ -f "$input" ] || continue
  filename=$(basename "$input")
  stem=${filename%.*}
  cwebp -quiet -mt -q 86 -sharp_yuv -resize 2560 0 -metadata icc \
    "$input" -o "$output_root/editorial/$stem.webp"
done

for input in "$source_root"/looks/*; do
  [ -f "$input" ] || continue
  filename=$(basename "$input")
  stem=${filename%.*}

  # Keep the photographer-friendly source names while emitting stable,
  # URL-safe asset names for the exhibition page.
  case "$stem" in
    aategois_*_1|aategois-01) stem="aategois-01" ;;
    aategois_*_2|aategois-02) stem="aategois-02" ;;
    aategois_*_3|aategois_*exhibition*|aategois-exhibition) stem="aategois-exhibition" ;;
    hooman_*_1|hooman-01) stem="hooman-01" ;;
    hooman_*_2|hooman-02) stem="hooman-02" ;;
    hooman_*_3|hooman_*exhibition*|hooman-exhibition) stem="hooman-exhibition" ;;
    cementbay_*_1|cementbay-01) stem="cementbay-01" ;;
    cementbay_*_2|cementbay-02) stem="cementbay-02" ;;
    cementbay_*_3|cementbay_*exhibition*|cementbay-exhibition) stem="cementbay-exhibition" ;;
  esac

  cwebp -quiet -mt -q 90 -alpha_q 100 -exact -resize 0 2400 -metadata icc \
    "$input" -o "$output_root/looks/$stem.webp"
done

echo "Exhibition images prepared in $output_root"
