import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Calendar, FileText, Trash2, ChevronLeft, ChevronRight, MessageCircle, Languages } from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import SimpleMarkdown from './SimpleMarkdown';

/**
 * 笔记本页面组件
 * 显示按日期分组的翻译记录
 */
const NotebookPage = ({ onBack, baseUrl }) => {
  // 日期列表相关状态
  const [dates, setDates] = useState([]);
  const [counts, setCounts] = useState({});
  const [selectedDate, setSelectedDate] = useState(null);

  // 记录列表相关状态
  const [records, setRecords] = useState([]);
  const [selectedRecordIndex, setSelectedRecordIndex] = useState(0);

  // 加载状态
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 获取日期列表
  const fetchDates = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/notebook/dates`);
      if (!res.ok) throw new Error('Failed to fetch dates');
      const data = await res.json();
      setDates(data.dates || []);
      setCounts(data.counts || {});
      // 默认选中第一个日期
      if (data.dates?.length > 0 && !selectedDate) {
        setSelectedDate(data.dates[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, selectedDate]);

  // 获取指定日期的记录
  const fetchRecords = useCallback(async (date) => {
    if (!date) return;
    try {
      const res = await fetch(`${baseUrl}/notebook/records?date=${date}`);
      if (!res.ok) throw new Error('Failed to fetch records');
      const data = await res.json();
      setRecords(data.records || []);
      setSelectedRecordIndex(0);
    } catch (err) {
      setError(err.message);
    }
  }, [baseUrl]);

  // 初始加载日期列表
  useEffect(() => {
    fetchDates();
  }, [fetchDates]);

  // 日期变化时加载记录
  useEffect(() => {
    if (selectedDate) {
      fetchRecords(selectedDate);
    }
  }, [selectedDate, fetchRecords]);

  // 删除记录
  const handleDeleteRecord = async (recordId) => {
    if (!window.confirm('Are you sure you want to delete this record?')) return;
    try {
      const res = await fetch(`${baseUrl}/notebook/record/${recordId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete record');
      // 刷新记录列表
      await fetchRecords(selectedDate);
      // 刷新日期列表（可能删除后日期就没有记录了）
      await fetchDates();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  // 切换记录（上一条/下一条）
  const handlePrevRecord = () => {
    if (selectedRecordIndex > 0) {
      setSelectedRecordIndex(selectedRecordIndex - 1);
    }
  };

  const handleNextRecord = () => {
    if (selectedRecordIndex < records.length - 1) {
      setSelectedRecordIndex(selectedRecordIndex + 1);
    }
  };

  // 当前选中的记录
  const currentRecord = records[selectedRecordIndex];

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

  return (
    <div className="flex flex-col h-screen bg-[#FAFAF9] text-stone-900 overflow-hidden">
      {/* Header */}
      <div className="h-10 bg-white border-b border-stone-200 flex items-center justify-between px-3 drag-region">
        <div className="flex items-center gap-2 no-drag">
          <button
            onClick={onBack}
            className="p-1.5 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-600"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="font-semibold text-stone-700 text-sm">
            Notebook {selectedDate ? `- ${selectedDate}` : ''}
          </span>
        </div>
        {/* 记录切换器 */}
        {records.length > 0 && (
          <div className="flex items-center gap-2 no-drag">
            <button
              onClick={handlePrevRecord}
              disabled={selectedRecordIndex === 0}
              className="p-1 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-stone-500">
              {selectedRecordIndex + 1} / {records.length}
            </span>
            <button
              onClick={handleNextRecord}
              disabled={selectedRecordIndex >= records.length - 1}
              className="p-1 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
            {currentRecord && (
              <button
                onClick={() => handleDeleteRecord(currentRecord.id)}
                className="p-1 hover:bg-red-100 rounded text-stone-400 hover:text-red-500 ml-2"
                title="Delete this record"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧日期列表 */}
        <div className="w-40 border-r border-stone-200 bg-white overflow-y-auto">
          <div className="p-2">
            <div className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 px-2">
              Dates
            </div>
            {loading ? (
              <div className="text-xs text-stone-400 px-2">Loading...</div>
            ) : dates.length === 0 ? (
              <div className="text-xs text-stone-400 px-2">No records yet</div>
            ) : (
              dates.map((date) => (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`w-full px-2 py-1.5 text-left rounded text-sm flex items-center justify-between ${
                    selectedDate === date
                      ? 'bg-amber-50 text-amber-700'
                      : 'hover:bg-stone-50 text-stone-600'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Calendar size={12} />
                    <span>{date}</span>
                  </div>
                  <span className="text-xs text-stone-400">{counts[date] || 0}</span>
                </button>
              ))
            )}
          </div>
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
                <div>Select a date to view records</div>
              </div>
            </div>
          ) : (
            <>
              {/* 记录时间标签 */}
              <div className="px-4 py-2 bg-stone-50 border-b border-stone-200 text-xs text-stone-500 flex items-center gap-2">
                <span>{formatTime(currentRecord.created_at)}</span>
                {currentRecord.mode === 'qa' ? (
                  <span className="flex items-center gap-1 text-purple-500">
                    <MessageCircle size={12} />
                    QA
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-500">
                    <Languages size={12} />
                    Translate
                  </span>
                )}
                {currentRecord.source_lang && currentRecord.target_lang && (
                  <span className="text-stone-400">
                    {currentRecord.source_lang.toUpperCase()} - {currentRecord.target_lang.toUpperCase()}
                  </span>
                )}
              </div>

              {/* 根据模式显示不同布局 */}
              {currentRecord.mode === 'qa' ? (
                /* QA模式布局 */
                <PanelGroup direction="horizontal" className="flex-1">
                  {/* 左侧：OCR原文 */}
                  <Panel defaultSize={40} minSize={20}>
                    <div className="h-full flex flex-col bg-white border-r border-stone-200">
                      <div className="px-3 py-2 border-b border-stone-100 text-xs font-bold text-purple-500 uppercase tracking-wider">
                        Original (OCR)
                      </div>
                      <div className="flex-1 p-3 overflow-y-auto text-sm text-stone-700 whitespace-pre-wrap">
                        {currentRecord.ocr_text || <span className="text-stone-400 italic">No OCR text</span>}
                      </div>
                    </div>
                  </Panel>

                  <PanelResizeHandle className="w-1 bg-stone-200 hover:bg-purple-400 transition-colors cursor-col-resize" />

                  {/* 右侧：QA对话历史 */}
                  <Panel defaultSize={60} minSize={30}>
                    <div className="h-full flex flex-col bg-white">
                      <div className="px-3 py-2 border-b border-stone-100 text-xs font-bold text-purple-500 uppercase tracking-wider">
                        Q&A History
                      </div>
                      <div className="flex-1 p-3 overflow-y-auto text-sm text-stone-700">
                        {(() => {
                          let qaList = [];
                          try {
                            qaList = currentRecord.qa_history ? JSON.parse(currentRecord.qa_history) : [];
                          } catch {
                            qaList = [];
                          }
                          if (qaList.length === 0) {
                            return <div className="text-stone-400 italic">No Q&A history</div>;
                          }
                          return qaList.map((qa, idx) => (
                            <div key={idx} className="mb-4 last:mb-0">
                              <div className="font-medium text-purple-600 mb-1">Q: {qa.q}</div>
                              <div className="text-stone-600 pl-3 border-l-2 border-purple-200">
                                <SimpleMarkdown content={qa.a} />
                              </div>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </Panel>
                </PanelGroup>
              ) : (
                /* 翻译模式布局（原有布局） */
                <PanelGroup direction="horizontal" className="flex-1">
                  {/* 左侧：分析结果 */}
                  <Panel defaultSize={50} minSize={20}>
                    <div className="h-full flex flex-col bg-white border-r border-stone-200">
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

                  <PanelResizeHandle className="w-1 bg-stone-200 hover:bg-amber-400 transition-colors cursor-col-resize" />

                  {/* 右侧：OCR + 翻译 */}
                  <Panel defaultSize={50} minSize={20}>
                    <PanelGroup direction="vertical">
                      {/* 上方：OCR 原文 */}
                      <Panel defaultSize={50} minSize={20}>
                        <div className="h-full flex flex-col bg-white border-b border-stone-200">
                          <div className="px-3 py-2 border-b border-stone-100 text-xs font-bold text-amber-500 uppercase tracking-wider">
                            Original (OCR)
                          </div>
                          <div className="flex-1 p-3 overflow-y-auto text-sm text-stone-700 whitespace-pre-wrap">
                            {currentRecord.ocr_text || <span className="text-stone-400 italic">No OCR text</span>}
                          </div>
                        </div>
                      </Panel>

                      <PanelResizeHandle className="h-1 bg-stone-200 hover:bg-amber-400 transition-colors cursor-row-resize" />

                      {/* 下方：翻译结果 */}
                      <Panel defaultSize={50} minSize={20}>
                        <div className="h-full flex flex-col bg-white">
                          <div className="px-3 py-2 border-b border-stone-100 text-xs font-bold text-amber-500 uppercase tracking-wider">
                            Translation
                          </div>
                          <div className="flex-1 p-3 overflow-y-auto text-sm text-stone-700 whitespace-pre-wrap">
                            {currentRecord.translated_text || <span className="text-stone-400 italic">No translation</span>}
                          </div>
                        </div>
                      </Panel>
                    </PanelGroup>
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
