'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/main/proc/parsers');

test('parsePidStat handles spaces and parentheses in comm', () => {
  const text = '1234 (Web Content (x)) S 1000 1234 1234 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 31 0 98765 2147483648 51200 18446744073709551615';
  const s = p.parsePidStat(text);
  assert.equal(s.pid, 1234);
  assert.equal(s.comm, 'Web Content (x)');
  assert.equal(s.state, 'S');
  assert.equal(s.ppid, 1000);
  assert.equal(s.utime, 250);
  assert.equal(s.stime, 50);
  assert.equal(s.priority, 20);
  assert.equal(s.nice, 0);
  assert.equal(s.threads, 31);
  assert.equal(s.starttime, 98765);
  assert.equal(s.vsize, 2147483648);
  assert.equal(s.rssPages, 51200);
});

test('parsePidStat rejects garbage', () => {
  assert.equal(p.parsePidStat('nonsense'), null);
});

test('parsePidStatm returns pages', () => {
  assert.deepEqual(p.parsePidStatm('5000 1200 300 10 0 900 0\n'),
    { size: 5000, resident: 1200, shared: 300, text: 10, data: 900 });
});

test('parsePidIo reads storage byte counters', () => {
  const io = p.parsePidIo('rchar: 10\nwchar: 20\nsyscr: 1\nsyscw: 2\nread_bytes: 4096\nwrite_bytes: 8192\ncancelled_write_bytes: 0\n');
  assert.deepEqual(io, { readBytes: 4096, writeBytes: 8192, cancelledWriteBytes: 0 });
});

test('parseCmdline splits on NUL', () => {
  assert.deepEqual(p.parseCmdline('/usr/bin/node\0--inspect\0app.js\0'), ['/usr/bin/node', '--inspect', 'app.js']);
  assert.deepEqual(p.parseCmdline(''), []);
});

test('parseCpuStat computes busy/idle and btime', () => {
  const text = [
    'cpu  100 0 50 800 50 0 0 0 0 0',
    'cpu0 60 0 20 400 20 0 0 0 0 0',
    'cpu1 40 0 30 400 30 0 0 0 0 0',
    'intr 12345',
    'btime 1700000000',
  ].join('\n');
  const s = p.parseCpuStat(text);
  assert.equal(s.total.total, 1000);
  assert.equal(s.total.idle, 850);
  assert.equal(s.total.busy, 150);
  assert.equal(s.cores.length, 2);
  assert.equal(s.cores[1].busy, 70);
  assert.equal(s.btime, 1700000000);
});

test('parseMeminfo derives used memory from MemAvailable', () => {
  const m = p.parseMeminfo([
    'MemTotal:       16000000 kB',
    'MemFree:         2000000 kB',
    'MemAvailable:   10000000 kB',
    'Buffers:          500000 kB',
    'Cached:          4000000 kB',
    'SwapTotal:       2000000 kB',
    'SwapFree:        1500000 kB',
  ].join('\n'));
  assert.equal(m.total, 16000000 * 1024);
  assert.equal(m.used, 6000000 * 1024);
  assert.equal(m.cached, 4500000 * 1024);
  assert.equal(m.swapUsed, 500000 * 1024);
});

test('parseMeminfo estimates available memory on old kernels', () => {
  const m = p.parseMeminfo('MemTotal: 1000 kB\nMemFree: 200 kB\nBuffers: 100 kB\nCached: 300 kB\n');
  assert.equal(m.available, 600 * 1024);
});

test('parseNetDev reads rx/tx bytes', () => {
  const text = [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    '    lo:  1000      10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0',
    '  eth0: 123456    100    0    0    0     0          0         0    654321     90    0    0    0     0       0          0',
  ].join('\n');
  assert.deepEqual(p.parseNetDev(text), [
    { name: 'lo', rxBytes: 1000, txBytes: 1000 },
    { name: 'eth0', rxBytes: 123456, txBytes: 654321 },
  ]);
});

test('parseDiskstats converts sectors to bytes', () => {
  const d = p.parseDiskstats('   8       0 sda 100 0 2000 50 10 0 400 5 0 60 55 0 0 0 0\n');
  assert.deepEqual(d, [{ name: 'sda', readBytes: 2000 * 512, writeBytes: 400 * 512 }]);
});

test('parseMounts decodes octal escapes', () => {
  const m = p.parseMounts('/dev/sdb1 /media/My\\040Disk ext4 rw,relatime 0 0\n');
  assert.equal(m[0].mountpoint, '/media/My Disk');
  assert.equal(m[0].type, 'ext4');
  assert.deepEqual(m[0].options, ['rw', 'relatime']);
});

test('parsePasswd maps uids', () => {
  const users = p.parsePasswd('root:x:0:0:root:/root:/bin/bash\n# comment\nalice:x:1000:1000::/home/alice:/bin/zsh\n');
  assert.equal(users.get(0), 'root');
  assert.equal(users.get(1000), 'alice');
});

test('parseMaps computes mapping sizes', () => {
  const maps = p.parseMaps('55d0c0a00000-55d0c0a21000 r-xp 00000000 08:01 131 /usr/bin/cat\n7ffd1000-7ffd2000 rw-p 00000000 00:00 0 \n');
  assert.equal(maps.length, 2);
  assert.equal(maps[0].size, 0x21000);
  assert.equal(maps[0].path, '/usr/bin/cat');
  assert.equal(maps[1].path, '');
});

test('parseOsRelease and parseCpuModel', () => {
  assert.equal(p.parseOsRelease('NAME="Fedora Linux"\nPRETTY_NAME="Fedora Linux 41"\n').PRETTY_NAME, 'Fedora Linux 41');
  assert.equal(p.parseCpuModel('processor : 0\nmodel name\t: AMD Ryzen 7 5800X\n'), 'AMD Ryzen 7 5800X');
});
