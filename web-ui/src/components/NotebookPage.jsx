import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Calendar, FileText, Trash2, MessageCircle, Languages, ChevronDown } from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import SimpleMarkdown from './SimpleMarkdown';

/**
 * 笔记本页面组件
 * 左侧显示记录列表，右侧显示记录详情
 * 支持翻译/QA模式切换和日期筛选
 */
const NotebookPage = ({ onBack, baseUrl }) => {
  // 模式切换状态
  const [selectedMode, setSelectedMode] = useState('translate'); // 'translate' 或 'qa'

  // 日期筛选状态
  const [dates, setDates] = useState([]); // 可选的日期列表
  const [selectedDate, setSelectedDate] = useState(''); // 空字符串表示全部日期
  const [showDatePicker, setShowDatePicker] = useState(false);

  // 记录列表相关状态
  const [records, setRecords] = useState([]);
  const [selectedRecordId, setSelectedRecordId] = useState(null);

  // 加载状态
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 获取日期列表（用于筛选下拉框）
  const fetchDates = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/notebook/dates?mode=${selectedMode}`);
      if (!res.ok) throw new Error('Failed to fetch dates');
      const data = await res.json();
      setDates(data.dates || []);
    } catch (err) {
      console.error('Failed to fetch dates:', err);
    }
  }, [baseUrl, selectedMode]);

  // 获取记录列表
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      let url = `${baseUrl}/notebook/records?mode=${selectedMode}`;
      if (selectedDate) {
        url += `&date=${selectedDate}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch records');
      const data = await res.json();
      setRecords(data.records || []);
      // 默认选中第一条记录
      if (data.records?.length > 0) {
        setSelectedRecordId(data.records[0].id);
      } else {
        setSelectedRecordId(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, selectedMode, selectedDate]);

  // 模式变化时重新获取日期和记录
  useEffect(() => {
    setSelectedDate(''); // 切换模式时重置日期筛选
    fetchDates();
  }, [selectedMode, fetchDates]);

  // 日期或模式变化时获取记录
  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // 删除记录
  const handleDeleteRecord = async (recordId, e) => {
    e.stopPropagation();
    if (!window.confirm('确定要删除这条记录吗？')) return;
    try {
      const res = await fetch(`${baseUrl}/notebook/record/${recordId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete record');
      // 刷新记录列表和日期
      await fetchRecords();
      await fetchDates();
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  };

  // 当前选中的记录
  const currentRecord = records.find(r => r.id === selectedRecordId);

  // 格式化时间显示
  const formatTime = (isoString) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  // 格式化日期显示
  const formatDate = (isoString) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  // 截取文本预览
  const getPreview = (text, maxLen = 50) => {
    if (!text) return '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '...' : cleaned;
  };

  return (
    <div className="flex flex-col h-screen bg-[#FAFAF9] text-stone-900 overflow-hidden">
      {/* Header */}
      <div className="h-10 bg-white border-b border-stone-200 flex items-center justify-between px-3 drag-region">
        <div className="flex items-center gap-3 no-drag">
          <button
            onClick={onBack}
            className="p-1.5 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-600"
          >
            <ArrowLeft size={16} />
          </button>

          {/* 模式切换 Tab */}
          <div className="flex items-center bg-stone-100 rounded-md p-0.5">
            <button
              onClick={() => setSelectedMode('translate')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                selectedMode === 'translate'
                  ? 'bg-white text-amber-600 shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              <Languages size={12} />
              <span>Translate</span>
            </button>
            <button
              onClick={() => setSelectedMode('qa')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                selectedMode === 'qa'
                  ? 'bg-white text-purple-600 shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              <MessageCircle size={12} />
              <span>Q&A</span>
            </button>
          </div>

          {/* 日期筛选下拉框 */}
          <div className="relative">
            <button
              onClick={() => setShowDatePicker(!showDatePicker)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 rounded border border-stone-200"
            >
              <Calendar size={12} />
              <span>{selectedDate || '全部日期'}</span>
              <ChevronDown size={12} />
            </button>
            {showDatePicker && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-stone-200 rounded-md shadow-lg z-50 min-w-[120px] max-h-[300px] overflow-y-auto">
                <button
                  onClick={() => { setSelectedDate(''); setShowDatePicker(false); }}
                  className={`w-full px-3 py-1.5 text-left text-xs hover:bg-stone-50 ${
                    !selectedDate ? 'bg-stone-100 text-amber-600' : 'text-stone-600'
                  }`}
                >
                  全部日期
                </button>
                {dates.map(date => (
                  <button
                    key={date}
                    onClick={() => { setSelectedDate(date); setShowDatePicker(false); }}
                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-stone-50 ${
                      selectedDate === date ? 'bg-stone-100 text-amber-600' : 'text-stone-600'
                    }`}
                  >
                    {date}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 记录数量 */}
          <span className="text-xs text-stone-400">
            {records.length} 条记录
          </span>
        </div>
      </div>

      {/* 点击其他地方关闭日期选择器 */}
      {showDatePicker && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowDatePicker(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧记录列表 */}
        <div className="w-64 border-r border-stone-200 bg-white overflow-y-auto">
          {loading ? (
            <div className="p-4 text-xs text-stone-400">加载中...</div>
          ) : records.length === 0 ? (
            <div className="p-4 text-xs text-stone-400 text-center">
              <FileText size={32} className="mx-auto mb-2 opacity-30" />
              <div>暂无记录</div>
            </div>
          ) : (
            records.map((record) => (
              <div
                key={record.id}
                onClick={() => setSelectedRecordId(record.id)}
                className={`p-3 border-b border-stone-100 cursor-pointer hover:bg-stone-50 group ${
                  selectedRecordId === record.id ? 'bg-amber-50 border-l-2 border-l-amber-400' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 text-xs text-stone-400">
                    {!selectedDate && (
                      <span>{formatDate(record.created_at)}</span>
                    )}
                    <span>{formatTime(record.created_at)}</span>
                  </div>
                  <button
                    onClick={(e) => handleDeleteRecord(record.id, e)}
                    className="p-1 text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="text-xs text-stone-600 line-clamp-2">
                  {getPreview(record.ocr_text, 80)}
                </div>
                {selectedMode === 'translate' && record.translated_text && (
                  <div className="text-xs text-stone-400 mt-1 line-clamp-1">
                    → {getPreview(record.translated_text, 40)}
                  </div>
                )}
                {selectedMode === 'qa' && record.qa_history?.length > 0 && (
                  <div className="text-xs text-purple-400 mt-1">
                    {record.qa_history.length} 轮对话
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* 右侧内容区域 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {error ? (
            <div className="flex-1 flex items-center justify-center text-red-500">
              {error}
            </div>
          ) : !currentRecord ? (
            <div className="flex-1 flex items-center justify-center text-stone-400">
              <div className="text-center">
                <FileText size={48} className="mx-auto mb-2 opacity-30" />
                <div>选择一条记录查看详情</div>
              </div>
            </div>
          ) : (
            <>
              {/* 记录信息标签 */}
              <div className="px-4 py-2 bg-stone-50 border-b border-stone-200 text-xs text-stone-500 flex items-center gap-2">
                <span>{currentRecord.date_key}</span>
                <span>{formatTime(currentRecord.created_at)}</span>
                {currentRecord.source_lang && currentRecord.target_lang && (
                  <span className="text-stone-400">
                    {currentRecord.source_lang.toUpperCase()} → {currentRecord.target_lang.toUpperCase()}
                  </span>
                )}
              </div>

              {/* 根据模式显示不同布局 */}
              {selectedMode === 'qa' ? (
                /* QA模式布局：纵向滚动 */
                <div className="flex-1 overflow-y-auto bg-white p-4 space-y-4">
                  {/* OCR原文卡片 */}
                  <div className="rounded-lg border border-purple-200 bg-purple-50/30">
                    <div className="px-3 py-2 border-b border-purple-200 text-xs font-bold text-purple-500 uppercase tracking-wider">
                      Original (OCR)
                    </div>
                    <div className="p-3 text-sm text-stone-700 whitespace-pre-wrap">
                      {currentRecord.ocr_text || <span className="text-stone-400 italic">No OCR text</span>}
                    </div>
                  </div>

                  {/* QA对话历史 */}
                  {(() => {
                    const qaList = Array.isArray(currentRecord.qa_history)
                      ? currentRecord.qa_history
                      : [];
                    if (qaList.length === 0) {
                      return (
                        <div className="text-stone-400 italic text-sm text-center py-8">
                          No Q&A history
                        </div>
                      );
                    }
                    return qaList.map((qa, idx) => (
                      <div key={idx} className="rounded-lg border border-stone-200">
                        {/* 问题 */}
                        <div className="px-3 py-2 bg-purple-50 border-b border-stone-200 text-sm font-medium text-purple-700">
                          Q{idx + 1}: {qa.q}
                        </div>
                        {/* 回答 */}
                        <div className="p-3 text-sm text-stone-700">
                          <SimpleMarkdown content={qa.a} />
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                /* 翻译模式布局 */
                <PanelGroup direction="horizontal" className="flex-1">
                  {/* 左侧：OCR + 翻译（上下分栏） */}
                  <Panel defaultSize={50} minSize={20}>
                    <div className="h-full flex flex-col">
                      {/* 上方：OCR 原文 */}
                      <div className="flex-1 flex flex-col bg-white border-b border-stone-200 min-h-0">
                        <div className="px-3 py-2 border-b border-stone-100 text-xs font-bold text-amber-500 uppercase tracking-wider flex-shrink-0">
                          Original (OCR)
                        </div>
                        <div className="flex-1 p-3 overflow-y-auto text-sm text-stone-700 whitespace-pre-wrap">
                          {currentRecord.ocr_text || <span className="text-stone-400 italic">No OCR text</span>}
                        </div>
                      </div>

                      {/* 下方：翻译结果 */}
                      <div className="flex-1 flex flex-col bg-white min-h-0">
                        <div className="px-3 py-2 border-b border-stone-100 text-xs font-bold text-amber-500 uppercase tracking-wider flex-shrink-0">
                          Translation
                        </div>
                        <div className="flex-1 p-3 overflow-y-auto text-sm text-stone-700 whitespace-pre-wrap">
                          {currentRecord.translated_text || <span className="text-stone-400 italic">No translation</span>}
                        </div>
                      </div>
                    </div>
                  </Panel>

                  <PanelResizeHandle className="w-1 bg-stone-200 hover:bg-amber-400 transition-colors cursor-col-resize" />

                  {/* 右侧：分析结果 */}
                  <Panel defaultSize={50} minSize={20}>
                    <div className="h-full flex flex-col bg-white">
                      <div className="px-3 py-2 border-b border-stone-100 text-xs font-bold text-amber-500 uppercase tracking-wider">
                        Analysis
                      </div>
                      <div className="flex-1 p-3 overflow-y-auto text-sm text-stone-700">
                        {currentRecord.analysis_text ? (
                          <SimpleMarkdown content={currentRecord.analysis_text} />
                        ) : (
                          <div className="text-stone-400 italic">No analysis</div>
                        )}
                      </div>
                    </div>
                  </Panel>
                </PanelGroup>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotebookPage;
