'use strict';

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const RETRY_DELAYS = [60_000, 300_000, 900_000];
function releaseNotes(value) {
  const text = Array.isArray(value) ? value.map(item => typeof item.note === 'string' ? item.note : '').join('\n\n') : value;
  return typeof text === 'string' ? text.slice(0, 32000) : '';
}

// Owns scheduling and UI state; networking and installer verification stay in electron-updater.
class Updates {
  constructor({updater, version, enabled, signed = false, notify, confirmInstall, prepareRestart, cancelRestart,
    setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now}) {
    Object.assign(this, {updater, notify, confirmInstall, prepareRestart, cancelRestart, setTimer, clearTimer, now});
    this.state = {currentVersion: version, availableVersion: null, phase: enabled ? 'idle' : 'disabled',
      releaseNotes: '', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0, lastChecked: null,
      error: '', signed, enabled};
    this.busy = false;
    this.retry = 0;
    this.listeners = [];
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.disableWebInstaller = true;
    updater.logger = null;
    this.on('error', () => {
      // The operation's rejected promise handles recovery. Never forward raw URLs or headers.
      if (this.state.phase === 'installing') this.installFailed();
    });
    this.on('update-available', info => this.change({phase: 'available', availableVersion: info.version,
      releaseNotes: releaseNotes(info.releaseNotes), progress: 0}));
    this.on('update-not-available', () => this.change({phase: 'idle', availableVersion: null, releaseNotes: ''}));
    this.on('download-progress', progress => {
      if (this.state.phase !== 'downloading') return;
      const finite = n => Number.isFinite(n) ? Math.max(0, n) : 0;
      this.change({progress: Math.min(100, finite(progress.percent)), transferred: finite(progress.transferred),
        total: finite(progress.total), bytesPerSecond: finite(progress.bytesPerSecond)});
    });
    this.on('update-downloaded', info => this.change({phase: 'downloaded', availableVersion: info.version, progress: 100}));
  }
  on(event, listener) { this.updater.on(event, listener); this.listeners.push([event, listener]); }
  snapshot() { return {...this.state}; }
  change(patch) { Object.assign(this.state, patch); this.notify(this.snapshot()); }
  schedule(delay) {
    this.clearTimer(this.timer);
    if (this.disposed || !this.state.enabled) return;
    this.timer = this.setTimer(() => { void this.check(); }, delay);
    this.timer?.unref?.();
  }
  start() { this.schedule(15000); }
  async check() {
    if (!this.state.enabled || this.busy || ['downloaded', 'installing', 'downloading'].includes(this.state.phase)) return this.snapshot();
    this.busy = true;
    this.clearTimer(this.timer);
    this.change({phase: 'checking', error: ''});
    try {
      await this.updater.checkForUpdates();
      this.retry = 0;
      this.change({lastChecked: this.now()});
      this.schedule(CHECK_INTERVAL);
    } catch {
      this.change({phase: 'error', error: 'Could not check for updates. Check your connection and try again.'});
      this.schedule(RETRY_DELAYS[this.retry++] ?? CHECK_INTERVAL);
    } finally { this.busy = false; }
    return this.snapshot();
  }
  async download() {
    if (!this.state.enabled || this.busy || this.state.phase !== 'available') return this.snapshot();
    this.busy = true;
    this.change({phase: 'downloading', error: '', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0});
    try {
      await this.updater.downloadUpdate();
    } catch {
      this.change({phase: 'available', progress: 0,
        error: 'Download or verification failed. This version is unchanged. You can retry the download.'});
    } finally { this.busy = false; this.schedule(CHECK_INTERVAL); }
    return this.snapshot();
  }
  installFailed() {
    this.clearTimer(this.installTimer);
    this.cancelRestart();
    this.busy = false;
    this.change({phase: 'downloaded', error: 'Restart was canceled or could not safely complete. Your current version remains available. Try again.'});
  }
  async install() {
    if (!this.state.enabled || this.busy || this.state.phase !== 'downloaded') return this.snapshot();
    this.busy = true;
    try {
      if (!await this.confirmInstall()) { this.busy = false; return this.snapshot(); }
      this.change({phase: 'installing', error: ''});
      await this.prepareRestart();
      // An installer spawn failure can arrive asynchronously without throwing.
      this.installTimer = this.setTimer(() => this.installFailed(), 15000);
      this.updater.quitAndInstall(false, true);
    } catch { this.installFailed(); }
    return this.snapshot();
  }
  dispose() {
    this.disposed = true;
    this.clearTimer(this.timer);
    this.clearTimer(this.installTimer);
    this.listeners.forEach(([event, listener]) => this.updater.removeListener(event, listener));
  }
}
module.exports = {Updates, releaseNotes, CHECK_INTERVAL, RETRY_DELAYS};
