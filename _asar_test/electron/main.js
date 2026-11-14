const { app, BrowserWindow } = require('electron');
const path = require('path');

function resolveAppUrl() {
  const dist = path.join(app.getAppPath(), 'dist', 'index.html');
  return 'file://' + dist;
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Wallet',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(resolveAppUrl());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = new BrowserWindow({ width: 1280, height: 800, title: 'Wallet' });
      w.loadURL(resolveAppUrl());
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
