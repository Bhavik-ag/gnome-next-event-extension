#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/dist}"

mkdir -p "$OUT_DIR"
gnome-extensions pack "$SCRIPT_DIR" --force --out-dir "$OUT_DIR"
echo "Package created in: $OUT_DIR"
