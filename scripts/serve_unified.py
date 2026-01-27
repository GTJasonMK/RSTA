"""
统一的 OCR + 翻译服务

API 端点：
- GET  /health          - 健康检查
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

# 设置 PaddleOCR 模型下载目录到项目的 models 目录
from pathlib import Path as _Path
_SCRIPT_DIR = _Path(__file__).resolve().parent.parent
_PADDLEOCR_HOME = _SCRIPT_DIR / "models" / "paddleocr"
_PADDLEOCR_HOME.mkdir(parents=True, exist_ok=True)
os.environ["PADDLEOCR_HOME"] = str(_PADDLEOCR_HOME)

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
        self._config = None

    def _load_config(self):
        """加载配置文件"""
        if self._config is None:
            config_path = _SCRIPT_DIR / "config.json"  # _SCRIPT_DIR 是项目根目录
            if config_path.exists():
                with open(config_path, "r", encoding="utf-8") as f:
                    self._config = json.load(f)
            else:
                self._config = {}
        return self._config

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

            # 检查模型是否存在（通过检查 PADDLEOCR_HOME 目录）
            paddleocr_home = Path(os.environ.get("PADDLEOCR_HOME", ""))
            if paddleocr_home.exists():
                # 检查是否有模型文件（whl 目录下应该有模型）
                whl_dir = paddleocr_home / "whl"
                has_models = whl_dir.exists() and any(whl_dir.iterdir()) if whl_dir.exists() else False
            else:
                has_models = False

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
                logger.info(f"\n{'='*60}")
                logger.info("正在下载 OCR 模型（首次使用需要下载）...")
                logger.info(f"模型将保存到: {paddleocr_home}")
                logger.info(f"{'='*60}\n")

            ocr_lang = OCR_LANG_MAP.get(lang, "en")

            # PaddleOCR 配置（禁用 MKLDNN 避免 PIR 错误，但会较慢）
            cpu_count = os.cpu_count() or 4
            kwargs = {
                "lang": ocr_lang,
                "device": "cpu",
                "enable_mkldnn": False,  # 禁用以避免 PIR 兼容问题
                "use_doc_preprocessor": False,
                "use_textline_orientation": False,
                "cpu_threads": max(cpu_count - 1, 1),
            }
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

    # 解码图片
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    width, height = image.size

    # 对于太小的图片，进行放大以提高 OCR 识别率
    # 最小边长阈值：小于此值的图片将被放大
    MIN_SIDE_FOR_UPSCALE = int(os.getenv("OCR_MIN_SIDE", "100"))
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

    # 限制图片最大边长以加速 OCR（大图片会显著降低速度）
    MAX_SIDE = int(os.getenv("OCR_MAX_SIDE", "640"))
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

# 导入 Argos 翻译支持
try:
    from argostranslate import translate as argos_translate
except ImportError:
    argos_translate = None


def has_argos_language_pair(from_code, to_code):
    """检查 Argos 是否支持该语言对"""
    if argos_translate is None:
        return False
    try:
        languages = argos_translate.get_installed_languages()
    except Exception:
        return False
    from_lang = None
    to_lang = None
    for lang in languages:
        if lang.code == from_code:
            from_lang = lang
        if lang.code == to_code:
            to_lang = lang
    if from_lang is None or to_lang is None:
        return False
    return from_lang.get_translation(to_lang) is not None


def translate_with_argos(text: str, source: str, target: str) -> str:
    """使用 Argos 翻译"""
    if argos_translate is None:
        raise RuntimeError("argostranslate 未安装")
    if not has_argos_language_pair(source, target):
        raise RuntimeError(f"Argos 语言包缺失: {source} -> {target}")
    return argos_translate.translate(text, source, target)


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
        logger.warning(f"huggingface_hub 导入失败: {e}，将使用 Argos 翻译")
        return None, None, None

    try:
        from llama_cpp import Llama
    except ImportError as e:
        logger.warning(f"llama-cpp-python 导入失败: {e}，将使用 Argos 翻译")
        return None, None, None
    except Exception as e:
        logger.warning(f"llama-cpp-python 加载异常: {e}，将使用 Argos 翻译")
        return None, None, None

    repo_id = os.getenv("MODEL_REPO", "tencent/HY-MT1.5-1.8B-GGUF")
    quant = os.getenv("QUANT", "Q6_K")
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
    # 启动时加载模型
    model, repo, filename = load_translate_model()
    STATE.translate_model = model
    STATE.translate_repo = repo
    STATE.translate_file = filename

    # 预加载 OCR 模型
    preload_ocr = [m.strip() for m in os.getenv("PRELOAD_OCR", "mobile").split(",") if m.strip()]
    ocr_lang = os.getenv("OCR_LANG", "en")
    for model_type in preload_ocr:
        model_type = model_type.strip()
        if model_type in ("mobile", "server"):
            try:
                logger.info(f"Preloading OCR model: {model_type}_{ocr_lang}...")
                STATE.load_ocr_engine(model_type, ocr_lang)
            except Exception as e:
                logger.warning(f"Failed to preload OCR model {model_type}_{ocr_lang}: {e}")

    yield  # 应用运行中

    # 关闭时清理（如果需要）


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
        "translate_available": STATE.translate_model is not None or argos_translate is not None,
        "translate_backend": "llama" if STATE.translate_model is not None else ("argos" if argos_translate is not None else None),
    }


@app.get("/models", response_model=ModelsResponse)
def list_models():
    return ModelsResponse(
        ocr_models=["mobile", "server"],
        ocr_loaded=list(STATE.ocr_engines.keys()),
        translate_model=STATE.translate_file,
    )


@app.get("/models/status")
def get_models_status():
    """获取模型下载状态"""
    # 检查 OCR 模型
    paddleocr_home = Path(os.environ.get("PADDLEOCR_HOME", ""))
    ocr_downloaded = False
    if paddleocr_home.exists():
        whl_dir = paddleocr_home / "whl"
        ocr_downloaded = whl_dir.exists() and any(whl_dir.iterdir()) if whl_dir.exists() else False

    # 检查翻译模型
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
            "downloaded": ocr_downloaded,
            "path": str(paddleocr_home) if paddleocr_home.exists() else None,
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
    """下载模型"""
    if req.model_type == "ocr":
        # 下载 OCR 模型 - 通过加载 PaddleOCR 触发自动下载
        try:
            from paddleocr import PaddleOCR

            logger.info("开始下载 OCR 模型...")

            # 创建 PaddleOCR 实例会自动下载模型
            kwargs = {
                "lang": "en",
                "device": "cpu",
            }
            # 安全创建，移除不支持的参数
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
        # 下载翻译模型
        try:
            from huggingface_hub import hf_hub_download, list_repo_files

            repo_id = "tencent/HY-MT1.5-1.8B-GGUF"
            config = STATE._load_config()
            quant = config.get("local_service", {}).get("quant", "Q6_K")
            model_dir = _SCRIPT_DIR / "models"
            model_dir.mkdir(parents=True, exist_ok=True)

            logger.info(f"开始下载翻译模型 (量化级别: {quant})...")

            # 获取文件列表并选择匹配的文件
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

            # 下载模型
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

    # 优先使用本地模型
    if STATE.translate_model is not None:
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

    # 使用 Argos 翻译
    if argos_translate is not None:
        try:
            translated = translate_with_argos(text, req.source, req.target)
            elapsed = (time.perf_counter() - start_time) * 1000
            logger.info(f"[Translate-Argos] {elapsed:.0f}ms | {len(text)}->{len(translated)} chars")
            return TranslateResponse(translatedText=translated)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Argos translation failed: {e}")

    raise HTTPException(status_code=503, detail="No translation backend available (install llama-cpp-python or argostranslate)")


@app.post("/translate_stream")
def translate_stream(req: TranslateRequest):
    text = (req.q or req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    # 优先使用本地模型 (支持真正的流式)
    if STATE.translate_model is not None:
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

    # 使用 Argos (不支持流式，一次性返回)
    if argos_translate is not None:
        try:
            import time
            start_time = time.perf_counter()
            translated = translate_with_argos(text, req.source, req.target)
            elapsed = (time.perf_counter() - start_time) * 1000
            logger.info(f"[Translate-Stream] {elapsed:.0f}ms | argos | {len(text)}->{len(translated)} chars")

            def argos_generator():
                payload = json.dumps({"token": translated})
                yield f"data: {payload}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(argos_generator(), media_type="text/event-stream")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Argos translation failed: {e}")

    raise HTTPException(status_code=503, detail="No translation backend available")


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
