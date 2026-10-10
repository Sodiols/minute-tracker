'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function renderer(initial) {
  const storage=new Map(initial ? [['minute.tracker.v1',JSON.stringify(initial)]] : []);
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='projectSelect'?'personal':'',textContent:'',classList:{add(){},remove(){}},reset(){},close(){}});return nodes.get(id);};
  let now=100000;class Clock extends Date {static now(){return now;}}
  const context=vm.createContext({Date:Clock,performance:{now:()=>now},console,crypto:require('node:crypto').webcrypto,setTimeout:()=>0,clearTimeout(){},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},document:{visibilityState:'visible',hasFocus:()=>true,getElementById:node,querySelector:()=>null},confirm:()=>false});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/app.js'),'utf8').replace(/initialize\(\);\s*$/,''),context);
  vm.runInContext('renderAll=()=>{};toast=()=>{};',context);
  return {run:code=>vm.runInContext(code,context),advance:ms=>now+=ms,storage,node};
}
test('canceling short-session discard leaves the timer running with its segment open',()=>{
  const r=renderer();r.run('beginSession()');r.advance(200);r.run('finishSession()');
  assert.equal(r.run('state.timer.status'),'running');assert.equal(r.run('state.timer.segments[0].end'),null);
  r.advance(1000);r.run('finishSession()');assert.equal(r.run('state.sessions.length'),1);
});
test('manual pause and resume excludes paused time and avoids duplicate segments',()=>{
  const r=renderer();r.run('beginSession();beginSession()');r.advance(1000);r.run('pauseSession();pauseSession()');
  r.advance(10000);r.run('beginSession()');r.advance(2000);r.run('finishSession();finishSession()');
  assert.equal(r.run('state.sessions.length'),1);assert.equal(r.run('totalSegments(state.sessions[0].segments)'),3000);
});
test('manual elapsed time is unaffected by a wall-clock correction',()=>{
  const r=renderer();r.run('beginSession();Date.now=()=>0');r.advance(2500);r.run('finishSession()');
  assert.equal(r.run('totalSegments(state.sessions[0].segments)'),2500);
});
test('manual restart recovers as paused at last persisted checkpoint',()=>{
  const r=renderer();r.run('beginSession()');r.advance(4000);r.run('saveState()');
  const recovered=renderer(JSON.parse(r.storage.get('minute.tracker.v1')));
  assert.equal(recovered.run('state.timer.status'),'paused');assert.equal(recovered.run('totalSegments(state.timer.segments)'),4000);
});
test('invalid manual workspace is backed up and safe defaults are used',()=>{
  const bad={version:1,projects:[null],sessions:[]};const r=renderer(bad);
  assert.equal(r.run('state.projects.length'),3);assert.ok([...r.storage.keys()].some(k=>k.includes('.invalid.')));
});
test('overlapping saved manual segments and style injection are rejected',()=>{
  const r=renderer();
  assert.throws(()=>r.run("validateState({...DEFAULT_STATE(),projects:[{id:'x',name:'X',color:'red;position:fixed'}]})"));
  assert.throws(()=>r.run("validateState({...DEFAULT_STATE(),sessions:[{id:'x',projectId:'personal',task:'X',createdAt:0,endedAt:3000,segments:[{start:0,end:2000},{start:1000,end:3000}]}]})"));
});
test('manual daily analytics split intervals at local midnight',()=>{
  const r=renderer();r.run("const midnight=new Date(2026,9,11).getTime();state.sessions=[{projectId:'personal',segments:[{start:midnight-1000,end:midnight+2000}]}]");
  assert.equal(r.run('groupedByDay(midnight+3000)[dayKey(midnight-1)]'),1000);
  assert.equal(r.run('groupedByDay(midnight+3000)[dayKey(midnight)]'),2000);
});
test('project creation rejects duplicate names and preserves existing projects',()=>{
  const r=renderer();r.node('newProjectName').value='Personal projects';r.node('newProjectName').setCustomValidity=()=>{};
  r.run('createProject({preventDefault(){}})');assert.equal(r.run('state.projects.length'),3);
  r.node('newProjectName').value='New project';r.run('createProject({preventDefault(){}})');assert.equal(r.run('state.projects.length'),4);
});

test('update checkpoint pauses manual time, preserves projects and resumes only after cancellation',()=>{
  const r=renderer();r.run('beginSession()');r.advance(3000);
  const snapshot=JSON.parse(r.run('prepareWorkspaceForUpdate()'));
  const data=JSON.parse(snapshot.state);assert.equal(data.timer.status,'paused');assert.equal(data.projects.length,3);
  r.advance(2000);r.run('beginSession()');assert.equal(r.run('state.timer.status'),'paused');
  assert.equal(r.run('attentionEligible()'),false);
  r.run('cancelWorkspaceUpdate()');assert.equal(r.run('state.timer.status'),'running');
  r.advance(1000);r.run('pauseSession()');assert.equal(r.run('totalSegments(state.timer.segments)'),4000);
});

test('update checkpoint refuses restart when localStorage fails',()=>{
  const r=renderer();r.run('beginSession();localStorage.setItem=()=>{throw new Error("quota")};console.warn=()=>{}');
  assert.throws(()=>r.run('prepareWorkspaceForUpdate()'),/Workspace save failed/);
  r.run('cancelWorkspaceUpdate()');assert.equal(r.run('state.timer.status'),'running');
});
