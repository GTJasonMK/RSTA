import base64
import inspect
import io
import os
from datetime import datetime
from pathlib import Path

import requests
from PIL import Image
import pytesseract

from rsta.config import CONFIG_PATH


class TesseractOcrEngine:
    def __init__(self, lang):
        self.lang = lang

    def read_text(self, image):
        text = pytesseract.image_to_string(image, lang=self.lang)
        return text.strip()


class HttpOcrEngine:
    """
    通过 HTTP API 调用远程 OCR 服务的引擎。
    与统一服务 (serve_unified.py) 配合使用。
    """

    def __init__(self, config):
        service_cfg = config.get("unified_service", {})
        host = service_cfg.get("host", "127.0.0.1")
        port = service_cfg.get("port", 8092)
        self.base_url = f"http://{host}:{port}"
        self.ocr_url = f"{self.base_url}/ocr"
        self.timeout = service_cfg.get("timeout", 30)
        self.model_type = service_cfg.get("ocr_model_type", "mobile")
        self.lang = config.get("source_lang", "en")
        self.debug = bool(config.get("paddleocr", {}).get("debug", False))
        self.debug_capture = bool(config.get("paddleocr", {}).get("debug_capture", False))
        debug_dir = config.get("paddleocr", {}).get("debug_capture_dir", "models/debug_captures")
        self.debug_capture_dir = Path(debug_dir)
        if not self.debug_capture_dir.is_absolute():
            self.debug_capture_dir = CONFIG_PATH.parent / self.debug_capture_dir

    def read_text(self, image):
        """
        将图片编码为 base64 并发送到 OCR 服务。

        参数:
            image: PIL.Image 对象

        返回:
            str: 识别的文本
        """
        if self.debug_capture:
            self.save_debug_images(image)

        # 将图片转换为 base64
        rgb_image = image.convert("RGB")
        with io.BytesIO() as buffer:
            rgb_image.save(buffer, format="PNG")
            image_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

        # 构建请求
        payload = {
            "image": image_base64,
            "lang": self.lang,
            "model_type": self.model_type,
        }

        try:
            response = requests.post(
                self.ocr_url,
                json=payload,
                timeout=self.timeout,
            )
            response.raise_for_status()
            result = response.json()
            text = result.get("text", "")
            if self.debug:
                print(f"[HttpOCR] 识别结果: {text[:100]}..." if len(text) > 100 else f"[HttpOCR] 识别结果: {text}")
            return text
        except requests.exceptions.Timeout:
            raise RuntimeError(f"OCR 服务超时 ({self.timeout}s)")
        except requests.exceptions.ConnectionError:
            raise RuntimeError(f"无法连接 OCR 服务: {self.base_url}")
        except requests.exceptions.HTTPError as e:
            detail = ""
            status_code = "unknown"
            if e.response is not None:
                status_code = e.response.status_code
                try:
                    detail = e.response.json().get("detail", "")
                except Exception:
                    pass
            raise RuntimeError(f"OCR 服务错误: {status_code} {detail}")
        except Exception as e:
            raise RuntimeError(f"OCR 请求失败: {e}")

    def save_debug_images(self, image):
        """保存调试图片"""
        try:
            base_dir = self.debug_capture_dir
            base_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
            raw_path = base_dir / f"ocr_http_{stamp}.png"
            image.save(raw_path)
            if self.debug:
                print(f"[HttpOCR] 已保存图片: {raw_path}")
        except Exception:
            pass


class PaddleOcrEngine:
    def __init__(self, config, fallback_lang):
        try:
            from paddleocr import PaddleOCR
        except Exception as exc:
            raise RuntimeError(f"paddleocr import failed: {exc}") from exc
        try:
            import numpy as np
        except Exception as exc:
            raise RuntimeError(f"numpy import failed: {exc}") from exc

        paddle_cfg = config.get("paddleocr", {})
        lang = paddle_cfg.get("lang") or map_tesseract_lang_to_paddle(fallback_lang)
        self.use_textline_orientation = bool(
            paddle_cfg.get("use_textline_orientation", paddle_cfg.get("use_angle_cls", True))
        )
        self.np = np
        self.debug = bool(paddle_cfg.get("debug", False))
        self.debug_capture = bool(paddle_cfg.get("debug_capture", self.debug))
        debug_dir = paddle_cfg.get("debug_capture_dir", "models/debug_captures")
        self.debug_capture_dir = Path(debug_dir)
        if not self.debug_capture_dir.is_absolute():
            self.debug_capture_dir = CONFIG_PATH.parent / self.debug_capture_dir
        self.max_side = int(paddle_cfg.get("max_side", 1800))

        # 设置模型下载目录到项目的 models 目录
        model_dir = config.get("model_dir", "models")
        model_path = Path(model_dir)
        if not model_path.is_absolute():
            model_path = CONFIG_PATH.parent / model_path
        paddleocr_home = model_path / "paddleocr"
        paddleocr_home.mkdir(parents=True, exist_ok=True)
        import os
        os.environ["PADDLEOCR_HOME"] = str(paddleocr_home)

        # 检查是否允许自动下载
        auto_download = bool(paddle_cfg.get("auto_download", False))

        # 检查模型是否存在
        whl_dir = paddleocr_home / "whl"
        has_models = whl_dir.exists() and any(whl_dir.iterdir()) if whl_dir.exists() else False

        if not has_models and not auto_download:
            raise RuntimeError(
                f"\n{'='*60}\n"
                f"OCR 模型未找到！\n"
                f"{'='*60}\n\n"
                f"模型目录: {paddleocr_home}\n\n"
                f"请选择以下方式之一：\n"
                f"  1. 在 config.json 中设置 paddleocr.auto_download = true 允许自动下载\n"
                f"  2. 手动下载模型到上述目录\n\n"
                f"PaddleOCR 模型下载地址：\n"
                f"  https://github.com/PaddlePaddle/PaddleOCR/blob/main/doc/doc_ch/models_list.md\n"
                f"{'='*60}\n"
            )

        if not has_models:
            print(f"\n{'='*60}")
            print("正在下载 OCR 模型（首次使用需要下载）...")
            print(f"模型将保存到: {paddleocr_home}")
            print(f"{'='*60}\n")

        signature = inspect.signature(PaddleOCR)
        allowed = signature.parameters
        kwargs = {}

        def set_if(name, value):
            if name in allowed:
                kwargs[name] = value

        set_if("lang", lang)
        set_if("ocr_version", paddle_cfg.get("ocr_version", "PP-OCRv5"))
        # 支持指定 mobile/server 模型变体
        model_type = paddle_cfg.get("model_type", "server")  # "mobile" 或 "server"
        if model_type == "mobile":
            set_if("text_detection_model_name", paddle_cfg.get("text_detection_model_name", "PP-OCRv5_mobile_det"))
            set_if("text_recognition_model_name", paddle_cfg.get("text_recognition_model_name", "PP-OCRv5_mobile_rec"))
        elif paddle_cfg.get("text_detection_model_name"):
            set_if("text_detection_model_name", paddle_cfg.get("text_detection_model_name"))
            set_if("text_recognition_model_name", paddle_cfg.get("text_recognition_model_name"))
        if "device" in allowed:
            device = "gpu" if bool(paddle_cfg.get("use_gpu", False)) else "cpu"
            set_if("device", device)
        elif "use_gpu" in allowed:
            set_if("use_gpu", bool(paddle_cfg.get("use_gpu", False)))
        set_if("text_rec_score_thresh", float(paddle_cfg.get("text_rec_score_thresh", 0.3)))
        set_if("box_thresh", float(paddle_cfg.get("box_thresh", 0.3)))
        set_if("unclip_ratio", float(paddle_cfg.get("unclip_ratio", 1.6)))
        set_if("det_db_box_thresh", float(paddle_cfg.get("box_thresh", 0.3)))
        set_if("det_db_unclip_ratio", float(paddle_cfg.get("unclip_ratio", 1.6)))
        set_if("det_db_thresh", float(paddle_cfg.get("det_db_thresh", 0.2)))
        if "use_textline_orientation" in allowed:
            set_if("use_textline_orientation", self.use_textline_orientation)
        elif "use_angle_cls" in allowed:
            set_if("use_angle_cls", self.use_textline_orientation)

        self.ocr = self.safe_create_ocr(PaddleOCR, kwargs)

    def safe_create_ocr(self, PaddleOCR, kwargs):
        pending = dict(kwargs)
        while True:
            try:
                return PaddleOCR(**pending)
            except Exception as exc:
                message = str(exc)
                if "Unknown argument" not in message:
                    raise
                name = message.split("Unknown argument:", 1)[-1].strip().split()[0]
                if name in pending:
                    pending.pop(name, None)
                    continue
                raise

    def read_text(self, image):
        if self.debug_capture:
            self.save_debug_images(image)
        rgb = image.convert("RGB")
        # PaddleOCR C++ 推理层无法处理过小的图片，会导致 vector<bool> subscript 越界
        width, height = rgb.size
        if width < 32 or height < 32:
            return ""
        if self.max_side:
            scale = min(self.max_side / max(width, height), 1.0)
            if scale < 1.0:
                target = (int(width * scale), int(height * scale))
                rgb = rgb.resize(target, Image.Resampling.BICUBIC)
        img = self.np.array(rgb)[:, :, ::-1].copy()
        method = "predict" if hasattr(self.ocr, "predict") else "ocr"
        result = self._infer(img, method)
        if self.debug:
            self.log_result_summary(result, prefix=f"[OCR] {method} 输出")
        text = self.extract_text(result)
        return text

    def _infer(self, img, method):
        ocr_kwargs = {}
        if method == "predict":
            predict_signature = inspect.signature(self.ocr.predict)
            if "cls" in predict_signature.parameters:
                ocr_kwargs["cls"] = self.use_textline_orientation
            return self.ocr.predict(img, **ocr_kwargs)
        ocr_signature = inspect.signature(self.ocr.ocr)
        if "cls" in ocr_signature.parameters:
            ocr_kwargs["cls"] = self.use_textline_orientation
        return self.ocr.ocr(img, **ocr_kwargs)

    def extract_text(self, result):
        results = result if isinstance(result, list) else [result]
        texts = []
        for item in results:
            data = None
            if hasattr(item, "json"):
                try:
                    data = item.json
                except Exception:
                    data = None
            if data is None and hasattr(item, "to_dict"):
                try:
                    data = item.to_dict()
                except Exception:
                    data = None
            if data is None and isinstance(item, dict):
                data = item
            if data is not None:
                texts.extend(self.extract_text_from_data(data))
            if hasattr(item, "res"):
                try:
                    texts.extend(self.extract_text_from_data(getattr(item, "res")))
                except Exception:
                    pass
        return "\n".join([t for t in texts if t]).strip()

    def extract_text_from_data(self, data):
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
                texts.extend(self.extract_text_from_data(item))
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
                            texts.extend(self.extract_text_from_data(item))
            res_value = data.get("res")
            if res_value is not None:
                texts.extend(self.extract_text_from_data(res_value))
            return texts
        if hasattr(data, "res"):
            try:
                texts.extend(self.extract_text_from_data(getattr(data, "res")))
            except Exception:
                pass
        if hasattr(data, "rec_texts"):
            texts.extend([t for t in getattr(data, "rec_texts") or [] if t])
        if hasattr(data, "rec_text"):
            rec_text = getattr(data, "rec_text")
            if rec_text:
                texts.append(str(rec_text))
        if hasattr(data, "text"):
            text_value = getattr(data, "text")
            if text_value:
                texts.append(str(text_value))
        return texts

    def save_debug_images(self, image):
        try:
            base_dir = self.debug_capture_dir
            base_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
            raw_path = base_dir / f"ocr_raw_{stamp}.png"
            image.save(raw_path)
            if self.debug:
                print(f"[OCR] 已保存原图: {raw_path}")
        except Exception:
            pass

    def log_result_summary(self, result, prefix="[OCR] 原始结果"):
        try:
            if isinstance(result, dict):
                keys = list(result.keys())
                rec_texts = result.get("rec_texts") if isinstance(result.get("rec_texts"), list) else []
                preview = {k: (result[k] if k == "rec_texts" else type(result[k]).__name__) for k in keys[:5]}
                print(f"{prefix}: dict keys={keys} rec_texts={len(rec_texts)} preview={preview}")
                return
            if isinstance(result, list):
                sample = result[0] if result else None
                if sample is not None and hasattr(sample, "json"):
                    try:
                        data = sample.json
                        if isinstance(data, dict):
                            rec_texts = data.get("rec_texts") or []
                            res_value = data.get("res")
                            res_type = type(res_value).__name__
                            if isinstance(res_value, list) and res_value:
                                res_keys = [list(item.keys()) for item in res_value if isinstance(item, dict)]
                            elif isinstance(res_value, dict):
                                res_keys = list(res_value.keys())
                            else:
                                res_keys = []
                            preview = rec_texts[:3] if isinstance(rec_texts, list) else rec_texts
                            print(
                                f"{prefix}: list len={len(result)} sample_json_keys={list(data.keys())} "
                                f"rec_texts={len(rec_texts) if isinstance(rec_texts, list) else 'n/a'} "
                                f"res_type={res_type} res_len={len(res_value) if isinstance(res_value, list) else 'n/a'} "
                                f"res_keys={res_keys[:2]} "
                                f"preview={preview}"
                            )
                            return
                    except Exception:
                        pass
                print(f"{prefix}: list len={len(result)} sample_type={type(sample).__name__}")
                return
            print(f"{prefix}: type={type(result).__name__} value={result}")
        except Exception:
            print(f"{prefix}: <unavailable>")


def map_tesseract_lang_to_paddle(lang):
    if not lang:
        return "ch"
    value = lang.lower()
    if value.startswith("chi"):
        return "ch"
    if value.startswith("eng"):
        return "en"
    return "ch"


def map_source_lang_to_tesseract(lang):
    if not lang:
        return "eng"
    value = lang.lower()
    if value.startswith("zh"):
        if "hant" in value or "tw" in value or "hk" in value or "mo" in value:
            return "chi_tra"
        return "chi_sim"
    if value.startswith("en"):
        return "eng"
    if value.startswith("ja") or value.startswith("jp"):
        return "jpn"
    if value.startswith("ko"):
        return "kor"
    if value.startswith("fr"):
        return "fra"
    if value.startswith("de"):
        return "deu"
    if value.startswith("es"):
        return "spa"
    if value.startswith("ru"):
        return "rus"
    if value.startswith("pt"):
        return "por"
    if value.startswith("it"):
        return "ita"
    if value.startswith("vi"):
        return "vie"
    if value.startswith("id"):
        return "ind"
    if "_" in value:
        return value
    if value.isalpha() and len(value) in (3, 4, 5):
        return value
    return "eng"


# 模型 HuggingFace 仓库 ID
PADDLE_MODEL_REPOS = {
    "PP-OCRv5_mobile_det": "PaddlePaddle/PP-OCRv5_mobile_det",
    "PP-OCRv5_mobile_rec": "PaddlePaddle/PP-OCRv5_mobile_rec",
    "PP-OCRv5_server_det": "PaddlePaddle/PP-OCRv5_server_det",
    "PP-OCRv5_server_rec": "PaddlePaddle/PP-OCRv5_server_rec",
}

# 模型下载地址
PADDLE_MODEL_URLS = {
    name: f"https://huggingface.co/{repo}"
    for name, repo in PADDLE_MODEL_REPOS.items()
}


def create_ocr_engine(config):
    engine = (config.get("ocr_engine") or "tesseract").lower()
    fallback_lang = config.get("ocr_lang", "eng")

    # HTTP OCR 引擎 (通过统一服务)
    if engine == "http":
        return HttpOcrEngine(config), None

    if engine == "paddleocr":
        paddle_cfg = config.get("paddleocr", {})
        auto_download = bool(paddle_cfg.get("auto_download", True))
        if not auto_download:
            missing = _get_missing_paddle_models(config)
            if missing:
                urls = [f"  - {name}: {PADDLE_MODEL_URLS.get(name, 'N/A')}" for name in missing]
                # 获取模型目标路径
                model_dir = config.get("model_dir", "models")
                base = Path(model_dir)
                if not base.is_absolute():
                    base = CONFIG_PATH.parent / base
                target_dir = base / "paddlex" / "official_models"
                return None, (
                    f"PaddleOCR 模型未下载，请手动下载以下模型：\n"
                    + "\n".join(urls)
                    + f"\n\n下载后解压到：{target_dir}"
                )
        try:
            return PaddleOcrEngine(config, fallback_lang), None
        except Exception as exc:
            raise RuntimeError(
                f"PaddleOCR 初始化失败：{exc}。请先安装 PaddleOCR。"
            ) from exc
    if engine == "tesseract":
        return TesseractOcrEngine(fallback_lang), None
    raise ValueError(f"Unknown OCR engine: {engine}")


def create_ocr_engine_with_model_type(config, model_type):
    """
    创建指定模型类型的 PaddleOCR 引擎。
    用于预加载多个模型实现热切换。

    参数:
        config: 配置字典
        model_type: "mobile" 或 "server"

    返回:
        (engine, warning) 元组
    """
    engine_type = (config.get("ocr_engine") or "tesseract").lower()
    if engine_type != "paddleocr":
        return None, f"仅 PaddleOCR 支持模型类型切换，当前引擎: {engine_type}"

    # 创建临时配置，覆盖 model_type
    temp_config = dict(config)
    paddle_cfg = dict(config.get("paddleocr", {}))
    paddle_cfg["model_type"] = model_type
    temp_config["paddleocr"] = paddle_cfg

    # 检查模型是否存在
    auto_download = bool(paddle_cfg.get("auto_download", True))
    if not auto_download:
        missing = _get_missing_paddle_models(temp_config)
        if missing:
            urls = [f"  - {name}: {PADDLE_MODEL_URLS.get(name, 'N/A')}" for name in missing]
            model_dir = config.get("model_dir", "models")
            base = Path(model_dir)
            if not base.is_absolute():
                base = CONFIG_PATH.parent / base
            target_dir = base / "paddlex" / "official_models"
            return None, (
                f"PaddleOCR {model_type} 模型未下载：\n"
                + "\n".join(urls)
                + f"\n\n下载后解压到：{target_dir}"
            )

    fallback_lang = config.get("ocr_lang", "eng")
    try:
        return PaddleOcrEngine(temp_config, fallback_lang), None
    except Exception as exc:
        return None, f"PaddleOCR {model_type} 模型初始化失败：{exc}"


def _get_missing_paddle_models(config):
    """返回缺失的模型名称列表"""
    paddle_cfg = config.get("paddleocr", {})
    model_type = paddle_cfg.get("model_type", "server")

    if model_type == "mobile":
        required = ["PP-OCRv5_mobile_det", "PP-OCRv5_mobile_rec"]
    else:
        required = ["PP-OCRv5_server_det", "PP-OCRv5_server_rec"]

    # 自定义模型名称覆盖默认值
    if paddle_cfg.get("text_detection_model_name"):
        required[0] = paddle_cfg.get("text_detection_model_name")
    if paddle_cfg.get("text_recognition_model_name"):
        required[1] = paddle_cfg.get("text_recognition_model_name")

    candidates = _get_model_search_paths(config)
    missing = []

    for model_name in required:
        found = False
        for base_dir in candidates:
            if not base_dir.exists():
                continue
            # 检查模型目录是否存在
            model_dir = base_dir / "official_models" / model_name
            if model_dir.exists():
                # 检查是否有实际的模型文件
                for pattern in ("*.pdiparams", "*.pdparams"):
                    if list(model_dir.glob(pattern)):
                        found = True
                        break
            if found:
                break
        if not found:
            missing.append(model_name)

    return missing


def get_available_paddle_models(config):
    """
    返回已下载的 PaddleOCR 模型类型列表。
    检测 mobile 和 server 模型是否都已下载。

    返回:
        list: 可用的模型类型列表，如 ["mobile"], ["server"], ["mobile", "server"] 或 []
    """
    available = []
    candidates = _get_model_search_paths(config)

    # 定义模型类型及其所需文件
    model_variants = {
        "mobile": ["PP-OCRv5_mobile_det", "PP-OCRv5_mobile_rec"],
        "server": ["PP-OCRv5_server_det", "PP-OCRv5_server_rec"],
    }

    for model_type, required_models in model_variants.items():
        all_found = True
        for model_name in required_models:
            found = False
            for base_dir in candidates:
                if not base_dir.exists():
                    continue
                model_dir = base_dir / "official_models" / model_name
                if model_dir.exists():
                    for pattern in ("*.pdiparams", "*.pdparams"):
                        if list(model_dir.glob(pattern)):
                            found = True
                            break
                if found:
                    break
            if not found:
                all_found = False
                break
        if all_found:
            available.append(model_type)

    return available


def _get_model_search_paths(config):
    """获取模型搜索路径列表"""
    candidates = []
    for key in ("PADDLEOCR_HOME", "PADDLE_HOME"):
        env_dir = os.getenv(key)
        if env_dir:
            candidates.append(Path(env_dir))
    for key in ("PADDLE_PDX_CACHE_HOME", "PADDLEX_HOME"):
        env_dir = os.getenv(key)
        if env_dir:
            candidates.append(Path(env_dir))
    model_dir = config.get("model_dir", "models")
    base = Path(model_dir)
    if not base.is_absolute():
        base = CONFIG_PATH.parent / base
    candidates.append(base / "paddleocr")
    candidates.append(base / "paddlex")
    return candidates
