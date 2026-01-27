import json
import os
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from huggingface_hub import hf_hub_download, list_repo_files
from llama_cpp import Llama

# 项目根目录和配置
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
CONFIG_PATH = ROOT_DIR / "config.json"


def load_config():
    """加载配置文件"""
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


LANG_MAP = {
    "en": "English",
    "zh": "中文",
    "zh-cn": "中文",
    "zh-hans": "中文",
    "zh-hant": "繁体中文",
    "ja": "日语",
    "ko": "韩语",
    "fr": "法语",
    "de": "德语",
    "es": "西班牙语",
    "ru": "俄语",
    "pt": "葡萄牙语",
    "tr": "土耳其语",
    "ar": "阿拉伯语",
    "th": "泰语",
    "it": "意大利语",
    "vi": "越南语",
    "ms": "马来语",
    "id": "印尼语",
    "tl": "菲律宾语",
    "hi": "印地语",
    "pl": "波兰语",
    "nl": "荷兰语",
    "cs": "捷克语",
    "uk": "乌克兰语",
    "yue": "粤语",
}


class TranslateRequest(BaseModel):
    q: Optional[str] = None
    text: Optional[str] = None
    source: str = "en"
    target: str = "zh"
    format: Optional[str] = None
    api_key: Optional[str] = None


class TranslateResponse(BaseModel):
    translatedText: str


def normalize_lang(lang):
    value = lang.strip()
    key = value.lower()
    return LANG_MAP.get(key, value)


def is_chinese(lang):
    key = lang.lower()
    return key in {"中文", "繁体中文", "zh", "zh-cn", "zh-hans", "zh-hant"}


def build_prompt(source_lang, target_lang, text):
    source = normalize_lang(source_lang)
    target = normalize_lang(target_lang)
    if is_chinese(source) or is_chinese(target):
        return f"将以下文本翻译为{target}，注意只需要输出翻译后的结果，不要额外解释：\n\n{text}"
    return f"Translate the following segment into {target}, without additional explanation.\n\n{text}"


def select_model_file(repo_id, quant):
    try:
        files = [f for f in list_repo_files(repo_id) if f.lower().endswith(".gguf")]
    except Exception as exc:
        raise RuntimeError(
            "无法访问 Hugging Face 获取模型文件列表，可能是代理/网络/SSL 问题。"
            "请检查网络或代理设置，或先将 GGUF 模型文件下载到本地并设置 MODEL_FILE。"
        ) from exc
    if not files:
        raise RuntimeError("模型仓库未找到 GGUF 文件")
    quant_key = quant.lower()
    matched = [f for f in files if quant_key in f.lower()]
    if not matched:
        raise RuntimeError(f"未找到匹配量化档位 {quant} 的 GGUF 文件")
    matched.sort(key=len)
    return matched[0]


def find_local_gguf(model_dir, quant):
    candidates = [p for p in model_dir.rglob("*.gguf") if p.is_file()]
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    quant_key = quant.lower()
    matched = [p for p in candidates if quant_key in p.name.lower()]
    if not matched:
        return None
    matched.sort(key=lambda p: len(p.name))
    return matched[0]


def resolve_model_path(repo_id, filename, model_dir, auto_download=False):
    candidate = Path(filename)
    if candidate.is_file():
        return str(candidate)
    if not candidate.is_absolute():
        local_file = model_dir / filename
        if local_file.is_file():
            return str(local_file)

    # 模型不存在，检查是否允许自动下载
    if not auto_download:
        download_url = f"https://huggingface.co/{repo_id}/resolve/main/{filename}"
        target_path = model_dir / filename
        raise RuntimeError(
            f"\n{'='*60}\n"
            f"翻译模型未找到！\n"
            f"{'='*60}\n\n"
            f"模型文件: {filename}\n"
            f"目标路径: {target_path}\n\n"
            f"请手动下载模型：\n"
            f"  1. 访问: {download_url}\n"
            f"  2. 下载文件并保存到: {target_path}\n\n"
            f"或者在 config.json 中设置 local_service.auto_download = true 允许自动下载\n"
            f"{'='*60}\n"
        )

    print(f"\n{'='*60}")
    print(f"正在下载翻译模型...")
    print(f"仓库: {repo_id}")
    print(f"文件: {filename}")
    print(f"目标: {model_dir}")
    print(f"{'='*60}\n")

    return hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=model_dir,
        local_dir_use_symlinks=False,
    )


def load_model():
    # 加载配置
    config = load_config()
    local_service_cfg = config.get("local_service", {})
    auto_download = bool(local_service_cfg.get("auto_download", False))

    repo_id = os.getenv("MODEL_REPO", "tencent/HY-MT1.5-1.8B-GGUF")
    quant = os.getenv("QUANT", local_service_cfg.get("quant", "Q6_K"))
    default_dir = ROOT_DIR / "models"
    model_dir = Path(os.getenv("MODEL_DIR", default_dir)).resolve()
    model_dir.mkdir(parents=True, exist_ok=True)

    filename = os.getenv("MODEL_FILE", "").strip()
    if not filename:
        local_candidate = find_local_gguf(model_dir, quant)
        if local_candidate is not None:
            filename = str(local_candidate)
        else:
            filename = select_model_file(repo_id, quant)
    model_path = resolve_model_path(repo_id, filename, model_dir, auto_download)

    n_ctx = int(os.getenv("N_CTX", "4096"))
    n_threads = int(os.getenv("N_THREADS", str(max(os.cpu_count() - 1, 1))))
    n_batch = int(os.getenv("N_BATCH", "128"))

    return Llama(
        model_path=model_path,
        n_ctx=n_ctx,
        n_threads=n_threads,
        n_batch=n_batch,
        n_gpu_layers=0,
        use_mmap=True,
        verbose=False,
    ), repo_id, filename


app = FastAPI()
MODEL, MODEL_REPO, MODEL_FILE = load_model()
MAX_NEW_TOKENS = int(os.getenv("MAX_NEW_TOKENS", "256"))
TEMPERATURE = float(os.getenv("TEMPERATURE", "0.7"))
TOP_P = float(os.getenv("TOP_P", "0.6"))
TOP_K = int(os.getenv("TOP_K", "20"))
REPEAT_PENALTY = float(os.getenv("REPEAT_PENALTY", "1.05"))


@app.get("/health")
def health():
    return {"status": "ok", "repo": MODEL_REPO, "file": MODEL_FILE}


@app.post("/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest):
    text = (req.q or req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")
    prompt = build_prompt(req.source, req.target, text)
    result = MODEL.create_completion(
        prompt=prompt,
        max_tokens=MAX_NEW_TOKENS,
        temperature=TEMPERATURE,
        top_p=TOP_P,
        top_k=TOP_K,
        repeat_penalty=REPEAT_PENALTY,
        echo=False,
    )
    translated = result["choices"][0]["text"].strip()
    return TranslateResponse(translatedText=translated)


@app.post("/translate_stream")
def translate_stream(req: TranslateRequest):
    text = (req.q or req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")
    prompt = build_prompt(req.source, req.target, text)

    def generator():
        stream = MODEL.create_completion(
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
                payload = json.dumps({"token": token})
                yield f"data: {payload}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generator(), media_type="text/event-stream")


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
