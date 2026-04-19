const $ = (s) => document.querySelector(s);

/* ============ Window controls ============ */
$('#tl-close').addEventListener('click', () => api.window.close());
$('#tl-min').addEventListener('click', () => api.window.minimize());
$('#tl-max').addEventListener('click', () => api.window.maximize());

/* ============ Working directory ============ */
const CWD_KEY = 'calm-claude:cwd';
let homeDir = null;
let currentCwd = localStorage.getItem(CWD_KEY) || null;

function prettyPath(p) {
  if (!p) return '~';
  if (homeDir && (p === homeDir || p.toLowerCase() === homeDir.toLowerCase())) return '~';
  if (homeDir && p.toLowerCase().startsWith(homeDir.toLowerCase() + '\\')) {
    return '~\\' + p.slice(homeDir.length + 1);
  }
  if (homeDir && p.toLowerCase().startsWith(homeDir.toLowerCase() + '/')) {
    return '~/' + p.slice(homeDir.length + 1);
  }
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return '…/' + parts.slice(-2).join('/');
}

function renderFolderPill() {
  $('#folder-name').textContent = prettyPath(currentCwd);
  $('#folder-pill').title = currentCwd ? `Working in: ${currentCwd}\nClick to change` : 'Choose working directory';
}

api.window.onFocus((focused) => {
  document.body.classList.toggle('win-focused', !!focused);
});
api.window.isMaximized().then((m) => {
  document.body.classList.toggle('win-focused', true);
});

/* ============ Toast ============ */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ============ Theme palettes ============ */
const THEMES = {
  light: {
    background: 'rgba(0,0,0,0)',
    foreground: '#2a2330',
    cursor: '#a67847',
    cursorAccent: '#f6efe6',
    selectionBackground: 'rgba(150, 120, 180, 0.35)',
    black: '#3a3340',
    red: '#c04a3e',
    green: '#6b8e4a',
    yellow: '#c89a6b',
    blue: '#6b7fa8',
    magenta: '#a07aa8',
    cyan: '#5a8a95',
    white: '#e8dfd1',
    brightBlack: '#6b6378',
    brightRed: '#d97f6a',
    brightGreen: '#8eaa63',
    brightYellow: '#d4b07a',
    brightBlue: '#8aa0c2',
    brightMagenta: '#b898c0',
    brightCyan: '#7aa8b2',
    brightWhite: '#faf5ef'
  },
  dark: {
    background: 'rgba(0,0,0,0)',
    foreground: '#e8dfd1',
    cursor: '#e8be8a',
    cursorAccent: '#1a1520',
    selectionBackground: 'rgba(200, 170, 220, 0.28)',
    black: '#3a3340',
    red: '#e88273',
    green: '#a8c78a',
    yellow: '#e8c088',
    blue: '#9ab0d2',
    magenta: '#c5a5cd',
    cyan: '#88b5c0',
    white: '#e8dfd1',
    brightBlack: '#7a7288',
    brightRed: '#f59e8a',
    brightGreen: '#c2dca0',
    brightYellow: '#f0d3a0',
    brightBlue: '#b0c5e0',
    brightMagenta: '#d8bde0',
    brightCyan: '#a8cfd8',
    brightWhite: '#faf5ef'
  }
};

const THEME_KEY = 'calm-claude:theme';
function getTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === 'dark' ? 'dark' : 'light';
}
function applyTheme(name) {
  document.body.setAttribute('data-theme', name);
  localStorage.setItem(THEME_KEY, name);
  if (window.__term) {
    window.__term.options.theme = THEMES[name];
  }
}
applyTheme(getTheme());

/* ============ xterm init ============ */
const term = new Terminal({
  fontFamily: '"SF Mono", "Menlo", "Cascadia Mono", "Consolas", ui-monospace, monospace',
  fontSize: 13,
  lineHeight: 1.25,
  letterSpacing: 0,
  cursorBlink: true,
  cursorStyle: 'bar',
  cursorWidth: 2,
  allowProposedApi: true,
  allowTransparency: true,
  scrollback: 5000,
  macOptionIsMeta: true,
  theme: THEMES[getTheme()]
});
window.__term = term;

const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
try {
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();
  term.loadAddon(webLinksAddon);
} catch {}

term.open($('#terminal'));

/* ============ Copy / paste ============ */
async function copySelection() {
  const sel = term.getSelection();
  if (!sel) return false;
  try {
    await navigator.clipboard.writeText(sel);
    toast('Copied');
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = sel;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Copied');
      return true;
    } catch {
      return false;
    }
  }
}

async function pasteClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) term.paste(text);
  } catch {}
}

term.attachCustomKeyEventHandler((e) => {
  if (e.type !== 'keydown') return true;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return true;

  const key = e.key.toLowerCase();

  if (key === 'c' && e.shiftKey) {
    copySelection();
    return false;
  }
  if (key === 'c' && !e.shiftKey) {
    if (term.hasSelection()) {
      copySelection();
      term.clearSelection();
      return false;
    }
    return true;
  }
  if (key === 'v') {
    pasteClipboard();
    return false;
  }
  if (key === 'a' && e.shiftKey) {
    term.selectAll();
    return false;
  }
  return true;
});

$('#terminal').addEventListener('contextmenu', async (e) => {
  e.preventDefault();
  if (term.hasSelection()) {
    await copySelection();
    term.clearSelection();
  } else {
    await pasteClipboard();
  }
});

function fit() {
  try {
    fitAddon.fit();
    api.pty.resize(term.cols, term.rows);
  } catch {}
}

requestAnimationFrame(async () => {
  homeDir = await api.env.home();
  if (!currentCwd) currentCwd = homeDir;
  renderFolderPill();
  fit();
  start();
});

window.addEventListener('resize', () => {
  clearTimeout(window.__fitTimer);
  window.__fitTimer = setTimeout(fit, 50);
});

const ro = new ResizeObserver(() => {
  clearTimeout(window.__fitTimer);
  window.__fitTimer = setTimeout(fit, 50);
});
ro.observe($('#terminal'));

/* ============ PTY wire-up ============ */
api.pty.onData((data) => {
  term.write(data);
});

api.pty.onExit(({ exitCode }) => {
  term.write(`\r\n\x1b[2m[session ended${exitCode != null ? ` · exit ${exitCode}` : ''}]\x1b[0m\r\n`);
});

term.onData((data) => {
  api.pty.write(data);
});

async function start() {
  const res = await api.pty.start({ cols: term.cols, rows: term.rows, cwd: currentCwd });
  if (!res || !res.ok) {
    term.write(`\r\n\x1b[31mCould not launch claude.\x1b[0m\r\n`);
  }
}

async function changeFolder() {
  const picked = await api.dialog.pickFolder(currentCwd);
  if (!picked || picked === currentCwd) return;
  currentCwd = picked;
  localStorage.setItem(CWD_KEY, currentCwd);
  renderFolderPill();
  await api.pty.kill();
  term.clear();
  term.reset();
  toast(`Switched to ${prettyPath(currentCwd)}`);
  setTimeout(() => start(), 120);
}

$('#folder-pill').addEventListener('click', changeFolder);

/* ============ Theme toggle ============ */
$('#theme-toggle').addEventListener('click', () => {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast(next === 'dark' ? 'Dark' : 'Light');
});

/* ============ Restart ============ */
$('#restart').addEventListener('click', async () => {
  await api.pty.kill();
  term.clear();
  term.reset();
  toast('Restarting Claude…');
  setTimeout(() => start(), 150);
});

/* ============ Keyboard shortcuts ============ */
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
    e.preventDefault();
    term.clear();
  }
  if (mod && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
    e.preventDefault();
    $('#restart').click();
  }
  if (mod && e.shiftKey && (e.key === 'T' || e.key === 't')) {
    e.preventDefault();
    $('#theme-toggle').click();
  }
});

term.focus();

/* ============ Auto-update notifications ============ */
api.updater.onAvailable((info) => {
  toast(`Update ${info?.version ? 'v' + info.version : ''} downloading…`);
});
api.updater.onReady((info) => {
  const banner = document.createElement('div');
  banner.className = 'update-banner show';
  banner.innerHTML = `
    <span>Update ${info?.version ? 'v' + info.version : ''} ready.</span>
    <button class="ub-btn" id="ub-install">Restart & install</button>
    <button class="ub-btn ub-later" id="ub-later">Later</button>
  `;
  document.body.appendChild(banner);
  $('#ub-install').addEventListener('click', () => api.updater.install());
  $('#ub-later').addEventListener('click', () => banner.remove());
});
api.updater.onError((msg) => {
  console.warn('updater error:', msg);
});
