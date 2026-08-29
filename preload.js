import { contextBridge, ipcRenderer } from 'electron';

console.log('⚡ Muthuwadige Hardware ERP Preload initialized.');

contextBridge.exposeInMainWorld('electronAPI', {
  openExternalUrl: async (url) => {
    console.log('[WhatsApp] 3. Preload openExternalUrl called with:', url);
    return await ipcRenderer.invoke('open-external-url', url);
  },
  openExternal: async (url) => {
    console.log('[WhatsApp] 3. Preload openExternal called with:', url);
    return await ipcRenderer.invoke('open-external-url', url);
  },
  restartBackend: async () => {
    return await ipcRenderer.invoke('restart-backend');
  },
  checkBackendHealth: async () => {
    return await ipcRenderer.invoke('check-backend-health');
  }
});

