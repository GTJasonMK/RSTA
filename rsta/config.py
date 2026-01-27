import json
from pathlib import Path


CONFIG_PATH = Path(__file__).resolve().parents[1] / "config.json"

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
        "lang": "en",  # 与 source_lang 保持一致
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
        "min_side_for_upscale": 100  # 小图片放大阈值
    },
    "tesseract_cmd": "",
    "local_service": {
        "enabled": True,
        "type": "hymt_gguf",
        "host": "127.0.0.1",
        "port": 8092,
        "model_repo": "tencent/HY-MT1.5-1.8B-GGUF",
        "quant": "Q6_K",
        "auto_download": False,
        "auto_install": True,
        "venv": ".venv-hymt-gguf",
        "script_win": "scripts/deploy_hymt_gguf.ps1",
        "script_unix": "scripts/deploy_hymt_gguf.sh"
    },
    "unified_service": {
        "enabled": False,
        "host": "127.0.0.1",
        "port": 8092,
        "timeout": 30,
        "ocr_model_type": "mobile",
        "preload_ocr": [],
        "script_win": "scripts/deploy_unified.ps1",
        "script_unix": "scripts/deploy_unified.sh"
    },
    "startup": {
        "auto_load_ocr": False,  # 默认禁用，按需加载更快启动
        "auto_load_translator": False,  # 默认禁用，按需加载更快启动
        "auto_start_unified_service": False,
        "auto_start_local_service": False
    },
    "ui": {
        "poll_ms": 100,
        "capture_delay_ms": 120,
        "overlay_max_width": 300,
        "overlay_max_height": 0
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
