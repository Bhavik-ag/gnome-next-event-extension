#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/dist}"
SCHEMA_FILE="$SCRIPT_DIR/schemas/org.gnome.shell.extensions.next_event.gschema.xml"

mkdir -p "$OUT_DIR"
gnome-extensions pack "$SCRIPT_DIR" --force --out-dir "$OUT_DIR" --schema="$SCHEMA_FILE"
echo "Package created in: $OUT_DIR"
