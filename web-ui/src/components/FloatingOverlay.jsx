import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, ChevronDown, ChevronUp, BookOpen, Eye, EyeOff, Send, MessageCircle } from 'lucide-react';
import SimpleMarkdown from './SimpleMarkdown';

const MAX_HEIGHT_TRANSLATE = 150;
const MAX_HEIGHT_OCR = 80;
const MAX_HEIGHT_ANALYSIS = 200;
const MAX_HEIGHT_QA = 200;

/**
 * 浮窗组件
 */
const FloatingOverlay = () => {
  const query = new URLSearchParams(window.location.search);
  const captureMode = query.get('captureMode') || 'translate';
  const isQAMode = captureMode === 'qa';

  const [text, setText] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [showOcr, setShowOcr] = useState(false);
  const [status, setStatus] = useState('processing');
  const [maxWidth, setMaxWidth] = useState(isQAMode ? 350 : 300);
  const [serverPort, setServerPort] = useState(8092);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('zh');
  const [recordId, setRecordId] = useState(null);

  const [qaHistory, setQaHistory] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [isAnswering, setIsAnswering] = useState(false);

  const containerRef = useRef(null);
  const qaContainerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    window.electron.getConfig().then(config => {
      const width = config?.ui?.overlay_max_width;
      if (width && width > 0) setMaxWidth(isQAMode ? Math.max(width, 350) : width);
      if (config?.serverPort) setServerPort(config.serverPort);
    }).catch(() => {});
  }, [isQAMode]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${serverPort}/config`);
        if (res.ok) {
          const data = await res.json();
          if (data.source_lang) setSourceLang(data.source_lang);
          if (data.target_lang) setTargetLang(data.target_lang);
        }
      } catch (e) {}
    };
    fetchConfig();
  }, [serverPort]);

  useEffect(() => {
    const handleUpdate = (data) => {
      if (data.status) setStatus(data.status);
      if (data.text !== undefined) setText(data.text);
      if (data.ocrText !== undefined) setOcrText(data.ocrText);
      if (data.recordId !== undefined) setRecordId(data.recordId);
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

  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      window.electron.resizeOverlay({
        width: Math.ceil(rect.width) + 4,
        height: Math.ceil(rect.height) + 4
      });
    }
  }, [text, status, showOcr, showAnalysis, analysisText, analyzing, qaHistory, currentAnswer, isAnswering]);

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
            if (lineData === '[DONE]') break;
            try {
              const parsed = JSON.parse(lineData);
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.token) {
                analysisResult += parsed.token;
                setAnalysisText(analysisResult);
              }
            } catch (e) {
              if (e.message && !e.message.includes('JSON')) throw e;
            }
          }
        }
      }
    } catch (err) {
      setAnalysisText(`Error: ${err.message}`);
    } finally {
      setAnalyzing(false);
      if (recordId && analysisResult) {
        try {
          await fetch(`http://127.0.0.1:${serverPort}/notebook/record/${recordId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ analysis_text: analysisResult })
          });
        } catch (updateErr) {
          console.warn('[Notebook] Failed to update analysis:', updateErr.message);
        }
      }
    }
  };

  const handleAsk = async () => {
    if (!currentQuestion.trim() || isAnswering || !recordId) return;

    const question = currentQuestion.trim();
    setCurrentQuestion('');
    setIsAnswering(true);
    setCurrentAnswer('');
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
            if (lineData === '[DONE]') break;
            try {
              const parsed = JSON.parse(lineData);
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.token) {
                answerText += parsed.token;
                setCurrentAnswer(answerText);
              }
            } catch (e) {
              if (e.message && !e.message.includes('JSON')) throw e;
            }
          }
        }
      }

      setQaHistory(prev => {
        const updated = [...prev];
        if (updated.length > 0) updated[updated.length - 1].a = answerText;
        return updated;
      });
      setCurrentAnswer('');
    } catch (err) {
      setQaHistory(prev => {
        const updated = [...prev];
        if (updated.length > 0) updated[updated.length - 1].a = `Error: ${err.message}`;
        return updated;
      });
      setCurrentAnswer('');
    } finally {
      setIsAnswering(false);
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  return (
    <>
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
        className="electron-drag relative bg-stone-900/95 backdrop-blur-sm text-white text-sm px-3 py-2 pr-6 rounded-xl shadow-2xl cursor-move"
        style={{ width: isQAMode ? maxWidth : 'max-content', minWidth: isQAMode ? 280 : 60, maxWidth }}
      >
        {/* Close Button */}
        <button
          onClick={() => window.electron.closeOverlay()}
          className="electron-no-drag absolute top-2 right-2 w-4 h-4 flex items-center justify-center text-stone-500 hover:text-white transition-colors"
          title="Close"
        >
          <X size={12} />
        </button>

        {/* QA Mode Badge */}
        {isQAMode && status === 'done' && (
          <div className="flex items-center gap-1.5 text-violet-400 text-xs mb-2">
            <MessageCircle size={11} />
            <span className="font-medium">Q&A Mode</span>
          </div>
        )}

        {/* Status Display */}
        {(status === 'processing' || status === 'ocr' || status === 'translating' ||
          status === 'ocr_loading' || status === 'translate_loading') ? (
          <div className="flex items-center gap-2 text-stone-400">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">
              {status === 'ocr' && 'Recognizing...'}
              {status === 'ocr_loading' && 'Loading OCR...'}
              {status === 'translating' && 'Translating...'}
              {status === 'translate_loading' && 'Loading translator...'}
              {status === 'processing' && 'Processing...'}
            </span>
          </div>
        ) : status === 'error' ? (
          <span className="text-red-400 text-xs">{text || 'Error occurred'}</span>
        ) : isQAMode ? (
          /* QA Mode UI */
          <>
            <div
              className="electron-no-drag leading-relaxed select-text cursor-text overflow-y-auto text-stone-300 text-xs"
              style={{ wordBreak: 'break-word', maxHeight: MAX_HEIGHT_OCR }}
            >
              {text || ocrText}
            </div>

            {(qaHistory.length > 0 || currentAnswer) && (
              <div
                ref={qaContainerRef}
                className="electron-no-drag mt-2 pt-2 border-t border-stone-700/50 overflow-y-auto space-y-2"
                style={{ maxHeight: MAX_HEIGHT_QA }}
              >
                {qaHistory.map((qa, idx) => (
                  <div key={idx}>
                    <div className="text-[11px] text-violet-400 font-medium">Q: {qa.q}</div>
                    <div className="text-xs text-stone-300 pl-2 mt-0.5 select-text cursor-text">
                      {qa.a ? <SimpleMarkdown content={qa.a} /> : (
                        isAnswering && idx === qaHistory.length - 1 && currentAnswer ? (
                          <div className="flex items-start gap-1.5">
                            <Loader2 size={10} className="animate-spin flex-shrink-0 mt-0.5 text-violet-400" />
                            <SimpleMarkdown content={currentAnswer} />
                          </div>
                        ) : (
                          <span className="text-stone-600">...</span>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="electron-no-drag mt-2 pt-2 border-t border-stone-700/50 flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={currentQuestion}
                onChange={(e) => setCurrentQuestion(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask a question..."
                disabled={isAnswering || !recordId}
                className="flex-1 bg-stone-800/50 text-white text-xs px-2.5 py-1.5 rounded-lg border border-stone-700/50
                  focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/20
                  disabled:opacity-50 placeholder:text-stone-600 transition-colors"
              />
              <button
                onClick={handleAsk}
                disabled={isAnswering || !currentQuestion.trim() || !recordId}
                className="w-7 h-7 flex items-center justify-center bg-violet-600 hover:bg-violet-500
                  disabled:bg-stone-700 disabled:opacity-50 rounded-lg text-white transition-colors"
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
          /* Translate Mode UI */
          <>
            <div
              className="electron-no-drag leading-relaxed select-text cursor-text overflow-y-auto"
              style={{ wordBreak: 'break-word', maxHeight: MAX_HEIGHT_TRANSLATE }}
            >
              <span>{text}</span>
              <span className="inline-flex items-center gap-0.5 ml-1.5 align-middle">
                {!analysisText && (
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className="electron-no-drag w-4 h-4 inline-flex items-center justify-center text-stone-500 hover:text-amber-400 disabled:opacity-50 transition-colors"
                    title="Analyze"
                  >
                    <BookOpen size={11} />
                  </button>
                )}
                {analysisText && (
                  <button
                    onClick={() => setShowAnalysis(!showAnalysis)}
                    className="electron-no-drag w-4 h-4 inline-flex items-center justify-center text-stone-500 hover:text-amber-400 transition-colors"
                    title={showAnalysis ? 'Hide analysis' : 'Show analysis'}
                  >
                    {showAnalysis ? <EyeOff size={11} /> : <Eye size={11} />}
                  </button>
                )}
                {ocrText && (
                  <button
                    onClick={() => setShowOcr(!showOcr)}
                    className="electron-no-drag w-4 h-4 inline-flex items-center justify-center text-stone-500 hover:text-white transition-colors"
                    title={showOcr ? 'Hide original' : 'Show original'}
                  >
                    {showOcr ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  </button>
                )}
              </span>
            </div>
            {showOcr && ocrText && (
              <div
                className="electron-no-drag mt-2 pt-2 border-t border-stone-700/50 text-stone-500 text-xs select-text cursor-text overflow-y-auto"
                style={{ maxHeight: MAX_HEIGHT_OCR }}
              >
                {ocrText}
              </div>
            )}
            {showAnalysis && (
              <div
                className="electron-no-drag mt-2 pt-2 border-t border-stone-700/50 text-stone-300 text-xs select-text cursor-text overflow-y-auto"
                style={{ maxHeight: MAX_HEIGHT_ANALYSIS }}
              >
                {analyzing ? (
                  <div className="flex items-start gap-2 text-stone-400">
                    <Loader2 size={12} className="animate-spin flex-shrink-0 mt-0.5" />
                    <SimpleMarkdown content={analysisText || 'Analyzing...'} />
                  </div>
                ) : (
                  <SimpleMarkdown content={analysisText || 'No analysis'} />
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
