try:
    from argostranslate import translate as argos_translate
except ImportError:
    argos_translate = None

import json
import requests


class ArgosTranslator:
    def __init__(self, from_code, to_code):
        if argos_translate is None:
            raise RuntimeError("argostranslate is not installed")
        if from_code == "auto":
            raise ValueError("Argos translator does not support auto source language")
        self.from_code = from_code
        self.to_code = to_code
        if not has_argos_language_pair(from_code, to_code):
            raise RuntimeError(
                f"Argos 语言包缺失：{from_code} -> {to_code}。请安装对应语言包。"
            )

    def translate(self, text):
        return argos_translate.translate(text, self.from_code, self.to_code)


class LibreTranslateTranslator:
    def __init__(self, url, source, target, api_key, stream=False):
        self.url = url
        self.source = source
        self.target = target
        self.api_key = api_key
        self.stream = bool(stream)

    def translate(self, text):
        payload = {
            "q": text,
            "source": self.source,
            "target": self.target,
            "format": "text"
        }
        if self.api_key:
            payload["api_key"] = self.api_key
        response = requests.post(self.url, json=payload, timeout=15)
        response.raise_for_status()
        data = response.json()
        return data.get("translatedText", "")

    def translate_stream(self, text):
        if not self.stream:
            yield self.translate(text)
            return
        payload = {
            "q": text,
            "source": self.source,
            "target": self.target,
            "format": "text"
        }
        if self.api_key:
            payload["api_key"] = self.api_key
        stream_url = self.url.rstrip("/")
        if stream_url.endswith("/translate"):
            stream_url = stream_url.rsplit("/", 1)[0] + "/translate_stream"
        response = None
        try:
            response = requests.post(stream_url, json=payload, stream=True, timeout=30)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            is_sse = "text/event-stream" in content_type.lower()
            saw_data_event = False
            sse_mode = is_sse

            def handle_sse_line(raw_line):
                raw = raw_line[len("data:"):].lstrip(" \t")
                raw_stripped = raw.strip()
                if (sse_mode or saw_data_event) and raw_stripped == "[DONE]" and raw.strip() == "[DONE]":
                    return True, None
                if raw.startswith("{") and raw.endswith("}"):
                    try:
                        payload = json.loads(raw)
                        token = payload.get("token")
                        if isinstance(token, str):
                            return False, token
                    except Exception:
                        pass
                if raw_stripped == "\\n":
                    return False, "\n"
                return False, raw

            for line in response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                if line.startswith("data:"):
                    raw_candidate = line[len("data:"):].lstrip(" \t")
                    candidate_stripped = raw_candidate.strip()
                    if sse_mode or candidate_stripped in ("[DONE]", "\\n") or (raw_candidate.startswith("{") and raw_candidate.endswith("}")):
                        sse_mode = True
                        saw_data_event = True
                        done, payload = handle_sse_line(line)
                        if done:
                            break
                        if payload is not None:
                            yield payload
                        continue
                    if not sse_mode:
                        yield raw_candidate
                        continue
                if not sse_mode:
                    yield line
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass


class UnifiedServiceTranslator:
    """
    统一服务翻译器。
    调用 serve_unified.py 提供的翻译 API。
    """

    def __init__(self, host, port, source, target, stream=True, timeout=30):
        self.base_url = f"http://{host}:{port}"
        self.translate_url = f"{self.base_url}/translate"
        self.stream_url = f"{self.base_url}/translate_stream"
        self.source = source
        self.target = target
        self.stream = bool(stream)
        self.timeout = timeout

    def translate(self, text):
        payload = {
            "text": text,
            "source": self.source,
            "target": self.target,
        }
        try:
            response = requests.post(self.translate_url, json=payload, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            return data.get("translatedText", "")
        except requests.exceptions.Timeout:
            raise RuntimeError(f"翻译服务超时 ({self.timeout}s)")
        except requests.exceptions.ConnectionError:
            raise RuntimeError(f"无法连接翻译服务: {self.base_url}")
        except requests.exceptions.HTTPError as e:
            detail = ""
            status_code = "unknown"
            if e.response is not None:
                status_code = e.response.status_code
                try:
                    detail = e.response.json().get("detail", "")
                except Exception:
                    pass
            raise RuntimeError(f"翻译服务错误: {status_code} {detail}")
        except Exception as e:
            raise RuntimeError(f"翻译请求失败: {e}")

    def translate_stream(self, text):
        if not self.stream:
            yield self.translate(text)
            return

        payload = {
            "text": text,
            "source": self.source,
            "target": self.target,
        }
        response = None
        try:
            response = requests.post(self.stream_url, json=payload, stream=True, timeout=self.timeout)
            response.raise_for_status()

            for line in response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                if line.startswith("data:"):
                    raw = line[len("data:"):].strip()
                    if raw == "[DONE]":
                        break
                    if raw.startswith("{") and raw.endswith("}"):
                        try:
                            data = json.loads(raw)
                            token = data.get("token")
                            if isinstance(token, str):
                                yield token
                        except Exception:
                            pass
        except requests.exceptions.Timeout:
            raise RuntimeError(f"翻译服务超时 ({self.timeout}s)")
        except requests.exceptions.ConnectionError:
            raise RuntimeError(f"无法连接翻译服务: {self.base_url}")
        except Exception as e:
            raise RuntimeError(f"翻译请求失败: {e}")
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass


def has_argos_language_pair(from_code, to_code):
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


def create_translator(config):
    translator_type = config.get("translator", "argos").lower()
    source_lang = config.get("source_lang", "en")
    target_lang = config.get("target_lang", "zh")

    # 统一服务翻译器
    if translator_type == "unified":
        service_cfg = config.get("unified_service", {})
        return UnifiedServiceTranslator(
            host=service_cfg.get("host", "127.0.0.1"),
            port=service_cfg.get("port", 8092),
            source=source_lang,
            target=target_lang,
            stream=True,
            timeout=service_cfg.get("timeout", 30)
        ), None

    if translator_type == "argos":
        if argos_translate is None:
            raise RuntimeError("argostranslate 未安装。请安装 argostranslate 或更换其他翻译器。")
        if not has_argos_language_pair(source_lang, target_lang):
            raise RuntimeError(f"Argos 语言包缺失：{source_lang} -> {target_lang}。请安装对应语言包。")
        return ArgosTranslator(source_lang, target_lang), None
    if translator_type == "libretranslate":
        lt = config.get("libretranslate", {})
        return LibreTranslateTranslator(
            lt.get("url", "http://localhost:5000/translate"),
            source_lang,
            target_lang,
            lt.get("api_key", ""),
            lt.get("stream", False)
        ), None
    if translator_type == "none":
        return None, None
    raise ValueError(f"Unknown translator type: {translator_type}")
