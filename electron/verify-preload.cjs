const { contextBridge, ipcRenderer } = require('electron');
const marker = process.argv.find(arg => arg.startsWith('--verification-id='));
const nonce = marker?.slice('--verification-id='.length);
contextBridge.exposeInMainWorld('verification', {
  complete: value => ipcRenderer.send('coolapk:verified', nonce, typeof value === 'string' ? value : ''),
  cancel: () => ipcRenderer.send('coolapk:verified', nonce, ''),
});
