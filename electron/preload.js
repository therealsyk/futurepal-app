const { contextBridge, ipcRenderer } = require('electron');

// Com contextIsolation ligado, só o que passa pelo contextBridge chega à página.
contextBridge.exposeInMainWorld('__electronBridge', {
  platform: process.platform,
  version: process.versions.electron,
  // Pedidos HTTP feitos pelo processo principal (sem CORS): usado pela ligação à IA.
  httpRequest: (req) => ipcRenderer.invoke('wallet:http', req),
  // Atualizações automáticas (ver main.js). supported=false no .exe portátil e em desenvolvimento.
  updates: {
    supported: ipcRenderer.sendSync('wallet:update-supported'),
    check: () => ipcRenderer.invoke('wallet:update-check'),
    download: () => ipcRenderer.invoke('wallet:update-download'),
    install: () => ipcRenderer.send('wallet:update-install'),
    onProgress: (cb) => {
      const h = (_e, percent) => cb(percent);
      ipcRenderer.on('wallet:update-progress', h);
      return () => ipcRenderer.removeListener('wallet:update-progress', h);
    },
  },
});
