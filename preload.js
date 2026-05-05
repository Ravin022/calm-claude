const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    isFocused: () => ipcRenderer.invoke('window:isFocused'),
    flash: () => ipcRenderer.invoke('window:flash'),
    focus: () => ipcRenderer.invoke('window:focus'),
    onState: (cb) => ipcRenderer.on('window:state', (_e, s) => cb(s)),
    onFocus: (cb) => ipcRenderer.on('window:focus', (_e, f) => cb(f))
  },
  pty: {
    start: (opts) => ipcRenderer.invoke('pty:start', opts || {}),
    write: (tabId, data) => ipcRenderer.send('pty:write', { tabId, data }),
    resize: (tabId, cols, rows) => ipcRenderer.send('pty:resize', { tabId, cols, rows }),
    kill: (tabId) => ipcRenderer.invoke('pty:kill', { tabId }),
    onData: (cb) => ipcRenderer.on('pty:data', (_e, payload) => cb(payload)),
    onExit: (cb) => ipcRenderer.on('pty:exit', (_e, info) => cb(info))
  },
  dialog: {
    pickFolder: (startPath) => ipcRenderer.invoke('dialog:pickFolder', startPath)
  },
  env: {
    home: () => ipcRenderer.invoke('env:home')
  },
  paste: {
    saveFile: (data, mime, suggestedName) =>
      ipcRenderer.invoke('paste:saveFile', { data, mime, suggestedName }),
    clipboardFilePaths: () => ipcRenderer.invoke('paste:clipboardFilePaths'),
    copyPaths: (paths) => ipcRenderer.invoke('paste:copyPaths', paths),
    readClipboard: () => ipcRenderer.invoke('clipboard:read'),
    pathForFile: (file) => {
      try { return webUtils.getPathForFile(file); }
      catch { return null; }
    }
  },
  updater: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
    onNone: (cb) => ipcRenderer.on('update:none', () => cb()),
    onProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p)),
    onReady: (cb) => ipcRenderer.on('update:ready', (_e, info) => cb(info)),
    onError: (cb) => ipcRenderer.on('update:error', (_e, msg) => cb(msg))
  }
});
