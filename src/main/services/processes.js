'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { readText, readLink } = require('../proc/reader');
const {
  parsePidStat,
  parsePidStatm,
  parsePidIo,
  parsePidStatus,
  parseCmdline,
  parseCpuStat,
  parseMaps,
} = require('../proc/parsers');

/** Signals the UI may send. Anything else is rejected at the IPC boundary. */
const SIGNALS = Object.freeze({
  stop: 'SIGSTOP',
  continue: 'SIGCONT',
  end: 'SIGTERM',
  kill: 'SIGKILL',
});

const MAX_OPEN_FILES = 2000;
const MAX_MAPS = 5000;

/**
 * Enumerates processes from procfs and derives rates (CPU %, disk I/O)
 * from the difference between consecutive samples.
 *
 * Per-process state is keyed by `${pid}:${starttime}` so a recycled pid is
 * never mistaken for the process that previously owned it.
 */
class ProcessService {
  constructor({ procRoot = '/proc', clockTicks = 100, pageSize = 4096, users, myUid = os.userInfo().uid }) {
    this.procRoot = procRoot;
    this.clockTicks = clockTicks;
    this.pageSize = pageSize;
    this.users = users;
    this.myUid = myUid;
    this.prev = new Map();     // key -> { cpuTicks, readBytes, writeBytes }
    this.static = new Map();   // key -> { cmdline, name, uid }
    this.prevTotalTicks = null;
    this.prevTime = null;
    this.btime = 0;
  }

  /** Take one sample of every visible process. */
  async sample() {
    const statText = await readText(path.join(this.procRoot, 'stat'));
    const cpu = statText ? parseCpuStat(statText) : null;
    const totalTicks = cpu?.total?.total ?? 0;
    if (cpu?.btime) this.btime = cpu.btime;

    const now = Date.now();
    const dTicks = this.prevTotalTicks === null ? 0 : totalTicks - this.prevTotalTicks;
    const dSeconds = this.prevTime === null ? 0 : (now - this.prevTime) / 1000;

    const entries = await fs.readdir(this.procRoot);
    const pids = entries.filter((e) => /^\d+$/.test(e));
    const results = await Promise.all(pids.map((pid) => this.readProcess(pid, dTicks, dSeconds)));

    const processes = results.filter(Boolean);
    const alive = new Set(processes.map((p) => p.key));
    for (const key of this.prev.keys()) {
      if (!alive.has(key)) {
        this.prev.delete(key);
        this.static.delete(key);
      }
    }

    this.prevTotalTicks = totalTicks;
    this.prevTime = now;
    return { processes, myUid: this.myUid, timestamp: now };
  }

  async readProcess(pid, dTicks, dSeconds) {
    const dir = path.join(this.procRoot, pid);
    const [statText, statmText, ioText] = await Promise.all([
      readText(path.join(dir, 'stat')),
      readText(path.join(dir, 'statm')),
      readText(path.join(dir, 'io')),
    ]);
    if (!statText) return null; // exited mid-sample
    const stat = parsePidStat(statText);
    if (!stat) return null;

    const key = `${stat.pid}:${stat.starttime}`;
    let info = this.static.get(key);
    if (!info) {
      info = await this.readStaticInfo(dir, stat);
      this.static.set(key, info);
    }

    const cpuTicks = stat.utime + stat.stime;
    const io = ioText ? parsePidIo(ioText) : null;
    const prev = this.prev.get(key);
    this.prev.set(key, { cpuTicks, readBytes: io?.readBytes ?? 0, writeBytes: io?.writeBytes ?? 0 });

    // CPU % of the whole machine, i.e. divided by the number of cores
    // (GNOME's default "Solaris mode").
    const cpuPercent = prev && dTicks > 0 ? Math.min(100, ((cpuTicks - prev.cpuTicks) / dTicks) * 100) : 0;
    const rate = (cur, before) => (prev && io && dSeconds > 0 ? Math.max(0, (cur - before) / dSeconds) : 0);

    const statm = statmText ? parsePidStatm(statmText) : null;
    const memory = statm ? Math.max(0, statm.resident - statm.shared) * this.pageSize : 0;

    return {
      key,
      pid: stat.pid,
      ppid: stat.ppid,
      name: info.name,
      cmdline: info.cmdline,
      uid: info.uid,
      user: this.users ? this.users.name(info.uid) : String(info.uid),
      state: stat.state,
      nice: stat.nice,
      threads: stat.threads,
      cpuPercent,
      cpuTime: cpuTicks / this.clockTicks,
      memory,
      virtualMemory: stat.vsize,
      residentMemory: (statm?.resident ?? 0) * this.pageSize,
      sharedMemory: (statm?.shared ?? 0) * this.pageSize,
      diskReadTotal: io ? io.readBytes : null,
      diskWriteTotal: io ? io.writeBytes : null,
      diskRead: rate(io?.readBytes ?? 0, prev?.readBytes ?? 0),
      diskWrite: rate(io?.writeBytes ?? 0, prev?.writeBytes ?? 0),
      startedAt: this.btime ? (this.btime + stat.starttime / this.clockTicks) * 1000 : null,
    };
  }

  /** Fields that never change for the lifetime of a process. */
  async readStaticInfo(dir, stat) {
    const [cmdText, dirStat] = await Promise.all([
      readText(path.join(dir, 'cmdline')),
      fs.stat(dir).catch(() => null),
    ]);
    const argv = cmdText ? parseCmdline(cmdText) : [];
    // comm is truncated to 15 characters; prefer the argv[0] basename when
    // it is clearly the untruncated form of the same name.
    let name = stat.comm;
    if (argv.length > 0) {
      const base = path.basename(argv[0].split(' ')[0]);
      if (stat.comm.length >= 15 && base.startsWith(stat.comm)) name = base;
    }
    return {
      name,
      cmdline: argv.join(' '),
      // The owner of /proc/<pid> is the process's effective uid.
      uid: dirStat ? dirStat.uid : -1,
    };
  }

  /** Detailed information for the properties dialog. */
  async details(pid) {
    const dir = path.join(this.procRoot, String(pid));
    const [statusText, cwd, exe, cmdText, statText] = await Promise.all([
      readText(path.join(dir, 'status')),
      readLink(path.join(dir, 'cwd')),
      readLink(path.join(dir, 'exe')),
      readText(path.join(dir, 'cmdline')),
      readText(path.join(dir, 'stat')),
    ]);
    if (!statusText || !statText) throw new Error(`Process ${pid} no longer exists`);
    const status = parsePidStatus(statusText);
    const stat = parsePidStat(statText);
    const uid = Number((status.Uid || '').split(/\s+/)[1]);
    return {
      pid,
      name: status.Name,
      state: status.State,
      user: this.users ? this.users.name(uid) : String(uid),
      ppid: stat.ppid,
      nice: stat.nice,
      threads: stat.threads,
      cpuTime: (stat.utime + stat.stime) / this.clockTicks,
      startedAt: this.btime ? (this.btime + stat.starttime / this.clockTicks) * 1000 : null,
      vmSize: kbField(status.VmSize),
      vmRss: kbField(status.VmRSS),
      rssAnon: kbField(status.RssAnon),
      rssFile: kbField(status.RssFile),
      rssShmem: kbField(status.RssShmem),
      vmSwap: kbField(status.VmSwap),
      cmdline: cmdText ? parseCmdline(cmdText).join(' ') : '',
      cwd,
      exe,
    };
  }

  /** Open file descriptors of a process (requires same uid or root). */
  async openFiles(pid) {
    const fdDir = path.join(this.procRoot, String(pid), 'fd');
    let fds;
    try {
      fds = await fs.readdir(fdDir);
    } catch (err) {
      throw new Error(err.code === 'EACCES' ? 'Permission denied' : `Cannot read open files: ${err.code}`);
    }
    fds = fds.map(Number).sort((a, b) => a - b).slice(0, MAX_OPEN_FILES);
    const targets = await Promise.all(fds.map((fd) => readLink(path.join(fdDir, String(fd)))));
    return fds.map((fd, i) => ({ fd, type: fdType(targets[i]), target: targets[i] ?? '?' }));
  }

  /** Memory mappings of a process (requires same uid or root). */
  async memoryMaps(pid) {
    const text = await readText(path.join(this.procRoot, String(pid), 'maps'));
    if (text === null) throw new Error('Permission denied');
    return parseMaps(text).slice(0, MAX_MAPS);
  }

  /**
   * Send a signal. On EPERM the caller may retry with `elevated`, which goes
   * through polkit (pkexec) exactly like GNOME System Monitor's helper.
   */
  async signal(pid, action, { elevated = false } = {}) {
    const sig = SIGNALS[action];
    if (!sig) throw new Error(`Unknown action: ${action}`);
    if (elevated) {
      await run('pkexec', ['kill', '-s', sig.replace(/^SIG/, ''), String(pid)]);
      return { ok: true };
    }
    try {
      process.kill(pid, sig);
      return { ok: true };
    } catch (err) {
      return { ok: false, code: err.code, message: err.message };
    }
  }

  /** Change a process's nice value (-20 … 19). */
  async renice(pid, nice, { elevated = false } = {}) {
    if (elevated) {
      await run('pkexec', ['renice', '-n', String(nice), '-p', String(pid)]);
      return { ok: true };
    }
    try {
      os.setPriority(pid, nice);
      return { ok: true };
    } catch (err) {
      // os.setPriority wraps the errno in a SystemError with info.code.
      const code = err.info?.code?.toUpperCase?.() || err.code;
      return { ok: false, code, message: err.message };
    }
  }
}

function kbField(value) {
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n * 1024 : null;
}

function fdType(target) {
  if (!target) return 'unknown';
  if (target.startsWith('socket:')) return 'socket';
  if (target.startsWith('pipe:')) return 'pipe';
  if (target.startsWith('anon_inode:')) return 'anon inode';
  if (target.startsWith('/dev/')) return 'device';
  return 'file';
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve();
    });
  });
}

module.exports = { ProcessService, SIGNALS };
