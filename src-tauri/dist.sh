#!/bin/sh
# Tauri embeds src-tauri/dist: a copy, made here, of what the web version serves, laid out like the
# repo root. `make app` and .github/workflows/release.yml both run this, so the two cannot differ.
set -e
cd "$(dirname "$0")"
rm -rf dist
mkdir dist
cp -Rp ../web ../lessons ../examples dist/
