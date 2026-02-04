import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Calendar, FileText, Trash2, MessageCircle, Languages, ChevronDown } from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import SimpleMarkdown from './SimpleMarkdown';

/**
 * 笔记本页面组件
 */
const NotebookPage = ({ onBack, baseUrl }) => {
  const [selectedMode, setSelectedMode] = useState('translate');
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [records, setRecords] = useState([]);
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    setSelectedDate('');
    fetchDates();
  }, [selectedMode, fetchDates]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleDeleteRecord = async (recordId, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this record?')) return;
    try {
      const res = await fetch(`${baseUrl}/notebook/record/${recordId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete record');
      await fetchRecords();
      await fetchDates();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const currentRecord = records.find(r => r.id === selectedRecordId);

  const formatTime = (isoString) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  const getPreview = (text, maxLen = 50) => {
    if (!text) return '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '...' : cleaned;
  };

  return (
    <div className="flex flex-col h-screen bg-surface text-stone-900 overflow-hidden">
      {/* Header */}
      <div className="h-11 bg-white/80 backdrop-blur-sm border-b border-stone-100 flex items-center justify-between px-4 drag-region">
        <div className="flex items-center gap-4 no-drag">
          <button
            onClick={onBack}
            className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-stone-600 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>

          {/* Mode Toggle */}
          <div className="flex items-center bg-stone-100 rounded-lg p-0.5">
            <button
              onClick={() => setSelectedMode('translate')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
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
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                selectedMode === 'qa'
                  ? 'bg-white text-violet-600 shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              <MessageCircle size={12} />
              <span>Q&A</span>
            </button>
          </div>

          {/* Date Filter */}
          <div className="relative">
            <button
              onClick={() => setShowDatePicker(!showDatePicker)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-stone-500 hover:bg-stone-100 rounded-lg transition-colors"
            >
              <Calendar size={12} />
              <span>{selectedDate || 'All Dates'}</span>
              <ChevronDown size={12} />
            </button>
            {showDatePicker && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-stone-100 rounded-xl shadow-elevated z-50 min-w-[120px] max-h-[280px] overflow-y-auto py-1">
                <button
                  onClick={() => { setSelectedDate(''); setShowDatePicker(false); }}
                  className={`w-full px-3 py-2 text-left text-xs hover:bg-stone-50 transition-colors ${
                    !selectedDate ? 'text-amber-600 font-medium' : 'text-stone-600'
                  }`}
                >
                  All Dates
                </button>
                {dates.map(date => (
                  <button
                    key={date}
                    onClick={() => { setSelectedDate(date); setShowDatePicker(false); }}
                    className={`w-full px-3 py-2 text-left text-xs hover:bg-stone-50 transition-colors ${
                      selectedDate === date ? 'text-amber-600 font-medium' : 'text-stone-600'
                    }`}
                  >
                    {date}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="text-xs text-stone-400">
            {records.length} records
          </span>
        </div>
      </div>

      {/* Click outside to close date picker */}
      {showDatePicker && (
        <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Record List */}
        <div className="w-60 border-r border-stone-100 bg-white/50 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-xs text-stone-400">Loading...</div>
          ) : records.length === 0 ? (
            <div className="p-6 text-center">
              <FileText size={32} className="mx-auto mb-2 text-stone-200" />
              <div className="text-xs text-stone-400">No records</div>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {records.map((record) => (
                <div
                  key={record.id}
                  onClick={() => setSelectedRecordId(record.id)}
                  className={`p-3 rounded-xl cursor-pointer group transition-colors ${
                    selectedRecordId === record.id
                      ? 'bg-amber-50 border border-amber-200'
                      : 'hover:bg-stone-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-stone-400">
                      {!selectedDate && <span>{formatDate(record.created_at)}</span>}
                      <span>{formatTime(record.created_at)}</span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteRecord(record.id, e)}
                      className="p-1 text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="text-xs text-stone-600 line-clamp-2 leading-relaxed">
                    {getPreview(record.ocr_text, 80)}
                  </div>
                  {selectedMode === 'translate' && record.translated_text && (
                    <div className="text-[10px] text-stone-400 mt-1.5 line-clamp-1">
                      {getPreview(record.translated_text, 40)}
                    </div>
                  )}
                  {selectedMode === 'qa' && record.qa_history?.length > 0 && (
                    <div className="text-[10px] text-violet-500 mt-1.5">
                      {record.qa_history.length} conversations
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          {error ? (
            <div className="flex-1 flex items-center justify-center text-red-500 text-sm">
              {error}
            </div>
          ) : !currentRecord ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FileText size={40} className="mx-auto mb-3 text-stone-200" />
                <div className="text-sm text-stone-400">Select a record to view</div>
              </div>
            </div>
          ) : (
            <>
              {/* Record Info Bar */}
              <div className="px-5 py-2.5 bg-stone-50/50 border-b border-stone-100 text-xs text-stone-400 flex items-center gap-3">
                <span className="font-medium text-stone-500">{currentRecord.date_key}</span>
                <span>{formatTime(currentRecord.created_at)}</span>
                {currentRecord.source_lang && currentRecord.target_lang && (
                  <>
                    <span className="w-px h-3 bg-stone-200" />
                    <span>{currentRecord.source_lang.toUpperCase()} → {currentRecord.target_lang.toUpperCase()}</span>
                  </>
                )}
              </div>

              {/* Content based on mode */}
              {selectedMode === 'qa' ? (
                /* QA Mode: Vertical scroll */
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {/* OCR Card */}
                  <div className="rounded-xl border border-violet-100 bg-violet-50/30">
                    <div className="px-4 py-2.5 border-b border-violet-100 text-xs font-medium text-violet-500 uppercase tracking-wider">
                      Original (OCR)
                    </div>
                    <div className="p-4 text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">
                      {currentRecord.ocr_text || <span className="text-stone-400 italic">No OCR text</span>}
                    </div>
                  </div>

                  {/* QA History */}
                  {(() => {
                    const qaList = Array.isArray(currentRecord.qa_history) ? currentRecord.qa_history : [];
                    if (qaList.length === 0) {
                      return (
                        <div className="text-stone-400 text-sm text-center py-10">
                          No Q&A history
                        </div>
                      );
                    }
                    return qaList.map((qa, idx) => (
                      <div key={idx} className="rounded-xl border border-stone-100 overflow-hidden">
                        <div className="px-4 py-2.5 bg-violet-50 text-sm font-medium text-violet-700">
                          Q{idx + 1}: {qa.q}
                        </div>
                        <div className="p-4 text-sm text-stone-700 leading-relaxed">
                          <SimpleMarkdown content={qa.a} />
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                /* Translate Mode */
                <PanelGroup direction="horizontal" className="flex-1">
                  {/* Left: OCR + Translation (vertical) */}
                  <Panel defaultSize={50} minSize={20}>
                    <div className="h-full flex flex-col">
                      {/* OCR */}
                      <div className="flex-1 flex flex-col border-b border-stone-100 min-h-0">
                        <div className="px-4 py-2.5 border-b border-stone-50 text-xs font-medium text-amber-500 uppercase tracking-wider flex-shrink-0">
                          Original (OCR)
                        </div>
                        <div className="flex-1 p-4 overflow-y-auto text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">
                          {currentRecord.ocr_text || <span className="text-stone-400 italic">No OCR text</span>}
                        </div>
                      </div>

                      {/* Translation */}
                      <div className="flex-1 flex flex-col min-h-0">
                        <div className="px-4 py-2.5 border-b border-stone-50 text-xs font-medium text-amber-500 uppercase tracking-wider flex-shrink-0">
                          Translation
                        </div>
                        <div className="flex-1 p-4 overflow-y-auto text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">
                          {currentRecord.translated_text || <span className="text-stone-400 italic">No translation</span>}
                        </div>
                      </div>
                    </div>
                  </Panel>

                  <PanelResizeHandle className="w-px bg-stone-100 hover:bg-amber-400 transition-colors cursor-col-resize" />

                  {/* Right: Analysis */}
                  <Panel defaultSize={50} minSize={20}>
                    <div className="h-full flex flex-col">
                      <div className="px-4 py-2.5 border-b border-stone-50 text-xs font-medium text-amber-500 uppercase tracking-wider">
                        Analysis
                      </div>
                      <div className="flex-1 p-4 overflow-y-auto text-sm text-stone-700 leading-relaxed">
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
