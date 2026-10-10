'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {NativeReader}=require('../electron/native-reader.cjs');
function fakeUtility({respond=true}={}) {
  const children=[];
  return {children,fork(){
    const child=new EventEmitter();children.push(child);
    child.kill=()=>{child.killed=true;child.emit('exit',0);};
    child.postMessage=()=>{if(respond)queueMicrotask(()=>child.emit('message',{type:'sample',name:'Google Chrome'}));};
    queueMicrotask(()=>child.emit('message',{type:'ready'}));return child;
  }};
}
test('native helper recycles at its sample limit without interrupting application names',async()=>{
  const utility=fakeUtility();const reader=new NativeReader(utility,{maxSamples:2});
  await reader.start();
  for(let i=0;i<3;i++)assert.equal((await reader.read()).owner.name,'Google Chrome');
  assert.equal(utility.children.length,2);assert.equal(utility.children[0].killed,true);
  reader.close();assert.equal(utility.children[1].killed,true);await assert.rejects(reader.read(),/closed/);
});
test('hung native call times out and the helper is terminated',async()=>{
  const utility=fakeUtility({respond:false});const reader=new NativeReader(utility,{timeoutMs:25});
  await assert.rejects(reader.read(),/timed out/);assert.equal(utility.children[0].killed,true);assert.equal(reader.pending,null);reader.close();
});
test('native helper exit rejects pending work and next sample starts a new helper',async()=>{
  const utility=fakeUtility({respond:false});const reader=new NativeReader(utility);
  await reader.start();const pending=reader.read();await new Promise(resolve=>setImmediate(resolve));
  utility.children[0].emit('exit',1);await assert.rejects(pending,/exited/);
  await reader.start();assert.equal(utility.children.length,2);reader.close();
});
