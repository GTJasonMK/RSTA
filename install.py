"""
一键安装依赖脚本
使用 uv 进行 Python 包管理，比 pip 快 10-100 倍
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

# 项目根目录
ROOT_DIR = Path(__file__).resolve().parent
WEB_UI_DIR = ROOT_DIR / "web-ui"
VENV_NAME = ".venv-hymt-gguf"
VENV_DIR = ROOT_DIR / VENV_NAME


def log(msg: str, level: str = "INFO"):
    """打印日志"""
    colors = {
        "INFO": "\033[36m",     # 青色
        "SUCCESS": "\033[32m",  # 绿色
        "WARNING": "\033[33m",  # 黄色
        "ERROR": "\033[31m",    # 红色
    }
    reset = "\033[0m"
    color = colors.get(level, "")
    print(f"{color}[{level}]{reset} {msg}")


def run_command(cmd: list, cwd: Path = None, check: bool = True) -> subprocess.CompletedProcess:
    """运行命令"""
    log(f"运行: {' '.join(cmd)}")
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            check=check,
            capture_output=True,
            text=True
        )
        return result
    except subprocess.CalledProcessError as e:
        log(f"命令失败: {e.stderr}", "ERROR")
        raise


def check_uv_installed() -> bool:
    """检查 uv 是否已安装"""
    return shutil.which("uv") is not None


def install_uv():
    """安装 uv"""
    log("正在安装 uv...")

    if sys.platform == "win32":
        # Windows: 使用 PowerShell 安装
        cmd = [
            "powershell", "-ExecutionPolicy", "ByPass", "-c",
            "irm https://astral.sh/uv/install.ps1 | iex"
        ]
    else:
        # Unix: 使用 curl 安装
        cmd = ["sh", "-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"]

    try:
        subprocess.run(cmd, check=True)
        log("uv 安装成功", "SUCCESS")

        # 提示用户重新加载 PATH
        if sys.platform == "win32":
            log("请重新打开终端或运行以下命令刷新环境变量:", "WARNING")
            log('  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")')
        else:
            log("请运行 'source ~/.bashrc' 或重新打开终端", "WARNING")

        return True
    except subprocess.CalledProcessError:
        log("uv 安装失败，尝试使用 pip 安装...", "WARNING")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "uv"], check=True)
            log("uv (通过 pip) 安装成功", "SUCCESS")
            return True
        except subprocess.CalledProcessError:
            log("uv 安装失败", "ERROR")
            return False


def check_node_installed() -> bool:
    """检查 Node.js 是否已安装"""
    return shutil.which("node") is not None and shutil.which("npm") is not None


def create_venv_and_install():
    """创建虚拟环境并安装 Python 依赖"""
    log(f"创建虚拟环境: {VENV_DIR}")

    # 使用 uv 创建虚拟环境
    run_command(["uv", "venv", str(VENV_DIR), "--python", "3.10"])

    # 获取虚拟环境中的 Python 路径
    if sys.platform == "win32":
        venv_python = VENV_DIR / "Scripts" / "python.exe"
    else:
        venv_python = VENV_DIR / "bin" / "python"

    # 使用 uv pip 安装依赖
    log("安装 Python 依赖...")
    requirements_file = ROOT_DIR / "requirements.txt"

    if requirements_file.exists():
        run_command([
            "uv", "pip", "install",
            "-r", str(requirements_file),
            "--python", str(venv_python)
        ])
        log("Python 依赖安装成功", "SUCCESS")
    else:
        log("未找到 requirements.txt，跳过 Python 依赖安装", "WARNING")


def install_node_dependencies():
    """安装 Node.js 依赖"""
    if not WEB_UI_DIR.exists():
        log(f"未找到 web-ui 目录: {WEB_UI_DIR}", "WARNING")
        return

    package_json = WEB_UI_DIR / "package.json"
    if not package_json.exists():
        log("未找到 package.json，跳过前端依赖安装", "WARNING")
        return

    node_modules = WEB_UI_DIR / "node_modules"
    if node_modules.exists():
        log("node_modules 已存在，跳过安装", "INFO")
        return

    log("安装前端依赖...")
    run_command(["npm", "install"], cwd=WEB_UI_DIR)
    log("前端依赖安装成功", "SUCCESS")


def print_summary():
    """打印安装摘要"""
    print("\n" + "=" * 50)
    log("安装完成!", "SUCCESS")
    print("=" * 50)

    print("\n后续步骤:")
    print("-" * 50)

    if sys.platform == "win32":
        activate_cmd = f"{VENV_NAME}\\Scripts\\activate"
    else:
        activate_cmd = f"source {VENV_NAME}/bin/activate"

    print(f"1. 激活虚拟环境: {activate_cmd}")
    print("2. 启动应用: python start.py")
    print("-" * 50)

    print("\n或者直接运行一键启动脚本:")
    print("  python start.py")
    print()


def main():
    print("=" * 50)
    print("RSTA 一键安装脚本")
    print("=" * 50)
    print()

    # 检查 Python 版本
    if sys.version_info < (3, 10):
        log(f"Python 版本过低: {sys.version}", "ERROR")
        log("需要 Python 3.10 或更高版本", "ERROR")
        sys.exit(1)
    log(f"Python 版本: {sys.version.split()[0]}", "SUCCESS")

    # 检查并安装 uv
    if not check_uv_installed():
        log("未检测到 uv，开始安装...", "WARNING")
        if not install_uv():
            log("无法安装 uv，请手动安装后重试", "ERROR")
            log("安装方法: pip install uv", "INFO")
            sys.exit(1)

        # 重新检查
        if not check_uv_installed():
            log("uv 安装后需要重新打开终端", "WARNING")
            log("或者尝试: pip install uv", "INFO")
            sys.exit(1)
    else:
        log("uv 已安装", "SUCCESS")

    # 检查 Node.js
    if not check_node_installed():
        log("未检测到 Node.js", "WARNING")
        log("请先安装 Node.js: https://nodejs.org/", "ERROR")
        sys.exit(1)
    else:
        result = subprocess.run(["node", "--version"], capture_output=True, text=True)
        log(f"Node.js 版本: {result.stdout.strip()}", "SUCCESS")

    print()

    # 创建虚拟环境并安装 Python 依赖
    try:
        create_venv_and_install()
    except Exception as e:
        log(f"Python 依赖安装失败: {e}", "ERROR")
        sys.exit(1)

    print()

    # 安装 Node.js 依赖
    try:
        install_node_dependencies()
    except Exception as e:
        log(f"前端依赖安装失败: {e}", "ERROR")
        sys.exit(1)

    # 打印摘要
    print_summary()


if __name__ == "__main__":
    main()
