"""
常量和语言映射模块
"""

# 语言名称映射（用于翻译提示）
LANG_MAP = {
    "en": "English",
    "zh": "Chinese",
    "zh-cn": "Chinese",
    "zh-hans": "Chinese",
    "zh-hant": "Traditional Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "ru": "Russian",
    "pt": "Portuguese",
    "it": "Italian",
    "vi": "Vietnamese",
}

# OCR 语言代码映射（用于 PaddleOCR）
OCR_LANG_MAP = {
    "en": "en",
    "zh": "ch",
    "zh-cn": "ch",
    "zh-hans": "ch",
    "zh-hant": "chinese_cht",
    "ja": "japan",
    "ko": "korean",
    "fr": "fr",
    "de": "german",
    "es": "es",
    "ru": "ru",
    "pt": "pt",
    "it": "it",
    "vi": "vi",
}

# LLM 语言名称映射（用于解析提示）
LLM_LANG_NAMES = {
    "en": "英语",
    "zh": "中文",
    "ja": "日语",
    "ko": "韩语",
    "fr": "法语",
    "de": "德语",
    "es": "西班牙语",
    "ru": "俄语",
}


def normalize_lang(lang: str) -> str:
    """将语言代码转换为语言名称"""
    key = lang.strip().lower()
    return LANG_MAP.get(key, lang)


def is_chinese(lang: str) -> bool:
    """判断是否是中文"""
    key = lang.lower()
    return key in {"chinese", "traditional chinese", "zh", "zh-cn", "zh-hans", "zh-hant"}


def get_ocr_lang(lang: str) -> str:
    """获取 OCR 语言代码"""
    return OCR_LANG_MAP.get(lang, "en")


def get_llm_lang_name(lang: str) -> str:
    """获取 LLM 显示的语言名称"""
    return LLM_LANG_NAMES.get(lang, lang)
