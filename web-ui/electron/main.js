const { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut, Tray, Menu, Notification } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow;
let snippingWindow;
let overlayWindows = new Map(); // 支持多个 overlay 窗口
let currentOverlayId = null; // 当前活动的 overlay ID
let overlayIdCounter = 0;
let tray;
let pythonServerProcess;

// 检测虚拟环境中的 Python
function getBackendPython() {
  const projectRoot = path.join(__dirname, '../..');
  const venvPython = process.platform === 'win32'
    ? path.join(projectRoot, '.venv-hymt-gguf', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv-hymt-gguf', 'bin', 'python');

  if (fs.existsSync(venvPython)) {
    console.log('Using venv Python:', venvPython);
    return venvPython;
  }

  console.log('Using system Python');
  return 'python';
}

const CONFIG = {
  serverPort: 8092,
  pythonScript: path.join(__dirname, '../../scripts/serve_unified.py'),
  pythonExecutable: getBackendPython()
}; 

function createMainWindow() {
  console.log('Creating main window...');
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#FAFAF9',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    console.log('Main window ready to show');
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    console.log('Main window closed');
    mainWindow = null;
  });

  const url = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173'
    : path.join(__dirname, '../dist/index.html');

  console.log('Loading URL:', url, 'NODE_ENV:', process.env.NODE_ENV);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(url);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function createSnippingWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  snippingWindow = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreen: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  const url = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173?mode=snipping'
    : `file://${path.join(__dirname, '../dist/index.html')}?mode=snipping`;

  snippingWindow.loadURL(url);
}

function createOverlayWindow(bounds) {
  // 计算浮窗位置：在选框右侧或下方显示
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;

  // 初始尺寸要足够大，让内容能正确渲染和测量
  const initialWidth = 300;
  const initialHeight = 150;

  const padding = 8;
  let x = bounds.x + bounds.width + padding;
  let y = bounds.y;

  // 如果右侧空间不足，显示在左侧
  if (x + initialWidth > screenWidth) {
    x = Math.max(0, bounds.x - initialWidth - padding);
  }
  // 确保不超出屏幕
  y = Math.max(0, Math.min(y, screenHeight - initialHeight));

  // 创建新的 overlay 窗口
  const overlayId = ++overlayIdCounter;
  currentOverlayId = overlayId;

  const overlayWindow = new BrowserWindow({
    x,
    y,
    width: initialWidth,
    height: initialHeight,
    minWidth: 80,
    minHeight: 28,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    show: false,
    hasShadow: false,
    // 使用几乎透明的颜色而不是完全透明，以便在 Windows 上正确处理点击
    backgroundColor: '#01000000',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  // 存储窗口引用
  overlayWindows.set(overlayId, overlayWindow);

  const url = process.env.NODE_ENV === 'development'
    ? `http://localhost:5173?mode=overlay&id=${overlayId}`
    : `file://${path.join(__dirname, '../dist/index.html')}?mode=overlay&id=${overlayId}`;

  overlayWindow.loadURL(url);

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.show();
  });

  overlayWindow.on('closed', () => {
    overlayWindows.delete(overlayId);
    if (currentOverlayId === overlayId) {
      currentOverlayId = null;
    }
  });

  return overlayId;
}

// 调整浮窗大小
ipcMain.handle('resize-overlay', (event, size) => {
  // 从发送者窗口找到对应的 overlay
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow.isDestroyed()) return;

  const display = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;
  let [x, y] = senderWindow.getPosition();

  // 限制请求的尺寸范围，最大不超过屏幕的 80%
  const maxWidth = Math.floor(screenWidth * 0.8);
  const maxHeight = Math.floor(screenHeight * 0.6);
  const requestedWidth = Math.max(80, Math.min(size.width, maxWidth));
  const requestedHeight = Math.max(28, Math.min(size.height, maxHeight));

  // 检查并调整位置，确保窗口不超出屏幕
  let needsReposition = false;
  if (x + requestedWidth > screenWidth) {
    x = Math.max(0, screenWidth - requestedWidth);
    needsReposition = true;
  }
  if (y + requestedHeight > screenHeight) {
    y = Math.max(0, screenHeight - requestedHeight);
    needsReposition = true;
  }

  // 先调整位置，再设置尺寸
  if (needsReposition) {
    senderWindow.setPosition(x, y);
  }
  senderWindow.setSize(requestedWidth, requestedHeight);
});

// --- Python Server Management ---

function checkServerRunning() {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${CONFIG.serverPort}/health`, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

async function startPythonServerIfNeeded() {
  const isRunning = await checkServerRunning();
  if (isRunning) {
    console.log('Python server already running, skipping startup');
    return;
  }

  console.log('Starting Python server...');
  pythonServerProcess = spawn(CONFIG.pythonExecutable, [CONFIG.pythonScript], {
    env: { ...process.env, PORT: CONFIG.serverPort.toString() }
  });

  pythonServerProcess.stdout.on('data', (data) => {
    console.log(`[Python]: ${data}`);
  });

  pythonServerProcess.stderr.on('data', (data) => {
    console.error(`[Python Error]: ${data}`);
  });
}

// 获取配置供渲染进程使用
ipcMain.handle('get-config', () => {
  return { serverPort: CONFIG.serverPort };
});

// --- IPC Handlers ---

ipcMain.handle('start-capture', async () => {
  if (!snippingWindow) createSnippingWindow();

  // 确保窗口加载完成后再显示，最多等待 5 秒
  if (snippingWindow.webContents.isLoading()) {
    const loadPromise = new Promise(resolve => {
      snippingWindow.webContents.once('did-finish-load', resolve);
    });
    const timeoutPromise = new Promise(resolve => setTimeout(resolve, 5000));
    await Promise.race([loadPromise, timeoutPromise]);
  }

  snippingWindow.show();
  snippingWindow.focus();
});

ipcMain.handle('cancel-capture', () => {
  if (snippingWindow) {
    snippingWindow.hide();
  }
});

ipcMain.handle('capture-complete', async (event, bounds) => {
  // 隐藏截图窗口
  if (snippingWindow) {
    snippingWindow.hide();
  }

  // 截取屏幕
  const primaryDisplay = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: primaryDisplay.size
  });
  const source = sources[0];

  if (!source) {
    console.error('No screen source found');
    return { success: false, error: 'No screen source found' };
  }

  const captureData = {
    image: source.thumbnail.toDataURL(),
    bounds: bounds
  };

  // 创建并显示浮窗，返回 overlay ID
  const overlayId = createOverlayWindow(bounds);

  // 发送数据到主窗口进行处理，包含 overlayId
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('capture-result', { ...captureData, overlayId });
  }

  return { success: true, overlayId };
});

// 更新浮窗内容
ipcMain.handle('update-overlay', (event, data) => {
  // 使用指定的 overlayId，或者当前活动的 overlay
  const overlayId = data.overlayId || currentOverlayId;
  const overlayWindow = overlayWindows.get(overlayId);

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // 在更新内容前先把窗口设置大，让内容能正确渲染和测量
    if (data.status === 'done' || data.text) {
      overlayWindow.setSize(300, 150);
    }
    // 确保窗口已加载完成
    if (overlayWindow.webContents.isLoading()) {
      overlayWindow.webContents.once('did-finish-load', () => {
        overlayWindow.webContents.send('overlay-update', data);
      });
    } else {
      overlayWindow.webContents.send('overlay-update', data);
    }
  }
});

// 关闭浮窗
ipcMain.handle('close-overlay', (event, data) => {
  // 从发送者窗口找到对应的 overlay 并关闭
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && !senderWindow.isDestroyed()) {
    senderWindow.close();
  }
});

// 获取窗口位置（用于拖动）
ipcMain.handle('get-window-position', (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && !senderWindow.isDestroyed()) {
    const [x, y] = senderWindow.getPosition();
    console.log('[IPC] get-window-position:', { x, y });
    return { x, y };
  }
  console.log('[IPC] get-window-position: window not found');
  return { x: 0, y: 0 };
});

// 设置窗口位置（用于拖动）
ipcMain.handle('set-window-position', (event, { x, y }) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && !senderWindow.isDestroyed()) {
    console.log('[IPC] set-window-position:', { x, y });
    senderWindow.setPosition(Math.round(x), Math.round(y));
    return { success: true };
  }
  console.log('[IPC] set-window-position: window not found');
  return { success: false };
});

ipcMain.handle('close-app', () => {
  // 关闭窗口时隐藏到托盘
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
});

ipcMain.handle('quit-app', () => {
  app.quit();
});

ipcMain.handle('minimize-app', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

// 显示系统通知
ipcMain.handle('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title || 'Screen Translate',
      body: body || '',
      silent: true
    });
    notification.show();
    return { success: true };
  }
  return { success: false, error: 'Notifications not supported' };
});

// --- Tray ---

function createTray() {
  // 使用简单的图标路径，如果没有图标文件则创建一个简单的图标
  const iconPath = path.join(__dirname, '../assets/icon.png');
  const { nativeImage } = require('electron');

  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      throw new Error('Icon file is empty or invalid');
    }
  } catch (e) {
    // 创建一个 16x16 的简单橙色圆形图标
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const dx = x - size / 2;
        const dy = y - size / 2;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < size / 2 - 1) {
          // 橙色填充 (RGBA)
          canvas[idx] = 245;     // R
          canvas[idx + 1] = 158; // G
          canvas[idx + 2] = 11;  // B
          canvas[idx + 3] = 255; // A
        } else {
          // 透明
          canvas[idx + 3] = 0;
        }
      }
    }
    trayIcon = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Capture (Ctrl+Alt+Q)',
      click: () => {
        if (snippingWindow) {
          snippingWindow.show();
          snippingWindow.focus();
        }
      }
    },
    {
      label: 'Swap Languages (Ctrl+Alt+A)',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('swap-languages');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Screen Translate');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// --- App Lifecycle ---

app.whenReady().then(async () => {
  await startPythonServerIfNeeded();
  createMainWindow();
  createSnippingWindow();
  createTray();

  // 快捷键：Ctrl+Alt+Q = 截图
  globalShortcut.register('CommandOrControl+Alt+Q', () => {
    if (snippingWindow && !snippingWindow.isDestroyed() && !snippingWindow.isVisible()) {
      snippingWindow.show();
      snippingWindow.focus();
    }
  });

  // 快捷键：Ctrl+Alt+A = 互换语言
  globalShortcut.register('CommandOrControl+Alt+A', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('swap-languages');
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (pythonServerProcess) {
    pythonServerProcess.kill();
  }
});

app.on('window-all-closed', () => {
  // 不退出，保持在托盘
});
