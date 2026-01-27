"""
翻译服务模块
提供翻译模型加载和翻译功能
"""

import os
import logging
from pathlib import Path
from typing import Optional, Tuple

from .constants import normalize_lang, is_chinese

logger = logging.getLogger(__name__)


def build_prompt(source_lang: str, target_lang: str, text: str) -> str:
    """构建翻译提示"""
    source = normalize_lang(source_lang)
    target = normalize_lang(target_lang)
    if is_chinese(source) or is_chinese(target):
        return f"将以下文本翻译为{target}，注意只需要输出翻译后的结果，不要额外解释：\n\n{text}"
    return f"Translate the following segment into {target}, without additional explanation.\n\n{text}"


def load_translate_model(config: dict) -> Tuple[Optional[object], Optional[str], Optional[str]]:
    """加载翻译模型

    Args:
        config: 配置字典

    Returns:
        (model, repo_id, filename) 元组
    """
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

    # 从配置文件读取设置
    local_service_cfg = config.get("local_service", {})
    repo_id = os.getenv("MODEL_REPO") or local_service_cfg.get("model_repo", "tencent/HY-MT1.5-1.8B-GGUF")
    quant = os.getenv("QUANT") or local_service_cfg.get("quant", "Q6_K")

    # 获取脚本目录的父目录作为项目根目录
    script_dir = Path(__file__).resolve().parents[2]
    default_dir = script_dir / "models"
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
