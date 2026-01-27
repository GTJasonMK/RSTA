#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$ROOT_DIR/.." && pwd)"
VENV_DIR="${REPO_DIR}/.venv-hymt-gguf"
PYTHON="${VENV_DIR}/bin/python"
QUANT="${QUANT:-Q6_K}"
PORT="${PORT:-8092}"

if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
fi

"$PYTHON" -m pip install --upgrade pip
"$PYTHON" -m pip install -r "${ROOT_DIR}/requirements-hymt-gguf.txt"

MODEL_REPO="tencent/HY-MT1.5-1.8B-GGUF" MODEL_DIR="${REPO_DIR}/models" \
  QUANT="$QUANT" PORT="$PORT" \
  "$PYTHON" "${ROOT_DIR}/serve_hymt_gguf.py"
