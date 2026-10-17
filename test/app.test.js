'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings, DEFAULTS } = require('../src/main/settings');

test('preload mirrors every IPC channel defined in main', () => {
  const ipcSource = fs.readFileSync(path.join(__dirname, '../src/main/ipc.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, '../src/preload/preload.js'), 'utf8');
  const channels = (src) => new Set([...src.matchAll(/^\s+([A-Z_]+): '([a-z]+:[a-z-]+)'/gm)].map((m) => `${m[1]}=${m[2]}`));
  const main = channels(ipcSource);
  assert.ok(main.size >= 13);
  assert.deepEqual([...channels(preloadSource)].sort(), [...main].sort());
});

test('Settings validates, persists and recovers from corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-'));
  const s = new Settings(dir);
  assert.equal(s.get('updateInterval'), DEFAULTS.updateInterval);
  assert.deepEqual(s.update({ updateInterval: 1000, processFilter: 'bogus', unknown: 1 }), ['updateInterval']);
  assert.equal(new Settings(dir).get('updateInterval'), 1000);

  fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
  assert.equal(new Settings(dir).get('updateInterval'), DEFAULTS.updateInterval);
});
