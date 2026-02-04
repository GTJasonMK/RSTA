import json
import sys
from pathlib import Path


def get_config_path() -> Path:
    """获取配置文件路径，支持打包和开发两种环境"""
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后：从工作目录或可执行文件目录查找
        # 优先使用工作目录（Electron 会设置工作目录为 resources）
        cwd_config = Path.cwd() / "config.json"
        if cwd_config.exists():
            return cwd_config
        # 其次使用可执行文件所在目录
        exe_dir = Path(sys.executable).parent
        exe_config = exe_dir / "config.json"
        if exe_config.exists():
            return exe_config
        # 再查找上级目录
        parent_config = exe_dir.parent / "config.json"
        if parent_config.exists():
            return parent_config
        # 默认返回工作目录
        return cwd_config
    else:
        # 开发环境：rsta/ -> project_root
        return Path(__file__).resolve().parents[1] / "config.json"


CONFIG_PATH = get_config_path()

DEFAULT_CONFIG = {
    "hotkey": "Ctrl+Alt+Q",
    "swap_hotkey": "Ctrl+Alt+A",
    "close_overlay_hotkey": "Escape",
    "ocr_lang": "eng",
    "ocr_engine": "paddleocr",
    "source_lang": "en",
    "target_lang": "zh",
    "translator": "unified",
    "libretranslate": {
        "url": "http://localhost:5000/translate",
        "api_key": "",
        "stream": True
    },
    "model_dir": "models",
    "paddleocr": {
        "lang": "en",
        "ocr_version": "PP-OCRv5",
        "model_type": "mobile",
        "use_textline_orientation": True,
        "use_gpu": False,
        "auto_download": False,
        "debug": False,
        "debug_capture": False,
        "debug_capture_dir": "models/debug_captures",
        "text_rec_score_thresh": 0.3,
        "box_thresh": 0.3,
        "unclip_ratio": 1.6,
        "max_side": 1800,
        "min_side_for_upscale": 100
    },
    "local_service": {
        "host": "127.0.0.1",
        "port": 8092,
        "model_repo": "tencent/HY-MT1.5-1.8B-GGUF",
        "quant": "Q6_K"
    },
    "unified_service": {
        "host": "127.0.0.1",
        "port": 8092,
        "timeout": 30,
        "ocr_model_type": "mobile",
        "preload_ocr": []
    },
    "startup": {
        "auto_load_ocr": False,
        "auto_load_translator": False
    },
    "ui": {
        "overlay_max_width": 300
    },
    "llm": {
        "api_key": "",
        "base_url": "",
        "model": "",
        "max_tokens": 2048,
        "temperature": 0.7
    }
}


def merge_config(base, override):
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merge_config(result[key], value)
        else:
            result[key] = value
    return result


def load_config():
    if not CONFIG_PATH.exists():
        return DEFAULT_CONFIG
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    return merge_config(DEFAULT_CONFIG, raw)


def save_config(config):
    """保存配置到文件"""
    with CONFIG_PATH.open("w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
