"""
LLM 客户端模块
支持 OpenAI 兼容格式和 Anthropic (Claude) 格式
"""

import json
import httpx


class LLMClient:
    """LLM 客户端，支持 OpenAI 兼容格式和 Anthropic 格式"""

    def __init__(self, api_key: str, base_url: str, model: str):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/') if base_url else ""
        self.model = model

    def _is_claude_model(self) -> bool:
        """检测是否是 Claude 模型"""
        return 'claude' in self.model.lower() if self.model else False

    def _build_endpoint(self) -> str:
        """构建 API 端点"""
        if self._is_claude_model():
            # Anthropic 格式
            if self.base_url.endswith('/messages'):
                return self.base_url
            elif self.base_url.endswith('/v1'):
                return f"{self.base_url}/messages"
            else:
                return f"{self.base_url}/v1/messages"
        else:
            # OpenAI 格式
            if self.base_url.endswith('/chat/completions'):
                return self.base_url
            elif self.base_url.endswith('/v1'):
                return f"{self.base_url}/chat/completions"
            else:
                return f"{self.base_url}/v1/chat/completions"

    def _get_headers(self) -> dict:
        """获取请求头"""
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}',
        }
        if self._is_claude_model():
            headers['anthropic-version'] = '2023-06-01'
        return headers

    async def stream_chat(self, messages: list, max_tokens: int = 2048, temperature: float = 0.7):
        """流式聊天请求"""
        endpoint = self._build_endpoint()
        headers = self._get_headers()

        if self._is_claude_model():
            async for chunk in self._stream_anthropic(endpoint, headers, messages, max_tokens, temperature):
                yield chunk
        else:
            async for chunk in self._stream_openai(endpoint, headers, messages, max_tokens, temperature):
                yield chunk

    async def _stream_anthropic(self, endpoint: str, headers: dict, messages: list,
                                 max_tokens: int, temperature: float):
        """Anthropic 格式流式请求"""
        system_content = None
        api_messages = []
        for msg in messages:
            if msg['role'] == 'system':
                system_content = msg['content']
            else:
                api_messages.append(msg)

        payload = {
            "model": self.model,
            "messages": api_messages,
            "stream": True,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if system_content:
            payload["system"] = system_content

        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream('POST', endpoint, headers=headers, json=payload) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    raise Exception(f"API 错误 ({response.status_code}): {error_text.decode()[:500]}")

                async for line in response.aiter_lines():
                    if not line or not line.startswith('data: '):
                        continue
                    data_str = line[6:]
                    if data_str == '[DONE]':
                        break
                    try:
                        chunk = json.loads(data_str)
                        event_type = chunk.get('type', '')
                        if event_type == 'content_block_delta':
                            delta = chunk.get('delta', {})
                            if delta.get('type') == 'text_delta':
                                text = delta.get('text', '')
                                if text:
                                    yield {"content": text}
                        elif event_type in ('message_delta', 'message_stop'):
                            yield {"finish_reason": "stop"}
                    except json.JSONDecodeError:
                        continue

    async def _stream_openai(self, endpoint: str, headers: dict, messages: list,
                              max_tokens: int, temperature: float):
        """OpenAI 格式流式请求"""
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream('POST', endpoint, headers=headers, json=payload) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    raise Exception(f"API 错误 ({response.status_code}): {error_text.decode()[:500]}")

                async for line in response.aiter_lines():
                    if not line or not line.startswith('data: '):
                        continue
                    data_str = line[6:]
                    if data_str == '[DONE]':
                        break
                    try:
                        chunk = json.loads(data_str)
                        choices = chunk.get('choices', [])
                        if choices:
                            delta = choices[0].get('delta', {})
                            content = delta.get('content')
                            finish_reason = choices[0].get('finish_reason')
                            if content:
                                yield {"content": content}
                            if finish_reason:
                                yield {"finish_reason": finish_reason}
                    except json.JSONDecodeError:
                        continue


# LLM 分析提示模板
ANALYZE_PROMPT_TEMPLATE = """请分析以下{source_lang_name}文本的语法结构和重点词汇，用{target_lang_name}解释：

原文：{text}

请按以下格式输出：

【语法分析】
分析句子的语法结构，包括主谓宾、从句、时态等。

【重点词汇】
列出重要的单词或短语，给出释义和用法说明。

【学习要点】
总结这段文本中值得学习的语言点。
"""
