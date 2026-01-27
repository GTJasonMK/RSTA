import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, X, Minus, ArrowRightLeft, Settings, ChevronLeft, Save, RotateCcw, Loader2, Terminal, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import axios from 'axios';

// ==================== Snipper Component ====================
const Snipper = ({ onComplete, onCancel }) => {
  const [startPos, setStartPos] = useState(null);
  const [currPos, setCurrentPos] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleMouseDown = (e) => {
    setStartPos({ x: e.clientX, y: e.clientY });
    setCurrentPos({ x: e.clientX, y: e.clientY });
    setIsDrawing(true);
  };

  const handleMouseMove = (e) => {
    if (!isDrawing) return;
    setCurrentPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    if (!startPos || !currPos) return;
    const x = Math.min(startPos.x, currPos.x);
    const y = Math.min(startPos.y, currPos.y);
    const width = Math.abs(currPos.x - startPos.x);
    const height = Math.abs(currPos.y - startPos.y);
    if (width > 10 && height > 10) {
      onComplete({ x, y, width, height });
    }
    setStartPos(null);
    setCurrentPos(null);
  };

  const getStyle = () => {
    if (!startPos || !currPos) return {};
    return {
      position: 'absolute',
      left: Math.min(startPos.x, currPos.x),
      top: Math.min(startPos.y, currPos.y),
      width: Math.abs(currPos.x - startPos.x),
      height: Math.abs(currPos.y - startPos.y),
      border: '2px solid #F59E0B',
      backgroundColor: 'rgba(245, 158, 11, 0.2)',
    };
  };

  return (
    <div className="fixed inset-0 cursor-crosshair bg-black/30 z-50"
      onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      {isDrawing && <div style={getStyle()} />}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-lg text-sm font-medium text-stone-700">
        拖动选择区域 (ESC 取消)
      </div>
    </div>
  );
};

// ==================== Settings Components ====================
const SettingGroup = ({ title, children }) => (
  <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
    <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
      <h3 className="font-semibold text-stone-700">{title}</h3>
    </div>
    <div className="p-4 space-y-4">{children}</div>
  </div>
);

const SettingRow = ({ label, description, children }) => (
  <div className="flex items-start justify-between gap-4">
    <div className="flex-1 min-w-0">
      <div className="font-medium text-stone-800">{label}</div>
      {description && <div className="text-sm text-stone-500 mt-0.5">{description}</div>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

const Input = ({ value, onChange, type = 'text', className = '', ...props }) => (
  <input
    type={type}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 ${className}`}
    {...props}
  />
);

const Select = ({ value, onChange, options, className = '', disabled = false }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    disabled={disabled}
    className={`bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
  >
    {options.map(opt => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
);

const Toggle = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`w-11 h-6 rounded-full transition-colors ${checked ? 'bg-amber-500' : 'bg-stone-300'}`}
  >
    <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
  </button>
);

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'ru', label: 'Русский' },
  { value: 'pt', label: 'Português' },
  { value: 'it', label: 'Italiano' },
  { value: 'vi', label: 'Tiếng Việt' },
];

const TRANSLATORS = [
  { value: 'unified', label: 'HY-MT (本地)' },
  { value: 'libretranslate', label: 'LibreTranslate' },
  { value: 'none', label: '不翻译' },
];

const OCR_MODELS = [
  { value: 'mobile', label: 'Mobile (快速)' },
  { value: 'server', label: 'Server (精准)' },
];

const SettingsPage = ({ config, onConfigChange, onBack, onSave, onReset, serverPort }) => {
  const [activeTab, setActiveTab] = useState('general');
  const [modelStatus, setModelStatus] = useState({
    ocr: { downloaded: false, mobile_downloaded: false, server_downloaded: false },
    translate: { downloaded: false }
  });
  const [downloadingModel, setDownloadingModel] = useState(null); // 'ocr_mobile' | 'ocr_server' | 'translate' | null
  const [downloadProgress, setDownloadProgress] = useState({ percent: 0, message: '' });

  // 获取模型状态
  useEffect(() => {
    const fetchModelStatus = async () => {
      try {
        const res = await axios.get(`http://127.0.0.1:${serverPort}/models/status`);
        setModelStatus(res.data);
      } catch (err) {
        console.warn('Failed to fetch model status:', err.message);
      }
    };
    fetchModelStatus();
  }, [serverPort]);

  // 下载模型（使用流式接口显示进度）
  const downloadModel = async (modelType, ocrModelType = 'mobile') => {
    const downloadKey = modelType === 'ocr' ? `ocr_${ocrModelType}` : modelType;
    setDownloadingModel(downloadKey);
    setDownloadProgress({ percent: 0, message: '正在连接...' });

    try {
      // 构建 URL，OCR 模型需要额外的 ocr_model_type 参数
      let url = `http://127.0.0.1:${serverPort}/models/download_stream?model_type=${modelType}`;
      if (modelType === 'ocr') {
        url += `&ocr_model_type=${ocrModelType}`;
      }

      // 使用 EventSource 连接到流式下载接口
      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setDownloadProgress({ percent: data.percent, message: data.message });

          if (data.status === 'done') {
            eventSource.close();
            setDownloadingModel(null);
            setDownloadProgress({ percent: 100, message: '' });
            // 刷新模型状态
            axios.get(`http://127.0.0.1:${serverPort}/models/status`).then(res => {
              setModelStatus(res.data);
            }).catch(() => {});
          } else if (data.status === 'error') {
            eventSource.close();
            setDownloadingModel(null);
            setDownloadProgress({ percent: 0, message: '' });
            alert(`下载失败: ${data.message}`);
          }
        } catch (e) {
          console.warn('Failed to parse download progress:', e);
        }
      };

      eventSource.onerror = (err) => {
        console.error('EventSource error:', err);
        eventSource.close();
        setDownloadingModel(null);
        setDownloadProgress({ percent: 0, message: '' });
        alert('下载连接中断，请重试');
      };

    } catch (err) {
      console.error(`Failed to download ${modelType} model:`, err.message);
      setDownloadingModel(null);
      setDownloadProgress({ percent: 0, message: '' });
      alert(`下载失败: ${err.message}`);
    }
  };

  const updateConfig = (path, value) => {
    const newConfig = { ...config };
    const keys = path.split('.');
    let current = newConfig;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    onConfigChange(newConfig);
  };

  const tabs = [
    { id: 'general', label: '常规' },
    { id: 'hotkeys', label: '快捷键' },
    { id: 'ocr', label: 'OCR' },
    { id: 'service', label: '服务' },
    { id: 'ui', label: '界面' },
  ];

  return (
    <div className="flex flex-col h-screen bg-stone-100">
      {/* Header */}
      <div className="h-12 bg-white border-b border-stone-200 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-600">
            <ChevronLeft size={20} />
          </button>
          <span className="font-bold text-stone-700">Settings</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onReset} className="flex items-center gap-1.5 px-3 py-1.5 text-stone-600 hover:bg-stone-100 rounded-lg text-sm">
            <RotateCcw size={16} /> Reset
          </button>
          <button onClick={onSave} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium">
            <Save size={16} /> Save
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 bg-white border-r border-stone-200 p-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id ? 'bg-amber-100 text-amber-700' : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl space-y-6">
            {activeTab === 'general' && (
              <>
                <SettingGroup title="语言设置">
                  <SettingRow label="源语言" description="OCR 识别的语言">
                    <Select value={config.source_lang} onChange={(v) => updateConfig('source_lang', v)} options={LANGUAGES} className="w-40" />
                  </SettingRow>
                  <SettingRow label="目标语言" description="翻译的目标语言">
                    <Select value={config.target_lang} onChange={(v) => updateConfig('target_lang', v)} options={LANGUAGES} className="w-40" />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="翻译引擎">
                  <SettingRow label="翻译器" description="选择翻译服务">
                    <Select value={config.translator} onChange={(v) => updateConfig('translator', v)} options={TRANSLATORS} className="w-48" />
                  </SettingRow>
                  {config.translator === 'libretranslate' && (
                    <>
                      <SettingRow label="API 地址">
                        <Input value={config.libretranslate?.url || ''} onChange={(v) => updateConfig('libretranslate.url', v)} className="w-64" />
                      </SettingRow>
                      <SettingRow label="API Key" description="可选">
                        <Input value={config.libretranslate?.api_key || ''} onChange={(v) => updateConfig('libretranslate.api_key', v)} className="w-48" />
                      </SettingRow>
                      <SettingRow label="流式输出">
                        <Toggle checked={config.libretranslate?.stream ?? true} onChange={(v) => updateConfig('libretranslate.stream', v)} />
                      </SettingRow>
                    </>
                  )}
                </SettingGroup>
              </>
            )}

            {activeTab === 'hotkeys' && (
              <SettingGroup title="快捷键">
                <SettingRow label="截图翻译" description="触发屏幕区域选择">
                  <Input value={config.hotkey || ''} onChange={(v) => updateConfig('hotkey', v)} className="w-40 font-mono text-xs" />
                </SettingRow>
                <SettingRow label="切换语言" description="交换源语言和目标语言">
                  <Input value={config.swap_hotkey || ''} onChange={(v) => updateConfig('swap_hotkey', v)} className="w-40 font-mono text-xs" />
                </SettingRow>
                <SettingRow label="关闭浮窗" description="关闭翻译结果浮窗">
                  <Input value={config.close_overlay_hotkey || ''} onChange={(v) => updateConfig('close_overlay_hotkey', v)} className="w-40 font-mono text-xs" />
                </SettingRow>
                <div className="text-xs text-stone-500 bg-stone-50 rounded-lg p-3">
                  格式示例: &lt;ctrl&gt;+&lt;shift&gt;+a, &lt;alt&gt;+q
                </div>
              </SettingGroup>
            )}

            {activeTab === 'ocr' && (
              <>
                <SettingGroup title="OCR 引擎">
                  <SettingRow label="OCR 引擎">
                    <Select
                      value={config.ocr_engine || 'paddleocr'}
                      onChange={(v) => updateConfig('ocr_engine', v)}
                      options={[
                        { value: 'paddleocr', label: 'PaddleOCR' },
                        { value: 'tesseract', label: 'Tesseract' },
                      ]}
                      className="w-40"
                    />
                  </SettingRow>
                  <SettingRow label="模型类型" description="Mobile 更快, Server 更准">
                    <Select value={config.paddleocr?.model_type || 'mobile'} onChange={(v) => updateConfig('paddleocr.model_type', v)} options={OCR_MODELS} className="w-40" />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="PaddleOCR 高级设置">
                  <SettingRow label="使用 GPU">
                    <Toggle checked={config.paddleocr?.use_gpu ?? false} onChange={(v) => updateConfig('paddleocr.use_gpu', v)} />
                  </SettingRow>
                  <SettingRow label="文本方向检测">
                    <Toggle checked={config.paddleocr?.use_textline_orientation ?? true} onChange={(v) => updateConfig('paddleocr.use_textline_orientation', v)} />
                  </SettingRow>
                  <SettingRow label="文本识别阈值" description="0.0 - 1.0">
                    <Input type="number" value={config.paddleocr?.text_rec_score_thresh ?? 0.3} onChange={(v) => updateConfig('paddleocr.text_rec_score_thresh', parseFloat(v))} className="w-24" step="0.1" min="0" max="1" />
                  </SettingRow>
                  <SettingRow label="检测框阈值">
                    <Input type="number" value={config.paddleocr?.box_thresh ?? 0.3} onChange={(v) => updateConfig('paddleocr.box_thresh', parseFloat(v))} className="w-24" step="0.1" min="0" max="1" />
                  </SettingRow>
                  <SettingRow label="最大边长" description="图片预处理">
                    <Input type="number" value={config.paddleocr?.max_side ?? 1800} onChange={(v) => updateConfig('paddleocr.max_side', parseInt(v))} className="w-24" />
                  </SettingRow>
                  <SettingRow label="调试模式">
                    <Toggle checked={config.paddleocr?.debug ?? false} onChange={(v) => updateConfig('paddleocr.debug', v)} />
                  </SettingRow>
                </SettingGroup>

                {config.ocr_engine === 'tesseract' && (
                  <SettingGroup title="Tesseract 设置">
                    <SettingRow label="Tesseract 路径" description="tesseract.exe 的完整路径">
                      <Input value={config.tesseract_cmd || ''} onChange={(v) => updateConfig('tesseract_cmd', v)} className="w-64" />
                    </SettingRow>
                    <SettingRow label="OCR 语言代码" description="如 chi_sim, eng">
                      <Input value={config.ocr_lang || ''} onChange={(v) => updateConfig('ocr_lang', v)} className="w-32" />
                    </SettingRow>
                  </SettingGroup>
                )}
              </>
            )}

            {activeTab === 'service' && (
              <>
                <SettingGroup title="统一服务">
                  <SettingRow label="服务地址">
                    <Input value={config.unified_service?.host || '127.0.0.1'} onChange={(v) => updateConfig('unified_service.host', v)} className="w-40" />
                  </SettingRow>
                  <SettingRow label="端口">
                    <Input type="number" value={config.unified_service?.port || 8092} onChange={(v) => updateConfig('unified_service.port', parseInt(v))} className="w-24" />
                  </SettingRow>
                  <SettingRow label="超时时间 (秒)">
                    <Input type="number" value={config.unified_service?.timeout || 30} onChange={(v) => updateConfig('unified_service.timeout', parseInt(v))} className="w-24" />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="本地翻译服务">
                  <SettingRow label="启用">
                    <Toggle checked={config.local_service?.enabled ?? false} onChange={(v) => updateConfig('local_service.enabled', v)} />
                  </SettingRow>
                  <SettingRow label="量化级别" description="Q6_K 推荐">
                    <Select
                      value={config.local_service?.quant || 'Q6_K'}
                      onChange={(v) => updateConfig('local_service.quant', v)}
                      options={[
                        { value: 'Q4_K_M', label: 'Q4_K_M (更快)' },
                        { value: 'Q6_K', label: 'Q6_K (推荐)' },
                        { value: 'Q8_0', label: 'Q8_0 (更准)' },
                      ]}
                      className="w-40"
                    />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="模型管理">
                  <SettingRow label="模型存储路径">
                    <Input value={config.model_dir || 'models'} onChange={(v) => updateConfig('model_dir', v)} className="w-64" />
                  </SettingRow>
                  <SettingRow label="OCR Mobile 模型" description={modelStatus.ocr?.mobile_downloaded ? '已下载 (快速)' : '未下载 (快速)'}>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        onClick={() => downloadModel('ocr', 'mobile')}
                        disabled={downloadingModel !== null || modelStatus.ocr?.mobile_downloaded}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          modelStatus.ocr?.mobile_downloaded
                            ? 'bg-green-100 text-green-700 cursor-default'
                            : downloadingModel === 'ocr_mobile'
                            ? 'bg-stone-200 text-stone-500 cursor-wait'
                            : 'bg-amber-500 hover:bg-amber-600 text-white'
                        }`}
                      >
                        {modelStatus.ocr?.mobile_downloaded ? 'OK' : downloadingModel === 'ocr_mobile' ? `${downloadProgress.percent}%` : '下载'}
                      </button>
                      {downloadingModel === 'ocr_mobile' && downloadProgress.message && (
                        <span className="text-xs text-stone-500 max-w-48 text-right truncate">{downloadProgress.message}</span>
                      )}
                    </div>
                  </SettingRow>
                  <SettingRow label="OCR Server 模型" description={modelStatus.ocr?.server_downloaded ? '已下载 (精准)' : '未下载 (精准)'}>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        onClick={() => downloadModel('ocr', 'server')}
                        disabled={downloadingModel !== null || modelStatus.ocr?.server_downloaded}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          modelStatus.ocr?.server_downloaded
                            ? 'bg-green-100 text-green-700 cursor-default'
                            : downloadingModel === 'ocr_server'
                            ? 'bg-stone-200 text-stone-500 cursor-wait'
                            : 'bg-amber-500 hover:bg-amber-600 text-white'
                        }`}
                      >
                        {modelStatus.ocr?.server_downloaded ? 'OK' : downloadingModel === 'ocr_server' ? `${downloadProgress.percent}%` : '下载'}
                      </button>
                      {downloadingModel === 'ocr_server' && downloadProgress.message && (
                        <span className="text-xs text-stone-500 max-w-48 text-right truncate">{downloadProgress.message}</span>
                      )}
                    </div>
                  </SettingRow>
                  <SettingRow label="翻译模型" description={modelStatus.translate?.downloaded ? '已下载 (HY-MT)' : '未下载 (HY-MT)'}>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        onClick={() => downloadModel('translate')}
                        disabled={downloadingModel !== null || modelStatus.translate?.downloaded}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          modelStatus.translate?.downloaded
                            ? 'bg-green-100 text-green-700 cursor-default'
                            : downloadingModel === 'translate'
                            ? 'bg-stone-200 text-stone-500 cursor-wait'
                            : 'bg-amber-500 hover:bg-amber-600 text-white'
                        }`}
                      >
                        {modelStatus.translate?.downloaded ? 'OK' : downloadingModel === 'translate' ? `${downloadProgress.percent}%` : '下载'}
                      </button>
                      {downloadingModel === 'translate' && downloadProgress.message && (
                        <span className="text-xs text-stone-500 max-w-48 text-right truncate">{downloadProgress.message}</span>
                      )}
                    </div>
                  </SettingRow>
                  {/* 下载进度条 */}
                  {downloadingModel && (
                    <div className="mt-2">
                      <div className="w-full bg-stone-200 rounded-full h-2">
                        <div
                          className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${downloadProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </SettingGroup>
              </>
            )}

            {activeTab === 'ui' && (
              <>
                <SettingGroup title="界面设置">
                  <SettingRow label="轮询间隔 (ms)" description="状态检查频率">
                    <Input type="number" value={config.ui?.poll_ms || 100} onChange={(v) => updateConfig('ui.poll_ms', parseInt(v))} className="w-24" />
                  </SettingRow>
                  <SettingRow label="截图延迟 (ms)" description="截图前的等待时间">
                    <Input type="number" value={config.ui?.capture_delay_ms || 120} onChange={(v) => updateConfig('ui.capture_delay_ms', parseInt(v))} className="w-24" />
                  </SettingRow>
                  <SettingRow label="浮窗最大宽度" description="0 表示不限制">
                    <Input type="number" value={config.ui?.overlay_max_width || 520} onChange={(v) => updateConfig('ui.overlay_max_width', parseInt(v))} className="w-24" />
                  </SettingRow>
                  <SettingRow label="浮窗最大高度" description="0 表示不限制">
                    <Input type="number" value={config.ui?.overlay_max_height || 0} onChange={(v) => updateConfig('ui.overlay_max_height', parseInt(v))} className="w-24" />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="启动设置">
                  <SettingRow label="自动加载 OCR">
                    <Toggle checked={config.startup?.auto_load_ocr ?? true} onChange={(v) => updateConfig('startup.auto_load_ocr', v)} />
                  </SettingRow>
                  <SettingRow label="自动加载翻译器">
                    <Toggle checked={config.startup?.auto_load_translator ?? true} onChange={(v) => updateConfig('startup.auto_load_translator', v)} />
                  </SettingRow>
                </SettingGroup>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== Dashboard Component ====================
const Dashboard = ({ onStartCapture, config, onConfigChange, status, modelStatus, onOpenSettings, onOpenLogs, isModelLoading, loadingMessage }) => {
  const handleSwap = () => {
    onConfigChange({
      ...config,
      source_lang: config.target_lang,
      target_lang: config.source_lang
    });
  };

  // 根据配置的模型类型检查对应的 OCR 模型是否下载
  const ocrModelType = config.paddleocr?.model_type || 'mobile';
  const ocrReady = ocrModelType === 'mobile'
    ? modelStatus?.ocr?.mobile_downloaded
    : modelStatus?.ocr?.server_downloaded;
  const translateReady = modelStatus?.translate?.downloaded;
  const canCapture = status === 'ready' && ocrReady && translateReady && !isModelLoading;

  return (
    <div className="flex flex-col h-screen bg-[#FAFAF9] text-stone-900 overflow-hidden">
      {/* Title Bar */}
      <div className="h-10 bg-white border-b border-stone-200 flex items-center justify-between px-3 drag-region">
        <span className="font-semibold text-stone-700 text-sm no-drag">
          Screen Translate
        </span>
        <div className="flex gap-1 no-drag">
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
            {isModelLoading ? (
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
          {isModelLoading ? (
            <div className="text-amber-600 text-xs font-medium">{loadingMessage}</div>
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
            <div className={`w-2 h-2 rounded-full ${ocrReady ? 'bg-green-500' : 'bg-red-500'}`} />
            <span>OCR ({ocrModelType}): {ocrReady ? 'Ready' : 'Not Downloaded'}</span>
          </div>
          <div className="h-3 w-px bg-stone-200" />
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${translateReady ? 'bg-green-500' : 'bg-red-500'}`} />
            <span>Translate: {translateReady ? 'Ready' : 'Not Downloaded'}</span>
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

// ==================== Log Page Component ====================
const LogPage = ({ onBack, baseUrl }) => {
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('all'); // all, info, warning, error
  const logsEndRef = useRef(null);
  const containerRef = useRef(null);
  const lastIdRef = useRef(0);

  // 初始加载日志
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await axios.get(`${baseUrl}/logs?limit=500`);
        if (res.data?.logs) {
          setLogs(res.data.logs);
          // 记录最后的 ID，用于 SSE 连接
          if (res.data.logs.length > 0) {
            lastIdRef.current = res.data.logs[res.data.logs.length - 1].id;
          }
        }
      } catch (err) {
        console.error('[Logs] Failed to fetch logs:', err.message);
      }
    };
    fetchLogs();
  }, [baseUrl]);

  // SSE 流式获取新日志
  useEffect(() => {
    // 延迟启动 SSE，等待初始日志加载完成
    const timer = setTimeout(() => {
      const eventSource = new EventSource(`${baseUrl}/logs/stream?since_id=${lastIdRef.current}`);

      eventSource.onmessage = (event) => {
        try {
          const log = JSON.parse(event.data);
          // 忽略已经存在的日志
          if (log.id <= lastIdRef.current) return;
          lastIdRef.current = log.id;
          setLogs(prev => {
            const newLogs = [...prev, log];
            // 保持最多 1000 条
            if (newLogs.length > 1000) {
              return newLogs.slice(-1000);
            }
            return newLogs;
          });
        } catch (e) {
          // 忽略解析错误
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
      };

      // 保存引用用于清理
      timerRef.current = eventSource;
    }, 500);

    const timerRef = { current: null };

    return () => {
      clearTimeout(timer);
      if (timerRef.current) {
        timerRef.current.close();
      }
    };
  }, [baseUrl]);

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // 清空日志
  const handleClear = async () => {
    try {
      await axios.post(`${baseUrl}/logs/clear`);
      setLogs([]);
      lastIdRef.current = 0;
    } catch (err) {
      console.error('[Logs] Failed to clear logs:', err.message);
    }
  };

  // 过滤日志
  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    return log.level.toLowerCase() === filter;
  });

  // 日志级别颜色
  const getLevelColor = (level) => {
    switch (level.toLowerCase()) {
      case 'error': return 'text-red-400';
      case 'warning': return 'text-yellow-400';
      case 'info': return 'text-blue-400';
      case 'debug': return 'text-stone-500';
      default: return 'text-stone-400';
    }
  };

  return (
    <div className="flex flex-col h-screen bg-stone-900 text-stone-100">
      {/* Header */}
      <div className="h-12 bg-stone-800 border-b border-stone-700 flex items-center justify-between px-4 drag-region">
        <div className="flex items-center gap-3 no-drag">
          <button onClick={onBack} className="p-1.5 hover:bg-stone-700 rounded-lg text-stone-400 hover:text-white">
            <ChevronLeft size={20} />
          </button>
          <Terminal size={18} className="text-amber-500" />
          <span className="font-bold text-stone-200">Backend Logs</span>
          <span className="text-xs text-stone-500 ml-2">({filteredLogs.length} entries)</span>
        </div>
        <div className="flex items-center gap-2 no-drag">
          {/* Filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-stone-700 border border-stone-600 rounded px-2 py-1 text-sm text-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
          {/* Auto scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 rounded text-sm ${autoScroll ? 'bg-amber-500 text-white' : 'bg-stone-700 text-stone-300'}`}
          >
            Auto-scroll
          </button>
          {/* Clear */}
          <button onClick={handleClear} className="p-1.5 hover:bg-stone-700 rounded text-stone-400 hover:text-red-400">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Log Content */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 font-mono text-xs">
        {filteredLogs.length === 0 ? (
          <div className="text-center text-stone-500 py-8">No logs available</div>
        ) : (
          <div className="space-y-0.5">
            {filteredLogs.map((log) => (
              <div key={log.id} className="flex gap-2 hover:bg-stone-800/50 px-1 py-0.5 rounded">
                <span className="text-stone-600 shrink-0">{log.time}</span>
                <span className={`shrink-0 w-16 ${getLevelColor(log.level)}`}>[{log.level}]</span>
                <span className="text-stone-300 whitespace-pre-wrap break-all">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== Floating Overlay Window ====================
const FloatingOverlay = () => {
  const [text, setText] = useState('');
  const [ocrText, setOcrText] = useState(''); // OCR 原文
  const [showOcr, setShowOcr] = useState(false); // 是否显示 OCR 原文
  const [status, setStatus] = useState('processing'); // 初始就是 processing
  const [maxWidth, setMaxWidth] = useState(300);
  const containerRef = useRef(null);

  // 加载配置获取 maxWidth
  useEffect(() => {
    window.electron.getConfig().then(config => {
      const width = config?.ui?.overlay_max_width;
      if (width && width > 0) setMaxWidth(width);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handleUpdate = (data) => {
      if (data.status) setStatus(data.status);
      if (data.text !== undefined) setText(data.text);
      if (data.ocrText !== undefined) setOcrText(data.ocrText);
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
  }, [text, status, showOcr]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') window.electron.closeOverlay();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
        className="electron-drag relative bg-stone-900/90 text-white text-sm px-2 py-1 pr-6 rounded shadow-lg cursor-move"
        style={{ width: 'max-content', minWidth: 60, maxWidth }}
      >
      {status === 'processing' ? (
        <span className="text-stone-400">...</span>
      ) : (
        <>
          <span className="electron-no-drag no-drag block leading-snug select-text cursor-text" style={{ wordBreak: 'break-word' }}>{text}</span>
          {showOcr && ocrText && (
            <div className="electron-no-drag no-drag mt-2 pt-2 border-t border-stone-700 text-stone-400 text-xs select-text cursor-text">
              {ocrText}
            </div>
          )}
        </>
      )}
      <button
        onClick={() => window.electron.closeOverlay()}
        className="electron-no-drag absolute top-1 right-1 w-4 h-4 flex items-center justify-center text-stone-400 hover:text-white"
      >
        <X size={10} />
      </button>
      {status === 'done' && ocrText && (
        <button
          onClick={() => setShowOcr(!showOcr)}
          className="electron-no-drag absolute bottom-1 right-1 w-4 h-4 flex items-center justify-center text-stone-400 hover:text-white"
          title={showOcr ? '收回原文' : '显示原文'}
        >
          {showOcr ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
      )}
    </div>
    </>
  );
};

// ==================== Main App ====================
const App = () => {
  const query = new URLSearchParams(window.location.search);
  const mode = query.get('mode');
  const isSnipping = mode === 'snipping';
  const isOverlay = mode === 'overlay';

  const [serverPort, setServerPort] = useState(8092);
  const [status, setStatus] = useState('checking');
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [loadedModels, setLoadedModels] = useState(new Set());
  const [modelStatus, setModelStatus] = useState({
    ocr: { downloaded: false, mobile_downloaded: false, server_downloaded: false },
    translate: { downloaded: false }
  });
  const [config, setConfig] = useState({
    source_lang: 'en',
    target_lang: 'zh',
    translator: 'unified',
    paddleocr: { model_type: 'mobile' }
  });

  const baseUrl = `http://127.0.0.1:${serverPort}`;

  // 使用 ref 存储最新的配置，避免监听器重复注册
  const configRef = useRef(config);
  const baseUrlRef = useRef(baseUrl);
  useEffect(() => {
    configRef.current = config;
    baseUrlRef.current = baseUrl;
  }, [config, baseUrl]);

  // 加载配置
  useEffect(() => {
    window.electron.getConfig().then((cfg) => {
      if (cfg?.serverPort) setServerPort(cfg.serverPort);
    });
  }, []);

  useEffect(() => {
    if (isOverlay) return;
    axios.get(`${baseUrl}/config`).then(res => {
      setConfig(res.data);
    }).catch(err => {
      console.error('[Config] Failed to load config:', err.message);
    });
  }, [baseUrl, isOverlay]);

  // 健康检查并获取已加载的模型
  useEffect(() => {
    if (isOverlay) return;
    const checkHealth = async () => {
      try {
        const res = await axios.get(`${baseUrl}/health`);
        setStatus('ready');
        // 更新已加载的模型列表
        if (res.data.ocr_loaded) {
          setLoadedModels(new Set(res.data.ocr_loaded));
        }
        // 获取模型下载状态
        try {
          const statusRes = await axios.get(`${baseUrl}/models/status`);
          setModelStatus(statusRes.data);
        } catch (e) {
          // 忽略模型状态获取失败
        }
      } catch (e) {
        setStatus('error');
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, [baseUrl, isOverlay]);

  // 预加载 OCR 模型
  const preloadModel = useCallback(async (lang, modelType) => {
    const cacheKey = `${modelType}_${lang}`;
    if (loadedModels.has(cacheKey)) {
      return; // 已经加载
    }

    setIsModelLoading(true);
    setLoadingMessage(`Loading OCR model for ${lang}...`);

    try {
      const res = await axios.post(`${baseUrl}/ocr/preload`, {
        model_type: modelType,
        lang: lang
      }, { timeout: 120000 }); // 2分钟超时，模型加载可能较慢
      console.log('[Preload] Model loaded:', res.data);
      setLoadedModels(prev => new Set([...prev, cacheKey]));
    } catch (err) {
      // 网络错误或端点不存在时，静默失败
      // 模型会在首次 OCR 请求时按需加载
      console.warn('[Preload] Failed to preload model (will load on first use):', err.message);
    } finally {
      setIsModelLoading(false);
      setLoadingMessage('');
    }
  }, [baseUrl, loadedModels]);

  // 配置变更处理 - 检查是否需要预加载模型
  const handleConfigChange = useCallback(async (newConfig) => {
    const modelType = newConfig.paddleocr?.model_type || 'mobile';
    const sourceLang = newConfig.source_lang;
    const cacheKey = `${modelType}_${sourceLang}`;

    // 先更新配置
    setConfig(newConfig);

    // 检查是否需要预加载新的 OCR 模型
    if (!loadedModels.has(cacheKey)) {
      await preloadModel(sourceLang, modelType);
    }
  }, [loadedModels, preloadModel]);

  // 裁剪图片
  const cropImage = (imageDataUrl, bounds) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = bounds.width;
          canvas.height = bounds.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageDataUrl;
    });
  };

  // 处理截图结果 - 使用 ref 避免重复注册监听器
  const handleCaptureResult = useCallback(async (data) => {
    const currentBaseUrl = baseUrlRef.current;
    const currentConfig = configRef.current;
    const overlayId = data.overlayId; // 获取对应的 overlay ID

    console.log('[Capture] Processing started, overlayId:', overlayId);
    window.electron.updateOverlay({ overlayId, status: 'processing', text: '' });

    try {
      console.log('[Capture] Cropping image...');
      const croppedImage = await cropImage(data.image, data.bounds);
      console.log('[Capture] Image cropped, calling OCR...');

      const ocrRes = await axios.post(`${currentBaseUrl}/ocr`, {
        image: croppedImage.split(',')[1],
        lang: currentConfig.source_lang,
        model_type: currentConfig.paddleocr?.model_type || 'mobile'
      });

      // 验证 OCR 响应结构
      if (!ocrRes.data || typeof ocrRes.data.text !== 'string') {
        throw new Error('Invalid OCR response format');
      }
      console.log('[Capture] OCR done:', ocrRes.data.text?.substring(0, 50));

      const ocrText = ocrRes.data.text;
      if (!ocrText?.trim()) {
        window.electron.updateOverlay({ overlayId, status: 'done', text: 'No text detected.' });
        return;
      }

      console.log('[Capture] Translating (stream)...');

      // 使用流式翻译
      const response = await fetch(`${currentBaseUrl}/translate_stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ocrText,
          source: currentConfig.source_lang,
          target: currentConfig.target_lang
        })
      });

      if (!response.ok) {
        throw new Error(`Translation failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let translatedText = '';

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
              if (parsed.token) {
                translatedText += parsed.token;
                window.electron.updateOverlay({ overlayId, status: 'streaming', text: translatedText, ocrText });
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      console.log('[Capture] Translation done');
      window.electron.updateOverlay({ overlayId, status: 'done', text: translatedText, ocrText });
    } catch (err) {
      console.error('[Capture] Error:', err);
      window.electron.updateOverlay({ overlayId, status: 'error', text: err.response?.data?.detail || err.message });
    }
  }, []);  // 空依赖数组，只创建一次

  // 监听截图结果 - 只注册一次
  useEffect(() => {
    if (isSnipping || isOverlay) return;
    window.electron.onCaptureResult(handleCaptureResult);
    return () => window.electron.removeOnCaptureResult(handleCaptureResult);
  }, [isSnipping, isOverlay, handleCaptureResult]);

  // 监听快捷键互换语言
  useEffect(() => {
    if (isSnipping || isOverlay) return;
    const handleSwap = () => {
      handleConfigChange({
        ...configRef.current,
        source_lang: configRef.current.target_lang,
        target_lang: configRef.current.source_lang
      });
    };
    window.electron.onSwapLanguages(handleSwap);
    return () => window.electron.removeOnSwapLanguages(handleSwap);
  }, [isSnipping, isOverlay, handleConfigChange]);

  // 保存配置
  const handleSaveConfig = async () => {
    try {
      await axios.post(`${baseUrl}/config`, config);
      setShowSettings(false);

      // 检查是否需要预加载新的 OCR 模型
      const modelType = config.paddleocr?.model_type || 'mobile';
      const sourceLang = config.source_lang;
      const cacheKey = `${modelType}_${sourceLang}`;
      if (!loadedModels.has(cacheKey)) {
        await preloadModel(sourceLang, modelType);
      }
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
  };

  // 重置配置
  const handleResetConfig = async () => {
    try {
      const res = await axios.get(`${baseUrl}/config/default`);
      setConfig(res.data);
    } catch (err) {
      alert('Failed to reset: ' + err.message);
    }
  };

  // 截图模式
  if (isSnipping) {
    return <Snipper onComplete={(bounds) => window.electron.completeCapture(bounds)} onCancel={() => window.electron.cancelCapture()} />;
  }

  // 浮窗模式
  if (isOverlay) {
    return <FloatingOverlay />;
  }

  // 设置页面
  if (showSettings) {
    return (
      <SettingsPage
        config={config}
        onConfigChange={setConfig}
        onBack={() => setShowSettings(false)}
        onSave={handleSaveConfig}
        onReset={handleResetConfig}
        serverPort={serverPort}
      />
    );
  }

  // 日志页面
  if (showLogs) {
    return (
      <LogPage
        onBack={() => setShowLogs(false)}
        baseUrl={baseUrl}
      />
    );
  }

  // 主页面
  return (
    <Dashboard
      onStartCapture={() => window.electron.startCapture()}
      config={config}
      onConfigChange={handleConfigChange}
      status={status}
      modelStatus={modelStatus}
      onOpenSettings={() => setShowSettings(true)}
      onOpenLogs={() => setShowLogs(true)}
      isModelLoading={isModelLoading}
      loadingMessage={loadingMessage}
    />
  );
};

export default App;
