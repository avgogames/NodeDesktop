'use strict';

const os = require('node:os');
const { readText } = require('../proc/reader');
const { parseOsRelease, parseCpuModel, parseMeminfo } = require('../proc/parsers');

/** Static facts about the machine, gathered once at startup. */
async function getSystemInfo() {
  const [osRelease, cpuinfo, meminfo] = await Promise.all([
    readText('/etc/os-release'),
    readText('/proc/cpuinfo'),
    readText('/proc/meminfo'),
  ]);
  const release = osRelease ? parseOsRelease(osRelease) : {};
  return {
    hostname: os.hostname(),
    distro: release.PRETTY_NAME || release.NAME || 'Linux',
    kernel: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpuinfo ? parseCpuModel(cpuinfo) : os.cpus()[0]?.model ?? 'Unknown',
    cpuCount: os.cpus().length,
    memoryTotal: meminfo ? parseMeminfo(meminfo).total : os.totalmem(),
  };
}

module.exports = { getSystemInfo };
