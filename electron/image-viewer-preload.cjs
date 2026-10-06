const { contextBridge, ipcRenderer } = require('electron');
const invoke = (operation, args) => ipcRenderer.invoke('coolapk:image-viewer', operation, args);
contextBridge.exposeInMainWorld('coolapkImageViewer', { state: () => invoke('state'), close: () => invoke('close') });
// This window has no account, publishing, filesystem or phone bridge.
contextBridge.exposeInMainWorld('coolapk', {
  saveImage: args => invoke('save', args),
  openExternal: url => invoke('external', { url }),
  call: (operation, args) => invoke(operation === 'livePhotoVideo' ? operation : 'unsupported', args),
});
