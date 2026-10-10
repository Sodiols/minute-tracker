'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const {UpdateCheckpoint} = require('../electron/update-checkpoint.cjs');
const {Store} = require('../electron/store.cjs');
function setup(t, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'minute-update-'));
  t.after(() => fs.rmSync(folder, {recursive: true, force: true}));
  const store = new Store(folder); const collector = {blocked: false, reset() { this.resets = (this.resets || 0) + 1; }};
  const sent = []; let flushed = false;
  const window = {isDestroyed: () => false, webContents: {send: (...args) => sent.push(args), session: {flushStorageData: () => { flushed = true; }}}};
  const checkpoint = new UpdateCheckpoint({getWindow: () => window, store, getCollector: () => collector, folder, version: '0.3.0',
    onFreeze: value => { collector.blocked = value; }, timeoutMs: 100, ...options});
  const acknowledge = () => checkpoint.acknowledge({token: sent[0][1], ok: true, workspace: JSON.stringify({state: JSON.stringify({projects: [{id: 'preserved'}]}), theme: 'dark'})});
  return {checkpoint, store, collector, folder, sent, acknowledge, flushed: () => flushed};
}
test('checkpoint blocks pending samples, flushes both stores and writes a recovery snapshot', async t => {
  const s = setup(t); s.store.data.settings.enabled = true;
  const pending = s.checkpoint.prepare(); assert.equal(s.collector.blocked, true);
  s.acknowledge(); await pending;
  assert.equal(s.flushed(), true); assert.equal(new Store(s.folder).data.settings.enabled, true);
  const backups = fs.readdirSync(path.join(s.folder, 'update-backups'));
  const backup = JSON.parse(fs.readFileSync(path.join(s.folder, 'update-backups', backups[0])));
  assert.equal(backup.workspace.theme, 'dark'); assert.equal(JSON.parse(backup.workspace.state).projects[0].id, 'preserved');
});
test('disk failure aborts restart; cancellation unblocks tracking', async t => {
  const s = setup(t); s.store.save = () => { throw new Error('disk full'); };
  const pending = s.checkpoint.prepare(); s.acknowledge(); await assert.rejects(pending, /disk full/);
  s.checkpoint.cancel(); assert.equal(s.collector.blocked, false); assert.equal(s.sent.at(-1)[0], 'minute:update-cancel');
});
test('missing renderer acknowledgement times out without restarting', async t => {
  const s = setup(t, {timeoutMs: 10}); await assert.rejects(s.checkpoint.prepare(), /timed out/);
  s.checkpoint.cancel(); assert.equal(s.collector.blocked, false);
});
test('checkpoint rejects unsolicited, malformed, oversized and replayed acknowledgements', async t => {
  const s = setup(t); assert.throws(() => s.checkpoint.acknowledge({token: 'forged', ok: true}));
  const pending = s.checkpoint.prepare(); const token = s.sent[0][1];
  for (const payload of [null, {token: 'wrong', ok: true}, {token, ok: 'true'}, {token, ok: true, workspace: '{}'}, {token, ok: true, workspace: 'x'.repeat(25 * 1024 * 1024 + 1)}]) {
    assert.throws(() => s.checkpoint.acknowledge(payload));
  }
  s.acknowledge(); await pending; assert.throws(s.acknowledge);
});
