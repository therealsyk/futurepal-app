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
      sandbox: true,
    },
  });
  // Links externos (ex.: "criar chave API") abrem no browser do sistema, não dentro da app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // A janela só mostra a própria app: qualquer outro endereço abre no browser do sistema.
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return;
    event.preventDefault();
    if (/^https:\/\//.test(url)) shell.openExternal(url);
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

// ---------------------------------------------------------------- atualizações (Windows)
// O instalador (NSIS) traz o ficheiro app-update.yml que diz onde estão as versões novas (GitHub Releases).
// No .exe portátil, ou a correr em desenvolvimento, não há atualização automática: a app mostra o link de download.
const fs = require('fs');
let updater; // undefined = ainda não verificado; null = não suportado
function getUpdater() {
  if (updater !== undefined) return updater;
  updater = null;
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  const configured = fs.existsSync(path.join(process.resourcesPath || '', 'app-update.yml'));
  if (!app.isPackaged || portable || !configured) return updater;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false; // só descarrega quando a pessoa carrega em "Descarregar e instalar"
    autoUpdater.autoInstallOnAppQuit = true; // se não reiniciar logo, instala ao fechar a app
    autoUpdater.on('download-progress', (p) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('wallet:update-progress', p.percent);
    });
    updater = autoUpdater;
  } catch (err) {
    console.error('[updater]', err);
  }
  return updater;
}
const plainText = (notes) => (typeof notes === 'string' ? notes : Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : '')
  .replace(/<[^>]+>/g, '').trim();

ipcMain.on('wallet:update-supported', (event) => { event.returnValue = Boolean(getUpdater()); });
ipcMain.handle('wallet:update-check', async () => {
  const u = getUpdater();
  if (!u) return null;
  try {
    const r = await u.checkForUpdates();
    if (!r || !r.updateInfo || r.isUpdateAvailable === false || r.updateInfo.version === app.getVersion()) return null;
    return { version: r.updateInfo.version, notes: plainText(r.updateInfo.releaseNotes) };
  } catch (err) {
    console.error('[updater] check', err && err.message);
    return null;
  }
});
ipcMain.handle('wallet:update-download', async () => {
  const u = getUpdater();
  if (!u) return false;
  try { await u.downloadUpdate(); return true; } catch (err) { console.error('[updater] download', err && err.message); return false; }
});
ipcMain.on('wallet:update-install', () => {
  const u = getUpdater();
  if (u) setImmediate(() => u.quitAndInstall(false, true)); // fecha, instala e volta a abrir
});

// ---------------------------------------------------------------- login social (Google/Facebook/Apple)
// O fornecedor devolve a pessoa a wallet://auth-callback?code=…; o Windows entrega esse link à app já aberta.
const PROTOCOL = 'wallet';
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]); // em desenvolvimento
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}
let pendingAuthUrl = null;
const findAuthUrl = (argv) => (argv || []).find((a) => typeof a === 'string' && a.startsWith(PROTOCOL + '://'));
function deliverAuthUrl(url) {
  if (!url) return;
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { pendingAuthUrl = url; return; }
  if (win.isMinimized()) win.restore();
  win.focus();
  win.webContents.send('wallet:auth-callback', url);
}
// Uma só instância: o segundo arranque (com o link) passa o link à primeira e fecha.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => deliverAuthUrl(findAuthUrl(argv)));
  app.on('open-url', (event, url) => { event.preventDefault(); deliverAuthUrl(url); }); // macOS
  pendingAuthUrl = findAuthUrl(process.argv);
}
ipcMain.handle('wallet:open-external', async (_event, url) => {
  if (typeof url === 'string' && url.startsWith('https://')) await shell.openExternal(url);
});
ipcMain.on('wallet:auth-ready', (event) => {
  if (pendingAuthUrl) { event.sender.send('wallet:auth-callback', pendingAuthUrl); pendingAuthUrl = null; }
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
