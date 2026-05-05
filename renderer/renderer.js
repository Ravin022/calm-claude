const $ = (s) => document.querySelector(s);

/* ============ Window controls ============ */
$('#tl-close').addEventListener('click', () => api.window.close());
$('#tl-min').addEventListener('click', () => api.window.minimize());
$('#tl-max').addEventListener('click', () => api.window.maximize());

let windowFocused = true;
api.window.onFocus((focused) => {
  windowFocused = !!focused;
  document.body.classList.toggle('win-focused', !!focused);
});
api.window.isMaximized().then(() => {
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

/* ============ Paths ============ */
const CWD_KEY = 'calm-claude:cwd';
const RECENT_KEY = 'calm-claude:recent';
const MAX_RECENT = 6;
let homeDir = null;

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function pushRecent(p) {
  if (!p) return;
  const list = getRecent().filter(x => x.toLowerCase() !== p.toLowerCase());
  list.unshift(p);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

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

function basename(p) {
  if (!p) return '~';
  if (homeDir && p.toLowerCase() === homeDir.toLowerCase()) return '~';
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

/* ============ Theme ============ */
const THEMES = {
  light: {
    background: 'rgba(0,0,0,0)',
    foreground: '#2a2330',
    cursor: '#a67847',
    cursorAccent: '#f6efe6',
    selectionBackground: 'rgba(150, 120, 180, 0.35)',
    black: '#3a3340', red: '#c04a3e', green: '#6b8e4a', yellow: '#c89a6b',
    blue: '#6b7fa8', magenta: '#a07aa8', cyan: '#5a8a95', white: '#e8dfd1',
    brightBlack: '#6b6378', brightRed: '#d97f6a', brightGreen: '#8eaa63',
    brightYellow: '#d4b07a', brightBlue: '#8aa0c2', brightMagenta: '#b898c0',
    brightCyan: '#7aa8b2', brightWhite: '#faf5ef'
  },
  dark: {
    background: 'rgba(0,0,0,0)',
    foreground: '#e8dfd1',
    cursor: '#e8be8a',
    cursorAccent: '#1a1520',
    selectionBackground: 'rgba(200, 170, 220, 0.28)',
    black: '#3a3340', red: '#e88273', green: '#a8c78a', yellow: '#e8c088',
    blue: '#9ab0d2', magenta: '#c5a5cd', cyan: '#88b5c0', white: '#e8dfd1',
    brightBlack: '#7a7288', brightRed: '#f59e8a', brightGreen: '#c2dca0',
    brightYellow: '#f0d3a0', brightBlue: '#b0c5e0', brightMagenta: '#d8bde0',
    brightCyan: '#a8cfd8', brightWhite: '#faf5ef'
  }
};
const THEME_KEY = 'calm-claude:theme';
function getTheme() {
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}
function applyTheme(name) {
  document.body.setAttribute('data-theme', name);
  localStorage.setItem(THEME_KEY, name);
  for (const t of tabs.values()) {
    t.xterm.options.theme = THEMES[name];
  }
}

/* ============ Tabs ============ */
const tabs = new Map();
let activeTabId = null;
let nextTabId = 1;

const terminalsEl = $('#terminals');
const tabsEl = $('#tabs');

function newTabId() {
  return 't' + (nextTabId++) + '-' + Math.random().toString(36).slice(2, 7);
}

function activeTab() {
  return tabs.get(activeTabId);
}

function createTab(cwd) {
  const id = newTabId();

  const slot = document.createElement('div');
  slot.className = 'term-slot';
  slot.dataset.tabId = id;
  terminalsEl.appendChild(slot);

  const xterm = new Terminal({
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

  const fitAddon = new FitAddon.FitAddon();
  xterm.loadAddon(fitAddon);
  try { xterm.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch {}
  let searchAddon = null;
  try {
    searchAddon = new SearchAddon.SearchAddon();
    xterm.loadAddon(searchAddon);
  } catch {}

  xterm.open(slot);

  xterm.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return true;
    const key = e.key.toLowerCase();
    if (key === 'c' && e.shiftKey) {
      copySelection(xterm);
      return false;
    }
    if (key === 'c' && !e.shiftKey) {
      if (xterm.hasSelection()) {
        copySelection(xterm);
        xterm.clearSelection();
        return false;
      }
      return true;
    }
    if (key === 'a' && e.shiftKey) {
      xterm.selectAll();
      return false;
    }
    return true;
  });

  slot.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (xterm.hasSelection()) {
      await copySelection(xterm);
      xterm.clearSelection();
    } else {
      await pasteClipboard(xterm);
    }
  });

  xterm.onData((data) => {
    api.pty.write(id, data);
  });

  const tab = {
    id, cwd, xterm, fitAddon, searchAddon, slot,
    title: basename(cwd),
    started: false,
    state: 'idle',
    lastDataAt: 0
  };
  tabs.set(id, tab);
  return tab;
}

const MIN_WORKING_MS_FOR_NOTIFY = 3000;

function setTabState(tab, state) {
  if (!tab || tab.state === state) return;
  const prevState = tab.state;
  tab.state = state;
  const btn = tabsEl.querySelector(`.tab[data-tab-id="${tab.id}"]`);
  if (btn) {
    btn.classList.remove('tab-state-working', 'tab-state-waiting', 'tab-state-idle');
    btn.classList.add(`tab-state-${state}`);
  }

  if (state === 'working' && prevState !== 'working') {
    tab.workingSince = Date.now();
  }
  if (prevState === 'working' && state === 'waiting') {
    const dur = tab.workingSince ? Date.now() - tab.workingSince : 0;
    tab.workingSince = 0;
    maybeNotifyTabReady(tab, dur);
  }
}

let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { _audioCtx = null; }
  }
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

function playChime() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [
    { freq: 587.33, delay: 0.00, gain: 0.10 },
    { freq: 880.00, delay: 0.16, gain: 0.08 }
  ];
  for (const { freq, delay, gain: peak } of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t0 = now + delay;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 1.9);
  }
}

let notifStack = null;
function ensureNotifStack() {
  if (notifStack) return notifStack;
  notifStack = document.createElement('div');
  notifStack.className = 'notif-stack';
  document.body.appendChild(notifStack);
  return notifStack;
}

function showCalmBanner(tab) {
  const stack = ensureNotifStack();
  const el = document.createElement('div');
  el.className = 'notif-banner';
  el.innerHTML = `
    <span class="nb-dot" aria-hidden="true"></span>
    <div class="nb-text">
      <span class="nb-title">${escapeHtml(tab.title || 'Session')}</span>
      <span class="nb-sub">Waiting for input</span>
    </div>
    <button class="nb-close" aria-label="Dismiss">×</button>
  `;
  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    el.classList.remove('show');
    setTimeout(() => { try { el.remove(); } catch {} }, 380);
  }
  el.addEventListener('click', (e) => {
    if (e.target.closest('.nb-close')) { dismiss(); return; }
    api.window.focus();
    activateTab(tab.id);
    dismiss();
  });
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(dismiss, 5000);
}

function maybeNotifyTabReady(tab, workingDurationMs) {
  if (!getNotifEnabled()) return;
  if (workingDurationMs < MIN_WORKING_MS_FOR_NOTIFY) return;
  const isCurrent = windowFocused && tab.id === activeTabId;
  if (isCurrent) return;

  playChime();
  showCalmBanner(tab);

  if (!windowFocused) {
    api.window.flash();
    try {
      const n = new Notification('Calm Claude', {
        body: `${tab.title || 'Session'} is waiting for input`,
        silent: true
      });
      n.onclick = () => {
        api.window.focus();
        activateTab(tab.id);
        try { n.close(); } catch {}
      };
    } catch {}
  }
}

setInterval(() => {
  const now = Date.now();
  for (const t of tabs.values()) {
    if (!t.lastDataAt) continue;
    const elapsed = now - t.lastDataAt;
    if (elapsed > 30000) setTabState(t, 'idle');
    else if (elapsed > 1500) setTabState(t, 'waiting');
  }
}, 500);

function fitActive() {
  const t = activeTab();
  if (!t) return;
  try {
    t.fitAddon.fit();
    api.pty.resize(t.id, t.xterm.cols, t.xterm.rows);
  } catch {}
}

function activateTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  activeTabId = id;
  for (const slot of terminalsEl.querySelectorAll('.term-slot')) {
    slot.classList.toggle('active', slot.dataset.tabId === id);
  }
  renderTabBar();
  renderFolderPill();
  requestAnimationFrame(() => {
    fitActive();
    t.xterm.focus();
  });
}

function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  api.pty.kill(id);
  try { t.xterm.dispose(); } catch {}
  t.slot.remove();
  tabs.delete(id);

  if (id === activeTabId) {
    const remaining = [...tabs.keys()];
    if (remaining.length === 0) {
      const fresh = createTab(activeTab()?.cwd || homeDir);
      activateTab(fresh.id);
      startTabPty(fresh);
    } else {
      activateTab(remaining[remaining.length - 1]);
    }
  } else {
    renderTabBar();
  }
}

function renderTabBar() {
  tabsEl.innerHTML = '';
  for (const t of tabs.values()) {
    const btn = document.createElement('button');
    const stateClass = `tab-state-${t.state || 'idle'}`;
    btn.className = `tab ${stateClass}` + (t.id === activeTabId ? ' active' : '');
    btn.dataset.tabId = t.id;
    btn.innerHTML = `<span class="tab-status" aria-hidden="true"></span><span class="tab-title">${escapeHtml(t.title || basename(t.cwd))}</span><span class="tab-close" aria-label="Close tab">×</span>`;
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) {
        closeTab(t.id);
      } else {
        activateTab(t.id);
      }
    });
    btn.addEventListener('auxclick', (e) => {
      if (e.button === 1) { e.preventDefault(); closeTab(t.id); }
    });
    tabsEl.appendChild(btn);
  }
}

async function startTabPty(tab) {
  const res = await api.pty.start({
    tabId: tab.id,
    cols: tab.xterm.cols,
    rows: tab.xterm.rows,
    cwd: tab.cwd,
    skipPermissions: getSkipPerm()
  });
  tab.started = !!(res && res.ok);
  if (!tab.started) {
    tab.xterm.write(`\r\n\x1b[31mCould not launch claude.\x1b[0m\r\n`);
  }
}

async function newTabFlow(cwd) {
  const useCwd = cwd || activeTab()?.cwd || homeDir;
  const t = createTab(useCwd);
  pushRecent(useCwd);
  activateTab(t.id);
  await startTabPty(t);
}

$('#tab-new').addEventListener('click', () => newTabFlow());

/* ============ Clipboard ============ */
async function copySelection(xt) {
  const sel = xt.getSelection();
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
    } catch { return false; }
  }
}
async function pasteClipboard(xt) {
  try {
    const text = await navigator.clipboard.readText();
    if (text) xt.paste(text);
  } catch {}
}

/* ============ PTY wire-up ============ */
api.pty.onData(({ tabId, data }) => {
  const t = tabs.get(tabId);
  if (t) {
    t.xterm.write(data);
    t.lastDataAt = Date.now();
    setTabState(t, 'working');
  }
});

api.pty.onExit(({ tabId, exitCode }) => {
  const t = tabs.get(tabId);
  if (t) {
    t.xterm.write(`\r\n\x1b[2m[session ended${exitCode != null ? ` · exit ${exitCode}` : ''}]\x1b[0m\r\n`);
    setTabState(t, 'idle');
  }
});

/* ============ Fit on resize ============ */
window.addEventListener('resize', () => {
  clearTimeout(window.__fitTimer);
  window.__fitTimer = setTimeout(fitActive, 50);
});

const ro = new ResizeObserver(() => {
  clearTimeout(window.__fitTimer);
  window.__fitTimer = setTimeout(fitActive, 50);
});
ro.observe($('#terminals'));

/* ============ Folder pill + menu ============ */
function renderFolderPill() {
  const t = activeTab();
  const cwd = t ? t.cwd : null;
  $('#folder-name').textContent = prettyPath(cwd);
  $('#folder-pill').title = cwd ? `Working in: ${cwd}\nClick to change` : 'Choose working directory';
}

async function switchFolderInActiveTab(newCwd) {
  const t = activeTab();
  if (!t || !newCwd || newCwd.toLowerCase() === (t.cwd || '').toLowerCase()) return;
  t.cwd = newCwd;
  t.title = basename(newCwd);
  localStorage.setItem(CWD_KEY, newCwd);
  pushRecent(newCwd);
  renderTabBar();
  renderFolderPill();
  await api.pty.kill(t.id);
  t.xterm.clear();
  t.xterm.reset();
  toast(`Switched to ${prettyPath(newCwd)}`);
  setTimeout(() => startTabPty(t), 120);
}

async function browseFolder() {
  const t = activeTab();
  const picked = await api.dialog.pickFolder(t?.cwd);
  if (picked) await switchFolderInActiveTab(picked);
}

function renderFolderMenu() {
  const menu = $('#folder-menu');
  const cwd = activeTab()?.cwd;
  const recent = getRecent();
  const recentOther = recent.filter(p => p.toLowerCase() !== (cwd || '').toLowerCase());
  let html = '';
  html += `<div class="fm-section-title">Current</div>`;
  html += `<button class="fm-item current" disabled>
    <svg class="fm-icon" viewBox="0 0 16 16"><path d="M1.5 4.5 C1.5 3.7 2.2 3 3 3 L6 3 L7.5 4.5 L13 4.5 C13.8 4.5 14.5 5.2 14.5 6 L14.5 11.5 C14.5 12.3 13.8 13 13 13 L3 13 C2.2 13 1.5 12.3 1.5 11.5 Z" fill="currentColor"/></svg>
    <span class="fm-path">${escapeHtml(prettyPath(cwd))}</span>
  </button>`;
  if (recentOther.length) {
    html += `<div class="fm-divider"></div>`;
    html += `<div class="fm-section-title">Recent</div>`;
    for (const p of recentOther) {
      html += `<button class="fm-item" data-path="${escapeAttr(p)}">
        <svg class="fm-icon" viewBox="0 0 16 16"><path d="M8 1.5 A6.5 6.5 0 1 0 14.5 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M8 4.5 L8 8 L10.5 9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/></svg>
        <span class="fm-path">${escapeHtml(prettyPath(p))}</span>
      </button>`;
    }
  }
  html += `<div class="fm-divider"></div>`;
  html += `<button class="fm-item" id="fm-browse">
    <svg class="fm-icon" viewBox="0 0 16 16"><path d="M1.5 4.5 C1.5 3.7 2.2 3 3 3 L6 3 L7.5 4.5 L13 4.5 C13.8 4.5 14.5 5.2 14.5 6 L14.5 11.5 C14.5 12.3 13.8 13 13 13 L3 13 C2.2 13 1.5 12.3 1.5 11.5 Z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
    <span class="fm-path">Browse…</span>
  </button>`;
  menu.innerHTML = html;
  menu.querySelectorAll('.fm-item[data-path]').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      const p = btn.getAttribute('data-path');
      closeFolderMenu();
      switchFolderInActiveTab(p);
    });
  });
  const browse = menu.querySelector('#fm-browse');
  if (browse) browse.addEventListener('click', () => { closeFolderMenu(); browseFolder(); });
}

function openFolderMenu() { renderFolderMenu(); $('#folder-menu').classList.add('show'); }
function closeFolderMenu() { $('#folder-menu').classList.remove('show'); }

$('#folder-pill').addEventListener('click', (e) => {
  e.stopPropagation();
  if ($('#folder-menu').classList.contains('show')) closeFolderMenu();
  else openFolderMenu();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.folder-wrap')) closeFolderMenu();
});

/* ============ Restart ============ */
$('#restart').addEventListener('click', async () => {
  const t = activeTab();
  if (!t) return;
  await api.pty.kill(t.id);
  t.xterm.clear();
  t.xterm.reset();
  toast('Restarting Claude…');
  setTimeout(() => startTabPty(t), 150);
});

/* ============ Theme toggle ============ */
applyTheme(getTheme());
$('#theme-toggle').addEventListener('click', () => {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast(next === 'dark' ? 'Dark' : 'Light');
});

/* ============ Focus mode ============ */
const FOCUS_KEY = 'calm-claude:focus';
function getFocusMode() { return localStorage.getItem(FOCUS_KEY) === '1'; }

let focusRevealTimer = null;
function applyFocusMode(on) {
  document.body.classList.toggle('focus-mode', on);
  $('#focus-toggle').classList.toggle('active', on);
  localStorage.setItem(FOCUS_KEY, on ? '1' : '0');
  if (!on) {
    document.body.classList.remove('focus-reveal');
    clearTimeout(focusRevealTimer);
  }
  setTimeout(fitActive, 600);
}

function temporarilyReveal() {
  if (!getFocusMode()) return;
  document.body.classList.add('focus-reveal');
  clearTimeout(focusRevealTimer);
  focusRevealTimer = setTimeout(() => {
    document.body.classList.remove('focus-reveal');
  }, 1200);
}

document.addEventListener('mousemove', (e) => {
  if (!getFocusMode()) return;
  if (e.clientY < 60) {
    document.body.classList.add('focus-reveal');
    clearTimeout(focusRevealTimer);
  } else if (document.body.classList.contains('focus-reveal')) {
    clearTimeout(focusRevealTimer);
    focusRevealTimer = setTimeout(() => {
      document.body.classList.remove('focus-reveal');
    }, 600);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && getFocusMode()) {
    if (e.target && (e.target.id === 'composer-input' || e.target.id === 'search-input')) return;
    applyFocusMode(false);
    toast('Focus mode off');
  }
});

applyFocusMode(getFocusMode());
$('#focus-toggle').addEventListener('click', () => {
  const next = !getFocusMode();
  applyFocusMode(next);
  toast(next ? 'Focus mode on' : 'Focus mode off');
});

/* ============ Notifications toggle ============ */
const NOTIF_KEY = 'calm-claude:notif';
function getNotifEnabled() {
  const v = localStorage.getItem(NOTIF_KEY);
  return v === null ? true : v === '1';
}
function applyNotifToggle(on) {
  $('#notif-toggle').classList.toggle('active', on);
  localStorage.setItem(NOTIF_KEY, on ? '1' : '0');
}
applyNotifToggle(getNotifEnabled());

$('#notif-toggle').addEventListener('click', () => {
  const next = !getNotifEnabled();
  applyNotifToggle(next);
  toast(next ? 'Notifications on' : 'Notifications off');
});

/* ============ Permission bypass toggle ============ */
const PERM_KEY = 'calm-claude:skipPerm';
function getSkipPerm() {
  return localStorage.getItem(PERM_KEY) === '1';
}
function applyPermToggle(on) {
  $('#perm-toggle').classList.toggle('active', on);
  localStorage.setItem(PERM_KEY, on ? '1' : '0');
}
applyPermToggle(getSkipPerm());

$('#perm-toggle').addEventListener('click', async () => {
  const next = !getSkipPerm();
  applyPermToggle(next);
  toast(next ? 'Permissions bypassed — be careful' : 'Permissions back on');
  const t = activeTab();
  if (t) {
    await api.pty.kill(t.id);
    t.xterm.clear();
    t.xterm.reset();
    setTimeout(() => startTabPty(t), 120);
  }
});

/* ============ Ambient art toggle ============ */
const ART_KEY = 'calm-claude:art';
function getArt() {
  return localStorage.getItem(ART_KEY) === '1';
}
function applyArt(on) {
  document.body.classList.toggle('ambient-art', on);
  $('#art-toggle').classList.toggle('active', on);
  localStorage.setItem(ART_KEY, on ? '1' : '0');
}
applyArt(getArt());
$('#art-toggle').addEventListener('click', () => {
  const next = !getArt();
  applyArt(next);
  toast(next ? 'Ambient art on' : 'Ambient art off');
});

/* ============ Composer ============ */
const COMPOSER_KEY = 'calm-claude:composer';
const composerEl = $('#composer');
const composerInput = $('#composer-input');
const composerToggleBtn = $('#composer-toggle');

function autoGrow() {
  composerInput.style.height = 'auto';
  composerInput.style.height = Math.min(180, Math.max(40, composerInput.scrollHeight)) + 'px';
}

function setComposer(on) {
  localStorage.setItem(COMPOSER_KEY, on ? '1' : '0');
  composerEl.classList.toggle('show', on);
  composerToggleBtn.classList.toggle('active', on);
  if (on) {
    autoGrow();
    setTimeout(() => composerInput.focus(), 50);
  } else {
    activeTab()?.xterm.focus();
  }
}

function sendComposer() {
  const text = composerInput.value;
  if (!text) return;
  const t = activeTab();
  if (!t) return;
  t.xterm.paste(text);
  api.pty.write(t.id, '\r');
  composerInput.value = '';
  autoGrow();
  composerInput.focus();
}

composerToggleBtn.addEventListener('click', () => {
  setComposer(!composerEl.classList.contains('show'));
});
composerInput.addEventListener('input', autoGrow);
composerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComposer(); return; }
  if (e.key === 'Escape') { e.preventDefault(); activeTab()?.xterm.focus(); }
});
$('#composer-send').addEventListener('click', sendComposer);

/* ============ Scrollback search ============ */
const searchBar = $('#search-bar');
const searchInput = $('#search-input');
const searchCount = $('#search-count');

const searchOpts = {
  decorations: {
    matchBackground: '#c89a6b',
    matchBorder: '#a67847',
    matchOverviewRuler: '#c89a6b',
    activeMatchBackground: '#e8be8a',
    activeMatchBorder: '#d4a978',
    activeMatchColorOverviewRuler: '#e8be8a'
  }
};

function activeSearch() {
  return activeTab()?.searchAddon || null;
}

function bindSearchEvents() {
  const sa = activeSearch();
  if (!sa || !sa.onDidChangeResults) return;
  sa.__bound = sa.__bound || false;
  if (sa.__bound) return;
  sa.onDidChangeResults(({ resultCount, resultIndex }) => {
    if (activeTab()?.searchAddon !== sa) return;
    if (resultCount === undefined) { searchCount.textContent = ''; return; }
    if (resultCount === 0) { searchCount.textContent = 'No matches'; return; }
    searchCount.textContent = `${resultIndex + 1} / ${resultCount}`;
  });
  sa.__bound = true;
}

function openSearch() {
  if (!activeSearch()) return;
  bindSearchEvents();
  searchBar.classList.add('show');
  setTimeout(() => { searchInput.focus(); searchInput.select(); }, 40);
}
function closeSearch() {
  searchBar.classList.remove('show');
  const sa = activeSearch();
  if (sa) sa.clearDecorations();
  searchCount.textContent = '';
  activeTab()?.xterm.focus();
}
function findNext() {
  const sa = activeSearch();
  if (!sa || !searchInput.value) return;
  sa.findNext(searchInput.value, searchOpts);
}
function findPrev() {
  const sa = activeSearch();
  if (!sa || !searchInput.value) return;
  sa.findPrevious(searchInput.value, searchOpts);
}

searchInput.addEventListener('input', () => {
  const sa = activeSearch();
  if (!sa) return;
  if (!searchInput.value) { sa.clearDecorations(); searchCount.textContent = ''; return; }
  sa.findNext(searchInput.value, searchOpts);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) findPrev(); else findNext();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  }
});
$('#search-next').addEventListener('click', findNext);
$('#search-prev').addEventListener('click', findPrev);
$('#search-close').addEventListener('click', closeSearch);

/* ============ Keyboard shortcuts ============ */
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
    e.preventDefault();
    activeTab()?.xterm.clear();
  }
  if (mod && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
    e.preventDefault();
    $('#restart').click();
  }
  if (mod && e.shiftKey && (e.key === 'T' || e.key === 't')) {
    e.preventDefault();
    $('#theme-toggle').click();
  }
  if (mod && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
    e.preventDefault();
    composerToggleBtn.click();
  }
  if (mod && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
    e.preventDefault();
    $('#art-toggle').click();
  }
  if (mod && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    openSearch();
  }
  if (mod && !e.shiftKey && (e.key === 't' || e.key === 'T')) {
    e.preventDefault();
    newTabFlow();
  }
  if (mod && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
    e.preventDefault();
    if (activeTabId) closeTab(activeTabId);
  }
  if (mod && e.key === 'Tab') {
    e.preventDefault();
    const ids = [...tabs.keys()];
    const idx = ids.indexOf(activeTabId);
    if (idx >= 0) {
      const nextIdx = e.shiftKey
        ? (idx - 1 + ids.length) % ids.length
        : (idx + 1) % ids.length;
      activateTab(ids[nextIdx]);
    }
  }
});

/* ============ Boot ============ */
requestAnimationFrame(async () => {
  homeDir = await api.env.home();
  const savedCwd = localStorage.getItem(CWD_KEY) || homeDir;
  pushRecent(savedCwd);
  const first = createTab(savedCwd);
  activateTab(first.id);
  setComposer(localStorage.getItem(COMPOSER_KEY) === '1');
  await startTabPty(first);
});

/* ============ Paste image + drop files ============ */
function quoteIfSpace(p) {
  if (!p) return p;
  return /\s/.test(p) ? `"${p}"` : p;
}

function pasteIntoActiveTab(text) {
  const t = activeTab();
  if (!t) return;
  t.xterm.focus();
  t.xterm.paste(text);
}

async function savePastedBlob(blob, suggestedName) {
  try {
    const buf = await blob.arrayBuffer();
    const res = await api.paste.saveFile(buf, blob.type, suggestedName);
    if (res && res.ok) return res.path;
  } catch {}
  return null;
}

function insertIntoComposer(text) {
  const ta = composerInput;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  ta.value = before + text + after;
  const pos = start + text.length;
  ta.selectionStart = ta.selectionEnd = pos;
  autoGrow();
  ta.focus();
}

async function handleClipboardPaste(target) {
  const c = await api.paste.readClipboard();
  if (!c) return false;

  const deliver = target === 'composer' ? insertIntoComposer : pasteIntoActiveTab;

  if (c.kind === 'files' && c.filePaths.length) {
    toast(c.filePaths.length === 1 ? 'Copying file…' : `Copying ${c.filePaths.length} files…`);
    const copied = await api.paste.copyPaths(c.filePaths);
    if (copied.length) {
      deliver(copied.map(quoteIfSpace).join(' '));
      toast(copied.length === 1 ? 'Pasted file path' : `Pasted ${copied.length} paths`);
      return true;
    }
    toast('Paste failed');
    return false;
  }

  if (c.kind === 'image' && c.filePath) {
    deliver(quoteIfSpace(c.filePath));
    toast('Pasted image');
    return true;
  }

  if (c.kind === 'text' && c.text) {
    if (target === 'composer') {
      insertIntoComposer(c.text);
    } else {
      const t = activeTab();
      if (t) {
        t.xterm.focus();
        t.xterm.paste(c.text);
      }
    }
    return true;
  }

  return false;
}

window.addEventListener('keydown', async (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key !== 'v' && e.key !== 'V') return;
  const tgt = document.activeElement;
  if (tgt && tgt.id === 'search-input') return;
  const target = (tgt && tgt.id === 'composer-input') ? 'composer' : 'terminal';
  e.preventDefault();
  e.stopPropagation();
  await handleClipboardPaste(target);
}, true);

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('drag-over');
});
window.addEventListener('dragleave', (e) => {
  if (e.target === document || e.target === document.body || !e.relatedTarget) {
    document.body.classList.remove('drag-over');
  }
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('drag-over');
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;

  toast(files.length === 1 ? 'Copying file…' : `Copying ${files.length} files…`);
  const sourcePaths = [];
  const savedPaths = [];
  for (const f of files) {
    const p = api.paste.pathForFile(f);
    if (p) {
      sourcePaths.push(p);
    } else {
      const saved = await savePastedBlob(f, f.name);
      if (saved) savedPaths.push(saved);
    }
  }
  const copied = sourcePaths.length ? await api.paste.copyPaths(sourcePaths) : [];
  const paths = [...copied, ...savedPaths];
  if (paths.length) {
    pasteIntoActiveTab(paths.map(quoteIfSpace).join(' '));
    toast(paths.length === 1 ? 'Pasted file path' : `Pasted ${paths.length} paths`);
  } else {
    toast('Drop failed');
  }
});

/* ============ Auto-update notifications ============ */
api.updater.onAvailable((info) => {
  toast(`Update ${info?.version ? 'v' + info.version : ''} downloading…`);
});
api.updater.onReady((info) => {
  const banner = document.createElement('div');
  banner.className = 'update-banner show';
  banner.innerHTML = `
    <span>Update ${info?.version ? 'v' + info.version : ''} ready.</span>
    <button class="ub-btn" id="ub-install">Restart &amp; install</button>
    <button class="ub-btn ub-later" id="ub-later">Later</button>
  `;
  document.body.appendChild(banner);
  $('#ub-install').addEventListener('click', () => api.updater.install());
  $('#ub-later').addEventListener('click', () => banner.remove());
});
api.updater.onError((msg) => {
  console.warn('updater error:', msg);
});
