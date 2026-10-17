'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProcessService } = require('../src/main/services/processes');
const { ResourceService } = require('../src/main/services/resources');
const { FileSystemService, isStorage } = require('../src/main/services/filesystems');

/** Build a throwaway procfs-like tree so services can be tested hermetically. */
function fakeProc() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fakeproc-'));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const setCpu = (total) => write('stat', `cpu  ${total} 0 0 0 0 0 0 0\ncpu0 ${total} 0 0 0 0 0 0 0\nbtime 1700000000\n`);
  const setProc = (pid, { comm, utime, ppid = 1, cmdline = '', read = 0 }) => {
    write(`${pid}/stat`, `${pid} (${comm}) S ${ppid} 0 0 0 -1 0 0 0 0 0 ${utime} 0 0 0 20 0 1 0 500 1000000 10`);
    write(`${pid}/statm`, '250 100 40 0 0 0 0');
    write(`${pid}/cmdline`, cmdline);
    write(`${pid}/io`, `read_bytes: ${read}\nwrite_bytes: 0\n`);
  };
  return { root, write, setCpu, setProc };
}

test('ProcessService computes CPU% and disk rate from deltas', async () => {
  const f = fakeProc();
  f.setCpu(1000);
  f.setProc(10, { comm: 'worker', utime: 100, read: 0 });
  f.setProc(11, { comm: 'idle', utime: 5 });
  const svc = new ProcessService({ procRoot: f.root, clockTicks: 100, pageSize: 4096, myUid: 1000 });

  const first = await svc.sample();
  assert.equal(first.processes.length, 2);
  assert.ok(first.processes.every((p) => p.cpuPercent === 0), 'no baseline on first sample');

  f.setCpu(1200); // 200 ticks elapsed machine-wide
  f.setProc(10, { comm: 'worker', utime: 150, read: 8192 });
  await new Promise((r) => setTimeout(r, 20));
  const second = await svc.sample();
  const worker = second.processes.find((p) => p.pid === 10);
  assert.equal(worker.cpuPercent, 25);
  assert.equal(worker.memory, (100 - 40) * 4096);
  assert.ok(worker.diskRead > 0);
  assert.equal(worker.startedAt, (1700000000 + 5) * 1000);
});

test('ProcessService prefers untruncated argv[0] names and drops exited processes', async () => {
  const f = fakeProc();
  f.setCpu(100);
  f.setProc(20, { comm: 'gnome-shell-cal', utime: 1, cmdline: '/usr/libexec/gnome-shell-calendar-server\0' });
  f.setProc(21, { comm: 'short', utime: 1 });
  const svc = new ProcessService({ procRoot: f.root });
  let { processes } = await svc.sample();
  assert.equal(processes.find((p) => p.pid === 20).name, 'gnome-shell-calendar-server');

  fs.rmSync(path.join(f.root, '21'), { recursive: true });
  ({ processes } = await svc.sample());
  assert.deepEqual(processes.map((p) => p.pid), [20]);
  assert.equal(svc.prev.size, 1);
});

test('ProcessService.signal rejects unknown actions', async () => {
  const svc = new ProcessService({ procRoot: '/proc' });
  await assert.rejects(svc.signal(1, 'explode'), /Unknown action/);
});

test('ProcessService.signal reports ESRCH for a missing pid', async () => {
  const svc = new ProcessService({ procRoot: '/proc' });
  const result = await svc.signal(4194300, 'continue');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ESRCH');
});

test('ResourceService produces rates after the first sample', async () => {
  const f = fakeProc();
  fs.mkdirSync(path.join(f.root, 'sys/block/sda'), { recursive: true });
  fs.mkdirSync(path.join(f.root, 'sys/block/loop0'), { recursive: true });
  const setAll = (busy, idle, rx, sectors) => {
    f.write('stat', `cpu  ${busy} 0 0 ${idle} 0 0 0 0\ncpu0 ${busy} 0 0 ${idle} 0 0 0 0\n`);
    f.write('meminfo', 'MemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n');
    f.write('net/dev', `h1\nh2\n  lo: 999 0 0 0 0 0 0 0 999 0 0 0 0 0 0 0\n eth0: ${rx} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`);
    f.write('diskstats', `8 0 sda 0 0 ${sectors} 0 0 0 0 0 0 0 0\n7 0 loop0 0 0 99999 0 0 0 0 0 0 0 0\n`);
  };
  const svc = new ResourceService({ procRoot: f.root, sysRoot: path.join(f.root, 'sys'), historyLength: 3 });
  setAll(100, 900, 0, 0);
  assert.equal(await svc.sample(), null);

  setAll(150, 950, 10000, 20);
  await new Promise((r) => setTimeout(r, 50));
  const point = await svc.sample();
  assert.equal(point.cpu, 50);
  assert.equal(point.memory.used, 600 * 1024);
  assert.ok(point.network.rx > 0, 'loopback is excluded, eth0 counted');
  assert.equal(point.network.rxTotal, 10000);
  assert.equal(point.disk.readTotal, 20 * 512, 'loop devices are excluded');
  assert.equal(svc.getHistory().points.length, 1);
});

test('FileSystemService filters pseudo filesystems', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mounts-'));
  const mounts = path.join(dir, 'mounts');
  fs.writeFileSync(mounts, [
    'proc /proc proc rw 0 0',
    'tmpfs /run tmpfs rw 0 0',
    `/dev/sda1 ${os.tmpdir()} ext4 rw 0 0`,
    '/dev/loop3 /snap/core/1 squashfs ro 0 0',
  ].join('\n'));
  const rows = await new FileSystemService({ mountsPath: mounts }).sample();
  assert.deepEqual(rows.map((r) => r.mountpoint), [os.tmpdir()]);
  assert.ok(rows[0].total > 0);
  assert.ok(rows[0].percent >= 0 && rows[0].percent <= 100);

  assert.equal(isStorage({ device: '/dev/loop3', type: 'squashfs' }, true), true);
  assert.equal(isStorage({ device: 'server:/export', type: 'nfs4' }, false), true);
});
