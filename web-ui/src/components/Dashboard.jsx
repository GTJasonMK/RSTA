import React from 'react';
import { Camera, X, Minus, ArrowRightLeft, Settings, Loader2, Terminal, BookOpen } from 'lucide-react';
import { Select } from './SettingControls';
import { LANGUAGES, TRANSLATORS, OCR_MODELS } from '../constants';

/**
 * 主仪表板组件
 */
const Dashboard = ({
  onStartCapture,
  config,
  onConfigChange,
  status,
  modelStatus,
  loadingStatus,
  onOpenSettings,
  onOpenLogs,
  onOpenNotebook,
  isModelLoading,
  loadingMessage
}) => {
  const handleSwap = () => {
    onConfigChange({
      ...config,
      source_lang: config.target_lang,
      target_lang: config.source_lang
    });
  };

  // 根据配置的模型类型检查对应的 OCR 模型是否下载
  const ocrModelType = config.paddleocr?.model_type || 'mobile';
  const ocrDownloaded = ocrModelType === 'mobile'
    ? modelStatus?.ocr?.mobile_downloaded
    : modelStatus?.ocr?.server_downloaded;
  const translateDownloaded = modelStatus?.translate?.downloaded;

  // 模型加载状态（已加载到内存）
  const ocrLoading = loadingStatus?.ocr?.loading;
  const ocrLoaded = loadingStatus?.ocr?.ready;
  const translateLoading = loadingStatus?.translate?.loading;
  const translateLoaded = loadingStatus?.translate?.ready;

  // 判断模型是否真正就绪（已下载且已加载）
  const ocrReady = ocrDownloaded && ocrLoaded;
  const translateReady = translateDownloaded && translateLoaded;

  // 是否正在后台加载模型
  const isBackgroundLoading = ocrLoading || translateLoading;

  // 只有当模型下载且加载完成时才允许截图
  const canCapture = status === 'ready' && ocrReady && translateReady && !isModelLoading && !isBackgroundLoading;

  // 获取 OCR 状态文本
  const getOcrStatusText = () => {
    if (!ocrDownloaded) return 'Not Downloaded';
    if (ocrLoading) return 'Loading...';
    if (ocrLoaded) return 'Ready';
    return 'Not Loaded';
  };

  // 获取翻译状态文本
  const getTranslateStatusText = () => {
    if (!translateDownloaded) return 'Not Downloaded';
    if (translateLoading) return 'Loading...';
    if (translateLoaded) return 'Ready';
    return 'Not Loaded';
  };

  // 获取 OCR 状态颜色
  const getOcrStatusColor = () => {
    if (!ocrDownloaded) return 'bg-red-500';
    if (ocrLoading) return 'bg-amber-500 animate-pulse';
    if (ocrLoaded) return 'bg-green-500';
    return 'bg-amber-500';
  };

  // 获取翻译状态颜色
  const getTranslateStatusColor = () => {
    if (!translateDownloaded) return 'bg-red-500';
    if (translateLoading) return 'bg-amber-500 animate-pulse';
    if (translateLoaded) return 'bg-green-500';
    return 'bg-amber-500';
  };

  return (
    <div className="flex flex-col h-screen bg-[#FAFAF9] text-stone-900 overflow-hidden">
      {/* Title Bar */}
      <div className="h-10 bg-white border-b border-stone-200 flex items-center justify-between px-3 drag-region">
        <span className="font-semibold text-stone-700 text-sm no-drag">
          Screen Translate
        </span>
        <div className="flex gap-1 no-drag">
          <button onClick={onOpenNotebook} className="p-1.5 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-600" title="Notebook">
            <BookOpen size={16} />
          </button>
          <button onClick={onOpenSettings} className="p-1.5 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-600">
            <Settings size={16} />
          </button>
          <button onClick={() => window.electron.minimizeApp()} className="p-1.5 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-600">
            <Minus size={16} />
          </button>
          <button onClick={() => window.electron.closeApp()} className="p-1.5 hover:bg-red-100 hover:text-red-500 rounded text-stone-400">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-6 gap-6">
        {/* Left: Languages */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-stone-100 flex flex-col gap-3 w-56">
          <div className="text-xs font-bold text-amber-500 uppercase tracking-wider">Languages</div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-stone-500">Source</label>
            <Select value={config.source_lang} onChange={(v) => onConfigChange({...config, source_lang: v})} options={LANGUAGES} className="w-full" disabled={isModelLoading} />
          </div>
          <div className="flex justify-center">
            <button onClick={handleSwap} disabled={isModelLoading} className="p-1.5 hover:bg-stone-100 rounded-full text-stone-400 hover:text-amber-500 disabled:opacity-50 disabled:cursor-not-allowed">
              <ArrowRightLeft size={16} />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-stone-500">Target</label>
            <Select value={config.target_lang} onChange={(v) => onConfigChange({...config, target_lang: v})} options={LANGUAGES} className="w-full" disabled={isModelLoading} />
          </div>
        </div>

        {/* Center: Action */}
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={onStartCapture}
            disabled={!canCapture}
            className={`group relative w-32 h-32 rounded-full text-white shadow-lg transition-all flex flex-col items-center justify-center ${
              canCapture
                ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/25 hover:scale-105 hover:shadow-amber-500/40'
                : 'bg-gradient-to-br from-stone-300 to-stone-400 shadow-stone-400/25 cursor-not-allowed'
            }`}
          >
            <div className={`absolute inset-2 rounded-full border-2 ${canCapture ? 'border-white/20 group-hover:border-white/40' : 'border-white/10'}`} />
            {(isModelLoading || isBackgroundLoading) ? (
              <>
                <Loader2 size={40} className="mb-1 animate-spin" />
                <span className="font-bold text-xs tracking-wide">LOADING</span>
              </>
            ) : (
              <>
                <Camera size={40} className="mb-1" />
                <span className="font-bold text-sm tracking-wide">CAPTURE</span>
              </>
            )}
          </button>
          {(isModelLoading || isBackgroundLoading) ? (
            <div className="text-amber-600 text-xs font-medium">
              {isModelLoading ? loadingMessage : (
                ocrLoading && translateLoading ? 'Loading OCR & Translate...' :
                ocrLoading ? 'Loading OCR model...' :
                'Loading translate model...'
              )}
            </div>
          ) : (
            <div className="text-stone-400 text-xs font-mono">Ctrl+Alt+Q</div>
          )}
        </div>

        {/* Right: Models */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-stone-100 flex flex-col gap-3 w-56">
          <div className="text-xs font-bold text-amber-500 uppercase tracking-wider">Engine</div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-stone-500">Translator</label>
            <Select value={config.translator} onChange={(v) => onConfigChange({...config, translator: v})} options={TRANSLATORS} className="w-full" disabled={isModelLoading} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-stone-500">OCR Model</label>
            <Select value={config.paddleocr?.model_type || 'mobile'} onChange={(v) => onConfigChange({...config, paddleocr: {...config.paddleocr, model_type: v}})} options={OCR_MODELS} className="w-full" disabled={isModelLoading} />
          </div>
        </div>
      </div>

      {/* Footer Status */}
      <div className="bg-white h-10 border-t border-stone-200 flex items-center justify-between px-4 text-xs text-stone-500">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status === 'ready' ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`} />
            <span>Backend: {status === 'ready' ? 'Running' : 'Connecting...'}</span>
          </div>
          <div className="h-3 w-px bg-stone-200" />
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${getOcrStatusColor()}`} />
            <span>OCR ({ocrModelType}): {getOcrStatusText()}</span>
          </div>
          <div className="h-3 w-px bg-stone-200" />
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${getTranslateStatusColor()}`} />
            <span>Translate: {getTranslateStatusText()}</span>
          </div>
        </div>
        <button onClick={onOpenLogs} className="flex items-center gap-1.5 px-2 py-1 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-600">
          <Terminal size={14} />
          <span>Logs</span>
        </button>
      </div>
    </div>
  );
};

export default Dashboard;
