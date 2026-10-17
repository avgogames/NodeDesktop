'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('format helpers', async () => {
  const f = await import('../src/renderer/js/format.js');
  assert.equal(f.formatBytes(512), '512 B');
  assert.equal(f.formatBytes(1536), '1.5 KiB');
  assert.equal(f.formatBytes(5 * 1024 ** 3), '5.0 GiB');
  assert.equal(f.formatBytes(null), 'N/A');
  assert.equal(f.formatRate(2048), '2.0 KiB/s');
  assert.equal(f.formatCpuTime(3723.5), '1:02:03.50');
  assert.equal(f.formatCpuTime(65), '1:05.00');
  assert.equal(f.priorityLabel(-20), 'Very High');
  assert.equal(f.priorityLabel(0), 'Normal');
  assert.equal(f.priorityLabel(19), 'Very Low');
  assert.equal(f.escapeHtml('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
});

const procs = [
  { key: '1:0', pid: 1, ppid: 0, name: 'systemd', user: 'root', uid: 0, cmdline: '/sbin/init', cpuPercent: 0, state: 'S', memory: 10 },
  { key: '50:0', pid: 50, ppid: 1, name: 'gnome-shell', user: 'alice', uid: 1000, cmdline: '', cpuPercent: 12, state: 'S', memory: 500 },
  { key: '60:0', pid: 60, ppid: 50, name: 'firefox', user: 'alice', uid: 1000, cmdline: 'firefox --new', cpuPercent: 30, state: 'R', memory: 900 },
  { key: '61:0', pid: 61, ppid: 50, name: 'Xwayland', user: 'alice', uid: 1000, cmdline: '', cpuPercent: 0, state: 'S', memory: 50 },
];

test('buildRows sorts and filters in flat mode', async () => {
  const { buildRows } = await import('../src/renderer/js/processModel.js');
  assert.deepEqual(buildRows(procs, { sortColumn: 'cpuPercent', sortDirection: 'desc' }).map((r) => r.proc.pid), [60, 50, 1, 61]);
  assert.deepEqual(buildRows(procs, { sortColumn: 'name', sortDirection: 'asc' }).map((r) => r.proc.pid), [60, 50, 1, 61]);
  assert.deepEqual(buildRows(procs, { filter: 'mine', myUid: 1000 }).map((r) => r.proc.pid).sort(), [50, 60, 61]);
  assert.deepEqual(buildRows(procs, { filter: 'active' }).map((r) => r.proc.pid), [60, 50]);
  assert.deepEqual(buildRows(procs, { query: 'NEW' }).map((r) => r.proc.pid), [60]);
  assert.deepEqual(buildRows(procs, { query: '61' }).map((r) => r.proc.pid), [61]);
});

test('buildRows nests children in tree mode and honours collapse', async () => {
  const { buildRows } = await import('../src/renderer/js/processModel.js');
  const rows = buildRows(procs, { tree: true, sortColumn: 'name', sortDirection: 'asc' });
  assert.deepEqual(rows.map((r) => [r.proc.pid, r.depth]), [[1, 0], [50, 1], [60, 2], [61, 2]]);
  assert.equal(rows[1].hasChildren, true);

  const collapsed = buildRows(procs, { tree: true, collapsed: new Set(['50:0']) });
  assert.deepEqual(collapsed.map((r) => r.proc.pid), [1, 50]);
  assert.equal(collapsed[1].expanded, false);

  // A filtered-out parent promotes its children to roots.
  const mine = buildRows(procs, { tree: true, filter: 'mine', myUid: 1000, sortColumn: 'pid', sortDirection: 'asc' });
  assert.deepEqual(mine.map((r) => [r.proc.pid, r.depth]), [[50, 0], [60, 1], [61, 1]]);
});

test('niceMax rounds to 1/2/5 steps of binary units', async () => {
  const { niceMax } = await import('../src/renderer/js/components/lineChart.js');
  assert.equal(niceMax(0), 1024);
  assert.equal(niceMax(3 * 1024), 5 * 1024);
  assert.equal(niceMax(13 * 1024), 20 * 1024);
  assert.equal(niceMax(300 * 1024 ** 2), 500 * 1024 ** 2);
});
