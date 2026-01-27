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
- POST /analyze         - LLM 语法分析
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

import base64
import json
import sys
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# 导入拆分后的模块
from server import (
    LOG_BUFFER, setup_logging,
    LANG_MAP, OCR_LANG_MAP, LLM_LANG_NAMES,
    normalize_lang, is_chinese, get_ocr_lang, get_llm_lang_name,
    OcrRequest, OcrResponse, TranslateRequest, TranslateResponse,
    ModelsResponse, DownloadModelRequest, PreloadRequest, AnalyzeRequest,
    STATE, SCRIPT_DIR,
    do_ocr, extract_ocr_text,
    build_prompt, load_translate_model,
    LLMClient, ANALYZE_PROMPT_TEMPLATE,
)

# 设置日志
logger = setup_logging()

# 添加项目根目录到路径
PROJECT_ROOT = SCRIPT_DIR
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from rsta.config import load_config, save_config, DEFAULT_CONFIG

# 翻译模型参数
MAX_NEW_TOKENS = int(os.getenv("MAX_NEW_TOKENS", "256"))
TEMPERATURE = float(os.getenv("TEMPERATURE", "0.7"))
TOP_P = float(os.getenv("TOP_P", "0.6"))
TOP_K = int(os.getenv("TOP_K", "20"))
REPEAT_PENALTY = float(os.getenv("REPEAT_PENALTY", "1.05"))
TRANSLATE_TIMEOUT = int(os.getenv("TRANSLATE_TIMEOUT", "60"))

# 线程池用于超时控制
_executor = ThreadPoolExecutor(max_workers=2)


# ============== FastAPI 生命周期 ==============

@asynccontextmanager
async def lifespan(app):
    """应用生命周期管理"""
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
        try:
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

    if startup_cfg.get("auto_load_ocr", False) or startup_cfg.get("auto_load_translator", False):
        logger.info("模型将在后台异步加载...")
        preload_thread = threading.Thread(target=background_preload, daemon=True)
        preload_thread.start()
    else:
        logger.info("模型将在首次使用时按需加载（快速启动模式）")

    logger.info("=" * 60)
    logger.info("服务启动完成，可以接收请求")
    logger.info("=" * 60)

    yield

    logger.info("服务正在关闭...")


# ============== FastAPI 应用 ==============

app = FastAPI(title="Unified OCR + Translate Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== 健康检查和状态 API ==============

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
    """获取模型加载状态"""
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


# ============== 模型管理 API ==============

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
        model_dir = SCRIPT_DIR / "models"
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
            model_dir = SCRIPT_DIR / "models"
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
    """流式下载模型（带进度）"""
    import time

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

                repo_id = "tencent/HY-MT1.5-1.8B-GGUF"
                config = STATE._load_config()
                quant = config.get("local_service", {}).get("quant", "Q6_K")
                model_dir = SCRIPT_DIR / "models"
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

                local_path = model_dir / filename
                if local_path.exists():
                    yield send_progress(100, f"模型已存在: {filename}", "done")
                    return

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

                last_percent = 10
                while not download_complete.is_set():
                    time.sleep(2)
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


# ============== OCR API ==============

@app.post("/ocr/preload")
def preload_ocr(req: PreloadRequest):
    """预加载 OCR 模型"""
    cache_key = f"{req.model_type}_{req.lang}"

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

    if STATE.ocr_loading:
        raise HTTPException(status_code=503, detail="OCR 模型正在加载中，请稍候...")

    try:
        image_bytes = base64.b64decode(req.image)
    except Exception as e:
        image_preview = req.image[:50] if len(req.image) > 50 else req.image
        raise HTTPException(
            status_code=400,
            detail=f"Invalid base64 image: {e}. Preview: {image_preview}..."
        )

    try:
        text = do_ocr(image_bytes, req.model_type, req.lang, STATE)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR failed: {e}")

    elapsed = (time.perf_counter() - start_time) * 1000
    logger.info(f"[OCR] {elapsed:.0f}ms | lang={req.lang} | {len(text)} chars")

    return OcrResponse(text=text, model_type=req.model_type)


# ============== 翻译 API ==============

@app.post("/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest):
    import time
    start_time = time.perf_counter()

    text = (req.q or req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    if STATE.translate_loading:
        raise HTTPException(status_code=503, detail="翻译模型正在加载中，请稍候...")

    if not STATE.ensure_translate_model():
        raise HTTPException(status_code=503, detail="翻译模型未找到，请先在设置中下载翻译模型")

    prompt = build_prompt(req.source, req.target, text)

    def do_inference():
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
async def translate_stream(req: TranslateRequest):
    import asyncio

    text = (req.q or req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    if STATE.translate_loading:
        raise HTTPException(status_code=503, detail="翻译模型正在加载中，请稍候...")

    if not STATE.ensure_translate_model():
        raise HTTPException(status_code=503, detail="翻译模型未找到，请先在设置中下载翻译模型")

    prompt = build_prompt(req.source, req.target, text)

    async def generator():
        import time
        start_time = time.perf_counter()
        stream = None
        token_count = 0
        translated_text = ""
        first_token_time = None

        yield "data: {\"status\": \"connected\"}\n\n"
        await asyncio.sleep(0)

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
                        if first_token_time is None:
                            first_token_time = time.perf_counter()
                            prompt_time = (first_token_time - start_time) * 1000
                            logger.debug(f"[Translate-Stream] First token after {prompt_time:.0f}ms")
                        token_count += 1
                        translated_text += token
                        payload = json.dumps({"token": token}, ensure_ascii=False)
                        yield f"data: {payload}\n\n"
                        await asyncio.sleep(0)
                yield "data: [DONE]\n\n"
                elapsed = (time.perf_counter() - start_time) * 1000
                gen_time = (time.perf_counter() - first_token_time) * 1000 if first_token_time else 0
                logger.info(f"[Translate-Stream] {elapsed:.0f}ms total | {gen_time:.0f}ms gen | {token_count} tokens | {len(text)}->{len(translated_text)} chars")
            except GeneratorExit:
                elapsed = (time.perf_counter() - start_time) * 1000
                logger.info(f"[Translate-Stream] {elapsed:.0f}ms | cancelled | {token_count} tokens")
            except Exception as e:
                logger.error(f"[Translate-Stream] Error: {e}")
                yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"
            finally:
                if stream is not None:
                    try:
                        stream.close()
                    except Exception:
                        pass

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream; charset=utf-8",
        }
    )


# ============== LLM 解析 API ==============

@app.post("/analyze")
async def analyze_text(req: AnalyzeRequest):
    """解析文本的语法和词汇"""
    config = STATE._load_config()
    llm_config = config.get("llm", {})

    api_key = llm_config.get("api_key", "")
    base_url = llm_config.get("base_url", "")
    model = llm_config.get("model", "")

    if not api_key or not base_url or not model:
        raise HTTPException(
            status_code=400,
            detail="LLM API 未配置，请在设置中配置 API Key、Base URL 和模型名称"
        )

    source_lang_name = get_llm_lang_name(req.source_lang)
    target_lang_name = get_llm_lang_name(req.target_lang)

    prompt = ANALYZE_PROMPT_TEMPLATE.format(
        source_lang_name=source_lang_name,
        target_lang_name=target_lang_name,
        text=req.text
    )

    messages = [
        {"role": "system", "content": "你是一个专业的语言学习助手，擅长分析语法和词汇。"},
        {"role": "user", "content": prompt}
    ]

    client = LLMClient(api_key=api_key, base_url=base_url, model=model)

    async def generator():
        try:
            async for chunk in client.stream_chat(messages):
                if chunk.get("content"):
                    payload = json.dumps({"token": chunk["content"]}, ensure_ascii=False)
                    yield f"data: {payload}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"[Analyze] Error: {e}")
            yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


# ============== 配置 API ==============

@app.get("/config")
def get_config():
    """获取当前配置"""
    return load_config()


@app.post("/config")
def update_config(config: dict):
    """更新配置"""
    try:
        current = load_config()
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


# ============== 入口 ==============

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
