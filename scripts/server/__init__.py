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
    PreloadRequest, AnalyzeRequest,
    NotebookRecord, NotebookSaveRequest, NotebookUpdateRequest,
    NotebookDatesResponse, NotebookRecordsResponse,
    QAPair, QASaveRequest, QAAskRequest, QAHistoryResponse
)
from .state import STATE, SCRIPT_DIR
from .ocr_service import do_ocr, extract_ocr_text
from .translate_service import build_prompt, load_translate_model
from .llm_client import LLMClient, ANALYZE_PROMPT_TEMPLATE, QA_SYSTEM_PROMPT, QA_USER_PROMPT, format_qa_history
from . import notebook_service

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
    'NotebookRecord', 'NotebookSaveRequest', 'NotebookUpdateRequest',
    'NotebookDatesResponse', 'NotebookRecordsResponse',
    'QAPair', 'QASaveRequest', 'QAAskRequest', 'QAHistoryResponse',
    # 状态
    'STATE', 'SCRIPT_DIR',
    # 服务
    'do_ocr', 'extract_ocr_text',
    'build_prompt', 'load_translate_model',
    'LLMClient', 'ANALYZE_PROMPT_TEMPLATE', 'QA_SYSTEM_PROMPT', 'QA_USER_PROMPT', 'format_qa_history',
    'notebook_service',
]
