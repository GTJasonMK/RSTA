"""
一键启动脚本
启动 Python 后端服务和 Electron 前端应用

用法:
  python start.py         # 生产模式（推荐，启动快）
  python start.py --dev   # 开发模式（启动 Vite 开发服务器）
"""

import os
import sys
import time
import signal
import subprocess
from pathlib import Path

# 项目根目录
ROOT_DIR = Path(__file__).resolve().parent
WEB_UI_DIR = ROOT_DIR / "web-ui"
SCRIPTS_DIR = ROOT_DIR / "scripts"
VENV_DIR = ROOT_DIR / ".venv-hymt-gguf"
DIST_DIR = WEB_UI_DIR / "dist"

# 配置
BACKEND_PORT = 8092
VITE_PORT = 5173

# 存储子进程
processes = []


def get_backend_python():
    """获取后端服务使用的 Python 解释器"""
    # 优先使用 .venv-hymt-gguf 虚拟环境（包含 llama-cpp-python）
    if sys.platform == "win32":
        venv_python = VENV_DIR / "Scripts" / "python.exe"
    else:
        venv_python = VENV_DIR / "bin" / "python"

    if venv_python.exists():
        return str(venv_python)

    # 回退到当前 Python
    return sys.executable


def log(msg):
    print(f"[Launcher] {msg}")


def start_backend():
    """启动 Python 后端服务"""
    backend_python = get_backend_python()
    log(f"启动后端服务 (端口 {BACKEND_PORT})...")
    env = os.environ.copy()
    env["PORT"] = str(BACKEND_PORT)

    # 禁用 PIR 避免兼容性问题（但保留 MKLDNN 以获得更好的 CPU 性能）
    env["FLAGS_enable_pir_api"] = "0"
    env["FLAGS_enable_pir_in_executor"] = "0"
    env["FLAGS_pir_apply_inplace_pass"] = "0"
    env["FLAGS_enable_pir_with_pt_kernel"] = "0"
    env["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

    proc = subprocess.Popen(
        [backend_python, str(SCRIPTS_DIR / "serve_unified.py")],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        encoding="utf-8",
        errors="replace",
        bufsize=1
    )
    processes.append(("Backend", proc))
    return proc


def start_vite():
    """启动 Vite 开发服务器（仅开发模式）"""
    log(f"启动 Vite 开发服务器 (端口 {VITE_PORT})...")

    proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=WEB_UI_DIR,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        encoding="utf-8",
        errors="replace",
        bufsize=1
    )
    processes.append(("Vite", proc))
    return proc


def start_electron(dev_mode=False):
    """启动 Electron 应用"""
    log("启动 Electron 应用...")
    env = os.environ.copy()

    # 生产模式不设置 NODE_ENV=development，让 Electron 加载 dist 目录
    if dev_mode:
        env["NODE_ENV"] = "development"

    proc = subprocess.Popen(
        ["npm", "run", "start"],
        cwd=WEB_UI_DIR,
        shell=True,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        encoding="utf-8",
        errors="replace",
        bufsize=1
    )
    processes.append(("Electron", proc))
    return proc


def wait_for_vite(timeout=30):
    """等待 Vite 服务器就绪"""
    import urllib.request

    log("等待 Vite 服务器就绪...")
    start_time = time.time()

    while time.time() - start_time < timeout:
        req = None
        try:
            req = urllib.request.urlopen(f"http://127.0.0.1:{VITE_PORT}", timeout=2)
            if req.status == 200:
                log("Vite 服务器已就绪")
                return True
        except Exception:
            pass
        finally:
            if req is not None:
                try:
                    req.close()
                except Exception:
                    pass
        time.sleep(0.5)

    log("警告: Vite 服务器启动超时")
    return False


def wait_for_backend(timeout=30):
    """等待后端服务就绪"""
    import socket

    log("等待后端服务就绪...")
    start_time = time.time()

    while time.time() - start_time < timeout:
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex(("127.0.0.1", BACKEND_PORT))
            if result == 0:
                log("后端服务已就绪")
                return True
        except Exception:
            pass
        finally:
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass
        time.sleep(0.3)

    log("警告: 后端服务启动超时")
    return False


def build_frontend():
    """构建前端（如果 dist 不存在）"""
    if DIST_DIR.exists() and (DIST_DIR / "index.html").exists():
        log("前端已构建，跳过构建步骤")
        return True

    log("首次运行，正在构建前端...")
    log("（这可能需要一些时间，后续启动会很快）")

    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=WEB_UI_DIR,
        shell=True,
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        log(f"前端构建失败: {result.stderr}")
        return False

    log("前端构建完成")
    return True


def _stream_reader(proc, name):
    """在独立线程中持续读取进程输出并打印"""
    try:
        for line in proc.stdout:
            print(f"[{name}] {line.rstrip()}")
    except (IOError, ValueError, OSError):
        pass


def cleanup():
    """清理所有子进程"""
    log("正在关闭所有服务...")

    for name, proc in processes:
        try:
            if proc.poll() is None:
                log(f"终止 {name}...")
                if sys.platform == "win32":
                    try:
                        subprocess.run(
                            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                            capture_output=True,
                            timeout=5
                        )
                    except subprocess.TimeoutExpired:
                        log(f"警告: 终止 {name} 超时")
                    except Exception as e:
                        log(f"警告: 终止 {name} 失败: {e}")
                else:
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    except Exception as e:
                        log(f"警告: 终止 {name} 失败: {e}")
        except Exception as e:
            log(f"警告: 清理 {name} 时出错: {e}")

    for name, proc in processes:
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            log(f"警告: {name} 未能在超时时间内终止")
        except Exception:
            pass

    # Windows: 按端口清理残留进程
    if sys.platform == "win32":
        for port in [BACKEND_PORT, VITE_PORT]:
            try:
                result = subprocess.run(
                    ["netstat", "-ano"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                for line in result.stdout.splitlines():
                    if f":{port}" in line and "LISTENING" in line:
                        parts = line.split()
                        if parts:
                            pid = parts[-1]
                            if pid.isdigit():
                                subprocess.run(
                                    ["taskkill", "/F", "/PID", pid],
                                    capture_output=True,
                                    timeout=3
                                )
                                log(f"清理端口 {port} 上的残留进程 (PID: {pid})")
            except Exception:
                pass

    log("所有服务已关闭")


def signal_handler(signum, frame):
    """处理退出信号"""
    print()
    cleanup()
    sys.exit(0)


def main():
    # 解析参数
    dev_mode = "--dev" in sys.argv

    # 注册信号处理
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    if sys.platform == "win32":
        signal.signal(signal.SIGBREAK, signal_handler)

    log("=" * 50)
    log("实时屏幕翻译 - 一键启动")
    log(f"模式: {'开发模式' if dev_mode else '生产模式（快速启动）'}")
    log("=" * 50)

    try:
        if dev_mode:
            # 开发模式：启动 Vite 开发服务器
            backend_proc = start_backend()
            vite_proc = start_vite()
            wait_for_backend()
            wait_for_vite()
            time.sleep(0.5)
            electron_proc = start_electron(dev_mode=True)

            log("=" * 50)
            log("所有服务已启动（开发模式）")
            log(f"  后端服务: http://127.0.0.1:{BACKEND_PORT}")
            log(f"  Vite 服务: http://127.0.0.1:{VITE_PORT}")
            log("按 Ctrl+C 停止所有服务")
            log("=" * 50)
        else:
            # 生产模式：使用预构建的前端
            if not build_frontend():
                log("错误: 前端构建失败，无法启动")
                return

            backend_proc = start_backend()
            wait_for_backend()

            # 生产模式下不需要等待 Vite，直接启动 Electron
            electron_proc = start_electron(dev_mode=False)

            log("=" * 50)
            log("所有服务已启动（生产模式）")
            log(f"  后端服务: http://127.0.0.1:{BACKEND_PORT}")
            log("按 Ctrl+C 停止所有服务")
            log("=" * 50)

        # 启动独立线程读取每个进程的输出
        import threading
        for name, proc in processes:
            t = threading.Thread(target=_stream_reader, args=(proc, name), daemon=True)
            t.start()

        # 监控进程状态
        while True:
            if electron_proc.poll() is not None:
                log("Electron 已退出，正在关闭其他服务...")
                break

            all_dead = all(proc.poll() is not None for _, proc in processes)
            if all_dead:
                break

            time.sleep(0.5)

    except KeyboardInterrupt:
        pass
    except Exception as e:
        log(f"错误: {e}")
    finally:
        cleanup()


if __name__ == "__main__":
    main()
