'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {Collector}=require('../electron/collector.cjs');
const {defaults}=require('../electron/store.cjs');
const {processSample,dayKey,classifyApp}=require('../electron/tracker.cjs');
const start=new Date(2026,9,10,12).getTime();
function fixture(readWindow=async()=>({owner:{name:'Code.exe'}})) {
  const data=defaults();data.settings.enabled=true;let now=start;
  const collector=new Collector({data,readWindow,readSystem:()=>({idleSeconds:0}),wallNow:()=>now,monotonicNow:()=>now-start});
  return {data,collector,advance:ms=>now+=ms};
}
test('concurrent polls cannot accumulate duplicate time',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>resolve=r));
  const pending=f.collector.poll();assert.equal(await f.collector.poll(),false);
  resolve({owner:{name:'chrome'}});await pending;assert.deepEqual(f.data.days,{});
});
for(const action of ['pause','clear','lock','suspend','preferences']) test(`${action} invalidates a pending foreground result`,async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>resolve=r));const pending=f.collector.poll();
  f.collector.reset();if(action==='pause') f.data.settings.enabled=false;
  if(['lock','suspend'].includes(action))f.collector.blocked=true;
  resolve({owner:{name:'chrome'}});assert.equal(await pending,false);
  assert.equal(f.collector.previous,null);assert.equal(f.collector.currentApp,null);assert.deepEqual(f.data.days,{});
});
test('pause/resume and power boundaries exclude unobserved time',async()=>{
  const f=fixture();await f.collector.poll();f.advance(1000);await f.collector.poll();
  f.data.settings.enabled=false;f.collector.reset();f.advance(30000);await f.collector.poll();
  f.data.settings.enabled=true;await f.collector.poll();f.advance(1000);await f.collector.poll();
  assert.equal(f.data.days[dayKey(start)].apps.vscode.activeMs,2000);
});
test('collector failures reset continuity and permit recovery',async()=>{
  let fail=false;const f=fixture(async()=>{if(fail)throw new Error('native failure');return {owner:{name:'chrome'}};});
  await f.collector.poll();fail=true;f.advance(1000);await assert.rejects(f.collector.poll());
  assert.equal(f.collector.previous,null);fail=false;await f.collector.poll();assert.deepEqual(f.data.days,{});
});
test('monotonic elapsed time survives wall clock changes and counts delayed samples up to five seconds',()=>{
  const data=defaults();data.settings.enabled=true;
  const previous=processSample(data,null,{now:start,monotonic:0,appName:'chrome',idleSeconds:0}).previous;
  processSample(data,previous,{now:start-3600000,monotonic:4000,appName:'chrome',idleSeconds:0});
  assert.equal(data.days[dayKey(start)].apps.chrome.activeMs,4000);
});
test('midnight interval is split into the correct local dates',()=>{
  const data=defaults();data.settings.enabled=true;const midnight=new Date(2026,9,11).getTime();
  const previous=processSample(data,null,{now:midnight-500,appName:'chrome',idleSeconds:0}).previous;
  processSample(data,previous,{now:midnight+500,appName:'chrome',idleSeconds:0});
  assert.equal(data.days[dayKey(midnight-1)].apps.chrome.activeMs,500);assert.equal(data.days[dayKey(midnight)].apps.chrome.activeMs,500);
});
test('idle threshold crossings split active and idle portions',()=>{
  const data=defaults();data.settings.enabled=true;
  const previous=processSample(data,null,{now:start,appName:'chrome',idleSeconds:119.5}).previous;
  processSample(data,previous,{now:start+1000,appName:'chrome',idleSeconds:120.5});
  const row=data.days[dayKey(start)].apps.chrome;assert.equal(row.activeMs,500);assert.equal(row.idleMs,500);
});
test('locked and unmonitored intervals cannot leak into the next monitored interval',()=>{
  const data=defaults();data.settings.enabled=true;
  let previous=processSample(data,null,{now:start,appName:'Spotify',idleSeconds:0}).previous;
  previous=processSample(data,previous,{now:start+1000,appName:'chrome',idleSeconds:0}).previous;
  assert.deepEqual(data.days,{});
  const result=processSample(data,previous,{now:start+2000,appName:'chrome',locked:true,idleSeconds:0});
  assert.equal(result.previous,null);assert.deepEqual(data.days,{});
});
test('supported apps normalize names without inferring CLI agents from a host',()=>{
  for(const name of ['Code.exe','Google Chrome','Adobe Illustrator','Adobe Photoshop','AfterFX.exe','CapCut'])assert.ok(classifyApp(name));
  assert.equal(classifyApp('Windows Terminal'),null);assert.equal(classifyApp('Claude')?.name,'Claude');
  assert.equal(classifyApp('Visual Studio Code').name,'VS Code');
});
