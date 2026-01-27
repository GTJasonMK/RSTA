"""
统一的 OCR + 翻译服务

API 端点：
- GET  /health          - 健康检查
- GET  /loading_status  - 模型加载状态（用于前端判断功能是否可用）
- GET  /models          - 列出可用模型
- POST /ocr             - OCR 识别（接收 base64 图片）
- POST /ocr/preload     - 预加载 OCR 模型
- POST /translate       - 翻译
- POST /translate_stream - 流式翻译
- GET  /logs            - 获取服务日志
- GET  /logs/stream     - 流式获取日志
"""

import os
# 禁用 PIR 相关功能（避免某些模型的兼容性问题）
os.environ["FLAGS_enable_pir_api"] = "0"
os.environ["FLAGS_enable_pir_in_executor"] = "0"
os.environ["FLAGS_pir_apply_inplace_pass"] = "0"
os.environ["FLAGS_enable_pir_with_pt_kernel"] = "0"
os.environ["FLAGS_pir_subgraph_saving_dir"] = ""
# 禁用模型源检查，加快启动速度
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
# 注意：不要禁用 MKLDNN，否则 CPU 推理会非常慢

# 项目根目录（用于配置文件路径等）
from pathlib import Path as _Path
_SCRIPT_DIR = _Path(__file__).resolve().parent.parent

# 注意：PaddleOCR 环境变量由 initialize_ocr_environment() 统一设置
# 不在此处设置，避免与配置文件中的 model_dir 冲突

import base64
import io
import json
import sys
import logging
from collections import deque
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel


# ============== 日志系统 ==============

class LogBuffer:
    """环形日志缓冲区"""
    def __init__(self, max_size: int = 1000):
        self.buffer = deque(maxlen=max_size)
        self._last_id = 0

    def add(self, level: str, message: str):
        self._last_id += 1
        entry = {
            "id": self._last_id,
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "level": level,
            "message": message
        }
        self.buffer.append(entry)
        return entry

    def get_all(self, since_id: int = 0) -> List[dict]:
        return [e for e in self.buffer if e["id"] > since_id]

    def get_last_id(self) -> int:
        return self._last_id


LOG_BUFFER = LogBuffer(max_size=500)


class BufferedLogHandler(logging.Handler):
    """将日志写入缓冲区的处理器"""
    def emit(self, record):
        try:
            msg = self.format(record)
            LOG_BUFFER.add(record.levelname, msg)
        except Exception:
            pass


def setup_logging():
    """配置日志系统"""
    # 创建根日志器
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # 控制台输出
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_format = logging.Formatter('[%(asctime)s] %(levelname)s: %(message)s', datefmt='%H:%M:%S')
    console_handler.setFormatter(console_format)

    # 缓冲区输出
    buffer_handler = BufferedLogHandler()
    buffer_handler.setLevel(logging.DEBUG)
    buffer_format = logging.Formatter('%(message)s')
    buffer_handler.setFormatter(buffer_format)

    root_logger.addHandler(console_handler)
    root_logger.addHandler(buffer_handler)

    # 设置 uvicorn 日志
    for name in ["uvicorn", "uvicorn.access", "uvicorn.error"]:
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.addHandler(console_handler)
        logger.addHandler(buffer_handler)

    return logging.getLogger(__name__)


logger = setup_logging()


# ============== 语言映射 ==============

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


# ============== 请求/响应模型 ==============

class OcrRequest(BaseModel):
    image: str  # base64 编码的图片
    lang: str = "en"
    model_type: str = "mobile"  # mobile 或 server


class OcrResponse(BaseModel):
    text: str
    model_type: str


class TranslateRequest(BaseModel):
    q: Optional[str] = None
    text: Optional[str] = None
    source: str = "en"
    target: str = "zh"
    format: Optional[str] = None
    api_key: Optional[str] = None


class TranslateResponse(BaseModel):
    translatedText: str


class ModelsResponse(BaseModel):
    ocr_models: List[str]
    ocr_loaded: List[str]
    translate_model: Optional[str]


# ============== 全局状态 ==============

import threading

class ServiceState:
    def __init__(self):
        self.ocr_engines = {}  # {"mobile_en": engine, "server_zh": engine, ...}
        self.translate_model = None
        self.translate_repo = None
        self.translate_file = None
        self._ocr_lock = threading.Lock()  # 防止并发加载 OCR 模型
        self._translate_lock = threading.Lock()  # 防止并发访问翻译模型
        self._translate_load_lock = threading.Lock()  # 防止并发加载翻译模型
        self._config = None
        # 加载状态跟踪
        self.ocr_loading = False  # OCR 模型是否正在加载
        self.ocr_ready = False  # OCR 模型是否已就绪
        self.translate_loading = False  # 翻译模型是否正在加载
        self.translate_ready = False  # 翻译模型是否已就绪
        self.loading_error = None  # 加载错误信息

    def _load_config(self):
        """加载配置文件（使用 rsta.config 确保默认值被合并）"""
        if self._config is None:
            try:
                # 确保项目根目录在 sys.path 中
                import sys
                project_root = str(_SCRIPT_DIR)
                if project_root not in sys.path:
                    sys.path.insert(0, project_root)
                from rsta.config import load_config
                self._config = load_config()
            except ImportError as e:
                # 如果导入失败，使用简单的加载逻辑
                logger.warning(f"无法导入 rsta.config，使用 JSON 加载 fallback: {e}")
                config_path = _SCRIPT_DIR / "config.json"
                try:
                    if config_path.exists():
                        with open(config_path, "r", encoding="utf-8") as f:
                            self._config = json.load(f)
                    else:
                        logger.warning(f"配置文件不存在: {config_path}")
                        self._config = {}
                except json.JSONDecodeError as je:
                    logger.error(f"配置文件 JSON 解析错误: {je}")
                    self._config = {}
                except Exception as fe:
                    logger.error(f"配置文件读取失败: {fe}")
                    self._config = {}
        return self._config

    def ensure_translate_model(self):
        """确保翻译模型已加载，如果未加载则尝试加载"""
        if self.translate_model is not None:
            return True

        with self._translate_load_lock:
            # 双重检查
            if self.translate_model is not None:
                return True

            logger.info("正在加载翻译模型...")
            model, repo, filename = load_translate_model()
            if model is not None:
                self.translate_model = model
                self.translate_repo = repo
                self.translate_file = filename
                logger.info(f"翻译模型加载完成: {filename}")
                return True
            else:
                logger.warning("翻译模型加载失败或未找到")
                return False

    def get_ocr_engine(self, model_type: str, lang: str = "en"):
        cache_key = f"{model_type}_{lang}"
        return self.ocr_engines.get(cache_key)

    def load_ocr_engine(self, model_type: str, lang: str = "en"):
        # 缓存键包含模型类型和语言
        cache_key = f"{model_type}_{lang}"

        # 先检查是否已加载（无锁快速路径）
        if cache_key in self.ocr_engines:
            return self.ocr_engines[cache_key]

        # 加载配置，检查是否允许自动下载
        config = self._load_config()
        paddle_cfg = config.get("paddleocr", {})
        auto_download = bool(paddle_cfg.get("auto_download", False))

        # 加锁防止并发加载
        with self._ocr_lock:
            # 双重检查
            if cache_key in self.ocr_engines:
                return self.ocr_engines[cache_key]

            cpu_count = os.cpu_count() or 4

            # 优先尝试 RapidOCR-OpenVINO（Intel CPU 最快）
            try:
                from rapidocr_openvino import RapidOCR
                engine = RapidOCR()
                engine._backend = "rapidocr"
                self.ocr_engines[cache_key] = engine
                logger.info(f"Loaded RapidOCR-OpenVINO engine: {cache_key}")
                return engine
            except ImportError:
                pass
            except Exception as e:
                logger.warning(f"RapidOCR-OpenVINO 加载失败: {e}")

            # 其次尝试 RapidOCR-ONNX Runtime
            try:
                from rapidocr_onnxruntime import RapidOCR
                engine = RapidOCR(
                    det_use_cuda=False,
                    rec_use_cuda=False,
                    cls_use_cuda=False,
                    intra_op_num_threads=max(cpu_count - 1, 1),
                    inter_op_num_threads=1,
                )
                engine._backend = "rapidocr"
                self.ocr_engines[cache_key] = engine
                logger.info(f"Loaded RapidOCR-ONNX engine: {cache_key}")
                return engine
            except ImportError:
                pass
            except Exception as e:
                logger.warning(f"RapidOCR-ONNX 加载失败: {e}")

            # Fallback 到 PaddleOCR
            try:
                from paddleocr import PaddleOCR
            except ImportError:
                raise RuntimeError("OCR 引擎未安装，请安装 rapidocr-onnxruntime 或 paddleocr")

            # 使用共享函数检查模型是否存在
            try:
                from rsta.ocr import initialize_ocr_environment, check_paddle_models_exist
                paddleocr_home, paddlex_home = initialize_ocr_environment(config)
                has_models = check_paddle_models_exist(paddlex_home, paddleocr_home)
            except ImportError:
                # 如果导入失败，使用简单的检查逻辑
                has_models = False
                paddlex_home = Path(os.environ.get("PADDLE_PDX_CACHE_HOME", os.environ.get("PADDLEX_HOME", "")))
                if paddlex_home.exists():
                    official_models_dir = paddlex_home / "official_models"
                    if official_models_dir.exists():
                        model_dirs = [d for d in official_models_dir.iterdir() if d.is_dir() and "OCR" in d.name]
                        for model_dir_check in model_dirs:
                            if list(model_dir_check.glob("*.pdiparams")) or list(model_dir_check.glob("*.pdparams")):
                                has_models = True
                                break

            if not has_models and not auto_download:
                raise RuntimeError(
                    f"\n{'='*60}\n"
                    f"OCR 模型未找到！\n"
                    f"{'='*60}\n\n"
                    f"模型目录: {paddlex_home / 'official_models'}\n\n"
                    f"请在设置页面点击下载按钮下载 OCR 模型\n"
                    f"{'='*60}\n"
                )

            if not has_models:
                logger.info(f"\n{'='*60}")
                logger.info("正在下载 OCR 模型（首次使用需要下载）...")
                logger.info(f"模型将保存到: {paddlex_home / 'official_models'}")
                logger.info(f"{'='*60}\n")

            ocr_lang = OCR_LANG_MAP.get(lang, "en")

            # PaddleOCR 配置（复用之前加载的 paddle_cfg）
            cpu_count = os.cpu_count() or 4
            kwargs = {
                "lang": ocr_lang,
                "device": "gpu" if paddle_cfg.get("use_gpu", False) else "cpu",
                "enable_mkldnn": False,  # 禁用以避免 PIR 兼容问题
                "use_doc_preprocessor": False,
                "use_textline_orientation": paddle_cfg.get("use_textline_orientation", True),
                "cpu_threads": max(cpu_count - 1, 1),
                "text_rec_score_thresh": float(paddle_cfg.get("text_rec_score_thresh", 0.3)),
                "text_det_box_thresh": float(paddle_cfg.get("box_thresh", 0.3)),
                "text_det_unclip_ratio": float(paddle_cfg.get("unclip_ratio", 1.6)),
            }

            # 检查是否有对应的 PP-OCRv5 模型已下载，只有下载了才指定模型名称
            # 否则让 PaddleOCR 使用默认模型
            paddlex_home = Path(os.environ.get("PADDLE_PDX_CACHE_HOME", os.environ.get("PADDLEX_HOME", "")))
            official_models_dir = paddlex_home / "official_models" if paddlex_home.exists() else None

            if model_type == "mobile":
                det_model = "PP-OCRv5_mobile_det"
                rec_model = "PP-OCRv5_mobile_rec"
            else:  # server
                det_model = "PP-OCRv5_server_det"
                rec_model = "PP-OCRv5_server_rec"

            # 只有模型目录存在时才指定模型名称
            if official_models_dir and (official_models_dir / det_model).exists():
                kwargs["text_detection_model_name"] = det_model
                kwargs["text_recognition_model_name"] = rec_model
                logger.info(f"使用指定 OCR 模型: {det_model}")
            else:
                logger.info(f"OCR 模型 {det_model} 未找到，使用 PaddleOCR 默认模型")

            engine = self._safe_create_ocr(PaddleOCR, kwargs)
            engine._backend = "paddleocr"  # 标记后端类型
            self.ocr_engines[cache_key] = engine
            logger.info(f"Loaded PaddleOCR engine: {cache_key}")
            return engine

    def _safe_create_ocr(self, PaddleOCR, kwargs):
        """安全创建 OCR 引擎，自动移除不支持的参数"""
        pending = dict(kwargs)
        while True:
            try:
                return PaddleOCR(**pending)
            except Exception as exc:
                message = str(exc)
                if "Unknown argument" not in message:
                    raise
                # 解析不支持的参数名并移除
                name = message.split("Unknown argument:", 1)[-1].strip().split()[0]
                if name in pending:
                    logger.warning(f"移除不支持的 PaddleOCR 参数: {name}")
                    pending.pop(name, None)
                    continue
                raise


STATE = ServiceState()


# ============== OCR 功能 ==============

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


def do_ocr(image_bytes: bytes, model_type: str, lang: str) -> str:
    """执行 OCR"""
    import numpy as np
    from PIL import Image

    engine = STATE.load_ocr_engine(model_type, lang)

    # 读取配置
    config = STATE._load_config()
    paddle_cfg = config.get("paddleocr", {})

    # 解码图片
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    width, height = image.size

    # 对于太小的图片，进行放大以提高 OCR 识别率
    # 使用配置文件中的值，默认 100
    MIN_SIDE_FOR_UPSCALE = int(paddle_cfg.get("min_side_for_upscale", 100))
    if min(width, height) < MIN_SIDE_FOR_UPSCALE:
        # 计算放大比例，使最小边达到阈值
        scale = MIN_SIDE_FOR_UPSCALE / min(width, height)
        new_width = int(width * scale)
        new_height = int(height * scale)
        image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
        logger.info(f"图片放大: {width}x{height} -> {new_width}x{new_height}")
        width, height = new_width, new_height

    # 验证图片尺寸（放大后仍然太小则放弃）
    MIN_OCR_SIZE = 32
    if width < MIN_OCR_SIZE or height < MIN_OCR_SIZE:
        logger.warning(f"图片尺寸过小 ({width}x{height})，无法进行 OCR 识别")
        return ""

    # 限制图片最大边长（使用配置文件中的值，默认 1800）
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
        # use_cls=False 禁用方向分类器（屏幕截图文字方向固定，可节省约30%时间）
        # result 格式: [[box, text, confidence], ...]
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


# ============== 翻译功能 ==============


def normalize_lang(lang: str) -> str:
    key = lang.strip().lower()
    return LANG_MAP.get(key, lang)


def is_chinese(lang: str) -> bool:
    key = lang.lower()
    return key in {"chinese", "traditional chinese", "zh", "zh-cn", "zh-hans", "zh-hant"}


def build_prompt(source_lang: str, target_lang: str, text: str) -> str:
    source = normalize_lang(source_lang)
    target = normalize_lang(target_lang)
    if is_chinese(source) or is_chinese(target):
        return f"将以下文本翻译为{target}，注意只需要输出翻译后的结果，不要额外解释：\n\n{text}"
    return f"Translate the following segment into {target}, without additional explanation.\n\n{text}"


def load_translate_model():
    """加载翻译模型"""
    try:
        from huggingface_hub import hf_hub_download, list_repo_files
    except ImportError as e:
        logger.warning(f"huggingface_hub 导入失败: {e}")
        return None, None, None

    try:
        from llama_cpp import Llama
    except ImportError as e:
        logger.warning(f"llama-cpp-python 导入失败: {e}")
        return None, None, None
    except Exception as e:
        logger.warning(f"llama-cpp-python 加载异常: {e}")
        return None, None, None

    # 从配置文件读取设置（优先级：环境变量 > config.json > 默认值）
    config = STATE._load_config()
    local_service_cfg = config.get("local_service", {})

    repo_id = os.getenv("MODEL_REPO") or local_service_cfg.get("model_repo", "tencent/HY-MT1.5-1.8B-GGUF")
    quant = os.getenv("QUANT") or local_service_cfg.get("quant", "Q6_K")

    default_dir = Path(__file__).resolve().parents[1] / "models"
    model_dir = Path(os.getenv("MODEL_DIR", default_dir)).resolve()
    model_dir.mkdir(parents=True, exist_ok=True)

    # 查找本地 GGUF 文件
    def find_local_gguf():
        candidates = [p for p in model_dir.rglob("*.gguf") if p.is_file()]
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]
        quant_key = quant.lower()
        matched = [p for p in candidates if quant_key in p.name.lower()]
        if matched:
            matched.sort(key=lambda p: len(p.name))
            return matched[0]
        return None

    filename = os.getenv("MODEL_FILE", "").strip()
    if not filename:
        local_candidate = find_local_gguf()
        if local_candidate:
            filename = str(local_candidate)
        else:
            # 尝试从 HuggingFace 获取文件列表
            try:
                files = [f for f in list_repo_files(repo_id) if f.lower().endswith(".gguf")]
                quant_key = quant.lower()
                matched = [f for f in files if quant_key in f.lower()]
                if matched:
                    matched.sort(key=len)
                    filename = matched[0]
            except Exception:
                return None, repo_id, None

    if not filename:
        return None, repo_id, None

    # 解析模型路径
    candidate = Path(filename)
    if candidate.is_file():
        model_path = str(candidate)
    elif not candidate.is_absolute():
        local_file = model_dir / filename
        if local_file.is_file():
            model_path = str(local_file)
        else:
            try:
                model_path = hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    local_dir=model_dir,
                    local_dir_use_symlinks=False,
                )
            except Exception:
                return None, repo_id, filename
    else:
        return None, repo_id, filename

    n_ctx = int(os.getenv("N_CTX", "4096"))
    n_threads = int(os.getenv("N_THREADS", str(max((os.cpu_count() or 2) - 1, 1))))
    n_batch = int(os.getenv("N_BATCH", "128"))

    model = Llama(
        model_path=model_path,
        n_ctx=n_ctx,
        n_threads=n_threads,
        n_batch=n_batch,
        n_gpu_layers=0,
        use_mmap=True,
        verbose=False,
    )
    return model, repo_id, filename


# ============== FastAPI 应用 ==============


@asynccontextmanager
async def lifespan(app):
    """应用生命周期管理"""
    import threading

    config = STATE._load_config()
    startup_cfg = config.get("startup", {})
    paddle_cfg = config.get("paddleocr", {})
    unified_cfg = config.get("unified_service", {})

    logger.info("=" * 60)
    logger.info("统一服务快速启动中...")
    logger.info("=" * 60)

    # 快速检查模型状态（不阻塞）
    try:
        from rsta.ocr import get_models_status
        status = get_models_status(config)
        ocr_status = status.get("ocr", {})
        translate_status = status.get("translate", {})

        logger.info(f"  OCR Mobile: {'已下载' if ocr_status.get('mobile_downloaded') else '未下载'}")
        logger.info(f"  OCR Server: {'已下载' if ocr_status.get('server_downloaded') else '未下载'}")
        logger.info(f"  翻译模型: {'已下载' if translate_status.get('downloaded') else '未下载'}")
    except Exception as e:
        logger.warning(f"模型状态检查失败: {e}")

    # 后台异步预加载函数
    def background_preload():
        """在后台线程中预加载模型"""
        try:
            # 预加载 OCR 模型
            if startup_cfg.get("auto_load_ocr", False):
                STATE.ocr_loading = True
                model_type = paddle_cfg.get("model_type", "mobile")
                lang = config.get("source_lang", "en")
                logger.info(f"[后台] 正在预加载 OCR 模型: {model_type} ({lang})...")
                try:
                    STATE.load_ocr_engine(model_type, lang)
                    STATE.ocr_ready = True
                    logger.info(f"[后台] OCR 模型加载完成: {model_type}_{lang}")
                except Exception as e:
                    STATE.loading_error = f"OCR 加载失败: {e}"
                    logger.warning(f"[后台] OCR 模型加载失败: {e}")
                finally:
                    STATE.ocr_loading = False

                # 加载 preload_ocr 配置中的其他模型
                preload_ocr_list = unified_cfg.get("preload_ocr", [])
                for model_config in preload_ocr_list:
                    try:
                        m_type = model_config.get("type", "mobile")
                        m_lang = model_config.get("lang", "en")
                        cache_key = f"{m_type}_{m_lang}"
                        if cache_key not in STATE.ocr_engines:
                            STATE.load_ocr_engine(m_type, m_lang)
                            logger.info(f"[后台] OCR 模型加载完成: {cache_key}")
                    except Exception as e:
                        logger.warning(f"[后台] OCR 模型 {model_config} 加载失败: {e}")

            # 预加载翻译模型
            if startup_cfg.get("auto_load_translator", False):
                STATE.translate_loading = True
                logger.info("[后台] 正在预加载翻译模型...")
                try:
                    if STATE.ensure_translate_model():
                        STATE.translate_ready = True
                        logger.info(f"[后台] 翻译模型加载完成: {STATE.translate_file}")
                    else:
                        STATE.loading_error = "翻译模型未找到"
                        logger.warning("[后台] 翻译模型加载失败或未找到")
                except Exception as e:
                    STATE.loading_error = f"翻译模型加载失败: {e}"
                    logger.warning(f"[后台] 翻译模型加载失败: {e}")
                finally:
                    STATE.translate_loading = False
        except Exception as e:
            STATE.loading_error = f"预加载失败: {e}"
            logger.error(f"[后台] 预加载失败: {e}")

    # 如果启用了预加载，在后台线程中执行（不阻塞启动）
    if startup_cfg.get("auto_load_ocr", False) or startup_cfg.get("auto_load_translator", False):
        logger.info("模型将在后台异步加载...")
        preload_thread = threading.Thread(target=background_preload, daemon=True)
        preload_thread.start()
    else:
        logger.info("模型将在首次使用时按需加载（快速启动模式）")

    logger.info("=" * 60)
    logger.info("服务启动完成，可以接收请求")
    logger.info("=" * 60)

    yield  # 应用运行中

    # 关闭时清理
    logger.info("服务正在关闭...")


app = FastAPI(title="Unified OCR + Translate Service", lifespan=lifespan)

# CORS 配置 - 允许 Electron 应用访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 翻译模型参数
MAX_NEW_TOKENS = int(os.getenv("MAX_NEW_TOKENS", "256"))
TEMPERATURE = float(os.getenv("TEMPERATURE", "0.7"))
TOP_P = float(os.getenv("TOP_P", "0.6"))
TOP_K = int(os.getenv("TOP_K", "20"))
REPEAT_PENALTY = float(os.getenv("REPEAT_PENALTY", "1.05"))
TRANSLATE_TIMEOUT = int(os.getenv("TRANSLATE_TIMEOUT", "60"))  # 翻译超时时间（秒）

# 线程池用于超时控制
_executor = ThreadPoolExecutor(max_workers=2)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "ocr_loaded": list(STATE.ocr_engines.keys()),
        "translate_repo": STATE.translate_repo,
        "translate_file": STATE.translate_file,
        "translate_available": STATE.translate_model is not None,
        "translate_backend": "llama" if STATE.translate_model is not None else None,
    }


@app.get("/loading_status")
def loading_status():
    """获取模型加载状态（用于前端判断功能是否可用）"""
    return {
        "ocr": {
            "loading": STATE.ocr_loading,
            "ready": STATE.ocr_ready or len(STATE.ocr_engines) > 0,
            "loaded_models": list(STATE.ocr_engines.keys()),
        },
        "translate": {
            "loading": STATE.translate_loading,
            "ready": STATE.translate_ready or STATE.translate_model is not None,
            "model_file": STATE.translate_file,
        },
        "error": STATE.loading_error,
    }


@app.get("/models", response_model=ModelsResponse)
def list_models():
    return ModelsResponse(
        ocr_models=["mobile", "server"],
        ocr_loaded=list(STATE.ocr_engines.keys()),
        translate_model=STATE.translate_file,
    )


@app.get("/models/status")
def get_models_status_endpoint():
    """获取模型下载状态"""
    try:
        from rsta.ocr import get_models_status as check_models_status
        config = STATE._load_config()
        return check_models_status(config)
    except ImportError:
        # 如果导入失败，使用简单的检查逻辑
        ocr_mobile_downloaded = False
        ocr_server_downloaded = False
        ocr_path = None

        paddlex_home = Path(os.environ.get("PADDLE_PDX_CACHE_HOME", os.environ.get("PADDLEX_HOME", "")))
        if paddlex_home.exists():
            official_models_dir = paddlex_home / "official_models"
            if official_models_dir.exists():
                ocr_path = str(official_models_dir)
                mobile_det = official_models_dir / "PP-OCRv5_mobile_det"
                mobile_rec = official_models_dir / "PP-OCRv5_mobile_rec"
                if mobile_det.exists() and mobile_rec.exists():
                    ocr_mobile_downloaded = True
                server_det = official_models_dir / "PP-OCRv5_server_det"
                server_rec = official_models_dir / "PP-OCRv5_server_rec"
                if server_det.exists() and server_rec.exists():
                    ocr_server_downloaded = True

        translate_downloaded = False
        translate_model_path = None
        model_dir = _SCRIPT_DIR / "models"
        if model_dir.exists():
            gguf_files = list(model_dir.rglob("*.gguf"))
            if gguf_files:
                translate_downloaded = True
                translate_model_path = str(gguf_files[0])

        return {
            "ocr": {
                "downloaded": ocr_mobile_downloaded or ocr_server_downloaded,
                "mobile_downloaded": ocr_mobile_downloaded,
                "server_downloaded": ocr_server_downloaded,
                "path": ocr_path,
            },
            "translate": {
                "downloaded": translate_downloaded,
                "path": translate_model_path,
            }
        }


class DownloadModelRequest(BaseModel):
    model_type: str  # "ocr" or "translate"


@app.post("/models/download")
def download_model(req: DownloadModelRequest):
    """下载模型（非流式）"""
    if req.model_type == "ocr":
        try:
            from paddleocr import PaddleOCR
            logger.info("开始下载 OCR 模型...")
            kwargs = {"lang": "en", "device": "cpu"}
            pending = dict(kwargs)
            while True:
                try:
                    _ = PaddleOCR(**pending)
                    break
                except Exception as exc:
                    message = str(exc)
                    if "Unknown argument" not in message:
                        raise
                    name = message.split("Unknown argument:", 1)[-1].strip().split()[0]
                    if name in pending:
                        pending.pop(name, None)
                        continue
                    raise
            logger.info("OCR 模型下载完成")
            return {"status": "ok", "message": "OCR 模型下载完成"}
        except ImportError:
            raise HTTPException(status_code=500, detail="PaddleOCR 未安装")
        except Exception as e:
            logger.error(f"OCR 模型下载失败: {e}")
            raise HTTPException(status_code=500, detail=f"OCR 模型下载失败: {e}")

    elif req.model_type == "translate":
        try:
            from huggingface_hub import hf_hub_download, list_repo_files
            repo_id = "tencent/HY-MT1.5-1.8B-GGUF"
            config = STATE._load_config()
            quant = config.get("local_service", {}).get("quant", "Q6_K")
            model_dir = _SCRIPT_DIR / "models"
            model_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"开始下载翻译模型 (量化级别: {quant})...")
            files = [f for f in list_repo_files(repo_id) if f.lower().endswith(".gguf")]
            if not files:
                raise RuntimeError("模型仓库未找到 GGUF 文件")
            quant_key = quant.lower()
            matched = [f for f in files if quant_key in f.lower()]
            if not matched:
                raise RuntimeError(f"未找到匹配量化档位 {quant} 的 GGUF 文件")
            matched.sort(key=len)
            filename = matched[0]
            logger.info(f"下载文件: {filename}")
            hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=model_dir,
                local_dir_use_symlinks=False,
            )
            logger.info("翻译模型下载完成")
            return {"status": "ok", "message": f"翻译模型下载完成: {filename}"}
        except ImportError:
            raise HTTPException(status_code=500, detail="huggingface_hub 未安装")
        except Exception as e:
            logger.error(f"翻译模型下载失败: {e}")
            raise HTTPException(status_code=500, detail=f"翻译模型下载失败: {e}")
    else:
        raise HTTPException(status_code=400, detail=f"未知的模型类型: {req.model_type}")


@app.get("/models/download_stream")
def download_model_stream(model_type: str, ocr_model_type: str = "mobile"):
    """流式下载模型（带进度）

    参数:
        model_type: "ocr" 或 "translate"
        ocr_model_type: OCR 模型类型，"mobile" 或 "server"（仅当 model_type="ocr" 时有效）
    """

    def generate():
        def send_progress(percent: int, message: str, status: str = "downloading"):
            payload = json.dumps({"percent": percent, "message": message, "status": status})
            return f"data: {payload}\n\n"

        if model_type == "ocr":
            try:
                model_label = "Mobile" if ocr_model_type == "mobile" else "Server"
                yield send_progress(0, f"正在初始化 OCR 模块 ({model_label})...", "downloading")

                from paddleocr import PaddleOCR

                yield send_progress(10, "正在检查模型文件...", "downloading")

                # 根据模型类型设置不同的模型名称
                kwargs = {"lang": "en", "device": "cpu"}
                if ocr_model_type == "mobile":
                    kwargs["text_detection_model_name"] = "PP-OCRv5_mobile_det"
                    kwargs["text_recognition_model_name"] = "PP-OCRv5_mobile_rec"
                else:
                    kwargs["text_detection_model_name"] = "PP-OCRv5_server_det"
                    kwargs["text_recognition_model_name"] = "PP-OCRv5_server_rec"
                pending = dict(kwargs)

                yield send_progress(20, f"正在下载 OCR {model_label} 模型（此过程可能需要几分钟）...", "downloading")

                while True:
                    try:
                        _ = PaddleOCR(**pending)
                        break
                    except Exception as exc:
                        message = str(exc)
                        if "Unknown argument" not in message:
                            raise
                        name = message.split("Unknown argument:", 1)[-1].strip().split()[0]
                        if name in pending:
                            pending.pop(name, None)
                            continue
                        raise

                yield send_progress(100, "OCR 模型下载完成", "done")
                logger.info("OCR 模型下载完成")

            except ImportError as e:
                yield send_progress(0, f"PaddleOCR 未安装: {e}", "error")
            except Exception as e:
                logger.error(f"OCR 模型下载失败: {e}")
                yield send_progress(0, f"下载失败: {e}", "error")

        elif model_type == "translate":
            try:
                yield send_progress(0, "正在初始化...", "downloading")

                from huggingface_hub import hf_hub_download, list_repo_files
                from huggingface_hub.utils import tqdm as hf_tqdm

                repo_id = "tencent/HY-MT1.5-1.8B-GGUF"
                config = STATE._load_config()
                quant = config.get("local_service", {}).get("quant", "Q6_K")
                model_dir = _SCRIPT_DIR / "models"
                model_dir.mkdir(parents=True, exist_ok=True)

                yield send_progress(5, f"正在获取模型列表 (量化级别: {quant})...", "downloading")

                files = [f for f in list_repo_files(repo_id) if f.lower().endswith(".gguf")]
                if not files:
                    yield send_progress(0, "模型仓库未找到 GGUF 文件", "error")
                    return

                quant_key = quant.lower()
                matched = [f for f in files if quant_key in f.lower()]
                if not matched:
                    yield send_progress(0, f"未找到匹配量化档位 {quant} 的 GGUF 文件", "error")
                    return

                matched.sort(key=len)
                filename = matched[0]

                yield send_progress(10, f"正在下载: {filename}", "downloading")

                # 检查文件是否已存在
                local_path = model_dir / filename
                if local_path.exists():
                    yield send_progress(100, f"模型已存在: {filename}", "done")
                    return

                # 使用回调函数跟踪下载进度
                # huggingface_hub 不直接支持进度回调，但我们可以定期检查文件大小
                import threading
                import time

                download_complete = threading.Event()
                download_error = [None]
                final_path = [None]

                def download_thread():
                    try:
                        result = hf_hub_download(
                            repo_id=repo_id,
                            filename=filename,
                            local_dir=model_dir,
                            local_dir_use_symlinks=False,
                        )
                        final_path[0] = result
                    except Exception as e:
                        download_error[0] = e
                    finally:
                        download_complete.set()

                thread = threading.Thread(target=download_thread)
                thread.start()

                # 在下载过程中发送进度更新
                last_percent = 10
                while not download_complete.is_set():
                    time.sleep(2)
                    # 检查下载目录中的临时文件
                    # huggingface_hub 下载到 .cache 然后移动
                    if last_percent < 90:
                        last_percent = min(last_percent + 5, 90)
                        yield send_progress(last_percent, f"正在下载: {filename} ({last_percent}%)", "downloading")

                thread.join()

                if download_error[0]:
                    raise download_error[0]

                yield send_progress(100, f"翻译模型下载完成: {filename}", "done")
                logger.info(f"翻译模型下载完成: {filename}")

            except ImportError as e:
                yield send_progress(0, f"huggingface_hub 未安装: {e}", "error")
            except Exception as e:
                logger.error(f"翻译模型下载失败: {e}")
                yield send_progress(0, f"下载失败: {e}", "error")
        else:
            yield send_progress(0, f"未知的模型类型: {model_type}", "error")

    return StreamingResponse(generate(), media_type="text/event-stream")


class PreloadRequest(BaseModel):
    model_type: str = "mobile"
    lang: str = "en"


@app.post("/ocr/preload")
def preload_ocr(req: PreloadRequest):
    """预加载 OCR 模型，用于语言切换时提前加载"""
    cache_key = f"{req.model_type}_{req.lang}"

    # 检查是否已加载
    if cache_key in STATE.ocr_engines:
        return {"status": "already_loaded", "cache_key": cache_key}

    try:
        STATE.load_ocr_engine(req.model_type, req.lang)
        return {"status": "loaded", "cache_key": cache_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load OCR model: {e}")


@app.post("/ocr", response_model=OcrResponse)
def ocr(req: OcrRequest):
    import time
    start_time = time.perf_counter()

    # 检查 OCR 模型是否正在加载中
    if STATE.ocr_loading:
        raise HTTPException(
            status_code=503,
            detail="OCR 模型正在加载中，请稍候..."
        )

    try:
        image_bytes = base64.b64decode(req.image)
    except Exception as e:
        image_preview = req.image[:50] if len(req.image) > 50 else req.image
        raise HTTPException(
            status_code=400,
            detail=f"Invalid base64 image: {e}. Preview: {image_preview}..."
        )

    try:
        text = do_ocr(image_bytes, req.model_type, req.lang)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR failed: {e}")

    elapsed = (time.perf_counter() - start_time) * 1000
    logger.info(f"[OCR] {elapsed:.0f}ms | lang={req.lang} | {len(text)} chars")

    return OcrResponse(text=text, model_type=req.model_type)


@app.post("/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest):
    import time
    start_time = time.perf_counter()

    text = (req.q or req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    # 检查翻译模型是否正在加载中
    if STATE.translate_loading:
        raise HTTPException(
            status_code=503,
            detail="翻译模型正在加载中，请稍候..."
        )

    # 确保翻译模型已加载
    if not STATE.ensure_translate_model():
        raise HTTPException(status_code=503, detail="翻译模型未找到，请先在设置中下载翻译模型")

    prompt = build_prompt(req.source, req.target, text)

    def do_inference():
        # 使用锁防止并发访问，llama-cpp-python 不是线程安全的
        with STATE._translate_lock:
            return STATE.translate_model.create_completion(
                prompt=prompt,
                max_tokens=MAX_NEW_TOKENS,
                temperature=TEMPERATURE,
                top_p=TOP_P,
                top_k=TOP_K,
                repeat_penalty=REPEAT_PENALTY,
                echo=False,
            )

    try:
        future = _executor.submit(do_inference)
        result = future.result(timeout=TRANSLATE_TIMEOUT)
        translated = result["choices"][0]["text"].strip()

        elapsed = (time.perf_counter() - start_time) * 1000
        tokens = result.get("usage", {}).get("completion_tokens", 0)
        logger.info(f"[Translate] {elapsed:.0f}ms | {tokens} tokens | {len(text)}->{len(translated)} chars")

        return TranslateResponse(translatedText=translated)
    except FuturesTimeoutError:
        raise HTTPException(status_code=504, detail=f"Translation timeout ({TRANSLATE_TIMEOUT}s)")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")


@app.post("/translate_stream")
def translate_stream(req: TranslateRequest):
    text = (req.q or req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    # 检查翻译模型是否正在加载中
    if STATE.translate_loading:
        raise HTTPException(
            status_code=503,
            detail="翻译模型正在加载中，请稍候..."
        )

    # 确保翻译模型已加载
    if not STATE.ensure_translate_model():
        raise HTTPException(status_code=503, detail="翻译模型未找到，请先在设置中下载翻译模型")

    prompt = build_prompt(req.source, req.target, text)

    def generator():
        import time
        start_time = time.perf_counter()
        stream = None
        token_count = 0
        translated_text = ""
        # 使用锁防止并发访问，llama-cpp-python 不是线程安全的
        with STATE._translate_lock:
            try:
                stream = STATE.translate_model.create_completion(
                    prompt=prompt,
                    max_tokens=MAX_NEW_TOKENS,
                    temperature=TEMPERATURE,
                    top_p=TOP_P,
                    top_k=TOP_K,
                    repeat_penalty=REPEAT_PENALTY,
                    echo=False,
                    stream=True,
                )
                for chunk in stream:
                    token = chunk.get("choices", [{}])[0].get("text", "")
                    if token:
                        token_count += 1
                        translated_text += token
                        payload = json.dumps({"token": token})
                        yield f"data: {payload}\n\n"
                yield "data: [DONE]\n\n"
                # 打印时间日志
                elapsed = (time.perf_counter() - start_time) * 1000
                logger.info(f"[Translate-Stream] {elapsed:.0f}ms | {token_count} tokens | {len(text)}->{len(translated_text)} chars")
            except GeneratorExit:
                # 客户端断开连接，正常退出
                elapsed = (time.perf_counter() - start_time) * 1000
                logger.info(f"[Translate-Stream] {elapsed:.0f}ms | cancelled | {token_count} tokens")
            finally:
                # 确保流式迭代器被清理
                if stream is not None:
                    try:
                        stream.close()
                    except Exception:
                        pass

    return StreamingResponse(generator(), media_type="text/event-stream")


# ============== 配置 API ==============

# 添加项目根目录到路径
import sys
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from rsta.config import load_config, save_config, DEFAULT_CONFIG


@app.get("/config")
def get_config():
    """获取当前配置"""
    return load_config()


@app.post("/config")
def update_config(config: dict):
    """更新配置"""
    try:
        current = load_config()
        # 合并配置
        for key, value in config.items():
            if isinstance(value, dict) and isinstance(current.get(key), dict):
                current[key].update(value)
            else:
                current[key] = value
        save_config(current)
        return {"status": "ok", "config": current}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save config: {e}")


@app.get("/config/default")
def get_default_config():
    """获取默认配置"""
    return DEFAULT_CONFIG


# ============== 日志 API ==============

@app.get("/logs")
def get_logs(since_id: int = 0, limit: int = 100):
    """获取日志"""
    logs = LOG_BUFFER.get_all(since_id)
    if limit > 0:
        logs = logs[-limit:]
    return {
        "logs": logs,
        "last_id": LOG_BUFFER.get_last_id()
    }


@app.get("/logs/stream")
def stream_logs(since_id: int = 0):
    """流式获取日志（SSE）"""
    import time

    def generate():
        last_id = since_id
        while True:
            logs = LOG_BUFFER.get_all(last_id)
            for log in logs:
                yield f"data: {json.dumps(log)}\n\n"
                last_id = log["id"]
            time.sleep(0.5)

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/logs/clear")
def clear_logs():
    """清空日志缓冲区"""
    LOG_BUFFER.buffer.clear()
    LOG_BUFFER._last_id = 0
    return {"status": "ok"}


def main():
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8092"))
    import uvicorn
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
