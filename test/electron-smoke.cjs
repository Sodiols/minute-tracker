'use strict';
// Development-only harness, excluded from build.files. Uses disposable userData.
const {app,BrowserWindow,powerMonitor,ipcMain,dialog}=require('electron');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'minute-electron-smoke-'));
app.setPath('userData',folder);
app.setVersion(require('../package.json').version);
const reports=[];const errors=[];
const watchdog=setTimeout(()=>{console.error('SMOKE FAIL: timed out');app.exit(1);},45000);
const originalHandle=ipcMain.handle.bind(ipcMain);const handlers=new Map();
ipcMain.handle=(name,handler)=>{handlers.set(name,handler);originalHandle(name,handler);};
app.on('web-contents-created',(_event,contents)=>{
  contents.on('console-message',(_event,details)=>{if(details.level==='error')errors.push(details.message);});
  contents.on('preload-error',(_event,_path,error)=>errors.push(error.message));
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
require('../electron/main.cjs');
(async()=>{
  try {
    await app.whenReady();
    let window;
    for(let i=0;i<100;i++){window=BrowserWindow.getAllWindows()[0];if(window && !window.webContents.isLoading())break;await pause(100);}
    assert.ok(window);await pause(300);
    const js=source=>window.webContents.executeJavaScript(source,true);
    const preferences=window.webContents.getLastWebPreferences();
    assert.equal(preferences.contextIsolation,true);assert.equal(preferences.sandbox,true);assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.webSecurity,true);
    assert.equal(await js('typeof require'),'undefined');reports.push('renderer sandbox, context isolation, Node isolation and web security');
    const summary=await js('minuteDesktop.getSummary()');assert.equal(summary.available,true);assert.equal(summary.settings.enabled,false);assert.equal(summary.error,'');reports.push('native collector initialized; tracking defaults off');
    const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
    for(const [channel,bad] of [['minute:set-enabled','true'],['minute:set-other-apps',{}],['minute:set-idle',-1],['minute:set-idle',NaN]])assert.throws(()=>handlers.get(channel)(event,bad));
    for(const channel of handlers.keys())await assert.rejects(async()=>handlers.get(channel)({...event,senderFrame:{url:'https://evil.example'}}));
    reports.push('all IPC channels reject untrusted frames; mutation payload validation');
    for(const channel of ['minute:updates-status','minute:updates-check','minute:updates-download','minute:updates-install'])assert.throws(()=>handlers.get(channel)(event,{url:'https://evil.example'}));
    const updateState=await js('minuteDesktop.updates.status()');assert.equal(updateState.currentVersion,app.getVersion());assert.equal(updateState.phase,'disabled');
    assert.throws(()=>handlers.get('minute:update-checkpoint')(event,{token:'forged',ok:true,workspace:'{}'}));
    reports.push('update commands reject supplied URLs and forged checkpoints; source runs cannot install updates');
    for(const view of ['overview','sessions','projects','insights','activity','settings']) {
      await js(`showView('${view}')`);assert.equal(await js(`document.getElementById('view-${view}').hidden`),false);
    }
    reports.push('all six dashboard views render');
    assert.equal(await js("document.getElementById('updateCurrentVersion').textContent"),app.getVersion());
    const updateServiceSource=require('../electron/updates.cjs');
    const {EventEmitter}=require('node:events');const fakeUpdater=new EventEmitter();
    fakeUpdater.checkForUpdates=async()=>fakeUpdater.emit('update-available',{version:'0.4.0',releaseNotes:'<script>window.updateXss=true</script>\nRelease test'});
    fakeUpdater.downloadUpdate=async()=>{fakeUpdater.emit('download-progress',{percent:50,transferred:1048576,total:2097152,bytesPerSecond:524288});};
    const uiUpdates=new updateServiceSource.Updates({updater:fakeUpdater,version:'0.3.0',enabled:true,notify:value=>window.webContents.send('minute:updates',value),confirmInstall:async()=>false,prepareRestart:async()=>{},cancelRestart:()=>{}});
    await uiUpdates.check();await pause(100);
    assert.equal(await js('window.updateXss'),undefined);assert.equal(await js("document.getElementById('updateDownload').hidden"),false);
    assert.equal(await js("document.getElementById('updateNotes').textContent.includes('<script>')"),true);
    await uiUpdates.download();await pause(100);assert.equal(await js("document.getElementById('updateProgress').value"),50);
    await js("showView('settings')");
    fs.writeFileSync(path.join(__dirname,'../audit/update-settings.png'),(await window.webContents.capturePage()).toPNG());
    uiUpdates.dispose();reports.push('Settings version, inert release notes and download progress render in real Electron (network mocked)');
    await js("document.getElementById('newProjectName').value='Smoke project';createProject({preventDefault(){}})");
    assert.equal(await js("state.projects.some(p=>p.name==='Smoke project')"),true);
    await js("beginSession()");await pause(1200);await js('pauseSession()');const first=await js('ongoingDuration()');await pause(200);assert.equal(await js('ongoingDuration()'),first);
    await js('beginSession()');await pause(1100);await js('finishSession()');assert.equal(await js('state.sessions.length'),1);reports.push('project creation and manual start/pause/resume/finish');
    const manualExport=path.join(folder,'manual.csv');
    const downloaded=new Promise((resolve,reject)=>{
      window.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(manualExport);item.once('done',(_event,state)=>state==='completed'?resolve():reject(new Error(state)));});
    });
    await js("state.sessions[0].task='=1+1';exportCsv()");await downloaded;
    assert.ok(fs.readFileSync(manualExport,'utf8').includes('"\'=1+1"'));reports.push('manual CSV download and spreadsheet formula protection');
    await js('minuteDesktop.setOtherApps(true)');await js('minuteDesktop.setEnabled(true)');
    window.focus();await pause(3200);
    let current=await js('minuteDesktop.getSummary()');assert.ok(Object.keys(current.days).length>0);reports.push('real Windows foreground samples persisted');
    const autoExport=path.join(folder,'automatic.csv');
    dialog.showSaveDialog=async()=>({canceled:false,filePath:autoExport});
    assert.equal(await js('minuteDesktop.exportCsv()'),true);assert.ok(fs.readFileSync(autoExport,'utf8').includes('Total foreground minutes'));reports.push('automatic CSV through preload, IPC and filesystem (dialog selection stubbed)');
    await js('minuteDesktop.setEnabled(false)');const before=JSON.stringify((await js('minuteDesktop.getSummary()')).days);await pause(1600);assert.equal(JSON.stringify((await js('minuteDesktop.getSummary()')).days),before);reports.push('pause immediately freezes automatic accounting');
    await js('minuteDesktop.setEnabled(true)');powerMonitor.emit('lock-screen');const locked=JSON.stringify((await js('minuteDesktop.getSummary()')).days);await pause(1600);assert.equal(JSON.stringify((await js('minuteDesktop.getSummary()')).days),locked);powerMonitor.emit('unlock-screen');
    powerMonitor.emit('suspend');await pause(1200);assert.equal(JSON.stringify((await js('minuteDesktop.getSummary()')).days),locked);powerMonitor.emit('resume');reports.push('simulated lock/unlock and suspend/resume event handling');
    const beforeHide=JSON.stringify((await js('minuteDesktop.getSummary()')).days);
    window.close();assert.equal(window.isDestroyed(),false);assert.equal(window.isVisible(),false);await pause(3200);
    assert.notEqual(JSON.stringify((await js('minuteDesktop.getSummary()')).days),beforeHide);
    reports.push('close hides to tray and automatic accounting continues');window.show();
    await js('minuteDesktop.setEnabled(false)');await js('minuteDesktop.clearActivity()');assert.equal(Object.keys((await js('minuteDesktop.getSummary()')).days).length,0);
    await js("showView('activity')");await pause(400);
    const image=await window.webContents.capturePage();fs.writeFileSync(path.join(__dirname,'../audit/dashboard.png'),image.toPNG());
    await window.webContents.session.flushStorageData();
    assert.equal(errors.length,0,errors.join('\n'));
    fs.writeFileSync(path.join(__dirname,'../audit/electron-smoke.json'),JSON.stringify({passed:reports,errors,versions:process.versions,userData:folder},null,2));
    console.log('SMOKE PASS',JSON.stringify(reports));clearTimeout(watchdog);app.quit();
  }catch(error){console.error('SMOKE FAIL',error);fs.writeFileSync(path.join(__dirname,'../audit/electron-smoke.json'),JSON.stringify({passed:reports,errors,failure:error.stack},null,2));app.exit(1);}
})();
