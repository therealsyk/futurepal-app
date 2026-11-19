const { app, BrowserWindow, Menu, ipcMain, net, shell } = require('electron');

// Sem o menu "File / Edit / View / Window" (copiar/colar continuam a funcionar nos campos de texto).
Menu.setApplicationMenu(null);
// A app avisa a cor do tema para a barra do título acompanhar (escuro / cinzento / claro).
ipcMain.on('wallet:titlebar', (e, { color, symbol }) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && typeof w.setTitleBarOverlay === 'function' && /^#[0-9a-f]{6}$|^rgb/i.test(String(color))) {
    try { w.setTitleBarOverlay({ color, symbolColor: symbol, height: 34 }); } catch { /* sistema sem suporte */ }
  }
});
const path = require('path');

// A app chamava-se "Wallet": continua a usar a mesma pasta de dados para não se perder nada ao mudar de nome.
app.setPath('userData', path.join(app.getPath('appData'), 'Wallet'));

function resolveAppUrl() {
  const dist = path.join(app.getAppPath(), 'dist', 'index.html');
  return 'file://' + dist;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    title: 'FuturePal',
    backgroundColor: '#0a0a0d',
    show: false, // só aparece já desenhada (sem piscar a branco)
    // Janela sem a barra do sistema nem o menu: a barra do título é escura e faz parte da app,
    // com os botões minimizar/maximizar/fechar do Windows por cima (cor acertada pelo tema da app).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0a0d', symbolColor: '#e8e8ec', height: 34 },
    webPreferences: {
      preload: path.join(app.getAppPath(), 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.setMenuBarVisibility(false);
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
// O fornecedor devolve a pessoa a futurepal://auth-callback?code=…; o Windows entrega esse link à app já aberta.
const PROTOCOL = 'futurepal';
// Em desenvolvimento NÃO se regista o protocolo: senão roubava os links de login à app instalada
// (o browser mandava o futurepal://… para o electron.exe do projeto e a app instalada ficava à espera).
// Para testar o login social em desenvolvimento: FUTUREPAL_DEV_PROTOCOL=1.
if (process.defaultApp) {
  if (process.env.FUTUREPAL_DEV_PROTOCOL === '1' && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
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
// Login pelo endereço local: o fornecedor volta para http://127.0.0.1:<porta>/auth-callback?code=… e um pequeno
// servidor só local recebe o código. Funciona em qualquer browser, sem depender do futurepal:// (que o browser pode
// bloquear, pedir confirmação ou mandar para outro programa). As portas têm de estar nos Redirect URLs do Supabase.
const AUTH_PORTS = [53682, 53683, 53684];
let authServer = null;
let authServerTimer = null;
function stopAuthServer() {
  if (authServerTimer) { clearTimeout(authServerTimer); authServerTimer = null; }
  if (authServer) { try { authServer.close(); } catch { /* já fechado */ } authServer = null; }
}
const AUTH_DONE_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>FuturePal</title>'
  + '<style>body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0;text-align:center}'
  + 'h1{font-size:22px;margin:0 0 8px}p{color:#9aa7b4;margin:0}</style></head><body><div><h1>Sessão iniciada ✓</h1>'
  + '<p>Já podes fechar esta página e voltar ao FuturePal.</p><p style="margin-top:6px">Signed in — you can close this page and return to FuturePal.</p></div>'
  + '<script>setTimeout(function(){window.close()},1500)</script></body></html>';
function listenOn(port) {
  return new Promise((resolve) => {
    const http = require('http');
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      if (u.pathname !== '/auth-callback') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(AUTH_DONE_PAGE);
      deliverAuthUrl(`${PROTOCOL}://auth-callback${u.search}`);
      setTimeout(stopAuthServer, 2000);
    });
    srv.once('error', () => resolve(null));
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}
ipcMain.handle('wallet:oauth-redirect', async () => {
  stopAuthServer();
  for (const port of AUTH_PORTS) {
    const srv = await listenOn(port);
    if (srv) {
      authServer = srv;
      authServerTimer = setTimeout(stopAuthServer, 10 * 60 * 1000); // desiste ao fim de 10 minutos
      return `http://127.0.0.1:${port}/auth-callback`;
    }
  }
  return null; // portas ocupadas: usa o futurepal://
});
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
