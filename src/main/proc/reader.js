'use strict';

const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');

/**
 * Read a small text file, returning null instead of throwing when it is
 * missing or unreadable. Processes can exit between listing /proc and
 * reading their files, and many files are root-only, so "not available" is
 * a normal outcome rather than an error.
 */
async function readText(path) {
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** Like readText, but for symlinks such as /proc/<pid>/exe. */
async function readLink(path) {
  try {
    return await fs.readlink(path);
  } catch {
    return null;
  }
}

/** Query a sysconf value via getconf, falling back to a sane default. */
function sysconf(name, fallback) {
  try {
    const v = Number(execFileSync('getconf', [name], { encoding: 'utf8', timeout: 2000 }).trim());
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Reject after `ms` so a hung syscall (e.g. stale NFS statfs) can't stall a sample. */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { readText, readLink, sysconf, withTimeout };
