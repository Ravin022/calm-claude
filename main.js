const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {}

let pty;
let ptyLoadError = null;
try {
  pty = require('node-pty');
} catch (err) {
  ptyLoadError = err;
}

let mainWindow;
let splashWindow;
const ptyProcesses = new Map();

const isWindows = process.platform === 'win32';
const ICON_PATH = path.join(__dirname, 'build', 'icon.png');
const ICON_ICO_PATH = path.join(__dirname, 'build', 'icon.ico');

function getWindowIcon() {
  if (isWindows && fs.existsSync(ICON_ICO_PATH)) return ICON_ICO_PATH;
  if (fs.existsSync(ICON_PATH)) return ICON_PATH;
  return undefined;
}

if (isWindows) app.setAppUserModelId('com.ravin.calmclaude');

function resolveClaudeExecutable() {
  const home = os.homedir();
  const candidates = isWindows
    ? [
        path.join(home, '.local', 'bin', 'claude.exe'),
        path.join(home, '.local', 'bin', 'claude.cmd'),
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        'claude.exe',
        'claude'
      ]
    : [
        path.join(home, '.local', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        'claude'
      ];

  for (const c of candidates) {
    if (path.isAbsolute(c)) {
      if (fs.existsSync(c)) return c;
    } else {
      return c;
    }
  }
  return 'claude';
}

function resolveGitBashPath() {
  if (!isWindows) return null;
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH && fs.existsSync(process.env.CLAUDE_CODE_GIT_BASH_PATH)) {
    return process.env.CLAUDE_CODE_GIT_BASH_PATH;
  }
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    path.join(programFiles, 'Git', 'bin', 'bash.exe'),
    path.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe'),
    path.join(home, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function spawnClaudePty(cols, rows, cwd) {
  const command = resolveClaudeExecutable();
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3'
  };

  if (isWindows) {
    const bash = resolveGitBashPath();
    if (bash) {
      env.CLAUDE_CODE_GIT_BASH_PATH = bash;
      const bashDir = path.dirname(bash);
      env.PATH = `${bashDir};${env.PATH || env.Path || ''}`;
    }
  }

  return pty.spawn(command, [], {
    name: 'xterm-256color',
    cols: cols || 120,
    rows: rows || 30,
    cwd: cwd || os.homedir(),
    env,
    useConpty: true
  });
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 380,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    show: false,
    icon: getWindowIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  splashWindow.loadFile('renderer/splash.html');
  splashWindow.once('ready-to-show', () => splashWindow.show());
  splashWindow.on('closed', () => { splashWindow = null; });
}

function closeSplash() {
  if (!splashWindow) return;
  try {
    splashWindow.webContents.send('__splash__', 'fade-out');
    splashWindow.webContents.executeJavaScript("document.body.classList.add('out')").catch(() => {});
  } catch {}
  setTimeout(() => {
    if (splashWindow) {
      try { splashWindow.close(); } catch {}
      splashWindow = null;
    }
  }, 280);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#f5efe7',
    show: false,
    icon: getWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('renderer/index.html');
  mainWindow.once('ready-to-show', () => {
    const MIN_SPLASH_MS = 900;
    const elapsed = Date.now() - (global.__splashShownAt || Date.now());
    const wait = Math.max(0, MIN_SPLASH_MS - elapsed);
    setTimeout(() => {
      mainWindow.show();
      closeSplash();
    }, wait);
  });

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') mainWindow.webContents.toggleDevTools();
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:state', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:state', { maximized: false }));
  mainWindow.on('focus', () => mainWindow.webContents.send('window:focus', true));
  mainWindow.on('blur', () => mainWindow.webContents.send('window:focus', false));

  mainWindow.on('closed', () => {
    for (const [, p] of ptyProcesses) {
      try { p.kill(); } catch {}
    }
    ptyProcesses.clear();
    mainWindow = null;
  });
}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', info);
  });
  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update:none');
  });
  autoUpdater.on('download-progress', (p) => {
    mainWindow?.webContents.send('update:progress', p);
  });
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update:ready', info);
  });
  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update:error', String(err?.message || err));
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4000);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  global.__splashShownAt = Date.now();
  createSplash();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      global.__splashShownAt = Date.now();
      createSplash();
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

ipcMain.handle('pty:start', (_evt, { tabId, cols, rows, cwd } = {}) => {
  if (!tabId) return { ok: false, error: 'tabId required' };

  if (ptyLoadError) {
    const msg = `\r\n\x1b[31mnode-pty failed to load: ${ptyLoadError.message}\x1b[0m\r\n`;
    mainWindow?.webContents.send('pty:data', { tabId, data: msg });
    return { ok: false, error: ptyLoadError.message };
  }

  const existing = ptyProcesses.get(tabId);
  if (existing) {
    try { existing.kill(); } catch {}
    ptyProcesses.delete(tabId);
  }

  let p;
  try {
    p = spawnClaudePty(cols, rows, cwd);
  } catch (err) {
    const msg = `\r\n\x1b[31mFailed to start claude: ${err.message}\x1b[0m\r\n\x1b[2mIs the claude CLI installed and on PATH?\x1b[0m\r\n`;
    mainWindow?.webContents.send('pty:data', { tabId, data: msg });
    return { ok: false, error: err.message };
  }

  ptyProcesses.set(tabId, p);

  p.onData((data) => {
    mainWindow?.webContents.send('pty:data', { tabId, data });
  });

  p.onExit(({ exitCode, signal }) => {
    mainWindow?.webContents.send('pty:exit', { tabId, exitCode, signal });
    ptyProcesses.delete(tabId);
  });

  return { ok: true, pid: p.pid };
});

ipcMain.on('pty:write', (_evt, { tabId, data }) => {
  const p = ptyProcesses.get(tabId);
  if (p) {
    try { p.write(data); } catch {}
  }
});

ipcMain.on('pty:resize', (_evt, { tabId, cols, rows }) => {
  const p = ptyProcesses.get(tabId);
  if (p && cols > 0 && rows > 0) {
    try { p.resize(cols, rows); } catch {}
  }
});

ipcMain.handle('dialog:pickFolder', async (_evt, startPath) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose working directory',
    defaultPath: startPath && fs.existsSync(startPath) ? startPath : os.homedir(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('env:home', () => os.homedir());

ipcMain.handle('update:install', () => {
  if (autoUpdater) {
    try { autoUpdater.quitAndInstall(false, true); } catch {}
  }
});

ipcMain.handle('update:check', async () => {
  if (!autoUpdater || !app.isPackaged) return { ok: false, reason: 'dev' };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: r?.updateInfo || null };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
});

ipcMain.handle('pty:kill', (_evt, { tabId } = {}) => {
  if (tabId) {
    const p = ptyProcesses.get(tabId);
    if (p) {
      try { p.kill(); } catch {}
      ptyProcesses.delete(tabId);
      return true;
    }
    return false;
  }
  for (const [, p] of ptyProcesses) {
    try { p.kill(); } catch {}
  }
  ptyProcesses.clear();
  return true;
});
