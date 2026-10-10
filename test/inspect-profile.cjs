'use strict';
// Read a disposable COPY of an installed profile. Never point this at live userData.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const {createHash} = require('node:crypto');
const profile = process.argv[2]; const page = process.argv[3]; const output = process.argv[4];
if (!profile || !page || !output || !path.basename(profile).startsWith('minute-profile-inspection-')) throw new Error('A disposable profile copy is required');
app.setPath('userData', path.resolve(profile));
app.whenReady().then(async () => {
  const window = new BrowserWindow({show: false, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false}});
  // Block application scripts so inspecting the snapshot cannot start a timer or mutate history.
  window.webContents.session.webRequest.onBeforeRequest({urls: ['file://*/*.js']}, (_details, callback) => callback({cancel: true}));
  await window.loadFile(page);
  const values = await window.webContents.executeJavaScript('({workspace:localStorage.getItem("minute.tracker.v1"),theme:localStorage.getItem("minute.theme")})');
  const data = JSON.parse(values.workspace);
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const result = {projectCount: data.projects.length, sessionCount: data.sessions.length,
    projectsHash: hash(data.projects), sessionsHash: hash(data.sessions), settingsHash: hash(data.settings),
    timerHash: hash(data.timer), timerStatus: data.timer?.status, timerDuration: data.timer?.segments.reduce((total, segment) => total + ((segment.end ?? data.savedAt) - segment.start), 0),
    theme: values.theme};
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); app.quit();
}).catch(error => {console.error(error);app.exit(1);});
