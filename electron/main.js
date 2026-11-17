const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const path = require('path');

function resolveAppUrl() {
  const dist = path.join(app.getAppPath(), 'dist', 'index.html');
  return 'file://' + dist;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    title: 'Wallet',
    backgroundColor: '#0a0a0d',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Links externos (ex.: "criar chave API") abrem no browser do sistema, não dentro da app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer crashed]', details);
  });
  win.loadURL(resolveAppUrl());
  return win;
}

// Proxy HTTP para a ligação à IA. Só https (ou http para o próprio PC: Ollama/LM Studio).
ipcMain.handle('wallet:http', async (_event, req) => {
  const url = String(req && req.url || '');
  let u;
  try { u = new URL(url); } catch { return { status: 0, body: 'invalid url' }; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local))) return { status: 0, body: 'blocked url' };
  const method = req.method === 'POST' ? 'POST' : 'GET';
  try {
    const res = await net.fetch(url, { method, headers: req.headers || {}, body: method === 'POST' ? req.body : undefined });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    return { status: 0, body: String(err && err.message || err) };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
