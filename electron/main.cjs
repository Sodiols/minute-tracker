'use strict';
const path = require('node:path');
const fs = require('node:fs');
const {app,BrowserWindow,Tray,Menu,nativeImage,nativeTheme,ipcMain,dialog,powerMonitor,screen,utilityProcess} = require('electron');
const {Store} = require('./store.cjs');
const {dayKey} = require('./tracker.cjs');
const {Collector} = require('./collector.cjs');
const {guardSender} = require('./security.cjs');
const {formatCsv} = require('./csv.cjs');
const {NativeReader} = require('./native-reader.cjs');
const {Updates} = require('./updates.cjs');
const {UpdateCheckpoint} = require('./update-checkpoint.cjs');
const pagePath = path.join(__dirname,'..','app','index.html');

let mainWindow;
let tray;
let store;
let activeWindow;
let nativeReader;
let collector;
let persistenceError = "";
let locked = false;
let suspended = false;
const timers = [];
let trackingError = '';
let lastPersist = 0;
let lastUpdate = 0;
let quitting = false;
let updates;
let checkpoint;
let updatePreparing = false;

const isWindows = process.platform === 'win32';
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance',()=>{if(store)openWindow();});
const asset = name => path.join(__dirname,'..','assets',name);

function summary() {
  const data = store.data;
  const key = dayKey(Date.now());
  return {
    available:isWindows && typeof activeWindow === 'function',
    settings:{...data.settings},
    today:data.days[key] || {apps:{},switches:0},
    days:data.days,
    currentApp:collector?.currentApp || null,
    error:[trackingError,persistenceError,store.warning].filter(Boolean).join(' ')
  };
}
function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('minute:update',summary());
}
function save() {
  try { store.save(); persistenceError = ''; }
  catch(err) { persistenceError = 'Could not save local activity data. Check disk access.'; console.error(err); }
}
function setTrackingState(enabled) {
  if (updatePreparing) throw new Error('Saving for update; please wait');
  store.data.settings.enabled = !!enabled;
  if (enabled) store.data.settings.consentGranted = true;
  collector?.reset();
  save();
  updateTray();
  broadcast();
  return summary();
}
async function poll() {
  if (!collector || quitting || updatePreparing) return;
  try {
    const changed = await collector.poll();
    trackingError = '';
    const now = performance.now();
    if (changed && now - lastPersist > 10000) {save();lastPersist = now;}
    if (now - lastUpdate > 2500) {broadcast();lastUpdate = now;}
  } catch(err) {
    trackingError = 'Unable to read the current Windows foreground app.';
    console.error('Collector error:',err);
    broadcast();
  }
}
function openWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show(); mainWindow.focus(); return;
  }
  mainWindow = new BrowserWindow({
    width:1380,height:920,minWidth:800,minHeight:620,
    show:false,backgroundColor:nativeTheme.shouldUseDarkColors ? '#09110d' : '#e6ede5',
    title:'Minute Tracker',
    icon:asset('tray.png'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:!app.isPackaged,backgroundThrottling:false}
  });
  // No native menu bar over the glass UI. Development keeps it one Alt press away for DevTools and reload.
  if (app.isPackaged) mainWindow.removeMenu(); else mainWindow.setAutoHideMenuBar(true);
  mainWindow.loadFile(pagePath, {hash:'activity'}).catch(error=>{console.error('Window load failed',error);app.quit();});
  mainWindow.once('ready-to-show',()=>mainWindow?.show());
  mainWindow.on('close',event=>{
    if (!quitting && tray) {event.preventDefault();mainWindow.hide();}
  });
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(event)=>event.preventDefault());
  mainWindow.webContents.on('will-frame-navigate',(event)=>event.preventDefault());
  mainWindow.webContents.on('will-attach-webview',(event)=>event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(()=>false);
  mainWindow.webContents.session.setDisplayMediaRequestHandler((_request,callback)=>callback({}));
}
function updateTray() {
  if (!tray) return;
  const enabled = store.data.settings.enabled;
  tray.setToolTip(`Minute Tracker: ${enabled ? 'Tracking active' : 'Paused'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Open Minute',click:openWindow},
    {label:enabled ? 'Pause tracking' : store.data.settings.consentGranted ? 'Resume tracking' : 'Enable tracking in App activity…',
      enabled:typeof activeWindow === 'function',
      click:()=>{if(enabled || store.data.settings.consentGranted)setTrackingState(!enabled);else openWindow();}},
    {type:'separator'},
    {label:'Quit',click:()=>{quitting=true;app.quit();}}
  ]));
}
function bindChannels() {
  const guard = (event) => {
    guardSender(event, mainWindow, pagePath);
    if (updatePreparing) throw new Error('Saving for update; please wait');
  };
  const updateGuard = (event, args) => {
    guardSender(event, mainWindow, pagePath);
    if (args.length) throw new Error('Update commands accept no arguments');
  };
  for (const [channel, action] of [['status', () => updates.snapshot()], ['check', () => updates.check()],
    ['download', () => updates.download()], ['install', () => updates.install()]]) {
    ipcMain.handle(`minute:updates-${channel}`, (event, ...args) => { updateGuard(event, args); return action(); });
  }
  ipcMain.handle('minute:update-checkpoint', (event, payload, ...extra) => {
    guardSender(event, mainWindow, pagePath);
    if (extra.length) throw new Error('Invalid update checkpoint');
    return checkpoint.acknowledge(payload);
  });
  ipcMain.handle('minute:summary', event => {guard(event);return summary();});
  ipcMain.handle('minute:set-enabled',(event,enabled)=>{
    guard(event);
    if (typeof enabled !== 'boolean') throw new Error('Boolean required');
    if (enabled && (!isWindows || typeof activeWindow !== 'function')) throw new Error('Windows collector unavailable');
    return setTrackingState(enabled);
  });
  ipcMain.handle('minute:set-idle',(event,seconds)=>{
    guard(event);
    if (![60,120,300,600].includes(seconds)) throw new Error('Unsupported idle threshold');
    collector?.reset();
    store.data.settings.idleThresholdSeconds = seconds;
    save();broadcast();return summary();
  });
  ipcMain.handle('minute:set-other-apps',(event,enabled)=>{
    guard(event);
    if (typeof enabled !== 'boolean') throw new Error('Boolean required');
    store.data.settings.trackOtherApps = enabled;
    collector?.reset();
    save();broadcast();return summary();
  });
  ipcMain.handle('minute:clear',event=>{guard(event);collector?.reset();store.reset();broadcast();return summary();});
  ipcMain.handle('minute:export-csv',async event=>{
    guard(event);
    const result = await dialog.showSaveDialog(mainWindow, {
      title:'Save application activity report',defaultPath:`minute-activity-${dayKey(Date.now())}.csv`,
      filters:[{name:'CSV',extensions:['csv']}]
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath,formatCsv(store.data.days),'utf8');return true;
  });
}

app.on('before-quit',()=>{quitting=true;updates?.dispose();collector?.reset();if(collector)collector.blocked=true;nativeReader?.close();timers.forEach(clearInterval);if(store)save();});
app.on('window-all-closed',()=>{ if (process.platform !== 'win32' || !tray) app.quit(); });
if (primaryInstance) app.whenReady().then(async()=>{
  store = new Store(app.getPath('userData'));
  if (isWindows) {
    try {
      nativeReader = new NativeReader(utilityProcess);
      await nativeReader.start();
      activeWindow = () => nativeReader.read();
      collector = new Collector({data:store.data,readWindow:activeWindow,readSystem:()=>({
        idleSeconds:powerMonitor.getSystemIdleTime(),
        locked:locked || suspended || powerMonitor.getSystemIdleState(store.data.settings.idleThresholdSeconds) === 'locked',
        position:screen.getCursorScreenPoint()
      })});
    }
    catch (err) { trackingError = 'Could not initialize the foreground app collector.';console.error(err); }
  }
  // Inaccessible collectors must never silently claim to be tracking.
  if (!isWindows || typeof activeWindow !== 'function') store.data.settings.enabled = false;
  checkpoint = new UpdateCheckpoint({getWindow: () => mainWindow, store, getCollector: () => collector,
    folder: app.getPath('userData'), version: app.getVersion(), onFreeze: frozen => {
      updatePreparing = frozen;
      if (collector) { collector.blocked = frozen || locked || suspended; collector.reset(); }
    }});
  const metadata = require('../package.json').minuteUpdates;
  updates = new Updates({updater: require('electron-updater').autoUpdater, version: app.getVersion(),
    enabled: isWindows && app.isPackaged && metadata?.configured === true, signed: metadata?.signed === true,
    notify: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('minute:updates', value); },
    confirmInstall: async () => {
      openWindow();
      const result = await dialog.showMessageBox(mainWindow, {type: 'question', title: 'Install Minute Tracker update?',
        message: 'Save your work and restart Minute Tracker?',
        detail: 'Any running manual session will be saved and paused. Automatic tracking will pause during installation and resume after launch if it is enabled. Projects, history and preferences will be kept.',
        buttons: ['Keep working', 'Save and restart'], defaultId: 0, cancelId: 0, noLink: true});
      return result.response === 1;
    }, prepareRestart: () => checkpoint.prepare(), cancelRestart: () => checkpoint.cancel()});
  bindChannels();
  openWindow();
  updates.start();
  if (isWindows) {
    try { tray = new Tray(nativeImage.createFromPath(asset('tray.png')));tray.on('double-click',openWindow);updateTray(); }
    catch(err) {console.warn('Tray unavailable; closing the window will exit.',err);}
  }
  const resetPowerState = () => {if(collector){collector.blocked=updatePreparing || locked || suspended;collector.reset();}save();broadcast();};
  powerMonitor.on('suspend',()=>{suspended=true;resetPowerState();});
  powerMonitor.on('resume',()=>{suspended=false;resetPowerState();});
  powerMonitor.on('lock-screen',()=>{locked=true;resetPowerState();});
  powerMonitor.on('unlock-screen',()=>{locked=false;resetPowerState();});
  timers.push(setInterval(poll,1000));
  timers.push(setInterval(()=>{if(store.data.settings.enabled)save();broadcast();},15000));
}).catch(error=>{console.error('Minute startup failed:',error);dialog.showErrorBox('Minute could not start','The local data folder or app assets could not be opened. Your existing files have not been deleted.');app.quit();});
