"""
日志系统模块
提供环形日志缓冲区和日志配置
"""

import sys
import logging
from collections import deque
from datetime import datetime
from typing import List


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

    def clear(self):
        self.buffer.clear()
        self._last_id = 0


# 全局日志缓冲区实例
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
