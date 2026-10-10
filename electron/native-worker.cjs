'use strict';
const path = require('node:path');
(async()=>{
  try {
    const preGyp = require('@mapbox/node-pre-gyp');
    require(preGyp.find(path.join(path.dirname(require.resolve('get-windows')),'package.json')));
    const {activeWindow} = await import('get-windows');
    process.parentPort.on('message',async ({data})=>{
      if (data !== 'sample') return;
      try {
        const window = await activeWindow();
        // Do not forward titles, paths, URLs, coordinates or other metadata.
        process.parentPort.postMessage({type:'sample',name:window?.owner?.name || null});
      } catch { process.parentPort.postMessage({type:'error'}); }
    });
    process.parentPort.postMessage({type:'ready'});
  } catch { process.parentPort.postMessage({type:'error'}); }
})();
