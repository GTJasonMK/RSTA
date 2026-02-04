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


# ============== 笔记本相关模型 ==============

class NotebookRecord(BaseModel):
    """笔记本记录"""
    id: Optional[int] = None
    created_at: Optional[str] = None
    date_key: Optional[str] = None
    ocr_text: str
    translated_text: Optional[str] = None
    analysis_text: Optional[str] = None
    source_lang: str = "en"
    target_lang: str = "zh"


class NotebookSaveRequest(BaseModel):
    """保存笔记本记录请求"""
    ocr_text: str
    translated_text: Optional[str] = None
    analysis_text: Optional[str] = None
    source_lang: str = "en"
    target_lang: str = "zh"


class NotebookUpdateRequest(BaseModel):
    """更新笔记本记录请求"""
    analysis_text: Optional[str] = None


class NotebookDatesResponse(BaseModel):
    """日期列表响应"""
    dates: List[str]
    counts: dict


class NotebookRecordsResponse(BaseModel):
    """记录列表响应"""
    records: List[NotebookRecord]


# ============== QA 模式相关模型 ==============

class QAPair(BaseModel):
    """单轮QA对话"""
    q: str  # 问题
    a: str  # 回答


class QASaveRequest(BaseModel):
    """保存QA记录请求（OCR完成后）"""
    ocr_text: str
    source_lang: str = "en"
    target_lang: str = "zh"


class QAAskRequest(BaseModel):
    """提问请求"""
    record_id: int
    question: str
    ocr_text: str  # 用于构建上下文
    source_lang: str = "en"
    target_lang: str = "zh"


class QAHistoryResponse(BaseModel):
    """QA历史响应"""
    record_id: int
    qa_list: List[QAPair]

