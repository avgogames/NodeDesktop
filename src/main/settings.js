'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  updateInterval: 2000,          // ms between samples (GNOME default: 3 s for processes)
  processFilter: 'all',          // 'all' | 'mine' | 'active'
  showDependencies: false,       // process tree view
  showAllFileSystems: false,
  sortColumn: 'cpuPercent',
  sortDirection: 'desc',
  windowBounds: { width: 1000, height: 700 },
});

const VALIDATORS = {
  updateInterval: (v) => Number.isInteger(v) && v >= 500 && v <= 10000,
  processFilter: (v) => ['all', 'mine', 'active'].includes(v),
  showDependencies: (v) => typeof v === 'boolean',
  showAllFileSystems: (v) => typeof v === 'boolean',
  sortColumn: (v) => typeof v === 'string' && /^[a-zA-Z]{1,32}$/.test(v),
  sortDirection: (v) => v === 'asc' || v === 'desc',
  windowBounds: (v) => v && typeof v === 'object' && Number.isFinite(v.width) && Number.isFinite(v.height),
};

/**
 * Tiny JSON settings store in the app's userData directory.
 * Writes are atomic (temp file + rename) so a crash never leaves a
 * truncated settings file behind.
 */
class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.values = { ...DEFAULTS };
    try {
      const stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of Object.entries(stored)) {
        if (VALIDATORS[k]?.(v)) this.values[k] = v;
      }
    } catch {
      // First run or corrupt file: fall back to defaults.
    }
  }

  get(key) {
    return this.values[key];
  }

  all() {
    return { ...this.values };
  }

  /** Apply a partial update; invalid keys/values are ignored. Returns accepted keys. */
  update(patch) {
    const accepted = [];
    for (const [k, v] of Object.entries(patch || {})) {
      if (VALIDATORS[k]?.(v)) {
        this.values[k] = v;
        accepted.push(k);
      }
    }
    if (accepted.length) this.save();
    return accepted;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.values, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }
}

module.exports = { Settings, DEFAULTS };
