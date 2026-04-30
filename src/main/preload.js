const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  s3Upload: (params) => ipcRenderer.invoke('s3-upload', params),
});
