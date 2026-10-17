'use strict';

const { ipcMain } = require('electron');
const { SIGNALS } = require('./services/processes');

/**
 * IPC contract between main and renderer.
 *
 * The preload script mirrors these names (it runs sandboxed and cannot
 * require local modules); test/ipc.test.js keeps the two lists in sync.
 */
const INVOKE = Object.freeze({
  GET_INITIAL_STATE: 'app:get-initial-state',
  UPDATE_SETTINGS: 'settings:update',
  SET_ACTIVE_VIEW: 'view:set-active',
  REFRESH: 'sampler:refresh',
  PROCESS_SIGNAL: 'process:signal',
  PROCESS_RENICE: 'process:renice',
  PROCESS_DETAILS: 'process:details',
  PROCESS_OPEN_FILES: 'process:open-files',
  PROCESS_MEMORY_MAPS: 'process:memory-maps',
});

const EVENTS = Object.freeze({
  PROCESSES: 'sample:processes',
  RESOURCES: 'sample:resources',
  FILESYSTEMS: 'sample:filesystems',
  ERROR: 'sample:error',
});

const VIEWS = new Set(['processes', 'resources', 'filesystems']);

function assertPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid > 4194304) throw new Error(`Invalid pid: ${pid}`);
}

function assertNice(nice) {
  if (!Number.isInteger(nice) || nice < -20 || nice > 19) throw new Error(`Invalid nice value: ${nice}`);
}

/**
 * Register all handlers. Every argument coming from the renderer is
 * validated here: the renderer is treated as untrusted.
 */
function registerIpc({ getWindow, sampler, processes, resources, settings, systemInfo }) {
  const isTrustedSender = (event) => {
    const win = getWindow();
    return win && event.sender === win.webContents;
  };
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
      return fn(...args);
    });
  };

  handle(INVOKE.GET_INITIAL_STATE, async () => ({
    system: systemInfo,
    settings: settings.all(),
    resourceHistory: resources.getHistory(),
  }));

  handle(INVOKE.UPDATE_SETTINGS, async (patch) => {
    const accepted = settings.update(patch);
    if (accepted.includes('updateInterval')) {
      // Keep about two minutes of graph history, like GNOME.
      resources.setHistoryLength(Math.max(30, Math.round(120000 / settings.get('updateInterval'))));
    }
    if (accepted.includes('showAllFileSystems') || accepted.includes('updateInterval')) sampler.refreshNow();
    return settings.all();
  });

  handle(INVOKE.SET_ACTIVE_VIEW, async (view) => {
    if (!VIEWS.has(view)) throw new Error(`Unknown view: ${view}`);
    sampler.setActiveView(view);
  });

  handle(INVOKE.REFRESH, async () => sampler.refreshNow());

  handle(INVOKE.PROCESS_SIGNAL, async (pid, action, options = {}) => {
    assertPid(pid);
    if (!Object.hasOwn(SIGNALS, action)) throw new Error(`Unknown action: ${action}`);
    const result = await processes.signal(pid, action, { elevated: options.elevated === true });
    sampler.refreshNow();
    return result;
  });

  handle(INVOKE.PROCESS_RENICE, async (pid, nice, options = {}) => {
    assertPid(pid);
    assertNice(nice);
    const result = await processes.renice(pid, nice, { elevated: options.elevated === true });
    sampler.refreshNow();
    return result;
  });

  handle(INVOKE.PROCESS_DETAILS, async (pid) => {
    assertPid(pid);
    return processes.details(pid);
  });

  handle(INVOKE.PROCESS_OPEN_FILES, async (pid) => {
    assertPid(pid);
    return processes.openFiles(pid);
  });

  handle(INVOKE.PROCESS_MEMORY_MAPS, async (pid) => {
    assertPid(pid);
    return processes.memoryMaps(pid);
  });

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  sampler.on('processes', (data) => send(EVENTS.PROCESSES, data));
  sampler.on('resources', (data) => send(EVENTS.RESOURCES, data));
  sampler.on('filesystems', (data) => send(EVENTS.FILESYSTEMS, data));
  sampler.on('error', (err) => {
    console.error('Sampling error:', err);
    send(EVENTS.ERROR, { message: err.message });
  });
}

module.exports = { registerIpc, INVOKE, EVENTS };
