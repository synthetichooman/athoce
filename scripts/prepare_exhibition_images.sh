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

for input in "$source_root"/looks/yumin-* "$source_root"/looks/gayoung-* "$source_root"/looks/seyeon-*; do
  [ -f "$input" ] || continue
  filename=$(basename "$input")
  stem=${filename%.*}
  cwebp -quiet -mt -q 90 -alpha_q 100 -exact -resize 0 2400 -metadata icc \
    "$input" -o "$output_root/looks/$stem.webp"
done

echo "Exhibition images prepared in $output_root"
