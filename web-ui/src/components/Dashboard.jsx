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

  const ocrModelType = config.paddleocr?.model_type || 'mobile';
  const ocrDownloaded = ocrModelType === 'mobile'
    ? modelStatus?.ocr?.mobile_downloaded
    : modelStatus?.ocr?.server_downloaded;
  const translateDownloaded = modelStatus?.translate?.downloaded;

  const ocrLoading = loadingStatus?.ocr?.loading;
  const ocrLoaded = loadingStatus?.ocr?.ready;
  const translateLoading = loadingStatus?.translate?.loading;
  const translateLoaded = loadingStatus?.translate?.ready;

  const ocrReady = ocrDownloaded && ocrLoaded;
  const translateReady = translateDownloaded && translateLoaded;
  const isBackgroundLoading = ocrLoading || translateLoading;
  const canCapture = status === 'ready' && ocrReady && translateReady && !isModelLoading && !isBackgroundLoading;

  const getOcrStatusText = () => {
    if (!ocrDownloaded) return 'Not Downloaded';
    if (ocrLoading) return 'Loading...';
    if (ocrLoaded) return 'Ready';
    return 'Not Loaded';
  };

  const getTranslateStatusText = () => {
    if (!translateDownloaded) return 'Not Downloaded';
    if (translateLoading) return 'Loading...';
    if (translateLoaded) return 'Ready';
    return 'Not Loaded';
  };

  const getOcrStatusColor = () => {
    if (!ocrDownloaded) return 'bg-red-400';
    if (ocrLoading) return 'bg-amber-400 animate-pulse';
    if (ocrLoaded) return 'bg-emerald-400';
    return 'bg-amber-400';
  };

  const getTranslateStatusColor = () => {
    if (!translateDownloaded) return 'bg-red-400';
    if (translateLoading) return 'bg-amber-400 animate-pulse';
    if (translateLoaded) return 'bg-emerald-400';
    return 'bg-amber-400';
  };

  return (
    <div className="flex flex-col h-screen bg-surface text-stone-900 overflow-hidden">
      {/* Title Bar */}
      <div className="h-11 bg-white/80 backdrop-blur-sm border-b border-stone-100 flex items-center justify-between px-4 drag-region">
        <span className="font-semibold text-stone-700 text-sm tracking-tight no-drag">
          Screen Translate
        </span>
        <div className="flex items-center gap-0.5 no-drag">
          <button
            onClick={onOpenNotebook}
            className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-stone-600 transition-colors"
            title="Notebook"
          >
            <BookOpen size={16} />
          </button>
          <button
            onClick={onOpenSettings}
            className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-stone-600 transition-colors"
            title="Settings"
          >
            <Settings size={16} />
          </button>
          <div className="w-px h-4 bg-stone-200 mx-1" />
          <button
            onClick={() => window.electron.minimizeApp()}
            className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-stone-600 transition-colors"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={() => window.electron.closeApp()}
            className="p-2 hover:bg-red-50 rounded-lg text-stone-400 hover:text-red-500 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-8 gap-8">
        {/* Left: Languages */}
        <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-5 w-52">
          <div className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-4">Languages</div>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-stone-500 mb-1.5 block">Source</label>
              <Select
                value={config.source_lang}
                onChange={(v) => onConfigChange({...config, source_lang: v})}
                options={LANGUAGES}
                className="w-full"
                disabled={isModelLoading}
              />
            </div>
            <div className="flex justify-center">
              <button
                onClick={handleSwap}
                disabled={isModelLoading}
                className="p-2 hover:bg-stone-100 rounded-full text-stone-400 hover:text-amber-500
                  disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowRightLeft size={16} />
              </button>
            </div>
            <div>
              <label className="text-xs text-stone-500 mb-1.5 block">Target</label>
              <Select
                value={config.target_lang}
                onChange={(v) => onConfigChange({...config, target_lang: v})}
                options={LANGUAGES}
                className="w-full"
                disabled={isModelLoading}
              />
            </div>
          </div>
        </div>

        {/* Center: Action */}
        <div className="flex flex-col items-center gap-5">
          <button
            onClick={onStartCapture}
            disabled={!canCapture}
            className={`group relative w-28 h-28 rounded-full text-white transition-all duration-200 flex flex-col items-center justify-center ${
              canCapture
                ? 'bg-gradient-to-br from-amber-400 to-amber-500 shadow-lg shadow-amber-500/20 hover:shadow-xl hover:shadow-amber-500/30 hover:scale-[1.02] active:scale-[0.98]'
                : 'bg-stone-300 cursor-not-allowed'
            }`}
          >
            {(isModelLoading || isBackgroundLoading) ? (
              <>
                <Loader2 size={36} className="mb-1 animate-spin" />
                <span className="text-[10px] font-semibold tracking-wide opacity-80">LOADING</span>
              </>
            ) : (
              <>
                <Camera size={36} className="mb-1" />
                <span className="text-xs font-semibold tracking-wide">CAPTURE</span>
              </>
            )}
          </button>
          <div className="text-center">
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
        </div>

        {/* Right: Models */}
        <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-5 w-52">
          <div className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-4">Engine</div>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-stone-500 mb-1.5 block">Translator</label>
              <Select
                value={config.translator}
                onChange={(v) => onConfigChange({...config, translator: v})}
                options={TRANSLATORS}
                className="w-full"
                disabled={isModelLoading}
              />
            </div>
            <div>
              <label className="text-xs text-stone-500 mb-1.5 block">OCR Model</label>
              <Select
                value={config.paddleocr?.model_type || 'mobile'}
                onChange={(v) => onConfigChange({...config, paddleocr: {...config.paddleocr, model_type: v}})}
                options={OCR_MODELS}
                className="w-full"
                disabled={isModelLoading}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer Status */}
      <div className="h-10 bg-white/80 backdrop-blur-sm border-t border-stone-100 flex items-center justify-between px-4 text-xs text-stone-500">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${status === 'ready' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
            <span className="text-stone-400">Backend {status === 'ready' ? 'Running' : 'Connecting...'}</span>
          </div>
          <div className="w-px h-3 bg-stone-200" />
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${getOcrStatusColor()}`} />
            <span className="text-stone-400">OCR: {getOcrStatusText()}</span>
          </div>
          <div className="w-px h-3 bg-stone-200" />
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${getTranslateStatusColor()}`} />
            <span className="text-stone-400">Translate: {getTranslateStatusText()}</span>
          </div>
        </div>
        <button
          onClick={onOpenLogs}
          className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-stone-600 transition-colors"
        >
          <Terminal size={14} />
          <span>Logs</span>
        </button>
      </div>
    </div>
  );
};

export default Dashboard;
