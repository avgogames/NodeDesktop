'use strict';

const fs = require('node:fs/promises');
const { readText, withTimeout } = require('../proc/reader');
const { parseMounts } = require('../proc/parsers');

/** Filesystem types that are backed by real storage even without a /dev node. */
const STORAGE_TYPES = new Set([
  'btrfs', 'zfs', 'xfs', 'ext2', 'ext3', 'ext4', 'f2fs', 'vfat', 'exfat', 'ntfs', 'ntfs3',
  'fuseblk', 'nfs', 'nfs4', 'cifs', 'smb3', 'fuse.sshfs', 'bcachefs', 'overlay',
]);
/** Read-only images (snaps, live media) are hidden unless "show all" is on. */
const HIDDEN_BY_DEFAULT = new Set(['squashfs', 'iso9660', 'erofs']);

const STATFS_TIMEOUT_MS = 1500;

class FileSystemService {
  constructor({ mountsPath = '/proc/self/mounts' } = {}) {
    this.mountsPath = mountsPath;
  }

  async sample({ showAll = false } = {}) {
    const text = await readText(this.mountsPath);
    if (!text) return [];
    const seen = new Set();
    const mounts = parseMounts(text).filter((m) => {
      if (seen.has(m.mountpoint)) return false;
      seen.add(m.mountpoint);
      return isStorage(m, showAll);
    });

    const rows = await Promise.all(mounts.map(async (m) => {
      try {
        // statfs can hang forever on an unreachable network share.
        const s = await withTimeout(fs.statfs(m.mountpoint), STATFS_TIMEOUT_MS);
        const total = s.blocks * s.bsize;
        const free = s.bfree * s.bsize;
        const available = s.bavail * s.bsize;
        return {
          ...m,
          readOnly: m.options.includes('ro'),
          total,
          free,
          available,
          used: total - free,
          // Like df: used / (used + available) so root-reserved blocks count as full.
          percent: total - free + available > 0 ? ((total - free) / (total - free + available)) * 100 : 0,
        };
      } catch (err) {
        return { ...m, error: err.message };
      }
    }));
    return rows
      .filter((r) => showAll || r.error || r.total > 0)
      .sort((a, b) => a.mountpoint.localeCompare(b.mountpoint));
  }
}

function isStorage(mount, showAll) {
  if (HIDDEN_BY_DEFAULT.has(mount.type)) return showAll;
  if (showAll) return mount.device.startsWith('/') || STORAGE_TYPES.has(mount.type) || mount.type === 'tmpfs';
  return mount.device.startsWith('/dev/') || STORAGE_TYPES.has(mount.type);
}

module.exports = { FileSystemService, isStorage };
