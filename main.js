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

const PASTE_DIR = path.join(app.getPath('temp'), 'calm-claude-paste');
const PASTE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function ensurePasteDir() {
  try { fs.mkdirSync(PASTE_DIR, { recursive: true }); } catch {}
}
function cleanupPasteDir() {
  try {
    if (!fs.existsSync(PASTE_DIR)) return;
    const now = Date.now();
    for (const name of fs.readdirSync(PASTE_DIR)) {
      const full = path.join(PASTE_DIR, name);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > PASTE_MAX_AGE_MS) fs.unlinkSync(full);
      } catch {}
    }
  } catch {}
}

function extFromMime(mime) {
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
    'image/heic': '.heic',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'text/markdown': '.md',
    'text/html': '.html',
    'application/json': '.json',
    'application/zip': '.zip'
  };
  return map[(mime || '').toLowerCase()] || '';
}

function extFromName(name) {
  if (!name) return '';
  const m = String(name).match(/(\.[a-zA-Z0-9]{1,6})$/);
  return m ? m[1].toLowerCase() : '';
}

function safeBasename(name) {
  if (!name) return '';
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').slice(0, 80);
}

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

function spawnClaudePty(cols, rows, cwd, opts = {}) {
  const command = resolveClaudeExecutable();
  const args = [];
  if (opts.skipPermissions) {
    args.push('--dangerously-skip-permissions');
  }
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
    CLAUDE_CODE_EFFORT_LEVEL: process.env.CLAUDE_CODE_EFFORT_LEVEL || 'max',
    ANTHROPIC_CUSTOM_MODEL_OPTION: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION || 'claude-opus-4-6[1m]',
    ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME || 'Opus 4.6 (1M context)',
    ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION || 'Opus 4.6 with 1M token context window'
  };

  if (isWindows) {
    const bash = resolveGitBashPath();
    if (bash) {
      env.CLAUDE_CODE_GIT_BASH_PATH = bash;
      const bashDir = path.dirname(bash);
      env.PATH = `${bashDir};${env.PATH || env.Path || ''}`;
    }
  }

  return pty.spawn(command, args, {
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
  mainWindow.on('focus', () => {
    try { mainWindow.flashFrame(false); } catch {}
    mainWindow.webContents.send('window:focus', true);
  });
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
  ensurePasteDir();
  cleanupPasteDir();
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
ipcMain.handle('window:isFocused', () => mainWindow?.isFocused() ?? false);
ipcMain.handle('window:flash', () => {
  if (mainWindow && !mainWindow.isFocused()) {
    try { mainWindow.flashFrame(true); } catch {}
  }
});
ipcMain.handle('window:focus', () => {
  if (!mainWindow) return;
  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.flashFrame(false);
  } catch {}
});

ipcMain.handle('pty:start', (_evt, { tabId, cols, rows, cwd, skipPermissions } = {}) => {
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
    p = spawnClaudePty(cols, rows, cwd, { skipPermissions });
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

ipcMain.handle('paste:saveFile', (_evt, { data, mime, suggestedName } = {}) => {
  if (!data) return { ok: false, error: 'no data' };
  ensurePasteDir();
  const nameExt = extFromName(suggestedName);
  const mimeExt = extFromMime(mime);
  const ext = nameExt || mimeExt || '.bin';
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const baseRaw = suggestedName ? suggestedName.replace(/\.[^.]+$/, '') : 'pasted';
  const base = safeBasename(baseRaw) || 'pasted';
  const name = `${base}-${stamp}-${rand}${ext}`;
  const full = path.join(PASTE_DIR, name);
  try {
    const buf = Buffer.from(data);
    fs.writeFileSync(full, buf);
    return { ok: true, path: full };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

function copyToPasteDir(srcPath) {
  ensurePasteDir();
  const base = path.basename(srcPath);
  const ext = extFromName(base) || '';
  const stem = base.replace(/\.[^.]+$/, '') || 'file';
  const safe = safeBasename(stem) || 'file';
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  const dest = path.join(PASTE_DIR, `${safe}-${stamp}-${rand}${ext}`);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

ipcMain.handle('paste:copyPaths', (_evt, paths) => {
  if (!Array.isArray(paths)) return [];
  const out = [];
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p) && fs.statSync(p).isFile()) {
        out.push(copyToPasteDir(p));
      }
    } catch {}
  }
  return out;
});

ipcMain.handle('clipboard:read', () => {
  const { clipboard } = require('electron');
  const result = { kind: 'none', text: null, filePath: null, filePaths: [], debug: [] };

  function parseDropfiles(buf) {
    if (!buf || buf.length < 22) return [];
    try {
      const pFiles = buf.readUInt32LE(0);
      const fWide = buf.readUInt32LE(16);
      if (pFiles < 20 || pFiles >= buf.length) return [];
      const paths = [];
      if (fWide) {
        let i = pFiles, start = i;
        while (i + 1 < buf.length) {
          if (buf.readUInt16LE(i) === 0) {
            if (i > start) paths.push(buf.slice(start, i).toString('utf16le'));
            else break;
            i += 2; start = i;
          } else i += 2;
        }
      } else {
        let i = pFiles, start = i;
        while (i < buf.length) {
          if (buf[i] === 0) {
            if (i > start) paths.push(buf.slice(start, i).toString('ascii'));
            else break;
            i += 1; start = i;
          } else i += 1;
        }
      }
      return paths.filter(Boolean);
    } catch { return []; }
  }

  try {
    if (process.platform === 'win32') {
      const candidates = ['CF_HDROP', 'FileNameW', 'FileName', 'FileGroupDescriptorW'];
      for (const fmt of candidates) {
        try {
          const buf = clipboard.readBuffer(fmt);
          result.debug.push(`${fmt}=${buf?.length || 0}`);
          if (buf && buf.length > 0) {
            if (fmt === 'CF_HDROP') {
              const paths = parseDropfiles(buf);
              if (paths.length) {
                result.kind = 'files';
                result.filePaths = paths;
                return result;
              }
            } else if (fmt === 'FileNameW') {
              const s = buf.toString('utf16le').replace(/\0+$/, '');
              if (s) { result.kind = 'files'; result.filePaths = [s]; return result; }
            } else if (fmt === 'FileName') {
              const s = buf.toString('ascii').replace(/\0+$/, '');
              if (s) { result.kind = 'files'; result.filePaths = [s]; return result; }
            }
          }
        } catch (e) { result.debug.push(`${fmt}:err`); }
      }

      try {
        const uriList = clipboard.read('text/uri-list');
        result.debug.push(`uri-list.len=${uriList?.length || 0}`);
        if (uriList) {
          const paths = uriList.split(/\r?\n/)
            .map(s => s.trim())
            .filter(s => s && !s.startsWith('#'))
            .map(s => {
              if (s.startsWith('file:///')) {
                try { return decodeURIComponent(s.replace(/^file:\/\/\//, '').replace(/\//g, '\\')); }
                catch { return null; }
              }
              return s;
            })
            .filter(Boolean);
          if (paths.length) { result.kind = 'files'; result.filePaths = paths; return result; }
        }
      } catch { result.debug.push('uri-list:err'); }
    }

    try {
      const img = clipboard.readImage();
      const empty = img.isEmpty();
      const size = empty ? { width: 0, height: 0 } : img.getSize();
      result.debug.push(`img=${size.width}x${size.height}`);
      if (!empty && size.width > 0 && size.height > 0) {
        const buf = img.toPNG();
        if (buf && buf.length > 100) {
          ensurePasteDir();
          const name = `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
          const full = path.join(PASTE_DIR, name);
          fs.writeFileSync(full, buf);
          result.kind = 'image';
          result.filePath = full;
          return result;
        }
      }
    } catch (e) { result.debug.push(`img:err=${e.message}`); }

    try {
      const text = clipboard.readText();
      result.debug.push(`text.len=${text?.length || 0}`);
      if (text) { result.kind = 'text'; result.text = text; }
    } catch (e) { result.debug.push(`text:err=${e.message}`); }
  } catch (e) {
    result.debug.push(`outer:err=${e.message}`);
  }

  return result;
});

ipcMain.handle('paste:clipboardFilePaths', () => {
  try {
    const { clipboard } = require('electron');
    if (process.platform !== 'win32') return [];
    const formats = clipboard.availableFormats();
    if (!formats.includes('CF_HDROP') && !formats.includes('text/uri-list')) return [];
    const buf = clipboard.readBuffer('CF_HDROP');
    if (!buf || buf.length < 20) return [];
    const pFiles = buf.readUInt32LE(0);
    const fWide = buf.readUInt32LE(16);
    const paths = [];
    if (fWide) {
      let i = pFiles;
      let start = i;
      while (i + 1 < buf.length) {
        const code = buf.readUInt16LE(i);
        if (code === 0) {
          if (i > start) {
            paths.push(buf.slice(start, i).toString('utf16le'));
          } else {
            break;
          }
          i += 2;
          start = i;
        } else {
          i += 2;
        }
      }
    } else {
      let i = pFiles;
      let start = i;
      while (i < buf.length) {
        if (buf[i] === 0) {
          if (i > start) {
            paths.push(buf.slice(start, i).toString('ascii'));
          } else {
            break;
          }
          i += 1;
          start = i;
        } else {
          i += 1;
        }
      }
    }
    return paths.filter(Boolean);
  } catch {
    return [];
  }
});

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
