const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onState: (cb) => ipcRenderer.on('window:state', (_e, s) => cb(s)),
    onFocus: (cb) => ipcRenderer.on('window:focus', (_e, f) => cb(f))
  },
  pty: {
    start: (opts) => ipcRenderer.invoke('pty:start', opts || {}),
    write: (data) => ipcRenderer.send('pty:write', data),
    resize: (cols, rows) => ipcRenderer.send('pty:resize', { cols, rows }),
    kill: () => ipcRenderer.invoke('pty:kill'),
    onData: (cb) => ipcRenderer.on('pty:data', (_e, data) => cb(data)),
    onExit: (cb) => ipcRenderer.on('pty:exit', (_e, info) => cb(info))
  },
  dialog: {
    pickFolder: (startPath) => ipcRenderer.invoke('dialog:pickFolder', startPath)
  },
  env: {
    home: () => ipcRenderer.invoke('env:home')
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
