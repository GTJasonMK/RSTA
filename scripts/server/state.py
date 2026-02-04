"""
服务状态管理模块
管理 OCR 引擎和翻译模型的加载状态
"""

import os
import sys
import json
import logging
import threading
from pathlib import Path
from typing import Dict, Optional

from .constants import get_ocr_lang
from .translate_service import load_translate_model

logger = logging.getLogger(__name__)

# 检测是否为 PyInstaller 打包环境
def get_project_root() -> Path:
    """获取项目根目录，支持打包和开发两种环境"""
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后：可执行文件所在目录的父目录（resources 目录）
        # 或者使用工作目录
        base_path = Path(sys.executable).parent
        # 检查是否在 Electron 打包环境中（资源在上一级）
        if (base_path.parent / 'config.json').exists():
            return base_path.parent
        return base_path
    else:
        # 开发环境：scripts/server/ -> scripts -> project_root
        return Path(__file__).resolve().parents[2]

SCRIPT_DIR = get_project_root()


class ServiceState:
    """服务状态管理类"""

    def __init__(self):
        self.ocr_engines: Dict[str, object] = {}
        self.translate_model = None
        self.translate_repo = None
        self.translate_file = None
        self._ocr_lock = threading.Lock()
        self._translate_lock = threading.Lock()
        self._translate_load_lock = threading.Lock()
        self._config = None
        # 加载状态跟踪
        self.ocr_loading = False
        self.ocr_ready = False
        self.translate_loading = False
        self.translate_ready = False
        self.loading_error = None

    def _load_config(self) -> dict:
        """加载配置文件"""
        if self._config is None:
            try:
                import sys
                project_root = str(SCRIPT_DIR)
                if project_root not in sys.path:
                    sys.path.insert(0, project_root)
                from rsta.config import load_config
                self._config = load_config()
            except ImportError as e:
                logger.warning(f"无法导入 rsta.config，使用 JSON 加载: {e}")
                config_path = SCRIPT_DIR / "config.json"
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

    def ensure_translate_model(self) -> bool:
        """确保翻译模型已加载"""
        if self.translate_model is not None:
            return True

        with self._translate_load_lock:
            if self.translate_model is not None:
                return True

            logger.info("正在加载翻译模型...")
            config = self._load_config()
            model, repo, filename = load_translate_model(config)
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
        """获取已加载的 OCR 引擎"""
        cache_key = f"{model_type}_{lang}"
        return self.ocr_engines.get(cache_key)

    def load_ocr_engine(self, model_type: str, lang: str = "en"):
        """加载 OCR 引擎"""
        cache_key = f"{model_type}_{lang}"

        # 快速路径
        if cache_key in self.ocr_engines:
            return self.ocr_engines[cache_key]

        config = self._load_config()
        paddle_cfg = config.get("paddleocr", {})
        auto_download = bool(paddle_cfg.get("auto_download", False))

        with self._ocr_lock:
            if cache_key in self.ocr_engines:
                return self.ocr_engines[cache_key]

            cpu_count = os.cpu_count() or 4

            # 优先尝试 RapidOCR-OpenVINO
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

            # 检查模型是否存在
            try:
                from rsta.ocr import initialize_ocr_environment, check_paddle_models_exist
                paddleocr_home, paddlex_home = initialize_ocr_environment(config)
                has_models = check_paddle_models_exist(paddlex_home, paddleocr_home)
            except ImportError:
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

            ocr_lang = get_ocr_lang(lang)

            kwargs = {
                "lang": ocr_lang,
                "device": "gpu" if paddle_cfg.get("use_gpu", False) else "cpu",
                "enable_mkldnn": False,
                "use_doc_preprocessor": False,
                "use_textline_orientation": paddle_cfg.get("use_textline_orientation", True),
                "cpu_threads": max(cpu_count - 1, 1),
                "text_rec_score_thresh": float(paddle_cfg.get("text_rec_score_thresh", 0.3)),
                "text_det_box_thresh": float(paddle_cfg.get("box_thresh", 0.3)),
                "text_det_unclip_ratio": float(paddle_cfg.get("unclip_ratio", 1.6)),
            }

            # 检查模型目录
            paddlex_home = Path(os.environ.get("PADDLE_PDX_CACHE_HOME", os.environ.get("PADDLEX_HOME", "")))
            official_models_dir = paddlex_home / "official_models" if paddlex_home.exists() else None

            if model_type == "mobile":
                det_model = "PP-OCRv5_mobile_det"
                rec_model = "PP-OCRv5_mobile_rec"
            else:
                det_model = "PP-OCRv5_server_det"
                rec_model = "PP-OCRv5_server_rec"

            if official_models_dir and (official_models_dir / det_model).exists():
                kwargs["text_detection_model_name"] = det_model
                kwargs["text_recognition_model_name"] = rec_model
                logger.info(f"使用指定 OCR 模型: {det_model}")
            else:
                logger.info(f"OCR 模型 {det_model} 未找到，使用 PaddleOCR 默认模型")

            engine = self._safe_create_ocr(PaddleOCR, kwargs)
            engine._backend = "paddleocr"
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
                name = message.split("Unknown argument:", 1)[-1].strip().split()[0]
                if name in pending:
                    logger.warning(f"移除不支持的 PaddleOCR 参数: {name}")
                    pending.pop(name, None)
                    continue
                raise


# 全局状态实例
STATE = ServiceState()
