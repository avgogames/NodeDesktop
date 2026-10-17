'use strict';

const { EventEmitter } = require('node:events');

const FILESYSTEM_INTERVAL_MS = 5000;

/**
 * Drives periodic sampling and emits results.
 *
 * Resources are sampled on every tick regardless of the visible view so the
 * graphs have continuous history. Processes (the expensive part, one set of
 * reads per pid) are only sampled while the Processes view is visible and
 * the window is not hidden; file systems are refreshed every few seconds
 * while their view is visible.
 *
 * Ticks never overlap: the next one is scheduled only after the current
 * sample finishes, so a slow /proc never causes a pile-up.
 */
class Sampler extends EventEmitter {
  constructor({ processes, resources, filesystems, settings }) {
    super();
    this.processes = processes;
    this.resources = resources;
    this.filesystems = filesystems;
    this.settings = settings;
    this.activeView = 'processes';
    this.windowVisible = true;
    this.timer = null;
    this.running = false;
    this.lastFsSample = 0;
    this.inFlight = false;
    this.pendingRefresh = false;
    this.forceFs = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  setActiveView(view) {
    this.activeView = view;
    this.refreshNow();
  }

  setWindowVisible(visible) {
    this.windowVisible = visible;
  }

  /** Run a tick immediately (e.g. after a view switch or a process action). */
  refreshNow() {
    if (!this.running) return;
    this.forceFs = true;
    if (this.inFlight) {
      this.pendingRefresh = true;
      return;
    }
    clearTimeout(this.timer);
    this.tick();
  }

  async tick() {
    this.inFlight = true;
    try {
      const point = await this.resources.sample();
      if (point) this.emit('resources', point);

      if (this.windowVisible && this.activeView === 'processes') {
        this.emit('processes', await this.processes.sample());
      }

      const now = Date.now();
      if (this.windowVisible && this.activeView === 'filesystems'
          && (now - this.lastFsSample >= FILESYSTEM_INTERVAL_MS || this.forceFs)) {
        this.lastFsSample = now;
        this.forceFs = false;
        const showAll = this.settings.get('showAllFileSystems');
        this.emit('filesystems', await this.filesystems.sample({ showAll }));
      }
    } catch (err) {
      this.emit('error', err);
    } finally {
      this.inFlight = false;
    }

    if (!this.running) return;
    if (this.pendingRefresh) {
      this.pendingRefresh = false;
      setImmediate(() => this.tick());
    } else {
      this.timer = setTimeout(() => this.tick(), this.settings.get('updateInterval'));
    }
  }
}

module.exports = { Sampler };
