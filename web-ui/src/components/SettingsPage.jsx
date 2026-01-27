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
    { id: 'llm', label: 'LLM' },
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

            {activeTab === 'llm' && (
              <>
                <SettingGroup title="LLM 配置">
                  <div className="text-sm text-stone-500 bg-stone-50 rounded-lg p-3 mb-4">
                    配置 LLM API 用于语法和词汇分析。支持 OpenAI 兼容格式和 Claude API。
                  </div>
                  <SettingRow label="API Key" description="LLM 服务的 API 密钥">
                    <Input
                      type="password"
                      value={config.llm?.api_key || ''}
                      onChange={(v) => updateConfig('llm.api_key', v)}
                      className="w-64"
                      placeholder="sk-..."
                    />
                  </SettingRow>
                  <SettingRow label="Base URL" description="API 端点地址">
                    <Input
                      value={config.llm?.base_url || ''}
                      onChange={(v) => updateConfig('llm.base_url', v)}
                      className="w-64"
                      placeholder="https://api.openai.com"
                    />
                  </SettingRow>
                  <SettingRow label="模型" description="模型名称">
                    <Input
                      value={config.llm?.model || ''}
                      onChange={(v) => updateConfig('llm.model', v)}
                      className="w-48"
                      placeholder="gpt-4o-mini"
                    />
                  </SettingRow>
                </SettingGroup>

                <SettingGroup title="高级设置">
                  <SettingRow label="Max Tokens" description="最大生成长度">
                    <Input
                      type="number"
                      value={config.llm?.max_tokens || 2048}
                      onChange={(v) => updateConfig('llm.max_tokens', parseInt(v))}
                      className="w-24"
                      min="256"
                      max="8192"
                    />
                  </SettingRow>
                  <SettingRow label="Temperature" description="生成随机性 (0-1)">
                    <Input
                      type="number"
                      value={config.llm?.temperature || 0.7}
                      onChange={(v) => updateConfig('llm.temperature', parseFloat(v))}
                      className="w-24"
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
                <SettingGroup title="界面设置">
                  <SettingRow label="浮窗最大宽度" description="0 表示不限制">
                    <Input type="number" value={config.ui?.overlay_max_width || 300} onChange={(v) => updateConfig('ui.overlay_max_width', parseInt(v))} className="w-24" />
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

export default SettingsPage;
