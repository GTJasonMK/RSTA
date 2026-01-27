"""
服务器模块
提供 OCR、翻译和 LLM 解析服务
"""

from .logging_config import LOG_BUFFER, setup_logging
from .constants import (
    LANG_MAP, OCR_LANG_MAP, LLM_LANG_NAMES,
    normalize_lang, is_chinese, get_ocr_lang, get_llm_lang_name
)
from .schemas import (
    OcrRequest, OcrResponse,
    TranslateRequest, TranslateResponse,
    ModelsResponse, DownloadModelRequest,
    PreloadRequest, AnalyzeRequest
)
from .state import STATE, SCRIPT_DIR
from .ocr_service import do_ocr, extract_ocr_text
from .translate_service import build_prompt, load_translate_model
from .llm_client import LLMClient, ANALYZE_PROMPT_TEMPLATE

__all__ = [
    # 日志
    'LOG_BUFFER', 'setup_logging',
    # 常量
    'LANG_MAP', 'OCR_LANG_MAP', 'LLM_LANG_NAMES',
    'normalize_lang', 'is_chinese', 'get_ocr_lang', 'get_llm_lang_name',
    # 模型
    'OcrRequest', 'OcrResponse',
    'TranslateRequest', 'TranslateResponse',
    'ModelsResponse', 'DownloadModelRequest',
    'PreloadRequest', 'AnalyzeRequest',
    # 状态
    'STATE', 'SCRIPT_DIR',
    # 服务
    'do_ocr', 'extract_ocr_text',
    'build_prompt', 'load_translate_model',
    'LLMClient', 'ANALYZE_PROMPT_TEMPLATE',
]
