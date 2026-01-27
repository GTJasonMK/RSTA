#!/bin/bash
# 统一 OCR + 翻译服务部署脚本 (Unix)
# 启动 serve_unified.py 提供 OCR 和翻译的 HTTP API

set -e

# 默认参数
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8092}"
PRELOAD_OCR="${PRELOAD_OCR:-}"
OCR_LANG="${OCR_LANG:-en}"
MODEL_REPO="${MODEL_REPO:-tencent/HY-MT1.5-1.8B-GGUF}"
QUANT="${QUANT:-Q6_K}"
VENV_NAME="${VENV_NAME:-.venv-unified}"

# 获取脚本目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_PATH="$PROJECT_ROOT/$VENV_NAME"
PYTHON_EXE="$VENV_PATH/bin/python"
PIP_EXE="$VENV_PATH/bin/pip"
SERVE_SCRIPT="$SCRIPT_DIR/serve_unified.py"

echo "[INFO] 项目根目录: $PROJECT_ROOT"
echo "[INFO] 虚拟环境路径: $VENV_PATH"

# 检查虚拟环境
if [ ! -f "$PYTHON_EXE" ]; then
    echo "[INFO] 创建虚拟环境..."
    python3 -m venv "$VENV_PATH"
fi

# 检查并安装依赖
echo "[INFO] 检查依赖..."

REQUIRED_PACKAGES=(
    "fastapi"
    "uvicorn"
    "pydantic"
    "llama-cpp-python"
    "huggingface_hub"
    "paddlepaddle"
    "paddleocr"
    "paddlex"
    "pillow"
    "numpy"
)

for pkg in "${REQUIRED_PACKAGES[@]}"; do
    pkg_import="${pkg//-/_}"
    pkg_import="${pkg_import%%\[*}"
    if ! "$PYTHON_EXE" -c "import $pkg_import" 2>/dev/null; then
        echo "[INFO] 安装 $pkg..."
        "$PIP_EXE" install "$pkg" -q
    fi
done

# 设置环境变量
export HOST="$HOST"
export PORT="$PORT"
export MODEL_REPO="$MODEL_REPO"
export QUANT="$QUANT"
export OCR_LANG="$OCR_LANG"

if [ -n "$PRELOAD_OCR" ]; then
    export PRELOAD_OCR="$PRELOAD_OCR"
fi

echo ""
echo "=========================================="
echo "  统一 OCR + 翻译服务"
echo "=========================================="
echo "  地址: http://${HOST}:${PORT}"
echo "  OCR 预加载: ${PRELOAD_OCR:-无}"
echo "  翻译模型: $MODEL_REPO ($QUANT)"
echo "=========================================="
echo ""

# 启动服务
"$PYTHON_EXE" "$SERVE_SCRIPT"
