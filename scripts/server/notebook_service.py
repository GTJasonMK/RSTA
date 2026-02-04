"""
笔记本数据库服务模块
提供翻译记录的持久化存储和查询功能
"""

import os
import sys
import json
import sqlite3
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any
from contextlib import contextmanager

logger = logging.getLogger(__name__)


def get_db_path() -> Path:
    """获取数据库文件路径"""
    if getattr(sys, 'frozen', False):
        # 打包环境：与可执行文件同目录
        base_path = Path(sys.executable).parent
        if (base_path.parent / 'data').exists():
            return base_path.parent / 'data' / 'notebook.db'
        data_dir = base_path / 'data'
    else:
        # 开发环境：项目根目录
        project_root = Path(__file__).resolve().parents[2]
        data_dir = project_root / 'data'

    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / 'notebook.db'


DB_PATH = get_db_path()


def init_db():
    """初始化数据库表结构"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS translation_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                date_key TEXT NOT NULL,
                ocr_text TEXT NOT NULL,
                translated_text TEXT,
                analysis_text TEXT,
                source_lang TEXT DEFAULT 'en',
                target_lang TEXT DEFAULT 'zh',
                mode TEXT DEFAULT 'translate',
                qa_history TEXT
            )
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_date_key
            ON translation_records(date_key)
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_created_at
            ON translation_records(created_at DESC)
        ''')
        conn.commit()

        # 迁移：为旧数据库添加新字段
        _migrate_add_columns(conn)

    logger.info(f"数据库初始化完成: {DB_PATH}")


def _migrate_add_columns(conn):
    """为已有数据库添加新字段（兼容旧版本）"""
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(translation_records)")
    existing_cols = {row['name'] for row in cursor.fetchall()}

    migrations = [
        ("mode", "TEXT DEFAULT 'translate'"),
        ("qa_history", "TEXT"),
    ]
    for col_name, col_def in migrations:
        if col_name not in existing_cols:
            cursor.execute(f'ALTER TABLE translation_records ADD COLUMN {col_name} {col_def}')
            logger.info(f"数据库迁移：添加字段 {col_name}")

    conn.commit()


@contextmanager
def get_connection():
    """获取数据库连接的上下文管理器"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def save_record(
    ocr_text: str,
    translated_text: Optional[str] = None,
    analysis_text: Optional[str] = None,
    source_lang: str = "en",
    target_lang: str = "zh"
) -> Dict[str, Any]:
    """保存新的翻译记录

    Returns:
        包含 id 和 date_key 的字典
    """
    date_key = datetime.now().strftime("%Y-%m-%d")
    created_at = datetime.now().isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO translation_records
            (created_at, date_key, ocr_text, translated_text, analysis_text, source_lang, target_lang)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (created_at, date_key, ocr_text, translated_text, analysis_text, source_lang, target_lang))
        conn.commit()
        record_id = cursor.lastrowid

    logger.info(f"保存记录: id={record_id}, date={date_key}")
    return {"id": record_id, "date_key": date_key}


def update_record(record_id: int, analysis_text: Optional[str] = None) -> bool:
    """更新记录的分析结果

    Returns:
        是否更新成功
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE translation_records
            SET analysis_text = ?
            WHERE id = ?
        ''', (analysis_text, record_id))
        conn.commit()
        success = cursor.rowcount > 0

    if success:
        logger.info(f"更新记录分析结果: id={record_id}")
    return success


def get_record(record_id: int) -> Optional[Dict[str, Any]]:
    """获取单条记录"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, created_at, date_key, ocr_text, translated_text,
                   analysis_text, source_lang, target_lang, mode, qa_history
            FROM translation_records
            WHERE id = ?
        ''', (record_id,))
        row = cursor.fetchone()

    if row:
        record = dict(row)
        # 解析 qa_history JSON
        if record.get('qa_history'):
            try:
                record['qa_history'] = json.loads(record['qa_history'])
            except json.JSONDecodeError:
                record['qa_history'] = []
        else:
            record['qa_history'] = []
        return record
    return None


def get_records_by_date(date_key: str) -> List[Dict[str, Any]]:
    """获取指定日期的所有记录"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, created_at, date_key, ocr_text, translated_text,
                   analysis_text, source_lang, target_lang, mode, qa_history
            FROM translation_records
            WHERE date_key = ?
            ORDER BY created_at DESC
        ''', (date_key,))
        rows = cursor.fetchall()

    records = []
    for row in rows:
        record = dict(row)
        # 解析 qa_history JSON
        if record.get('qa_history'):
            try:
                record['qa_history'] = json.loads(record['qa_history'])
            except json.JSONDecodeError:
                record['qa_history'] = []
        else:
            record['qa_history'] = []
        records.append(record)

    return records


def get_dates_with_counts() -> Dict[str, Any]:
    """获取所有有记录的日期及其记录数

    Returns:
        { "dates": ["2024-02-04", ...], "counts": {"2024-02-04": 5, ...} }
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT date_key, COUNT(*) as count
            FROM translation_records
            GROUP BY date_key
            ORDER BY date_key DESC
        ''')
        rows = cursor.fetchall()

    dates = []
    counts = {}
    for row in rows:
        dates.append(row['date_key'])
        counts[row['date_key']] = row['count']

    return {"dates": dates, "counts": counts}


def delete_record(record_id: int) -> bool:
    """删除单条记录"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM translation_records WHERE id = ?', (record_id,))
        conn.commit()
        success = cursor.rowcount > 0

    if success:
        logger.info(f"删除记录: id={record_id}")
    return success


def delete_records_by_date(date_key: str) -> int:
    """删除指定日期的所有记录

    Returns:
        删除的记录数
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM translation_records WHERE date_key = ?', (date_key,))
        conn.commit()
        deleted_count = cursor.rowcount

    logger.info(f"删除日期 {date_key} 的记录: {deleted_count} 条")
    return deleted_count


# ============== QA 模式相关函数 ==============


def save_qa_record(
    ocr_text: str,
    source_lang: str = "en",
    target_lang: str = "zh"
) -> Dict[str, Any]:
    """保存新的QA记录（OCR完成后立即调用）

    Returns:
        包含 id 和 date_key 的字典
    """
    date_key = datetime.now().strftime("%Y-%m-%d")
    created_at = datetime.now().isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO translation_records
            (created_at, date_key, ocr_text, source_lang, target_lang, mode, qa_history)
            VALUES (?, ?, ?, ?, ?, 'qa', '[]')
        ''', (created_at, date_key, ocr_text, source_lang, target_lang))
        conn.commit()
        record_id = cursor.lastrowid

    logger.info(f"保存QA记录: id={record_id}, date={date_key}")
    return {"id": record_id, "date_key": date_key}


def get_qa_history(record_id: int) -> List[Dict[str, str]]:
    """获取某条记录的QA对话历史

    Returns:
        [{"q": "问题", "a": "回答"}, ...]
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT qa_history FROM translation_records WHERE id = ?', (record_id,))
        row = cursor.fetchone()

    if not row or not row['qa_history']:
        return []

    try:
        return json.loads(row['qa_history'])
    except json.JSONDecodeError:
        return []


def append_qa_pair(record_id: int, question: str, answer: str) -> bool:
    """追加一轮QA对话到记录中

    Returns:
        是否更新成功
    """
    history = get_qa_history(record_id)
    history.append({"q": question, "a": answer})
    history_json = json.dumps(history, ensure_ascii=False)

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE translation_records
            SET qa_history = ?
            WHERE id = ?
        ''', (history_json, record_id))
        conn.commit()
        success = cursor.rowcount > 0

    if success:
        logger.info(f"追加QA对话: id={record_id}, round={len(history)}")
    return success


# 模块加载时初始化数据库
init_db()
