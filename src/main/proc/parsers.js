'use strict';

/**
 * Pure parsers for the Linux procfs text formats used by the monitor.
 *
 * Every function takes the raw file contents as a string and returns plain
 * data. Nothing here touches the filesystem, which keeps the parsing logic
 * fully unit-testable against fixtures (see test/parsers.test.js).
 */

/**
 * Parse /proc/<pid>/stat.
 *
 * The second field (comm) is wrapped in parentheses and may itself contain
 * spaces or parentheses, so we split on the *last* closing parenthesis.
 * Field numbers in comments follow proc(5).
 */
function parsePidStat(text) {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;

  const pid = Number(text.slice(0, open).trim());
  const comm = text.slice(open + 1, close);
  const rest = text.slice(close + 2).trim().split(/\s+/);
  // rest[0] is field (3), so field (n) lives at rest[n - 3].
  const field = (n) => Number(rest[n - 3]);

  return {
    pid,
    comm,
    state: rest[0],
    ppid: field(4),
    utime: field(14),
    stime: field(15),
    priority: field(18),
    nice: field(19),
    threads: field(20),
    starttime: field(22),
    vsize: field(23),
    rssPages: field(24),
  };
}

/** Parse /proc/<pid>/statm. All values are in pages. */
function parsePidStatm(text) {
  const [size, resident, shared, textSeg, , data] = text.trim().split(/\s+/).map(Number);
  return { size, resident, shared, text: textSeg, data };
}

/** Parse /proc/<pid>/io. Returns byte counters actually hitting storage. */
function parsePidIo(text) {
  const kv = parseKeyValue(text, ':');
  return {
    readBytes: kv.read_bytes ?? 0,
    writeBytes: kv.write_bytes ?? 0,
    cancelledWriteBytes: kv.cancelled_write_bytes ?? 0,
  };
}

/** Parse /proc/<pid>/status into a map of key -> raw string value. */
function parsePidStatus(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1).trim();
  }
  return out;
}

/** Parse /proc/<pid>/cmdline (NUL separated argv). */
function parseCmdline(text) {
  return text.split('\0').filter((s) => s.length > 0);
}

/**
 * Parse /proc/stat. Returns the aggregate CPU line, one entry per core and
 * the boot time (seconds since the epoch).
 */
function parseCpuStat(text) {
  const result = { total: null, cores: [], btime: 0 };
  for (const line of text.split('\n')) {
    if (line.startsWith('cpu')) {
      const parts = line.trim().split(/\s+/);
      const name = parts[0];
      const v = parts.slice(1).map(Number);
      // user nice system idle iowait irq softirq steal (guest is already in user)
      const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = v;
      const idleAll = idle + iowait;
      const total = user + nice + system + idle + iowait + irq + softirq + steal;
      const entry = { name, total, idle: idleAll, busy: total - idleAll };
      if (name === 'cpu') result.total = entry;
      else result.cores.push(entry);
    } else if (line.startsWith('btime ')) {
      result.btime = Number(line.slice(6));
    }
  }
  return result;
}

/** Parse /proc/meminfo. Values are returned in bytes. */
function parseMeminfo(text) {
  const raw = {};
  for (const line of text.split('\n')) {
    const m = /^(\S+):\s+(\d+)(?:\s+kB)?/.exec(line);
    if (m) raw[m[1]] = Number(m[2]) * 1024;
  }
  const total = raw.MemTotal ?? 0;
  // MemAvailable exists since Linux 3.14; estimate it on older kernels.
  const available = raw.MemAvailable ?? (raw.MemFree ?? 0) + (raw.Buffers ?? 0) + (raw.Cached ?? 0);
  const swapTotal = raw.SwapTotal ?? 0;
  const swapFree = raw.SwapFree ?? 0;
  return {
    total,
    available,
    used: Math.max(0, total - available),
    cached: (raw.Cached ?? 0) + (raw.Buffers ?? 0),
    swapTotal,
    swapUsed: Math.max(0, swapTotal - swapFree),
  };
}

/** Parse /proc/net/dev. Returns cumulative byte counters per interface. */
function parseNetDev(text) {
  const out = [];
  for (const line of text.split('\n').slice(2)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().split(/\s+/).map(Number);
    out.push({ name, rxBytes: v[0], txBytes: v[8] });
  }
  return out;
}

/** Parse /proc/diskstats. Sector counts in diskstats are always 512 bytes. */
function parseDiskstats(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p.length < 10) continue;
    out.push({
      name: p[2],
      readBytes: Number(p[5]) * 512,
      writeBytes: Number(p[9]) * 512,
    });
  }
  return out;
}

/** Decode the octal escapes the kernel uses in mount paths (e.g. \040). */
function unescapeMountField(s) {
  return s.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

/** Parse /proc/self/mounts (fstab format). */
function parseMounts(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    out.push({
      device: unescapeMountField(p[0]),
      mountpoint: unescapeMountField(p[1]),
      type: p[2],
      options: p[3].split(','),
    });
  }
  return out;
}

/** Parse /etc/passwd into a Map of uid -> username. */
function parsePasswd(text) {
  const users = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const p = line.split(':');
    if (p.length >= 3) users.set(Number(p[2]), p[0]);
  }
  return users;
}

/** Parse /proc/<pid>/maps into a list of mappings. */
function parseMaps(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const m = /^([0-9a-f]+)-([0-9a-f]+)\s+(\S+)\s+([0-9a-f]+)\s+(\S+)\s+(\d+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const start = BigInt('0x' + m[1]);
    const end = BigInt('0x' + m[2]);
    out.push({
      start: m[1],
      end: m[2],
      size: Number(end - start),
      perms: m[3],
      offset: m[4],
      device: m[5],
      inode: Number(m[6]),
      path: m[7] || '',
    });
  }
  return out;
}

/** Parse /etc/os-release style KEY="value" files. */
function parseOsRelease(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** Read the first "model name" from /proc/cpuinfo. */
function parseCpuModel(text) {
  const m = /^model name\s*:\s*(.+)$/m.exec(text) || /^Hardware\s*:\s*(.+)$/m.exec(text);
  return m ? m[1].trim() : 'Unknown processor';
}

function parseKeyValue(text, sep) {
  const out = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(sep);
    if (idx > 0) out[line.slice(0, idx).trim()] = Number(line.slice(idx + 1).trim());
  }
  return out;
}

module.exports = {
  parsePidStat,
  parsePidStatm,
  parsePidIo,
  parsePidStatus,
  parseCmdline,
  parseCpuStat,
  parseMeminfo,
  parseNetDev,
  parseDiskstats,
  parseMounts,
  parsePasswd,
  parseMaps,
  parseOsRelease,
  parseCpuModel,
  unescapeMountField,
};
