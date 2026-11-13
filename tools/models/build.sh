#!/usr/bin/env bash
# Runs the model generators in headless Blender (the bpy Python module, which needs CPython 3.11).
#   tools/models/build.sh [name ...]     default: every character with a generator
# The venv lives in tools/models/.venv (about 900 MB, not committed); BPY_PYTHON overrides it.
set -euo pipefail
cd "$(dirname "$0")"
PY="${BPY_PYTHON:-.venv/bin/python}"
if [ ! -x "$PY" ]; then
  command -v uv >/dev/null || { echo "install uv (https://docs.astral.sh/uv/) or set BPY_PYTHON to a Python 3.11 with bpy"; exit 1; }
  uv venv --python 3.11 .venv
  uv pip install --python .venv/bin/python 'bpy==5.0.1' numpy
fi
[ $# -gt 0 ] || set -- brass
for name in "$@"; do "$PY" "$name.py" "../../assets/models/$name.glb" 2>&1 | grep -v ' | INFO: ' || true; done
