const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('coolapk', {
  call: (operation, args) => ipcRenderer.invoke('coolapk:call', operation, args),
  accounts: () => ipcRenderer.invoke('coolapk:accounts'),
  login: () => ipcRenderer.invoke('coolapk:login'),
  importCookie: cookie => ipcRenderer.invoke('coolapk:import', cookie),
  verify: verificationId => ipcRenderer.invoke('coolapk:verify', verificationId),
  selectAccount: uid => ipcRenderer.invoke('coolapk:select', uid),
  removeAccount: uid => ipcRenderer.invoke('coolapk:remove', uid),
  openExternal: url => ipcRenderer.invoke('coolapk:external', url),
  onAccount: callback => { const handler = (_, value) => callback(value); ipcRenderer.on('coolapk:account', handler); return () => ipcRenderer.removeListener('coolapk:account', handler); },
  onCommand: callback => { const handler = (_, value) => callback(value); ipcRenderer.on('coolapk:command', handler); return () => ipcRenderer.removeListener('coolapk:command', handler); },
});
