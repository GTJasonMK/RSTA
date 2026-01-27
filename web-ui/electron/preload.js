const { contextBridge, ipcRenderer } = require('electron');

// 存储监听器引用，使用事件名称作为 key
const listeners = new Map();

contextBridge.exposeInMainWorld('electron', {
  // 获取配置
  getConfig: () => ipcRenderer.invoke('get-config'),

  // 截图相关
  startCapture: () => ipcRenderer.invoke('start-capture'),
  cancelCapture: () => ipcRenderer.invoke('cancel-capture'),
  completeCapture: (bounds) => ipcRenderer.invoke('capture-complete', bounds),

  // 监听截图结果 (主进程发送的事件)
  onCaptureResult: (callback) => {
    // 使用事件名称作为 key，确保能正确移除旧监听器
    const eventKey = 'capture-result';
    const existingCallback = listeners.get(eventKey);
    if (existingCallback) {
      ipcRenderer.removeListener(eventKey, existingCallback);
    }
    const wrappedCallback = (event, data) => callback(data);
    listeners.set(eventKey, wrappedCallback);
    ipcRenderer.on(eventKey, wrappedCallback);
  },

  // 移除截图结果监听器 (防止内存泄漏)
  removeOnCaptureResult: () => {
    const eventKey = 'capture-result';
    const wrappedCallback = listeners.get(eventKey);
    if (wrappedCallback) {
      ipcRenderer.removeListener(eventKey, wrappedCallback);
      listeners.delete(eventKey);
    }
  },

  // 浮窗相关
  updateOverlay: (data) => ipcRenderer.invoke('update-overlay', data),
  closeOverlay: () => ipcRenderer.invoke('close-overlay'),
  resizeOverlay: (size) => ipcRenderer.invoke('resize-overlay', size),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  setWindowPosition: (pos) => ipcRenderer.invoke('set-window-position', pos),

  // 监听浮窗更新 (用于 overlay 窗口)
  onOverlayUpdate: (callback) => {
    const eventKey = 'overlay-update';
    const existingCallback = listeners.get(eventKey);
    if (existingCallback) {
      ipcRenderer.removeListener(eventKey, existingCallback);
    }
    const wrappedCallback = (event, data) => callback(data);
    listeners.set(eventKey, wrappedCallback);
    ipcRenderer.on(eventKey, wrappedCallback);
  },

  removeOnOverlayUpdate: () => {
    const eventKey = 'overlay-update';
    const wrappedCallback = listeners.get(eventKey);
    if (wrappedCallback) {
      ipcRenderer.removeListener(eventKey, wrappedCallback);
      listeners.delete(eventKey);
    }
  },

  // 窗口控制
  closeApp: () => ipcRenderer.invoke('close-app'),
  minimizeApp: () => ipcRenderer.invoke('minimize-app'),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // 系统通知
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),

  // 监听快捷键事件
  onSwapLanguages: (callback) => {
    const eventKey = 'swap-languages';
    const existingCallback = listeners.get(eventKey);
    if (existingCallback) {
      ipcRenderer.removeListener(eventKey, existingCallback);
    }
    const wrappedCallback = () => callback();
    listeners.set(eventKey, wrappedCallback);
    ipcRenderer.on(eventKey, wrappedCallback);
  },

  removeOnSwapLanguages: () => {
    const eventKey = 'swap-languages';
    const wrappedCallback = listeners.get(eventKey);
    if (wrappedCallback) {
      ipcRenderer.removeListener(eventKey, wrappedCallback);
      listeners.delete(eventKey);
    }
  },
});
