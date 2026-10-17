'use strict';

const { execFile } = require('node:child_process');
const { readText } = require('../proc/reader');
const { parsePasswd } = require('../proc/parsers');

/**
 * Resolves numeric uids to user names.
 *
 * /etc/passwd covers local accounts. Directory-service users (LDAP, SSSD,
 * systemd-homed) are resolved lazily through `getent passwd <uid>` and
 * cached, so the hot sampling path never blocks on NSS lookups.
 */
class UserResolver {
  constructor({ passwdPath = '/etc/passwd' } = {}) {
    this.passwdPath = passwdPath;
    this.cache = new Map();
    this.pending = new Set();
  }

  async load() {
    const text = await readText(this.passwdPath);
    if (text) this.cache = parsePasswd(text);
  }

  /** Synchronous lookup; returns the uid as a string until it is resolved. */
  name(uid) {
    const known = this.cache.get(uid);
    if (known !== undefined) return known;
    this.resolveInBackground(uid);
    return String(uid);
  }

  resolveInBackground(uid) {
    if (this.pending.has(uid)) return;
    this.pending.add(uid);
    execFile('getent', ['passwd', String(uid)], { timeout: 2000 }, (err, stdout) => {
      const name = !err && stdout ? stdout.split(':')[0] : String(uid);
      this.cache.set(uid, name);
      this.pending.delete(uid);
    });
  }
}

module.exports = { UserResolver };
