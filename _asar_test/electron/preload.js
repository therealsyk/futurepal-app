const { ipcRenderer } = require('electron');

window.__electronBridge = {
  platform: process.platform,
  version: process.versions.electron,
};
