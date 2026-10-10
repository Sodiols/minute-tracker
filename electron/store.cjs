'use strict';
const fs = require('node:fs');
const path = require('node:path');

const defaults = () => ({
  version:1,
  settings:{enabled:false,consentGranted:false,idleThresholdSeconds:120,trackOtherApps:false},
  days:{}
});

function validateHistory(old) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(old) || old.version !== 1 || !object(old.days)) throw new Error('Invalid activity history');
  const data = defaults();
  data.settings.enabled = old.settings?.enabled === true;
  data.settings.consentGranted = old.settings?.consentGranted === true || data.settings.enabled;
  data.settings.trackOtherApps = old.settings?.trackOtherApps === true;
  if ([60,120,300,600].includes(old.settings?.idleThresholdSeconds)) data.settings.idleThresholdSeconds = old.settings.idleThresholdSeconds;
  for (const [date, day] of Object.entries(old.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !object(day) || !object(day.apps) || !Number.isSafeInteger(day.switches) || day.switches < 0) throw new Error('Invalid activity day');
    const apps = {};
    for (const [key, row] of Object.entries(day.apps)) {
      if (!/^(?:[a-z]+|other:.{1,60})$/.test(key) || ['constructor','prototype','__proto__'].includes(key) || !object(row) || typeof row.name !== 'string' || row.name.length > 100) throw new Error('Invalid application');
      const clean = {name:row.name};
      for (const field of ['foregroundMs','activeMs','idleMs','movementSamples','cursorDistancePixels']) {
        if (!Number.isFinite(row[field]) || row[field] < 0 || row[field] > Number.MAX_SAFE_INTEGER) throw new Error('Invalid activity count');
        clean[field] = row[field];
      }
      if (Math.abs(clean.foregroundMs - clean.activeMs - clean.idleMs) > 1) throw new Error('Inconsistent activity time');
      apps[key] = clean;
    }
    data.days[date] = {apps, switches:day.switches};
  }
  return data;
}

class Store {
  constructor(folder) {
    fs.mkdirSync(folder,{recursive:true});
    this.file = path.join(folder,'minute-activity.json');
    this.data = defaults();
    try {
      if (fs.existsSync(this.file)) {
        const old = JSON.parse(fs.readFileSync(this.file,'utf8'));
        this.data = validateHistory(old);
      }
    } catch(err) {
      // Preserve the original bytes before any subsequent save can replace them.
      const backup = this.file + `.invalid-${Date.now()}.bak`;
      fs.copyFileSync(this.file, backup, fs.constants.COPYFILE_EXCL);
      this.warning = 'Activity history could not be read. The original file was preserved as a .bak file in the data folder.';
      console.error(this.warning, err);
    }
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp,JSON.stringify(this.data),{encoding:'utf8',flush:true});
    fs.renameSync(tmp,this.file);
  }
  reset() {
    const previous = this.data.days;
    this.data.days = {};
    try { this.save(); } catch (error) { this.data.days = previous; throw error; }
  }
}
module.exports = {Store, defaults, validateHistory};
