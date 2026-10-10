'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

class UpdateCheckpoint {
  constructor({getWindow, store, getCollector, folder, version, onFreeze, timeoutMs = 10000}) {
    Object.assign(this, {getWindow, store, getCollector, folder, version, onFreeze, timeoutMs});
  }
  async prepare() {
    if (this.pending || this.frozen) throw new Error('Restart already pending');
    this.frozen = true;
    this.onFreeze(true);
    const collector = this.getCollector();
    if (collector) { collector.blocked = true; collector.reset(); }
    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw new Error('Workspace unavailable');
    const workspace = await new Promise((resolve, reject) => {
      const token = randomUUID();
      const timer = setTimeout(() => { this.pending = null; reject(new Error('Workspace save timed out')); }, this.timeoutMs);
      this.pending = {token, timer, resolve, reject};
      window.webContents.send('minute:update-prepare', token);
    });
    this.store.save(); // Unlike periodic saves, errors must prevent restarting.
    await window.webContents.session.flushStorageData();
    const backupFolder = path.join(this.folder, 'update-backups');
    fs.mkdirSync(backupFolder, {recursive: true});
    const file = path.join(backupFolder, `${Date.now()}-${randomUUID()}.json`);
    fs.writeFileSync(file, JSON.stringify({version: this.version, activity: this.store.data, workspace}),
      {encoding: 'utf8', flag: 'wx', flush: true});
    // Keep the three newest recovery points without touching the live data files.
    const backups = fs.readdirSync(backupFolder).filter(name => /^\d+-[\da-f-]+\.json$/.test(name)).sort().reverse();
    for (const name of backups.slice(3)) fs.unlinkSync(path.join(backupFolder, name));
  }
  acknowledge(payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.token !== 'string' ||
      typeof payload.ok !== 'boolean' || !this.pending || payload.token !== this.pending.token) throw new Error('Invalid update checkpoint');
    if (payload.ok && (typeof payload.workspace !== 'string' || payload.workspace.length > 25 * 1024 * 1024)) throw new Error('Invalid workspace snapshot');
    if (payload.ok) {
      const parsed = JSON.parse(payload.workspace);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.state !== 'string' || !JSON.parse(parsed.state)?.projects) throw new Error('Invalid workspace snapshot');
    }
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    if (payload.ok) pending.resolve(JSON.parse(payload.workspace));
    else pending.reject(new Error('Workspace could not be saved'));
    return true;
  }
  cancel() {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('Restart canceled')); this.pending = null; }
    if (!this.frozen) return;
    this.frozen = false;
    this.onFreeze(false);
    const window = this.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('minute:update-cancel');
  }
}
module.exports = {UpdateCheckpoint};
