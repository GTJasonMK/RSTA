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
