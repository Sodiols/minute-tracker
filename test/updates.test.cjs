'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {Updates, RETRY_DELAYS, CHECK_INTERVAL} = require('../electron/updates.cjs');
function setup(overrides = {}) {
  const updater = new EventEmitter();
  const calls = []; const timers = new Map(); let id = 0;
  updater.checkForUpdates = async () => { calls.push('check'); updater.emit('update-available', {version: '0.4.0', releaseNotes: '<img src=x onerror=alert(1)>'}); };
  updater.downloadUpdate = async () => { calls.push('download'); updater.emit('update-downloaded', {version: '0.4.0'}); };
  updater.quitAndInstall = () => { calls.push('install'); };
  const service = new Updates({updater, version: '0.3.0', enabled: true, notify: () => {},
    confirmInstall: async () => { calls.push('confirm'); return true; },
    prepareRestart: async () => { calls.push('save'); }, cancelRestart: () => { calls.push('cancel'); },
    setTimer: (fn, delay) => { timers.set(++id, {fn, delay}); return id; }, clearTimer: key => timers.delete(key), ...overrides});
  return {service, updater, calls, timers};
}
test('startup check, periodic checks and bounded retry backoff never download automatically', async () => {
  const {service, updater, calls, timers} = setup(); service.start();
  assert.equal([...timers.values()][0].delay, 15000);
  await service.check(); assert.deepEqual(calls, ['check']);
  assert.equal([...timers.values()][0].delay, CHECK_INTERVAL);
  updater.checkForUpdates = async () => { throw new Error('secret URL'); };
  for (const delay of [...RETRY_DELAYS, CHECK_INTERVAL]) {
    await service.check(); assert.equal([...timers.values()][0].delay, delay);
    assert.ok(!service.snapshot().error.includes('secret'));
  }
  service.dispose(); assert.equal(timers.size, 0);
});
test('explicit download and confirmed save precede installation; never install on ordinary quit', async () => {
  const {service, updater, calls} = setup();
  assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false); assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.disableWebInstaller, true);
  await service.check(); await service.download(); await service.install();
  assert.deepEqual(calls, ['check', 'download', 'confirm', 'save', 'install']);
});
test('cancel confirmation leaves tracking and downloaded update untouched', async () => {
  const {service, calls} = setup({confirmInstall: async () => false});
  await service.check(); await service.download(); await service.install();
  assert.deepEqual(calls, ['check', 'download']); assert.equal(service.snapshot().phase, 'downloaded');
});
test('failed persistence prevents restart and restores tracking', async () => {
  const {service, calls} = setup({prepareRestart: async () => { throw new Error('Disk full'); }});
  await service.check(); await service.download(); await service.install();
  assert.ok(!calls.includes('install')); assert.ok(calls.includes('cancel'));
  assert.equal(service.snapshot().phase, 'downloaded');
});
test('verification or network failure allows explicit retry without replacing the installed version', async () => {
  const {service, updater, calls} = setup(); await service.check();
  const download = updater.downloadUpdate;
  updater.downloadUpdate = async () => { updater.emit('error', new Error('invalid signature')); throw new Error('invalid signature'); };
  await service.download(); assert.equal(service.snapshot().phase, 'available'); assert.ok(service.snapshot().error);
  assert.ok(!calls.includes('install')); updater.downloadUpdate = download;
  await service.download(); assert.equal(service.snapshot().phase, 'downloaded');
});
test('concurrent requests cannot duplicate downloads or install confirmations', async () => {
  const {service, updater, calls} = setup(); await service.check();
  let finish; updater.downloadUpdate = () => new Promise(resolve => { finish = () => { updater.emit('update-downloaded', {version: '0.4.0'}); resolve(); }; });
  const first = service.download(); await service.download(); await service.check();
  finish(); await first;
  let confirm; service.confirmInstall = () => new Promise(resolve => { calls.push('confirm'); confirm = resolve; });
  const install = service.install(); await service.install(); confirm(true); await install;
  assert.equal(calls.filter(value => value === 'confirm').length, 1);
  assert.equal(calls.filter(value => value === 'install').length, 1);
});
test('installed-ready update is not discarded by periodic checks', async () => {
  const {service, calls} = setup(); await service.check(); await service.download(); await service.check();
  assert.equal(calls.filter(value => value === 'check').length, 1);
  assert.equal(service.snapshot().phase, 'downloaded');
});
test('asynchronous installer error and installer timeout unfreeze the workspace', async () => {
  for (const timeout of [false, true]) {
    const {service, updater, calls, timers} = setup(); await service.check(); await service.download(); await service.install();
    if (timeout) [...timers.values()].find(timer => timer.delay === 15000).fn();
    else updater.emit('error', new Error('spawn failed'));
    assert.ok(calls.includes('cancel')); assert.equal(service.snapshot().phase, 'downloaded');
  }
});
test('development source cannot check, download or install', async () => {
  const {service, calls, timers} = setup({enabled: false});
  service.start(); await service.check(); await service.download(); await service.install();
  assert.deepEqual(calls, []); assert.equal(timers.size, 0);
});
test('progress is bounded and release HTML remains inert text', async () => {
  const {service, updater} = setup(); await service.check();
  assert.equal(service.snapshot().releaseNotes, '<img src=x onerror=alert(1)>');
  service.change({phase: 'downloading'});
  updater.emit('download-progress', {percent: 150, transferred: NaN, total: -1, bytesPerSecond: Infinity});
  assert.equal(service.snapshot().progress, 100); assert.equal(service.snapshot().transferred, 0);
});
