'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {classifyApp,dayKey,processSample} = require('../electron/tracker.cjs');
const {defaults} = require('../electron/store.cjs');

test('recognized creative applications are normalized, terminal app is not assumed Claude Code', () => {
  assert.equal(classifyApp('Code.exe')?.name,'VS Code');
  assert.equal(classifyApp('AfterFX.exe')?.name,'Adobe After Effects');
  assert.equal(classifyApp('CapCut')?.name,'CapCut');
  assert.equal(classifyApp('Windows Terminal'),null);
  assert.equal(classifyApp('Windows Terminal',true)?.name,'Windows Terminal');
});

test('no usage is recorded before explicit consent', () => {
  const data = defaults();
  processSample(data,null,{appName:'Code.exe',now:1000,idleSeconds:0});
  assert.equal(Object.keys(data.days).length,0);
});

test('active time, idle time and cursor movement sampling are accounted separately', () => {
  const data = defaults();data.settings.enabled=true;
  const start = new Date(2026,9,10,9).getTime();
  let prev = processSample(data,null,{appName:'Code.exe',now:start,idleSeconds:0,position:{x:10,y:10}}).previous;
  prev = processSample(data,prev,{appName:'Code.exe',now:start+1000,idleSeconds:0,position:{x:35,y:10}}).previous;
  prev = processSample(data,prev,{appName:'Code.exe',now:start+2000,idleSeconds:200,position:{x:35,y:10}}).previous;
  const app = data.days[dayKey(start)].apps.vscode;
  assert.equal(app.activeMs,1000);
  assert.equal(app.idleMs,1000);
  assert.equal(app.foregroundMs,2000);
  assert.equal(app.movementSamples,1);
  assert.equal(app.cursorDistancePixels,25);
});

test('sleep and large clock jumps are discarded', () => {
  const data = defaults();data.settings.enabled=true;
  const start = Date.now();
  const prev = processSample(data,null,{appName:'chrome',now:start,idleSeconds:0}).previous;
  processSample(data,prev,{appName:'chrome',now:start+3600000,idleSeconds:0});
  assert.equal(Object.keys(data.days).length,0);
});

test('tracked foreground changes increment switch count', () => {
  const data = defaults();data.settings.enabled=true;
  const start = Date.now();
  let prev = processSample(data,null,{appName:'chrome',now:start,idleSeconds:0}).previous;
  prev = processSample(data,prev,{appName:'photoshop',now:start+1000,idleSeconds:0}).previous;
  assert.equal(data.days[dayKey(start)].switches,1);
  assert.equal(data.days[dayKey(start)].apps.chrome.activeMs,1000);
});

test('untracked applications do not count as productive application time', () => {
  const data = defaults();data.settings.enabled=true;
  const start=Date.now();
  const prev = processSample(data,null,{appName:'chrome',now:start,idleSeconds:0}).previous;
  processSample(data,prev,{appName:'Spotify',now:start+1000,idleSeconds:0});
  assert.equal(Object.keys(data.days).length,0);
});
