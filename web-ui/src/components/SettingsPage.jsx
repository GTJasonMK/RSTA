import React, { useState, useEffect } from 'react';
import { ChevronLeft, Save, RotateCcw } from 'lucide-react';
import axios from 'axios';
import { SettingGroup, SettingRow, Input, Select, Toggle } from './SettingControls';
import { LANGUAGES, TRANSLATORS, OCR_MODELS } from '../constants';

/**
 * 设置页面组件
 */
const SettingsPage = ({ config, onConfigChange, onBack, onSave, onReset, serverPort }) => {
  const [activeTab, setActiveTab] = useState('general');
  const [modelStatus, setModelStatus] = useState({
    ocr: { downloaded: false, mobile_downloaded: false, server_downloaded: false },
    translate: { downloaded: false }
  });
  const [downloadingModel, setDownloadingModel] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState({ percent: 0, message: '' });

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

  const downloadModel = async (modelType, ocrModelType = 'mobile') => {
    const downloadKey = modelType === 'ocr' ? `ocr_${ocrModelType}` : modelType;
    setDownloadingModel(downloadKey);
    setDownloadProgress({ percent: 0, message: 'Connecting...' });

    try {
      let url = `http://127.0.0.1:${serverPort}/models/download_stream?model_type=${modelType}`;
      if (modelType === 'ocr') {
        url += `&ocr_model_type=${ocrModelType}`;
      }

      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setDownloadProgress({ percent: data.percent, message: data.message });

          if (data.status === 'done') {
            eventSource.close();
            setDownloadingModel(null);
            setDownloadProgress({ percent: 100, message: '' });
            axios.get(`http://127.0.0.1:${serverPort}/models/status`).then(res => {
              setModelStatus(res.data);
            }).catch(() => {});
          } else if (data.status === 'error') {
            eventSource.close();
            setDownloadingModel(null);
            setDownloadProgress({ percent: 0, message: '' });
            alert(`Download failed: ${data.message}`);
          }
        } catch (e) {
          console.warn('Failed to parse download progress:', e);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setDownloadingModel(null);
        setDownloadProgress({ percent: 0, message: '' });
        alert('Connection interrupted, please retry');
      };

    } catch (err) {
      console.error(`Failed to download ${modelType} model:`, err.message);
      setDownloadingModel(null);
      setDownloadProgress({ percent: 0, message: '' });
      alert(`Download failed: ${err.message}`);
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
    { id: 'general', label: 'General' },
    { id: 'hotkeys', label: 'Hotkeys' },
    { id: 'ocr', label: 'OCR' },
    { id: 'service', label: 'Service' },
    { id: 'llm', label: 'LLM' },
    { id: 'ui', label: 'Interface' },
  ];

  return (
    <div className="flex flex-col h-screen bg-surface">
      {/* Header */}
      <div className="h-12 bg-white/80 backdrop-blur-sm border-b border-stone-100 flex items-center justify-between px-4 drag-region">
        <div className="flex items-center gap-3 no-drag">
          <button onClick={onBack} className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-500 hover:text-stone-700 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <span className="font-semibold text-stone-700">Settings</span>
        </div>
        <div className="flex items-center gap-2 no-drag">
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-stone-500 hover:bg-stone-100 rounded-xl text-sm transition-colors"
          >
            <RotateCcw size={14} /> Reset
          </button>
          <button
            onClick={onSave}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition-colors"
          >
            <Save size={14} /> Save
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-44 bg-white/50 border-r border-stone-100 p-3">
          <div className="space-y-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-amber-50 text-amber-600 font-medium'
                    : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl space-y-5">
            {activeTab === 'general' && (
              <>
                <SettingGroup title="Language Settings">
                  <SettingRow label="Source Language" description="OCR recognition language">
                    <Select value={config.source_lang} onChange={(v) => updateConfig('source_lang', v)} options={LANGUAGES} className="w-36" />
                  </SettingRow>
                  <SettingRow label="Target Language" description="Translation target language">
                    <Select value={config.target_lang} onChange={(v) => updateConfig('target_lang', v)} options={LANGUAGES} className="w-36" />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="Translation Engine">
                  <SettingRow label="Translator" description="Select translation service">
                    <Select value={config.translator} onChange={(v) => updateConfig('translator', v)} options={TRANSLATORS} className="w-44" />
                  </SettingRow>
                  {config.translator === 'libretranslate' && (
                    <>
                      <SettingRow label="API URL">
                        <Input value={config.libretranslate?.url || ''} onChange={(v) => updateConfig('libretranslate.url', v)} className="w-60" />
                      </SettingRow>
                      <SettingRow label="API Key" description="Optional">
                        <Input value={config.libretranslate?.api_key || ''} onChange={(v) => updateConfig('libretranslate.api_key', v)} className="w-44" />
                      </SettingRow>
                      <SettingRow label="Streaming">
                        <Toggle checked={config.libretranslate?.stream ?? true} onChange={(v) => updateConfig('libretranslate.stream', v)} />
                      </SettingRow>
                    </>
                  )}
                </SettingGroup>
              </>
            )}

            {activeTab === 'hotkeys' && (
              <SettingGroup title="Hotkeys">
                <SettingRow label="Capture & Translate" description="Trigger screen region selection">
                  <Input value={config.hotkey || ''} onChange={(v) => updateConfig('hotkey', v)} className="w-36 font-mono text-xs" />
                </SettingRow>
                <SettingRow label="Capture & Q&A" description="Trigger Q&A mode">
                  <Input value={config.qa_hotkey || ''} onChange={(v) => updateConfig('qa_hotkey', v)} className="w-36 font-mono text-xs" />
                </SettingRow>
                <SettingRow label="Swap Languages" description="Swap source and target language">
                  <Input value={config.swap_hotkey || ''} onChange={(v) => updateConfig('swap_hotkey', v)} className="w-36 font-mono text-xs" />
                </SettingRow>
                <SettingRow label="Close Overlay" description="Close translation overlay">
                  <Input value={config.close_overlay_hotkey || ''} onChange={(v) => updateConfig('close_overlay_hotkey', v)} className="w-36 font-mono text-xs" />
                </SettingRow>
                <div className="text-xs text-stone-400 bg-stone-50 rounded-xl p-3">
                  Format: Ctrl+Alt+Q, Ctrl+Shift+A, etc.
                </div>
              </SettingGroup>
            )}

            {activeTab === 'ocr' && (
              <>
                <SettingGroup title="OCR Engine">
                  <SettingRow label="Engine">
                    <Select
                      value={config.ocr_engine || 'paddleocr'}
                      onChange={(v) => updateConfig('ocr_engine', v)}
                      options={[
                        { value: 'paddleocr', label: 'PaddleOCR' },
                        { value: 'tesseract', label: 'Tesseract' },
                      ]}
                      className="w-36"
                    />
                  </SettingRow>
                  <SettingRow label="Model Type" description="Mobile: faster, Server: more accurate">
                    <Select value={config.paddleocr?.model_type || 'mobile'} onChange={(v) => updateConfig('paddleocr.model_type', v)} options={OCR_MODELS} className="w-36" />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="PaddleOCR Advanced">
                  <SettingRow label="Use GPU">
                    <Toggle checked={config.paddleocr?.use_gpu ?? false} onChange={(v) => updateConfig('paddleocr.use_gpu', v)} />
                  </SettingRow>
                  <SettingRow label="Text Direction Detection">
                    <Toggle checked={config.paddleocr?.use_textline_orientation ?? true} onChange={(v) => updateConfig('paddleocr.use_textline_orientation', v)} />
                  </SettingRow>
                  <SettingRow label="Text Recognition Threshold" description="0.0 - 1.0">
                    <Input type="number" value={config.paddleocr?.text_rec_score_thresh ?? 0.3} onChange={(v) => updateConfig('paddleocr.text_rec_score_thresh', parseFloat(v))} className="w-20" step="0.1" min="0" max="1" />
                  </SettingRow>
                  <SettingRow label="Box Threshold">
                    <Input type="number" value={config.paddleocr?.box_thresh ?? 0.3} onChange={(v) => updateConfig('paddleocr.box_thresh', parseFloat(v))} className="w-20" step="0.1" min="0" max="1" />
                  </SettingRow>
                  <SettingRow label="Max Side Length" description="Image preprocessing">
                    <Input type="number" value={config.paddleocr?.max_side ?? 1800} onChange={(v) => updateConfig('paddleocr.max_side', parseInt(v))} className="w-20" />
                  </SettingRow>
                  <SettingRow label="Debug Mode">
                    <Toggle checked={config.paddleocr?.debug ?? false} onChange={(v) => updateConfig('paddleocr.debug', v)} />
                  </SettingRow>
                </SettingGroup>

                {config.ocr_engine === 'tesseract' && (
                  <SettingGroup title="Tesseract Settings">
                    <SettingRow label="OCR Language Code" description="e.g. chi_sim, eng">
                      <Input value={config.ocr_lang || ''} onChange={(v) => updateConfig('ocr_lang', v)} className="w-28" />
                    </SettingRow>
                  </SettingGroup>
                )}
              </>
            )}

            {activeTab === 'service' && (
              <>
                <SettingGroup title="Unified Service">
                  <SettingRow label="Host">
                    <Input value={config.unified_service?.host || '127.0.0.1'} onChange={(v) => updateConfig('unified_service.host', v)} className="w-36" />
                  </SettingRow>
                  <SettingRow label="Port">
                    <Input type="number" value={config.unified_service?.port || 8092} onChange={(v) => updateConfig('unified_service.port', parseInt(v))} className="w-20" />
                  </SettingRow>
                  <SettingRow label="Timeout (seconds)">
                    <Input type="number" value={config.unified_service?.timeout || 30} onChange={(v) => updateConfig('unified_service.timeout', parseInt(v))} className="w-20" />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="Local Translation Service">
                  <SettingRow label="Quantization" description="Q6_K recommended">
                    <Select
                      value={config.local_service?.quant || 'Q6_K'}
                      onChange={(v) => updateConfig('local_service.quant', v)}
                      options={[
                        { value: 'Q4_K_M', label: 'Q4_K_M (Faster)' },
                        { value: 'Q6_K', label: 'Q6_K (Recommended)' },
                        { value: 'Q8_0', label: 'Q8_0 (Better)' },
                      ]}
                      className="w-40"
                    />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="Model Management">
                  <SettingRow label="Model Directory">
                    <Input value={config.model_dir || 'models'} onChange={(v) => updateConfig('model_dir', v)} className="w-56" />
                  </SettingRow>
                  <SettingRow label="OCR Mobile Model" description={modelStatus.ocr?.mobile_downloaded ? 'Downloaded (Fast)' : 'Not Downloaded (Fast)'}>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        onClick={() => downloadModel('ocr', 'mobile')}
                        disabled={downloadingModel !== null || modelStatus.ocr?.mobile_downloaded}
                        className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                          modelStatus.ocr?.mobile_downloaded
                            ? 'bg-emerald-50 text-emerald-600 cursor-default'
                            : downloadingModel === 'ocr_mobile'
                            ? 'bg-stone-100 text-stone-500 cursor-wait'
                            : 'bg-amber-500 hover:bg-amber-600 text-white'
                        }`}
                      >
                        {modelStatus.ocr?.mobile_downloaded ? 'OK' : downloadingModel === 'ocr_mobile' ? `${downloadProgress.percent}%` : 'Download'}
                      </button>
                      {downloadingModel === 'ocr_mobile' && downloadProgress.message && (
                        <span className="text-xs text-stone-400 max-w-44 text-right truncate">{downloadProgress.message}</span>
                      )}
                    </div>
                  </SettingRow>
                  <SettingRow label="OCR Server Model" description={modelStatus.ocr?.server_downloaded ? 'Downloaded (Accurate)' : 'Not Downloaded (Accurate)'}>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        onClick={() => downloadModel('ocr', 'server')}
                        disabled={downloadingModel !== null || modelStatus.ocr?.server_downloaded}
                        className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                          modelStatus.ocr?.server_downloaded
                            ? 'bg-emerald-50 text-emerald-600 cursor-default'
                            : downloadingModel === 'ocr_server'
                            ? 'bg-stone-100 text-stone-500 cursor-wait'
                            : 'bg-amber-500 hover:bg-amber-600 text-white'
                        }`}
                      >
                        {modelStatus.ocr?.server_downloaded ? 'OK' : downloadingModel === 'ocr_server' ? `${downloadProgress.percent}%` : 'Download'}
                      </button>
                      {downloadingModel === 'ocr_server' && downloadProgress.message && (
                        <span className="text-xs text-stone-400 max-w-44 text-right truncate">{downloadProgress.message}</span>
                      )}
                    </div>
                  </SettingRow>
                  <SettingRow label="Translation Model" description={modelStatus.translate?.downloaded ? 'Downloaded (HY-MT)' : 'Not Downloaded (HY-MT)'}>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        onClick={() => downloadModel('translate')}
                        disabled={downloadingModel !== null || modelStatus.translate?.downloaded}
                        className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                          modelStatus.translate?.downloaded
                            ? 'bg-emerald-50 text-emerald-600 cursor-default'
                            : downloadingModel === 'translate'
                            ? 'bg-stone-100 text-stone-500 cursor-wait'
                            : 'bg-amber-500 hover:bg-amber-600 text-white'
                        }`}
                      >
                        {modelStatus.translate?.downloaded ? 'OK' : downloadingModel === 'translate' ? `${downloadProgress.percent}%` : 'Download'}
                      </button>
                      {downloadingModel === 'translate' && downloadProgress.message && (
                        <span className="text-xs text-stone-400 max-w-44 text-right truncate">{downloadProgress.message}</span>
                      )}
                    </div>
                  </SettingRow>
                  {downloadingModel && (
                    <div className="mt-2">
                      <div className="w-full bg-stone-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-amber-500 h-1.5 transition-all duration-300"
                          style={{ width: `${downloadProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </SettingGroup>
              </>
            )}

            {activeTab === 'llm' && (
              <>
                <SettingGroup title="LLM Configuration">
                  <div className="text-sm text-stone-500 bg-stone-50 rounded-xl p-3 mb-4">
                    Configure LLM API for grammar and vocabulary analysis. Supports OpenAI-compatible format and Claude API.
                  </div>
                  <SettingRow label="API Key" description="LLM service API key">
                    <Input
                      type="password"
                      value={config.llm?.api_key || ''}
                      onChange={(v) => updateConfig('llm.api_key', v)}
                      className="w-56"
                      placeholder="sk-..."
                    />
                  </SettingRow>
                  <SettingRow label="Base URL" description="API endpoint">
                    <Input
                      value={config.llm?.base_url || ''}
                      onChange={(v) => updateConfig('llm.base_url', v)}
                      className="w-56"
                      placeholder="https://api.openai.com"
                    />
                  </SettingRow>
                  <SettingRow label="Model" description="Model name">
                    <Input
                      value={config.llm?.model || ''}
                      onChange={(v) => updateConfig('llm.model', v)}
                      className="w-44"
                      placeholder="gpt-4o-mini"
                    />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="Advanced Settings">
                  <SettingRow label="Max Tokens" description="Maximum generation length">
                    <Input
                      type="number"
                      value={config.llm?.max_tokens || 2048}
                      onChange={(v) => updateConfig('llm.max_tokens', parseInt(v))}
                      className="w-20"
                      min="256"
                      max="8192"
                    />
                  </SettingRow>
                  <SettingRow label="Temperature" description="Generation randomness (0-1)">
                    <Input
                      type="number"
                      value={config.llm?.temperature || 0.7}
                      onChange={(v) => updateConfig('llm.temperature', parseFloat(v))}
                      className="w-20"
                      step="0.1"
                      min="0"
                      max="1"
                    />
                  </SettingRow>
                </SettingGroup>
              </>
            )}

            {activeTab === 'ui' && (
              <>
                <SettingGroup title="Interface Settings">
                  <SettingRow label="Overlay Max Width" description="0 for no limit">
                    <Input type="number" value={config.ui?.overlay_max_width || 300} onChange={(v) => updateConfig('ui.overlay_max_width', parseInt(v))} className="w-20" />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="Startup Settings">
                  <SettingRow label="Auto-load OCR">
                    <Toggle checked={config.startup?.auto_load_ocr ?? true} onChange={(v) => updateConfig('startup.auto_load_ocr', v)} />
                  </SettingRow>
                  <SettingRow label="Auto-load Translator">
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

export default SettingsPage;
