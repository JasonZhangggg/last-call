#!/usr/bin/env bash
# Wraps index.html (written skeleton-less for claude.ai Artifacts) into a full document for static hosting.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="description" content="A bluffing card game with a six-chamber revolver, built in three.js.">\n</head>\n<body>\n'
  cat index.html
  printf '\n</body>\n</html>\n'
} > dist/index.html
