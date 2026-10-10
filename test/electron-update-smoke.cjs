'use strict';
// Runs real main/preload/renderer checkpoint IPC; only network, dialog choice and installer are mocked.
const {app, BrowserWindow, dialog} = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const assert = require('node:assert/strict'); const {EventEmitter} = require('node:events');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'minute-update-smoke-'));
app.setPath('userData', folder); app.setVersion(require('../package.json').version);
const updater = new EventEmitter(); let installed = 0; let accept = false; let service;
updater.checkForUpdates = async () => updater.emit('update-available', {version: '0.4.0', releaseNotes: 'Test update'});
updater.downloadUpdate = async () => updater.emit('update-downloaded', {version: '0.4.0'});
updater.quitAndInstall = () => { installed++; };
dialog.showMessageBox = async () => ({response: accept ? 1 : 0});
const moduleUnderTest = require('../electron/updates.cjs'); const RealUpdates = moduleUnderTest.Updates;
moduleUnderTest.Updates = class extends RealUpdates {
  constructor(options) { super({...options, updater, enabled: true}); service = this; }
};
const {Store} = require('../electron/store.cjs'); const originalSave = Store.prototype.save;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error('UPDATE SMOKE FAIL: timeout'); app.exit(1); }, 30000);
require('../electron/main.cjs');
(async () => {
  try {
    await app.whenReady(); let window;
    for (let i = 0; i < 100; i++) { window = BrowserWindow.getAllWindows()[0]; if (window && !window.webContents.isLoading()) break; await pause(100); }
    await pause(200); const js = source => window.webContents.executeJavaScript(source, true);
    await js('beginSession();minuteDesktop.setEnabled(true)'); await pause(1100);
    await js('minuteDesktop.updates.check()'); await js('minuteDesktop.updates.download()');
    await js('minuteDesktop.updates.install()'); assert.equal(installed, 0);
    assert.equal(await js('state.timer.status'), 'running');
    assert.equal((await js('minuteDesktop.getSummary()')).settings.enabled, true);
    accept = true;
    Store.prototype.save = () => { throw new Error('simulated disk full'); };
    await js('minuteDesktop.updates.install()'); await pause(100);
    assert.equal(installed, 0); assert.equal(await js('state.timer.status'), 'running');
    assert.equal(await js('document.body.inert'), false);
    Store.prototype.save = originalSave;
    await js('minuteDesktop.updates.install()');
    assert.equal(installed, 1); assert.equal(await js('state.timer.status'), 'paused');
    assert.equal(await js('document.body.inert'), true);
    const files = fs.readdirSync(path.join(folder, 'update-backups')); assert.equal(files.length, 1);
    const backup = JSON.parse(fs.readFileSync(path.join(folder, 'update-backups', files[0]), 'utf8'));
    assert.equal(JSON.parse(backup.workspace.state).timer.status, 'paused'); assert.equal(backup.activity.settings.enabled, true);
    updater.emit('error', new Error('simulated installer failure')); await pause(100);
    assert.equal(await js('document.body.inert'), false); assert.equal(await js('state.timer.status'), 'running');
    assert.equal((await js('minuteDesktop.getSummary()')).settings.enabled, true);
    assert.equal(service.snapshot().phase, 'downloaded');
    const report = {passed: ['cancel leaves manual and automatic tracking running', 'disk-full prevents installation and restores tracking',
      'real preload checkpoint pauses, saves, flushes and backs up both stores before installer call', 'installer failure restores renderer and automatic tracking'],
      network: 'mocked', installer: 'mocked', userData: folder};
    fs.writeFileSync(path.join(__dirname, '../audit/electron-update-smoke.json'), JSON.stringify(report, null, 2));
    console.log('UPDATE SMOKE PASS', JSON.stringify(report.passed)); clearTimeout(watchdog); app.quit();
  } catch (error) { Store.prototype.save = originalSave; console.error('UPDATE SMOKE FAIL', error); app.exit(1); }
})();
