#!/usr/bin/env bash
# Copies the VM Colors layout and its mods into your Herdr app folder and
# switches to it. Run it again after `git pull` to update.
# Only touches files named vm-colors* and mods/vm-*; your own files stay put.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

if [ ! -d "$home" ]; then
  echo "No Herdr app folder at $home (start Herdr once, or set HERDR_APP_HOME)." >&2
  exit 1
fi

mkdir -p "$home/layouts" "$home/mods"
cp "$here/layouts/vm-colors.json" "$here/layouts/vm-colors.svg" "$home/layouts/"
for mod in "$here"/mods/vm-*/; do
  name="$(basename "$mod")"
  mkdir -p "$home/mods/$name"
  cp "$mod"* "$home/mods/$name/"
done
echo "Copied to $home"

if command -v herdr-app >/dev/null; then
  ok=1
  for mod in "$here"/mods/vm-*/; do
    herdr-app check "$home/mods/$(basename "$mod")" 2>&1 | grep -E "check (passed|failed)|Error" || ok=0
  done
  if [ "$ok" = 1 ] && herdr-app status >/dev/null 2>&1; then
    herdr-app do layout.switch '{"name":"vm-colors"}' >/dev/null && echo "Switched to VM Colors (ctrl-shift-l cycles layouts)."
  else
    echo "Herdr isn't running (or a check failed). Pick VM Colors in Settings, or press ctrl-shift-l."
  fi
fi
