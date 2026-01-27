import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, ChevronDown, ChevronUp, BookOpen, Eye, EyeOff } from 'lucide-react';
import SimpleMarkdown from './SimpleMarkdown';

// 各区域最大高度配置
const MAX_HEIGHT_TRANSLATE = 150;
const MAX_HEIGHT_OCR = 80;
const MAX_HEIGHT_ANALYSIS = 200;

/**
 * 浮窗组件
 * 显示翻译结果，支持解析功能
 */
const FloatingOverlay = () => {
  const [text, setText] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [showOcr, setShowOcr] = useState(false);
  const [status, setStatus] = useState('processing');
  const [maxWidth, setMaxWidth] = useState(300);
  const [serverPort, setServerPort] = useState(8092);
  // 解析相关状态
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('zh');
  const containerRef = useRef(null);

  // 加载配置获取 maxWidth 和 serverPort
  useEffect(() => {
    window.electron.getConfig().then(config => {
      const width = config?.ui?.overlay_max_width;
      if (width && width > 0) setMaxWidth(width);
      if (config?.serverPort) setServerPort(config.serverPort);
    }).catch(() => {});
  }, []);

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
      // 新翻译时重置解析状态
      if (data.status === 'ocr' || data.status === 'processing') {
        setAnalysisText('');
        setShowAnalysis(false);
        setAnalyzing(false);
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
  }, [text, status, showOcr, showAnalysis, analysisText, analyzing]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') window.electron.closeOverlay();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 解析功能
  const handleAnalyze = async () => {
    if (!text || analyzing) return;

    setAnalyzing(true);
    setShowAnalysis(true);
    setAnalysisText('');

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
      let analysisResult = '';

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
        className="electron-drag bg-stone-900/90 text-white text-sm px-2 py-1 rounded shadow-lg cursor-move"
        style={{ width: 'max-content', minWidth: 60, maxWidth }}
      >
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
      ) : (
        <>
          {/* 翻译结果区域 */}
          <div className="flex items-start gap-1">
            <div
              className="electron-no-drag no-drag flex-1 leading-snug select-text cursor-text overflow-y-auto"
              style={{ wordBreak: 'break-word', maxHeight: MAX_HEIGHT_TRANSLATE }}
            >
              {text}
            </div>
            {/* 按钮组 */}
            <div className="electron-no-drag flex flex-col gap-0.5 flex-shrink-0">
              <button
                onClick={() => window.electron.closeOverlay()}
                className="w-4 h-4 flex items-center justify-center text-stone-400 hover:text-white"
                title="关闭"
              >
                <X size={10} />
              </button>
              {/* 解析按钮 - 只在没有分析结果时显示 */}
              {!analysisText && (
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="w-4 h-4 flex items-center justify-center text-stone-400 hover:text-amber-400 disabled:opacity-50"
                  title="解析语法词汇"
                >
                  <BookOpen size={10} />
                </button>
              )}
              {/* 展开/收起分析结果按钮 */}
              {analysisText && (
                <button
                  onClick={() => setShowAnalysis(!showAnalysis)}
                  className="w-4 h-4 flex items-center justify-center text-stone-400 hover:text-amber-400"
                  title={showAnalysis ? '收起分析' : '展开分析'}
                >
                  {showAnalysis ? <EyeOff size={10} /> : <Eye size={10} />}
                </button>
              )}
              {/* 显示原文按钮 */}
              {ocrText && (
                <button
                  onClick={() => setShowOcr(!showOcr)}
                  className="w-4 h-4 flex items-center justify-center text-stone-400 hover:text-white"
                  title={showOcr ? '收起原文' : '展开原文'}
                >
                  {showOcr ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                </button>
              )}
            </div>
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
