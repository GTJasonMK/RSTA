"""
OCR 服务模块
提供 OCR 引擎加载和文本识别功能
"""

import io
import os
import logging
from pathlib import Path
from typing import List, Optional

from .constants import get_ocr_lang

logger = logging.getLogger(__name__)


def extract_ocr_text(result) -> str:
    """从 PaddleOCR 结果中提取文本"""
    texts = []
    results = result if isinstance(result, list) else [result]

    for item in results:
        data = None
        if hasattr(item, "json"):
            try:
                data = item.json
            except Exception:
                pass
        if data is None and hasattr(item, "to_dict"):
            try:
                data = item.to_dict()
            except Exception:
                pass
        if data is None and isinstance(item, dict):
            data = item

        if data is not None:
            texts.extend(_extract_text_from_data(data))

    return "\n".join([t for t in texts if t]).strip()


def _extract_text_from_data(data) -> List[str]:
    """递归提取文本"""
    texts = []
    if isinstance(data, str):
        return [data]
    if isinstance(data, (list, tuple)):
        if len(data) >= 2 and isinstance(data[0], str) and isinstance(data[1], (int, float)):
            texts.append(data[0])
        if len(data) >= 2 and isinstance(data[1], (list, tuple)) and data[1]:
            if isinstance(data[1][0], str):
                texts.append(data[1][0])
        for item in data:
            texts.extend(_extract_text_from_data(item))
        return texts
    if isinstance(data, dict):
        for key in ("rec_texts", "rec_text", "text", "label", "transcription", "content"):
            value = data.get(key)
            if isinstance(value, str):
                texts.append(value)
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        texts.append(item)
                    else:
                        texts.extend(_extract_text_from_data(item))
        res_value = data.get("res")
        if res_value is not None:
            texts.extend(_extract_text_from_data(res_value))
        return texts
    return texts


def do_ocr(image_bytes: bytes, model_type: str, lang: str, state) -> str:
    """执行 OCR

    Args:
        image_bytes: 图片字节数据
        model_type: 模型类型 (mobile/server)
        lang: 语言代码
        state: ServiceState 实例

    Returns:
        识别的文本
    """
    import numpy as np
    from PIL import Image

    engine = state.load_ocr_engine(model_type, lang)

    # 读取配置
    config = state._load_config()
    paddle_cfg = config.get("paddleocr", {})

    # 解码图片
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    width, height = image.size

    # 对于太小的图片，进行放大以提高 OCR 识别率
    MIN_SIDE_FOR_UPSCALE = int(paddle_cfg.get("min_side_for_upscale", 100))
    if min(width, height) < MIN_SIDE_FOR_UPSCALE:
        scale = MIN_SIDE_FOR_UPSCALE / min(width, height)
        new_width = int(width * scale)
        new_height = int(height * scale)
        image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
        logger.info(f"图片放大: {width}x{height} -> {new_width}x{new_height}")
        width, height = new_width, new_height

    # 验证图片尺寸
    MIN_OCR_SIZE = 32
    if width < MIN_OCR_SIZE or height < MIN_OCR_SIZE:
        logger.warning(f"图片尺寸过小 ({width}x{height})，无法进行 OCR 识别")
        return ""

    # 限制图片最大边长
    MAX_SIDE = int(paddle_cfg.get("max_side", 1800))
    if max(width, height) > MAX_SIDE:
        scale = MAX_SIDE / max(width, height)
        new_width = int(width * scale)
        new_height = int(height * scale)
        image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
        logger.debug(f"图片缩放: {width}x{height} -> {new_width}x{new_height}")

    img_array = np.array(image)

    # 根据后端类型执行 OCR
    backend = getattr(engine, "_backend", "paddleocr")

    if backend == "rapidocr":
        # RapidOCR: 直接调用，返回 (result, elapse)
        result, _ = engine(img_array, use_cls=False)
        if result is None:
            return ""
        texts = [item[1] for item in result if item and len(item) >= 2]
        return "\n".join(texts).strip()
    else:
        # PaddleOCR: RGB -> BGR
        img_bgr = img_array[:, :, ::-1].copy()
        if hasattr(engine, "predict"):
            result = engine.predict(img_bgr)
        else:
            result = engine.ocr(img_bgr)
        return extract_ocr_text(result)
