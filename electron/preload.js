const { contextBridge, ipcRenderer } = require('electron');

// Com contextIsolation ligado, só o que passa pelo contextBridge chega à página.
contextBridge.exposeInMainWorld('__electronBridge', {
  platform: process.platform,
  version: process.versions.electron,
  // Pedidos HTTP feitos pelo processo principal (sem CORS): usado pela ligação à IA.
  httpRequest: (req) => ipcRenderer.invoke('wallet:http', req),
});
