#!/usr/bin/env bash
# RSTA 一键安装脚本 (Unix/Linux/macOS)
# 使用 uv 进行快速包管理

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 项目配置
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_NAME=".venv-hymt-gguf"
VENV_DIR="$SCRIPT_DIR/$VENV_NAME"
WEB_UI_DIR="$SCRIPT_DIR/web-ui"

log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "=================================================="
echo "RSTA 一键安装脚本"
echo "=================================================="
echo ""

# 检查 Python 版本
if ! command -v python3 &> /dev/null; then
    log_error "未检测到 Python3，请先安装 Python 3.10+"
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
log_success "Python 版本: $PYTHON_VERSION"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    log_error "未检测到 Node.js，请先安装: https://nodejs.org/"
    exit 1
fi
log_success "Node.js 版本: $(node --version)"

# 检查并安装 uv
if ! command -v uv &> /dev/null; then
    log_warning "未检测到 uv，开始安装..."
    curl -LsSf https://astral.sh/uv/install.sh | sh

    # 加载 uv 到当前 shell
    export PATH="$HOME/.cargo/bin:$PATH"

    if ! command -v uv &> /dev/null; then
        log_warning "uv 安装后需要重新加载 shell"
        log_info "请运行: source ~/.bashrc 或 source ~/.zshrc"
        log_info "然后重新运行此脚本"
        exit 1
    fi
fi
log_success "uv 已安装: $(uv --version)"

echo ""

# 创建虚拟环境
log_info "创建虚拟环境: $VENV_DIR"
uv venv "$VENV_DIR" --python 3.10 || uv venv "$VENV_DIR"

# 安装 Python 依赖
log_info "安装 Python 依赖..."
if [ -f "$SCRIPT_DIR/requirements.txt" ]; then
    uv pip install -r "$SCRIPT_DIR/requirements.txt" --python "$VENV_DIR/bin/python"
    log_success "Python 依赖安装成功"
else
    log_warning "未找到 requirements.txt"
fi

echo ""

# 安装 Node.js 依赖
if [ -d "$WEB_UI_DIR" ] && [ -f "$WEB_UI_DIR/package.json" ]; then
    if [ ! -d "$WEB_UI_DIR/node_modules" ]; then
        log_info "安装前端依赖..."
        cd "$WEB_UI_DIR"
        npm install
        cd "$SCRIPT_DIR"
        log_success "前端依赖安装成功"
    else
        log_info "node_modules 已存在，跳过安装"
    fi
fi

echo ""
echo "=================================================="
log_success "安装完成!"
echo "=================================================="
echo ""
echo "后续步骤:"
echo "--------------------------------------------------"
echo "1. 激活虚拟环境: source $VENV_NAME/bin/activate"
echo "2. 启动应用: python start.py"
echo "--------------------------------------------------"
echo ""
echo "或者直接运行一键启动脚本:"
echo "  python start.py"
echo ""
