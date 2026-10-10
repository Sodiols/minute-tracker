'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {pathToFileURL} = require('node:url');
const {Store,defaults,validateHistory} = require('../electron/store.cjs');
const {guardSender} = require('../electron/security.cjs');
const {formatCsv,quote} = require('../electron/csv.cjs');

test('activity history survives atomic save and restart without a trailing temporary file', t=>{
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'minute-store-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const store = new Store(folder);
  store.data.settings.enabled=true;
  store.data.settings.consentGranted=true;
  store.data.days['2026-10-10']={apps:{chrome:{name:'Google Chrome',activeMs:1000,idleMs:2000,foregroundMs:3000,movementSamples:1,cursorDistancePixels:50}},switches:2};
  store.save();
  assert.deepEqual(new Store(folder).data,store.data);
  assert.equal(fs.existsSync(store.file+'.tmp'),false);
  store.reset();
  assert.deepEqual(new Store(folder).data.days,{});
});
test('corrupt JSON is preserved byte-for-byte before fresh history is saved',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'minute-corrupt-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  fs.writeFileSync(path.join(folder,'minute-activity.json'),'{broken');
  const store = new Store(folder);
  assert.match(store.warning,/preserved/);
  store.save();
  assert.equal(fs.readFileSync(path.join(folder,fs.readdirSync(folder).find(f=>f.endsWith('.bak'))),'utf8'),'{broken');
  assert.equal(store.data.settings.enabled,false);
});
test('invalid persisted application maps and counters are rejected',()=>{
  for (const value of [null,[],{version:1,days:[]},{version:1,days:{'2026-10-10':null}},JSON.parse('{"version":1,"days":{"2026-10-10":{"switches":0,"apps":{"__proto__":{}}}}}')]) assert.throws(()=>validateHistory(value));
  const data=defaults(); data.days['2026-10-10']={switches:0,apps:{chrome:{name:'Chrome',foregroundMs:-1}}};
  assert.throws(()=>validateHistory(data));
});
test('failed reset rolls memory back instead of claiming history was deleted',()=>{
  const store=Object.create(Store.prototype); store.data=defaults(); const days=store.data.days;
  store.save=()=>{throw new Error('disk full');};
  assert.throws(()=>store.reset(),/disk full/);assert.equal(store.data.days,days);
});
test('IPC accepts only the exact local page in the owning main frame',()=>{
  const file=path.resolve('app/index.html');const frame={url:pathToFileURL(file).href+'#activity'};
  const window={isDestroyed:()=>false,webContents:{mainFrame:frame}};
  const event={sender:window.webContents,senderFrame:frame};
  assert.doesNotThrow(()=>guardSender(event,window,file));
  assert.throws(()=>guardSender({...event,sender:{}},window,file));
  assert.throws(()=>guardSender({...event,senderFrame:{url:frame.url}},window,file));
  for(const url of ['https://evil.example/','file:///other.html',pathToFileURL(file).href+'?evil=1','javascript:alert(1)']) {
    frame.url=url;assert.throws(()=>guardSender(event,window,file));
  }
});
test('CSV neutralizes formulas, quotes and multiline input while preserving time totals',()=>{
  for(const value of ['=1+1','+SUM(A1)','-1','@SUM(A1)',' \t=1','\n=1']) assert.equal(quote(value).startsWith('"\''),true);
  assert.equal(quote('a"b'),'"a""b"');
  const csv=formatCsv({'2026-10-10':{apps:{x:{name:'=evil',activeMs:60000,idleMs:120000,foregroundMs:180000,movementSamples:2,cursorDistancePixels:25}}}});
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=evil","1.00","2.00","3.00"'));
});
test('preload exposes fixed commands and removes listeners without exposing IPC events',()=>{
  let bridge; const listeners = new Map();const calls=[];
  const ipcRenderer={invoke:(...args)=>calls.push(args),on:(name,fn)=>listeners.set(name,fn),removeListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/preload.cjs'),'utf8'),{require:()=>({ipcRenderer,contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value}})});
  assert.equal(Object.keys(bridge).length,8);
  assert.deepEqual(Object.keys(bridge.updates), ['status','check','download','install','onStatus','onPrepare','onCancel','checkpoint']);
  bridge.setEnabled(false);assert.deepEqual(calls[0],['minute:set-enabled',false]);
  let received;const unsubscribe=bridge.onSummary(value=>received=value);
  listeners.get('minute:update')({secret:'must not leak'},{enabled:false});
  assert.deepEqual(received,{enabled:false});unsubscribe();unsubscribe();assert.equal(listeners.size,0);
});
