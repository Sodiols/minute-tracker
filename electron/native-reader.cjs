'use strict';
const path = require('node:path');

// get-windows 9.3.0 executes synchronously and its upstream Windows source
// leaks window-title buffers and some UWP handles. Isolate failures from the
// main process and recycle the helper to bound native resource retention.
class NativeReader {
  constructor(utilityProcess, {maxSamples=1800,timeoutMs=5000}={}) {
    Object.assign(this,{utilityProcess,maxSamples,timeoutMs});
    this.child=null;this.pending=null;this.count=0;this.closed=false;
  }
  waitFor(type) {
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.stop();},this.timeoutMs);
      this.pending={type,resolve:value=>{clearTimeout(timer);this.pending=null;resolve(value);},reject:error=>{clearTimeout(timer);this.pending=null;reject(error);}};
    });
  }
  async start() {
    if(this.closed)throw new Error('Collector closed');
    if(this.child)return;
    const ready=this.waitFor('ready');
    try {
      const child=this.utilityProcess.fork(path.join(__dirname,'native-worker.cjs'),[],{stdio:'ignore',serviceName:'Minute foreground collector'});
      this.child=child;this.count=0;
      child.on('message',message=>{
        if(this.child!==child)return;
        if(message?.type==='error'){this.stop();return;}
        if(message?.type===this.pending?.type)this.pending.resolve(message);
      });
      child.on('exit',()=>{if(this.child===child){this.child=null;this.pending?.reject(new Error('Foreground helper exited'));}});
    }catch(error){this.pending?.reject(error);}
    await ready;
  }
  async read() {
    if(this.pending)throw new Error('Foreground query already pending');
    if(this.count>=this.maxSamples)this.stop();
    await this.start();
    const result=this.waitFor('sample');
    try {this.child.postMessage('sample');}catch{this.stop();}
    const sample=await result;this.count++;
    return sample.name ? {owner:{name:sample.name}} : null;
  }
  stop() {
    const child=this.child;this.child=null;
    this.pending?.reject(new Error('Foreground helper unavailable or timed out'));
    child?.kill();
  }
  close() {this.closed=true;this.stop();}
}
module.exports={NativeReader};
