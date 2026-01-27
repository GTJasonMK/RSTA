"""
Pydantic 请求/响应模型
"""

from typing import Optional, List
from pydantic import BaseModel


class OcrRequest(BaseModel):
    """OCR 请求"""
    image: str  # base64 编码的图片
    lang: str = "en"
    model_type: str = "mobile"  # mobile 或 server


class OcrResponse(BaseModel):
    """OCR 响应"""
    text: str
    model_type: str


class TranslateRequest(BaseModel):
    """翻译请求"""
    q: Optional[str] = None
    text: Optional[str] = None
    source: str = "en"
    target: str = "zh"
    format: Optional[str] = None
    api_key: Optional[str] = None


class TranslateResponse(BaseModel):
    """翻译响应"""
    translatedText: str


class ModelsResponse(BaseModel):
    """模型列表响应"""
    ocr_models: List[str]
    ocr_loaded: List[str]
    translate_model: Optional[str]


class DownloadModelRequest(BaseModel):
    """下载模型请求"""
    model_type: str  # "ocr" or "translate"


class PreloadRequest(BaseModel):
    """预加载请求"""
    model_type: str = "mobile"
    lang: str = "en"


class AnalyzeRequest(BaseModel):
    """LLM 分析请求"""
    text: str  # 要解析的文本
    source_lang: str = "en"  # 源语言
    target_lang: str = "zh"  # 目标语言
