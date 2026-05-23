#!/usr/bin/env bash
#
# Convert the v1.6 cursor SVGs into Asset Catalog imagesets for the native app.
# Run from anywhere; outputs go under macos/CineScreen/Resources/Assets.xcassets/.
# Requires: rsvg-convert (brew install librsvg).

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
SRC_DIR="$REPO_ROOT/src/assets"
DST_DIR="$REPO_ROOT/macos/CineScreen/Resources/Assets.xcassets"

# Map: native CursorShape -> source SVG filename (without .svg).
# Keep in sync with the CursorShape enum in Models/Metadata.swift.
declare -a MAPPINGS=(
  "arrow:default"
  "pointer:handpointing"
  "hand:handopen"
  "openhand:handopen"
  "closedhand:handgrabbing"
  "crosshair:cross"
  "ibeam:textcursor"
  "ibeamvertical:textcursorvertical"
  "move:move"
  "resizeleft:resizewest"
  "resizeright:resizeeast"
  "resizeleftright:resizewesteast"
  "resizeup:resizenorth"
  "resizedown:resizesouth"
  "resizeupdown:resizenorthsouth"
  "resize:resizewesteast"
  "copy:copy"
  "dragcopy:copy"
  "draglink:makealias"
  "help:help"
  "notallowed:notallowed"
  "contextmenu:contextualmenu"
  "poof:poof"
  "screenshot:screenshotselection"
  "zoomin:zoomin"
  "zoomout:zoomout"
)

mkdir -p "$DST_DIR"

for entry in "${MAPPINGS[@]}"; do
  shape="${entry%%:*}"
  source="${entry##*:}"
  src_path="$SRC_DIR/${source}.svg"
  if [[ ! -f "$src_path" ]]; then
    echo "skip: no source for $shape ($source.svg)" >&2
    continue
  fi
  set_dir="$DST_DIR/${shape}.imageset"
  mkdir -p "$set_dir"
  rsvg-convert -w 128 -h 128 "$src_path" -o "$set_dir/${shape}.png"
  rsvg-convert -w 256 -h 256 "$src_path" -o "$set_dir/${shape}@2x.png"
  rsvg-convert -w 384 -h 384 "$src_path" -o "$set_dir/${shape}@3x.png"

  cat > "$set_dir/Contents.json" <<JSON
{
  "images" : [
    { "idiom" : "universal", "scale" : "1x", "filename" : "${shape}.png" },
    { "idiom" : "universal", "scale" : "2x", "filename" : "${shape}@2x.png" },
    { "idiom" : "universal", "scale" : "3x", "filename" : "${shape}@3x.png" }
  ],
  "info" : { "author" : "xcode", "version" : 1 },
  "properties" : { "preserves-vector-representation" : true, "template-rendering-intent" : "original" }
}
JSON
  echo "ok: $shape"
done
