'use strict';

/**
 * Preload bridge. Runs sandboxed, so it can only require 'electron'; the
 * channel names below mirror src/main/ipc.js (test/ipc.test.js checks it).
 *
 * The renderer gets a small, typed API — never raw ipcRenderer access.
 */
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = {
  GET_INITIAL_STATE: 'app:get-initial-state',
  UPDATE_SETTINGS: 'settings:update',
  SET_ACTIVE_VIEW: 'view:set-active',
  REFRESH: 'sampler:refresh',
  PROCESS_SIGNAL: 'process:signal',
  PROCESS_RENICE: 'process:renice',
  PROCESS_DETAILS: 'process:details',
  PROCESS_OPEN_FILES: 'process:open-files',
  PROCESS_MEMORY_MAPS: 'process:memory-maps',
};

const EVENTS = {
  PROCESSES: 'sample:processes',
  RESOURCES: 'sample:resources',
  FILESYSTEMS: 'sample:filesystems',
  ERROR: 'sample:error',
};

function subscribe(channel) {
  return (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('monitor', {
  getInitialState: () => ipcRenderer.invoke(INVOKE.GET_INITIAL_STATE),
  updateSettings: (patch) => ipcRenderer.invoke(INVOKE.UPDATE_SETTINGS, patch),
  setActiveView: (view) => ipcRenderer.invoke(INVOKE.SET_ACTIVE_VIEW, view),
  refresh: () => ipcRenderer.invoke(INVOKE.REFRESH),

  signalProcess: (pid, action, options) => ipcRenderer.invoke(INVOKE.PROCESS_SIGNAL, pid, action, options),
  reniceProcess: (pid, nice, options) => ipcRenderer.invoke(INVOKE.PROCESS_RENICE, pid, nice, options),
  getProcessDetails: (pid) => ipcRenderer.invoke(INVOKE.PROCESS_DETAILS, pid),
  getOpenFiles: (pid) => ipcRenderer.invoke(INVOKE.PROCESS_OPEN_FILES, pid),
  getMemoryMaps: (pid) => ipcRenderer.invoke(INVOKE.PROCESS_MEMORY_MAPS, pid),

  onProcesses: subscribe(EVENTS.PROCESSES),
  onResources: subscribe(EVENTS.RESOURCES),
  onFileSystems: subscribe(EVENTS.FILESYSTEMS),
  onError: subscribe(EVENTS.ERROR),
});
