'use strict';

/*
 * Pure accounting functions for the Windows collector.
 * A window is "active" only when it is the foreground app and Windows has
 * received keyboard/mouse input within the configured idle threshold.
 * A cursor movement sample is not an exact mouse movement or click count.
 */
const KNOWN = [
  ['vscode', 'VS Code', /^(code(?:\.exe)?|visual studio code|code - insiders)$/i],
  ['visualstudio', 'Visual Studio', /^(visual studio|devenv(?:\.exe)?)$/i],
  ['claude', 'Claude', /^(claude|claude\.exe)$/i],
  ['codex', 'Codex', /^(codex|codex\.exe|openai codex)$/i],
  ['chrome', 'Google Chrome', /^(chrome(?:\.exe)?|google chrome)$/i],
  ['illustrator', 'Adobe Illustrator', /\billustrator\b/i],
  ['photoshop', 'Adobe Photoshop', /\bphotoshop\b/i],
  ['aftereffects', 'Adobe After Effects', /\b(after effects|afterfx)\b/i],
  ['capcut', 'CapCut', /\bcapcut\b/i],
];

function classifyApp(rawName, trackOtherApps = false) {
  const name = String(rawName || '').trim().slice(0, 100);
  if (!name) return null;
  for (const [key, label, pattern] of KNOWN) if (pattern.test(name)) return {key, name: label};
  if (!trackOtherApps) return null;
  // There is no title, file path, URL, or window metadata persisted.
  const safeName = name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 60);
  if (!safeName) return null;
  return {key:`other:${safeName.toLowerCase()}`,name:safeName};
}

function dayKey(when) {
  const dt = new Date(when);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

function processSample(data, previous, sample) {
  const next = {
    timestamp: Number.isFinite(sample.now) ? sample.now : Date.now(),
    monotonic: Number.isFinite(sample.monotonic) ? sample.monotonic : sample.now,
    appKey: null,
    position: sample.position && Number.isFinite(sample.position.x) && Number.isFinite(sample.position.y)
      ? {x:sample.position.x,y:sample.position.y} : null,
  };
  if (!data.settings.enabled || sample.locked) return {previous:null, changed:false, currentApp:null};
  const app = !sample.locked ? classifyApp(sample.appName, data.settings.trackOtherApps) : null;
  if (!app) return {previous:next, changed:false, currentApp:null};
  next.appKey = app.key;
  next.appName = app.name;
  if (!previous || !Number.isFinite(previous.timestamp)) return {previous:next, changed:false, currentApp:app.name};
  const elapsed = next.monotonic - (previous.monotonic ?? previous.timestamp);
  // Do not count suspended time, long system sleeps, or clock jumps.
  if (elapsed <= 0 || elapsed > 5000) return {previous:next,changed:false,currentApp:app.name};
  if (!previous.appKey) return {previous:next,changed:false,currentApp:app.name};
  const delta = elapsed;
  // Attribute the sampled interval to its starting foreground app. Split at
  // local midnight, but use monotonic elapsed time even if the wall clock moves.
  const end = previous.timestamp + delta;
  const idleMs = Number.isFinite(sample.idleSeconds)
    ? Math.min(delta, Math.max(0, (sample.idleSeconds - data.settings.idleThresholdSeconds) * 1000)) : delta;
  let cursor = previous.timestamp;
  let row;
  while (cursor < end) {
    const midnight = new Date(cursor); midnight.setHours(24,0,0,0);
    const bound = Math.min(end, midnight.getTime());
    const day = dayKey(cursor);
    const bucket = data.days[day] || (data.days[day] = {apps:{},switches:0});
    row = bucket.apps[previous.appKey] || (bucket.apps[previous.appKey] = {
    name:previous.appName, foregroundMs:0, activeMs:0, idleMs:0,
    movementSamples:0, cursorDistancePixels:0
  });
    const idlePart = Math.max(0, bound - Math.max(cursor, end - idleMs));
    row.foregroundMs += bound - cursor;
    row.idleMs += idlePart;
    row.activeMs += bound - cursor - idlePart;
    cursor = bound;
  }
  if (previous.appKey !== app.key) {
    const key = dayKey(next.timestamp);
    const bucket = data.days[key] || (data.days[key] = {apps:{},switches:0});
    bucket.switches++;
  }
  const isIdle = idleMs > 0;
  if (!isIdle && previous.appKey === app.key && previous.position && next.position) {
    const dx = next.position.x - previous.position.x;
    const dy = next.position.y - previous.position.y;
    const distance = Math.sqrt(dx*dx + dy*dy);
    // Clamp improbable jumps from display reconfiguration / pointer warping.
    if (distance >= 3 && distance <= 4000) {
      row.movementSamples += 1;
      row.cursorDistancePixels += Math.round(distance);
    }
  }
  return {previous:next,changed:true,currentApp:app.name};
}

module.exports = {classifyApp, dayKey, processSample};
