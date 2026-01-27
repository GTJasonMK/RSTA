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

// 读取项目配置文件
function loadProjectConfig() {
  const configPath = path.join(__dirname, '../../config.json');
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.error('Failed to load config.json:', e.message);
  }
  // 返回默认配置
  return {
    hotkey: 'Ctrl+Alt+Q',
    swap_hotkey: 'Ctrl+Alt+A',
    close_overlay_hotkey: 'Escape'
  };
}

// 将配置文件格式的快捷键转换为 Electron 格式
function convertHotkeyToElectron(hotkey) {
  if (!hotkey) return null;
  // 将 Ctrl 替换为 CommandOrControl 以支持 Mac
  return hotkey
    .replace(/Ctrl/gi, 'CommandOrControl')
    .replace(/\+/g, '+');
} 

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
    // 初始化任务栏窗口图标（使用默认语言）
    updateWindowIcon(currentSourceLang, currentTargetLang);
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
  const projectConfig = loadProjectConfig();
  return {
    serverPort: CONFIG.serverPort,
    ui: projectConfig.ui || {},
    hotkey: projectConfig.hotkey,
    swap_hotkey: projectConfig.swap_hotkey,
    close_overlay_hotkey: projectConfig.close_overlay_hotkey
  };
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

// 语言代码到显示文字的映射（简短易读）
const LANG_DISPLAY = {
  'en': 'EN',
  'zh': '中',
  'zh-cn': '中',
  'zh-hans': '中',
  'zh-hant': '繁',
  'ja': '日',
  'ko': '韩',
  'fr': 'FR',
  'de': 'DE',
  'es': 'ES',
  'ru': 'RU',
  'pt': 'PT',
  'it': 'IT',
  'vi': 'VI',
};

// 当前语言状态
let currentSourceLang = 'en';
let currentTargetLang = 'zh';

// 创建带语言文字的托盘图标
function createLanguageIcon(sourceLang, targetLang) {
  const { nativeImage } = require('electron');

  // 获取显示文字
  const srcText = LANG_DISPLAY[sourceLang?.toLowerCase()] || sourceLang?.toUpperCase()?.slice(0, 2) || '??';
  const tgtText = LANG_DISPLAY[targetLang?.toLowerCase()] || targetLang?.toUpperCase()?.slice(0, 2) || '??';

  // 使用 32x32 尺寸以获得更好的可读性
  const size = 32;
  const canvas = Buffer.alloc(size * size * 4);

  // 填充深色背景（圆角矩形效果通过边缘透明实现）
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // 圆角效果：边角透明
      const cornerRadius = 4;
      const inCorner = (
        (x < cornerRadius && y < cornerRadius && Math.sqrt((cornerRadius - x) ** 2 + (cornerRadius - y) ** 2) > cornerRadius) ||
        (x >= size - cornerRadius && y < cornerRadius && Math.sqrt((x - (size - cornerRadius - 1)) ** 2 + (cornerRadius - y) ** 2) > cornerRadius) ||
        (x < cornerRadius && y >= size - cornerRadius && Math.sqrt((cornerRadius - x) ** 2 + (y - (size - cornerRadius - 1)) ** 2) > cornerRadius) ||
        (x >= size - cornerRadius && y >= size - cornerRadius && Math.sqrt((x - (size - cornerRadius - 1)) ** 2 + (y - (size - cornerRadius - 1)) ** 2) > cornerRadius)
      );

      if (inCorner) {
        canvas[idx + 3] = 0; // 透明
      } else {
        // 深灰色背景
        canvas[idx] = 45;      // R
        canvas[idx + 1] = 45;  // G
        canvas[idx + 2] = 48;  // B
        canvas[idx + 3] = 255; // A
      }
    }
  }

  // 简单的像素字体绘制函数（3x5 像素字体）
  const font3x5 = {
    'E': [[1,1,1],[1,0,0],[1,1,0],[1,0,0],[1,1,1]],
    'N': [[1,0,1],[1,1,1],[1,1,1],[1,0,1],[1,0,1]],
    'F': [[1,1,1],[1,0,0],[1,1,0],[1,0,0],[1,0,0]],
    'R': [[1,1,0],[1,0,1],[1,1,0],[1,0,1],[1,0,1]],
    'D': [[1,1,0],[1,0,1],[1,0,1],[1,0,1],[1,1,0]],
    'S': [[0,1,1],[1,0,0],[0,1,0],[0,0,1],[1,1,0]],
    'P': [[1,1,0],[1,0,1],[1,1,0],[1,0,0],[1,0,0]],
    'I': [[1,1,1],[0,1,0],[0,1,0],[0,1,0],[1,1,1]],
    'T': [[1,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0]],
    'V': [[1,0,1],[1,0,1],[1,0,1],[0,1,0],[0,1,0]],
    'U': [[1,0,1],[1,0,1],[1,0,1],[1,0,1],[0,1,0]],
    '?': [[0,1,0],[1,0,1],[0,0,1],[0,1,0],[0,1,0]],
  };

  // 中文字符使用 5x5 简化版
  const fontCJK = {
    '中': [[0,0,1,0,0],[1,1,1,1,1],[1,0,1,0,1],[1,1,1,1,1],[0,0,1,0,0]],
    '繁': [[1,1,1,1,1],[0,1,0,1,0],[1,1,1,1,1],[0,1,0,1,0],[1,0,1,0,1]],
    '日': [[1,1,1,1,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,1,1,1,1]],
    '韩': [[1,0,1,0,1],[1,1,1,1,1],[0,0,1,0,0],[1,1,1,1,1],[1,0,0,0,1]],
  };

  // 绘制像素的辅助函数
  function drawPixel(x, y, r, g, b) {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      const idx = (y * size + x) * 4;
      canvas[idx] = r;
      canvas[idx + 1] = g;
      canvas[idx + 2] = b;
      canvas[idx + 3] = 255;
    }
  }

  // 绘制字符
  function drawChar(char, startX, startY, r, g, b, scale = 2) {
    let charData = font3x5[char.toUpperCase()];
    let charWidth = 3;
    let charHeight = 5;

    // 检查是否是 CJK 字符
    if (fontCJK[char]) {
      charData = fontCJK[char];
      charWidth = 5;
      charHeight = 5;
    }

    if (!charData) {
      charData = font3x5['?'];
    }

    for (let cy = 0; cy < charHeight; cy++) {
      for (let cx = 0; cx < charWidth; cx++) {
        if (charData[cy][cx]) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              drawPixel(startX + cx * scale + sx, startY + cy * scale + sy, r, g, b);
            }
          }
        }
      }
    }
    return charWidth * scale;
  }

  // 绘制字符串
  function drawString(str, startX, startY, r, g, b, scale = 2) {
    let x = startX;
    for (const char of str) {
      const charWidth = drawChar(char, x, startY, r, g, b, scale);
      x += charWidth + scale; // 字符间距
    }
    return x - startX - scale; // 返回总宽度
  }

  // 计算字符串宽度
  function measureString(str, scale = 2) {
    let width = 0;
    for (const char of str) {
      const isCJK = !!fontCJK[char];
      const charWidth = isCJK ? 5 : 3;
      width += charWidth * scale + scale; // 字符宽度 + 间距
    }
    return width - scale; // 减去最后一个间距
  }

  // 绘制箭头 (简化版)
  function drawArrow(startX, startY, r, g, b) {
    // 横线
    for (let x = 0; x < 6; x++) {
      drawPixel(startX + x, startY, r, g, b);
      drawPixel(startX + x, startY + 1, r, g, b);
    }
    // 箭头尖
    drawPixel(startX + 4, startY - 1, r, g, b);
    drawPixel(startX + 5, startY - 1, r, g, b);
    drawPixel(startX + 4, startY + 2, r, g, b);
    drawPixel(startX + 5, startY + 2, r, g, b);
  }

  // 绘制源语言（上半部分，白色）
  const srcWidth = measureString(srcText, 2);
  const srcX = Math.floor((size - srcWidth) / 2);
  drawString(srcText, srcX, 3, 255, 255, 255, 2);

  // 绘制箭头（中间，橙色）
  drawArrow(13, 15, 245, 158, 11);

  // 绘制目标语言（下半部分，橙色）
  const tgtWidth = measureString(tgtText, 2);
  const tgtX = Math.floor((size - tgtWidth) / 2);
  drawString(tgtText, tgtX, 19, 245, 158, 11, 2);

  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

// 更新托盘图标
function updateTrayIcon(sourceLang, targetLang) {
  if (!tray) return;

  currentSourceLang = sourceLang || currentSourceLang;
  currentTargetLang = targetLang || currentTargetLang;

  const icon = createLanguageIcon(currentSourceLang, currentTargetLang);
  tray.setImage(icon);

  // 更新提示文字
  const srcDisplay = LANG_DISPLAY[currentSourceLang?.toLowerCase()] || currentSourceLang;
  const tgtDisplay = LANG_DISPLAY[currentTargetLang?.toLowerCase()] || currentTargetLang;
  tray.setToolTip(`Screen Translate: ${srcDisplay} -> ${tgtDisplay}`);

  // 同时更新任务栏窗口图标
  updateWindowIcon(currentSourceLang, currentTargetLang);
}

// 更新任务栏窗口图标
function updateWindowIcon(sourceLang, targetLang) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // 使用与托盘相同的图标（32x32 已经足够清晰）
  const icon = createLanguageIcon(sourceLang, targetLang);
  mainWindow.setIcon(icon);
}

// IPC: 更新托盘语言显示
ipcMain.handle('update-tray-language', (event, { source, target }) => {
  updateTrayIcon(source, target);
  return { success: true };
});

function createTray() {
  const { nativeImage } = require('electron');

  // 创建初始图标（使用默认语言）
  const trayIcon = createLanguageIcon(currentSourceLang, currentTargetLang);

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

  tray.setToolTip(`Screen Translate: ${LANG_DISPLAY[currentSourceLang] || currentSourceLang} -> ${LANG_DISPLAY[currentTargetLang] || currentTargetLang}`);
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

  // 从配置文件读取快捷键
  const projectConfig = loadProjectConfig();

  // 注册截图快捷键
  const captureHotkey = convertHotkeyToElectron(projectConfig.hotkey || 'Ctrl+Alt+Q');
  if (captureHotkey) {
    const registered = globalShortcut.register(captureHotkey, () => {
      if (snippingWindow && !snippingWindow.isDestroyed() && !snippingWindow.isVisible()) {
        snippingWindow.show();
        snippingWindow.focus();
      }
    });
    if (registered) {
      console.log('Registered capture hotkey:', captureHotkey);
    } else {
      console.warn('Failed to register capture hotkey:', captureHotkey);
    }
  }

  // 注册互换语言快捷键
  const swapHotkey = convertHotkeyToElectron(projectConfig.swap_hotkey || 'Ctrl+Alt+A');
  if (swapHotkey) {
    const registered = globalShortcut.register(swapHotkey, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('swap-languages');
      }
    });
    if (registered) {
      console.log('Registered swap hotkey:', swapHotkey);
    } else {
      console.warn('Failed to register swap hotkey:', swapHotkey);
    }
  }

  // 注册关闭浮窗快捷键
  const closeOverlayHotkey = convertHotkeyToElectron(projectConfig.close_overlay_hotkey);
  if (closeOverlayHotkey && closeOverlayHotkey.toLowerCase() !== 'escape') {
    // Escape 键在浮窗内部处理，这里只注册非 Escape 的全局快捷键
    const registered = globalShortcut.register(closeOverlayHotkey, () => {
      // 关闭所有浮窗
      overlayWindows.forEach((win, id) => {
        if (win && !win.isDestroyed()) {
          win.close();
        }
      });
      overlayWindows.clear();
      currentOverlayId = null;
    });
    if (registered) {
      console.log('Registered close overlay hotkey:', closeOverlayHotkey);
    } else {
      console.warn('Failed to register close overlay hotkey:', closeOverlayHotkey);
    }
  }
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
