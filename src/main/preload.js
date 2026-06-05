const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  s3Upload: (params) => ipcRenderer.invoke('s3-upload', params),
  s3Delete: (params) => ipcRenderer.invoke('s3-delete', params),
  fetchTracking: (labelUrl) => ipcRenderer.invoke('fetch-tracking', labelUrl),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdaterStatus: (cb) => {
    const listener = (_e, status) => cb(status);
    ipcRenderer.on('updater-status', listener);
    return () => ipcRenderer.removeListener('updater-status', listener);
  },
});
