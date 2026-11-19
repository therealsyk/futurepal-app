const { contextBridge, ipcRenderer } = require('electron');

// Com contextIsolation ligado, só o que passa pelo contextBridge chega à página.
contextBridge.exposeInMainWorld('__electronBridge', {
  platform: process.platform,
  // Cor da barra do título (segue o tema da app)
  setTitleBar: (color, symbol) => ipcRenderer.send('wallet:titlebar', { color, symbol }),
  version: process.versions.electron,
  // Pedidos HTTP feitos pelo processo principal (sem CORS): usado pela ligação à IA.
  httpRequest: (req) => ipcRenderer.invoke('wallet:http', req),
  // Login social: abrir o fornecedor no browser do sistema e receber o link de volta (futurepal://auth-callback).
  openExternal: (url) => ipcRenderer.invoke('wallet:open-external', url),
  // Endereço local (http://127.0.0.1:porta/auth-callback) para onde o login volta; null se não der para abrir.
  oauthRedirect: () => ipcRenderer.invoke('wallet:oauth-redirect'),
  onAuthCallback: (cb) => {
    const h = (_e, url) => cb(url);
    ipcRenderer.on('wallet:auth-callback', h);
    ipcRenderer.send('wallet:auth-ready'); // entrega um link que tenha aberto a app
    return () => ipcRenderer.removeListener('wallet:auth-callback', h);
  },
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
