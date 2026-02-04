import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, ChevronDown, ChevronUp, BookOpen, Eye, EyeOff, Send, MessageCircle } from 'lucide-react';
import SimpleMarkdown from './SimpleMarkdown';

// 各区域最大高度配置
const MAX_HEIGHT_TRANSLATE = 150;
const MAX_HEIGHT_OCR = 80;
const MAX_HEIGHT_ANALYSIS = 200;
const MAX_HEIGHT_QA = 200;

/**
 * 浮窗组件
 * 显示翻译结果，支持解析功能和QA模式
 */
const FloatingOverlay = () => {
  // 从 URL 获取 captureMode
  const query = new URLSearchParams(window.location.search);
  const captureMode = query.get('captureMode') || 'translate';
  const isQAMode = captureMode === 'qa';

  const [text, setText] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [showOcr, setShowOcr] = useState(false);
  const [status, setStatus] = useState('processing');
  const [maxWidth, setMaxWidth] = useState(isQAMode ? 350 : 300);
  const [serverPort, setServerPort] = useState(8092);
  // 解析相关状态
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('zh');
  const [recordId, setRecordId] = useState(null);

  // QA 模式相关状态
  const [qaHistory, setQaHistory] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [isAnswering, setIsAnswering] = useState(false);

  const containerRef = useRef(null);
  const qaContainerRef = useRef(null);
  const inputRef = useRef(null);

  // 加载配置获取 maxWidth 和 serverPort
  useEffect(() => {
    window.electron.getConfig().then(config => {
      const width = config?.ui?.overlay_max_width;
      if (width && width > 0) setMaxWidth(isQAMode ? Math.max(width, 350) : width);
      if (config?.serverPort) setServerPort(config.serverPort);
    }).catch(() => {});
  }, [isQAMode]);

  // 从后端获取语言配置
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${serverPort}/config`);
        if (res.ok) {
          const data = await res.json();
          if (data.source_lang) setSourceLang(data.source_lang);
          if (data.target_lang) setTargetLang(data.target_lang);
        }
      } catch (e) {
        // 忽略错误
      }
    };
    fetchConfig();
  }, [serverPort]);

  useEffect(() => {
    const handleUpdate = (data) => {
      if (data.status) setStatus(data.status);
      if (data.text !== undefined) setText(data.text);
      if (data.ocrText !== undefined) setOcrText(data.ocrText);
      if (data.recordId !== undefined) setRecordId(data.recordId);
      // 新截图时重置状态
      if (data.status === 'ocr' || data.status === 'processing') {
        setAnalysisText('');
        setShowAnalysis(false);
        setAnalyzing(false);
        setRecordId(null);
        setQaHistory([]);
        setCurrentQuestion('');
        setCurrentAnswer('');
        setIsAnswering(false);
      }
    };
    window.electron.onOverlayUpdate(handleUpdate);
    return () => window.electron.removeOnOverlayUpdate(handleUpdate);
  }, []);

  // 根据内容调整窗口大小
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      window.electron.resizeOverlay({
        width: Math.ceil(rect.width) + 4,
        height: Math.ceil(rect.height) + 4
      });
    }
  }, [text, status, showOcr, showAnalysis, analysisText, analyzing, qaHistory, currentAnswer, isAnswering]);

  // QA 模式自动滚动到底部
  useEffect(() => {
    if (qaContainerRef.current) {
      qaContainerRef.current.scrollTop = qaContainerRef.current.scrollHeight;
    }
  }, [qaHistory, currentAnswer]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') window.electron.closeOverlay();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 解析功能（翻译模式）
  const handleAnalyze = async () => {
    if (!text || analyzing) return;

    setAnalyzing(true);
    setShowAnalysis(true);
    setAnalysisText('');
    let analysisResult = '';

    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text,
          source_lang: sourceLang,
          target_lang: targetLang
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Analysis failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const lineData = line.slice(6);
            if (lineData === '[DONE]') {
              break;
            }
            try {
              const parsed = JSON.parse(lineData);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.token) {
                analysisResult += parsed.token;
                setAnalysisText(analysisResult);
              }
            } catch (e) {
              if (e.message && !e.message.includes('JSON')) {
                throw e;
              }
            }
          }
        }
      }
    } catch (err) {
      setAnalysisText(`Error: ${err.message}`);
    } finally {
      setAnalyzing(false);
      // 分析完成后更新笔记本记录
      if (recordId && analysisResult) {
        try {
          await fetch(`http://127.0.0.1:${serverPort}/notebook/record/${recordId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ analysis_text: analysisResult })
          });
          console.log('[Notebook] Analysis updated for record:', recordId);
        } catch (updateErr) {
          console.warn('[Notebook] Failed to update analysis:', updateErr.message);
        }
      }
    }
  };

  // QA 模式提问功能
  const handleAsk = async () => {
    if (!currentQuestion.trim() || isAnswering || !recordId) return;

    const question = currentQuestion.trim();
    setCurrentQuestion('');
    setIsAnswering(true);
    setCurrentAnswer('');

    // 先添加问题到历史
    setQaHistory(prev => [...prev, { q: question, a: '' }]);

    let answerText = '';

    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/qa/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          record_id: recordId,
          question: question,
          ocr_text: ocrText,
          source_lang: sourceLang,
          target_lang: targetLang
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const lineData = line.slice(6);
            if (lineData === '[DONE]') {
              break;
            }
            try {
              const parsed = JSON.parse(lineData);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.token) {
                answerText += parsed.token;
                setCurrentAnswer(answerText);
              }
            } catch (e) {
              if (e.message && !e.message.includes('JSON')) {
                throw e;
              }
            }
          }
        }
      }

      // 更新最后一条历史的回答
      setQaHistory(prev => {
        const updated = [...prev];
        if (updated.length > 0) {
          updated[updated.length - 1].a = answerText;
        }
        return updated;
      });
      setCurrentAnswer('');
    } catch (err) {
      // 错误时更新最后一条历史
      setQaHistory(prev => {
        const updated = [...prev];
        if (updated.length > 0) {
          updated[updated.length - 1].a = `Error: ${err.message}`;
        }
        return updated;
      });
      setCurrentAnswer('');
    } finally {
      setIsAnswering(false);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  };

  // 按回车提交
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  return (
    <>
      {/* Electron 拖动区域样式和透明窗口修复 */}
      <style>{`
        html, body, #root {
          background: transparent !important;
          margin: 0;
          padding: 0;
        }
        .electron-drag { -webkit-app-region: drag; }
        .electron-no-drag { -webkit-app-region: no-drag; }
      `}</style>
      <div
        ref={containerRef}
        className="electron-drag relative bg-stone-900/90 text-white text-sm px-2 py-1 pr-5 rounded shadow-lg cursor-move"
        style={{ width: isQAMode ? maxWidth : 'max-content', minWidth: isQAMode ? 280 : 60, maxWidth }}
      >
      {/* 关闭按钮 - 固定右上角 */}
      <button
        onClick={() => window.electron.closeOverlay()}
        className="electron-no-drag absolute top-1 right-1 w-4 h-4 flex items-center justify-center text-stone-400 hover:text-white"
        title="Close"
      >
        <X size={10} />
      </button>

      {/* QA 模式标识 */}
      {isQAMode && status === 'done' && (
        <div className="flex items-center gap-1 text-purple-400 text-xs mb-1">
          <MessageCircle size={10} />
          <span>QA Mode</span>
        </div>
      )}

      {/* 根据状态显示不同内容 */}
      {(status === 'processing' || status === 'ocr' || status === 'translating' ||
        status === 'ocr_loading' || status === 'translate_loading') ? (
        <div className="flex items-center gap-2 text-stone-400">
          <Loader2 size={14} className="animate-spin" />
          <span>
            {status === 'ocr' && 'Recognizing text...'}
            {status === 'ocr_loading' && 'Loading OCR model...'}
            {status === 'translating' && 'Translating...'}
            {status === 'translate_loading' && 'Loading translate model...'}
            {status === 'processing' && 'Processing...'}
          </span>
        </div>
      ) : status === 'error' ? (
        <span className="text-red-400">{text || 'Error occurred'}</span>
      ) : isQAMode ? (
        /* QA 模式 UI */
        <>
          {/* OCR 结果 */}
          <div
            className="electron-no-drag leading-snug select-text cursor-text overflow-y-auto text-stone-300"
            style={{ wordBreak: 'break-word', maxHeight: MAX_HEIGHT_OCR }}
          >
            {text || ocrText}
          </div>

          {/* QA 对话历史 */}
          {(qaHistory.length > 0 || currentAnswer) && (
            <div
              ref={qaContainerRef}
              className="electron-no-drag mt-2 pt-2 border-t border-stone-700 overflow-y-auto"
              style={{ maxHeight: MAX_HEIGHT_QA }}
            >
              {qaHistory.map((qa, idx) => (
                <div key={idx} className="mb-2">
                  <div className="text-xs text-purple-400">Q: {qa.q}</div>
                  <div className="text-xs text-stone-300 pl-2 select-text cursor-text">
                    {qa.a ? <SimpleMarkdown content={qa.a} /> : (
                      isAnswering && idx === qaHistory.length - 1 && currentAnswer ? (
                        <div className="flex items-start gap-1">
                          <Loader2 size={10} className="animate-spin flex-shrink-0 mt-0.5" />
                          <SimpleMarkdown content={currentAnswer} />
                        </div>
                      ) : (
                        <span className="text-stone-500">...</span>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 输入框 */}
          <div className="electron-no-drag mt-2 pt-2 border-t border-stone-700 flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={currentQuestion}
              onChange={(e) => setCurrentQuestion(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask a question..."
              disabled={isAnswering || !recordId}
              className="flex-1 bg-stone-800 text-white text-xs px-2 py-1 rounded border border-stone-600 focus:border-purple-500 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={handleAsk}
              disabled={isAnswering || !currentQuestion.trim() || !recordId}
              className="w-6 h-6 flex items-center justify-center bg-purple-600 hover:bg-purple-500 disabled:bg-stone-600 disabled:opacity-50 rounded text-white"
              title="Send"
            >
              {isAnswering ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Send size={12} />
              )}
            </button>
          </div>
        </>
      ) : (
        /* 翻译模式 UI */
        <>
          {/* 翻译结果 + 功能按钮（同一行） */}
          <div
            className="electron-no-drag no-drag leading-snug select-text cursor-text overflow-y-auto"
            style={{ wordBreak: 'break-word', maxHeight: MAX_HEIGHT_TRANSLATE }}
          >
            <span>{text}</span>
            {/* 功能按钮 - 跟在文本后面 */}
            <span className="inline-flex items-center gap-0.5 ml-1 align-middle">
              {!analysisText && (
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="electron-no-drag w-4 h-4 inline-flex items-center justify-center text-stone-500 hover:text-amber-400 disabled:opacity-50"
                  title="Analyze"
                >
                  <BookOpen size={10} />
                </button>
              )}
              {analysisText && (
                <button
                  onClick={() => setShowAnalysis(!showAnalysis)}
                  className="electron-no-drag w-4 h-4 inline-flex items-center justify-center text-stone-500 hover:text-amber-400"
                  title={showAnalysis ? 'Hide analysis' : 'Show analysis'}
                >
                  {showAnalysis ? <EyeOff size={10} /> : <Eye size={10} />}
                </button>
              )}
              {ocrText && (
                <button
                  onClick={() => setShowOcr(!showOcr)}
                  className="electron-no-drag w-4 h-4 inline-flex items-center justify-center text-stone-500 hover:text-white"
                  title={showOcr ? 'Hide original' : 'Show original'}
                >
                  {showOcr ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                </button>
              )}
            </span>
          </div>
          {/* 原文 */}
          {showOcr && ocrText && (
            <div
              className="electron-no-drag no-drag mt-2 pt-2 border-t border-stone-700 text-stone-400 text-xs select-text cursor-text overflow-y-auto"
              style={{ maxHeight: MAX_HEIGHT_OCR }}
            >
              {ocrText}
            </div>
          )}
          {/* 分析结果 */}
          {showAnalysis && (
            <div
              className="electron-no-drag no-drag mt-2 pt-2 border-t border-stone-700 text-stone-300 text-xs select-text cursor-text overflow-y-auto"
              style={{ maxHeight: MAX_HEIGHT_ANALYSIS }}
            >
              {analyzing ? (
                <div className="flex items-start gap-2 text-stone-400">
                  <Loader2 size={12} className="animate-spin flex-shrink-0 mt-0.5" />
                  <SimpleMarkdown content={analysisText || 'Analyzing...'} />
                </div>
              ) : (
                <SimpleMarkdown content={analysisText || 'No analysis result'} />
              )}
            </div>
          )}
        </>
      )}
    </div>
    </>
  );
};

export default FloatingOverlay;
