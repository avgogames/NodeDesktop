'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, shell, session } = require('electron');

const { Settings } = require('./settings');
const { Sampler } = require('./sampler');
const { registerIpc } = require('./ipc');
const { sysconf } = require('./proc/reader');
const { UserResolver } = require('./services/users');
const { ProcessService } = require('./services/processes');
const { ResourceService } = require('./services/resources');
const { FileSystemService } = require('./services/filesystems');
const { getSystemInfo } = require('./services/system');

if (process.platform !== 'linux') {
  console.error('NodeDesktop System Monitor reads /proc and only supports Linux.');
}

app.setName('System Monitor');
let mainWindow = null;

// One window only: a second launch focuses the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(bootstrap).catch((err) => {
    console.error('Failed to start:', err);
    app.exit(1);
  });
}

async function bootstrap() {
  Menu.setApplicationMenu(null);
  hardenSession();

  const settings = new Settings(app.getPath('userData'));
  const users = new UserResolver();
  await users.load();

  const processes = new ProcessService({
    clockTicks: sysconf('CLK_TCK', 100),
    pageSize: sysconf('PAGESIZE', 4096),
    users,
  });
  const resources = new ResourceService({
    historyLength: Math.max(30, Math.round(120000 / settings.get('updateInterval'))),
  });
  const filesystems = new FileSystemService();
  const sampler = new Sampler({ processes, resources, filesystems, settings });
  const systemInfo = await getSystemInfo();

  registerIpc({ getWindow: () => mainWindow, sampler, processes, resources, settings, systemInfo });

  createWindow(settings, sampler);
  sampler.start();

  app.on('window-all-closed', () => {
    sampler.stop();
    app.quit();
  });
}

function createWindow(settings, sampler) {
  const bounds = settings.get('windowBounds');
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 640,
    minHeight: 420,
    title: 'System Monitor',
    icon: path.join(__dirname, '../../build/icon.png'),
    backgroundColor: '#fafafa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Stop expensive process sampling while nobody can see it.
  mainWindow.on('minimize', () => sampler.setWindowVisible(false));
  mainWindow.on('hide', () => sampler.setWindowVisible(false));
  mainWindow.on('restore', () => { sampler.setWindowVisible(true); sampler.refreshNow(); });
  mainWindow.on('show', () => { sampler.setWindowVisible(true); sampler.refreshNow(); });

  mainWindow.on('close', () => {
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      settings.update({ windowBounds: mainWindow.getBounds() });
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  // Developer tools on Ctrl+Shift+I, since the default menu is removed.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

/** Lock down navigation, popups and permissions for the renderer. */
function hardenSession() {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}
