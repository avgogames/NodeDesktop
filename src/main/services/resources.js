'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { readText } = require('../proc/reader');
const { parseCpuStat, parseMeminfo, parseNetDev, parseDiskstats } = require('../proc/parsers');

/** Interfaces that never carry real traffic and would only add noise. */
const IGNORED_IFACE = /^(lo|veth|docker|br-|virbr)/;
/** Block devices that are not physical disks. */
const IGNORED_DISK = /^(loop|ram|zram|dm-|md|sr|fd)/;

/**
 * Samples system-wide CPU, memory, swap, network and disk throughput and
 * keeps a bounded history so a renderer (re)load can draw full graphs
 * immediately instead of starting from an empty chart.
 */
class ResourceService {
  constructor({ procRoot = '/proc', sysRoot = '/sys', historyLength = 60 } = {}) {
    this.procRoot = procRoot;
    this.sysRoot = sysRoot;
    this.historyLength = historyLength;
    this.history = [];
    this.prev = null;
    this.disks = null;
  }

  async sample() {
    const [statText, memText, netText, diskText] = await Promise.all([
      readText(path.join(this.procRoot, 'stat')),
      readText(path.join(this.procRoot, 'meminfo')),
      readText(path.join(this.procRoot, 'net/dev')),
      readText(path.join(this.procRoot, 'diskstats')),
    ]);
    if (!this.disks) this.disks = await this.listPhysicalDisks();

    const now = Date.now();
    const cpu = statText ? parseCpuStat(statText) : { total: null, cores: [] };
    const mem = memText ? parseMeminfo(memText) : null;

    const net = (netText ? parseNetDev(netText) : []).filter((i) => !IGNORED_IFACE.test(i.name));
    const rxTotal = sum(net, 'rxBytes');
    const txTotal = sum(net, 'txBytes');

    const disks = (diskText ? parseDiskstats(diskText) : []).filter((d) => this.disks.has(d.name));
    const diskReadTotal = sum(disks, 'readBytes');
    const diskWriteTotal = sum(disks, 'writeBytes');

    const prev = this.prev;
    const dt = prev ? (now - prev.time) / 1000 : 0;
    const perSecond = (cur, before) => (prev && dt > 0 ? Math.max(0, (cur - before) / dt) : 0);
    const usage = (cur, before) => {
      if (!before) return 0;
      const dTotal = cur.total - before.total;
      return dTotal > 0 ? Math.min(100, Math.max(0, ((cur.busy - before.busy) / dTotal) * 100)) : 0;
    };

    const point = {
      time: now,
      cpu: cpu.total ? usage(cpu.total, prev?.cpu.total) : 0,
      cores: cpu.cores.map((c, i) => usage(c, prev?.cpu.cores[i])),
      memory: mem,
      network: {
        rx: perSecond(rxTotal, prev?.rxTotal ?? 0),
        tx: perSecond(txTotal, prev?.txTotal ?? 0),
        rxTotal,
        txTotal,
      },
      disk: {
        read: perSecond(diskReadTotal, prev?.diskReadTotal ?? 0),
        write: perSecond(diskWriteTotal, prev?.diskWriteTotal ?? 0),
        readTotal: diskReadTotal,
        writeTotal: diskWriteTotal,
      },
    };

    this.prev = { time: now, cpu, rxTotal, txTotal, diskReadTotal, diskWriteTotal };
    // The first sample has no baseline for rates, so it is not recorded.
    if (prev) {
      this.history.push(point);
      if (this.history.length > this.historyLength) this.history.shift();
    }
    return prev ? point : null;
  }

  getHistory() {
    return { historyLength: this.historyLength, points: this.history.slice() };
  }

  setHistoryLength(n) {
    this.historyLength = n;
    while (this.history.length > n) this.history.shift();
  }

  /** Whole disks from /sys/block, so partitions aren't double counted. */
  async listPhysicalDisks() {
    try {
      const names = await fs.readdir(path.join(this.sysRoot, 'block'));
      return new Set(names.filter((n) => !IGNORED_DISK.test(n)));
    } catch {
      return new Set();
    }
  }
}

function sum(list, key) {
  return list.reduce((acc, item) => acc + (item[key] || 0), 0);
}

module.exports = { ResourceService };
