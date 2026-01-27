import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Snipper, Dashboard, SettingsPage, LogPage, FloatingOverlay } from './components';
import { getLangName } from './constants';

/**
 * 主应用组件
 */
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
  const [loadingStatus, setLoadingStatus] = useState({
    ocr: { loading: false, ready: false, loaded_models: [] },
    translate: { loading: false, ready: false, model_file: null },
    error: null
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
      // 初始化托盘图标语言显示
      if (window.electron?.updateTrayLanguage) {
        window.electron.updateTrayLanguage(res.data.source_lang, res.data.target_lang);
      }
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
        if (res.data.ocr_loaded) {
          setLoadedModels(new Set(res.data.ocr_loaded));
        }
        try {
          const statusRes = await axios.get(`${baseUrl}/models/status`);
          setModelStatus(statusRes.data);
        } catch (e) {
          // 忽略模型状态获取失败
        }
        try {
          const loadingRes = await axios.get(`${baseUrl}/loading_status`);
          setLoadingStatus(loadingRes.data);
        } catch (e) {
          // 忽略加载状态获取失败
        }
      } catch (e) {
        setStatus('error');
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 1000);
    return () => clearInterval(interval);
  }, [baseUrl, isOverlay]);

  // 预加载 OCR 模型
  const preloadModel = useCallback(async (lang, modelType) => {
    const cacheKey = `${modelType}_${lang}`;
    if (loadedModels.has(cacheKey)) {
      return;
    }

    setIsModelLoading(true);
    setLoadingMessage(`Loading OCR model for ${lang}...`);

    try {
      const res = await axios.post(`${baseUrl}/ocr/preload`, {
        model_type: modelType,
        lang: lang
      }, { timeout: 120000 });
      console.log('[Preload] Model loaded:', res.data);
      setLoadedModels(prev => new Set([...prev, cacheKey]));
    } catch (err) {
      console.warn('[Preload] Failed to preload model (will load on first use):', err.message);
    } finally {
      setIsModelLoading(false);
      setLoadingMessage('');
    }
  }, [baseUrl, loadedModels]);

  // 配置变更处理
  const handleConfigChange = useCallback(async (newConfig, options = {}) => {
    const { isSwap = false, showNotif = false } = options;
    const modelType = newConfig.paddleocr?.model_type || 'mobile';
    const sourceLang = newConfig.source_lang;
    const cacheKey = `${modelType}_${sourceLang}`;

    setConfig(newConfig);

    if (window.electron?.updateTrayLanguage) {
      window.electron.updateTrayLanguage(newConfig.source_lang, newConfig.target_lang);
    }

    if (isSwap && showNotif && window.electron?.showNotification) {
      const fromLang = getLangName(newConfig.target_lang);
      const toLang = getLangName(newConfig.source_lang);
      window.electron.showNotification('Language Swapped', `${fromLang} -> ${toLang}`);
    }

    if (!loadedModels.has(cacheKey)) {
      if (showNotif && window.electron?.showNotification) {
        window.electron.showNotification('Loading Model', `OCR model for ${getLangName(sourceLang)}...`);
      }
      await preloadModel(sourceLang, modelType);
      if (showNotif && window.electron?.showNotification) {
        window.electron.showNotification('Model Ready', `OCR model loaded`);
      }
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

  // 处理截图结果
  const handleCaptureResult = useCallback(async (data) => {
    const currentBaseUrl = baseUrlRef.current;
    const currentConfig = configRef.current;
    const overlayId = data.overlayId;

    console.log('[Capture] Processing started, overlayId:', overlayId);
    window.electron.updateOverlay({ overlayId, status: 'ocr', text: '' });

    try {
      console.log('[Capture] Cropping image...');
      const croppedImage = await cropImage(data.image, data.bounds);
      console.log('[Capture] Image cropped, calling OCR...');

      let ocrRes;
      try {
        ocrRes = await axios.post(`${currentBaseUrl}/ocr`, {
          image: croppedImage.split(',')[1],
          lang: currentConfig.source_lang,
          model_type: currentConfig.paddleocr?.model_type || 'mobile'
        });
      } catch (ocrErr) {
        if (ocrErr.response?.status === 503) {
          const detail = ocrErr.response?.data?.detail || '';
          if (detail.includes('加载中') || detail.includes('loading')) {
            window.electron.updateOverlay({ overlayId, status: 'ocr_loading', text: '' });
            let retryCount = 0;
            const maxRetries = 60;
            while (retryCount < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              retryCount++;
              try {
                const statusRes = await axios.get(`${currentBaseUrl}/loading_status`);
                if (!statusRes.data.ocr?.loading) {
                  window.electron.updateOverlay({ overlayId, status: 'ocr', text: '' });
                  ocrRes = await axios.post(`${currentBaseUrl}/ocr`, {
                    image: croppedImage.split(',')[1],
                    lang: currentConfig.source_lang,
                    model_type: currentConfig.paddleocr?.model_type || 'mobile'
                  });
                  break;
                }
              } catch (retryErr) {
                if (retryErr.response?.status !== 503) {
                  throw retryErr;
                }
              }
            }
            if (!ocrRes) {
              throw new Error('OCR model loading timeout');
            }
          } else {
            throw ocrErr;
          }
        } else {
          throw ocrErr;
        }
      }

      if (!ocrRes.data || typeof ocrRes.data.text !== 'string') {
        throw new Error('Invalid OCR response format');
      }
      console.log('[Capture] OCR done:', ocrRes.data.text?.substring(0, 50));

      const ocrText = ocrRes.data.text;
      if (!ocrText?.trim()) {
        window.electron.updateOverlay({ overlayId, status: 'done', text: 'No text detected.' });
        return;
      }

      window.electron.updateOverlay({ overlayId, status: 'translating', text: '' });
      console.log('[Capture] Translating (stream)...');

      let response;
      try {
        response = await fetch(`${currentBaseUrl}/translate_stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: ocrText,
            source: currentConfig.source_lang,
            target: currentConfig.target_lang
          })
        });
      } catch (fetchErr) {
        throw fetchErr;
      }

      if (response.status === 503) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData.detail || '';
        if (detail.includes('加载中') || detail.includes('loading')) {
          window.electron.updateOverlay({ overlayId, status: 'translate_loading', text: '' });
          let retryCount = 0;
          const maxRetries = 60;
          while (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            retryCount++;
            try {
              const statusRes = await axios.get(`${currentBaseUrl}/loading_status`);
              if (!statusRes.data.translate?.loading) {
                window.electron.updateOverlay({ overlayId, status: 'translating', text: '' });
                response = await fetch(`${currentBaseUrl}/translate_stream`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    text: ocrText,
                    source: currentConfig.source_lang,
                    target: currentConfig.target_lang
                  })
                });
                if (response.ok) break;
              }
            } catch (retryErr) {
              // 继续等待
            }
          }
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Translation failed: ${response.status}`);
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
              if (parsed.status === 'connected') {
                continue;
              }
              if (parsed.error) {
                console.error('[Translate] Stream error:', parsed.error);
                continue;
              }
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
  }, []);

  // 监听截图结果
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
      }, { isSwap: true, showNotif: true });
    };
    window.electron.onSwapLanguages(handleSwap);
    return () => window.electron.removeOnSwapLanguages(handleSwap);
  }, [isSnipping, isOverlay, handleConfigChange]);

  // 保存配置
  const handleSaveConfig = async () => {
    try {
      await axios.post(`${baseUrl}/config`, config);
      setShowSettings(false);

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
      loadingStatus={loadingStatus}
      onOpenSettings={() => setShowSettings(true)}
      onOpenLogs={() => setShowLogs(true)}
      isModelLoading={isModelLoading}
      loadingMessage={loadingMessage}
    />
  );
};

export default App;
