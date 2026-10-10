'use strict';
/* Automatic Windows tracking is opt-in and handled in the Electron main process. */
(() => {
  const bridge = window.minuteDesktop;
  const $ = id => document.getElementById(id);
  const format = ms => {
    const minutes = Math.floor((Number(ms) || 0) / 60000);
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const days = count => {
    const today = new Date();
    today.setHours(0,0,0,0);
    return Array.from({length:count}, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - count + i + 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return {key, label: d.toLocaleDateString('en-US', {weekday:'short'})};
    });
  };
  // Seconds of use should not read as "0h 00m" next to a full bar.
  const formatUse = ms => (Number(ms) > 0 && Number(ms) < 60000 ? "under 1m" : format(ms));
  let snapshot;
  const notify = message => { if (typeof toast === 'function') toast(message); else console.info(message); };
  const ask = options => (typeof askConfirm === 'function' ? askConfirm(options) : Promise.resolve(confirm(options.message)));
  function render(summary) {
    if (!summary) return;
    snapshot = summary;
    const available = summary.available;
    const enabled = available && summary.settings.enabled;
    $('autoConsent').classList.toggle('is-running', !!enabled);
    $('autoConsent').classList.toggle('is-unavailable', !available);
    $('autoConsentTitle').textContent = !available ? 'Windows tracking requires the desktop application' : enabled ? 'Automatic tracking is running' : 'Automatic tracking is paused';
    $('autoConsentDescription').textContent = !available
      ? 'Open this workspace in the Windows Electron app to enable real computer activity tracking.'
      : enabled
      ? `Collecting foreground application time. ${summary.currentApp ? `Currently focused: ${summary.currentApp}.` : 'Waiting for a monitored app.'} You can pause it anytime.`
      : 'Click Enable tracking to start. Only application names, usage durations and aggregate movement samples are stored locally.';
    $('autoToggle').textContent = enabled ? 'Pause tracking' : 'Enable tracking';
    $('autoToggle').disabled = !available;
    $('autoIdleSelect').value = String(summary.settings.idleThresholdSeconds || 120);
    $('autoIdleSelect').disabled = !available;
    $('autoOtherApps').checked = !!summary.settings.trackOtherApps;
    $('autoOtherApps').disabled = !available;
    $('autoExport').disabled = !available;
    $('autoClear').disabled = !available;
    if (summary.error) $('autoConsentDescription').textContent += ` Collector warning: ${summary.error}`;
    const today = summary.today || { apps: {}, switches: 0 };
    const apps = Object.entries(today.apps || {}).map(([key, item]) => ({ key, ...item })).sort((a,b) => b.activeMs - a.activeMs);
    const active = apps.reduce((sum, item) => sum + (item.activeMs || 0), 0);
    const idle = apps.reduce((sum, item) => sum + (item.idleMs || 0), 0);
    const moved = apps.reduce((sum, item) => sum + (item.movementSamples || 0), 0);
    $('autoActive').textContent = format(active);
    $('autoIdle').textContent = format(idle);
    $('autoSwitches').textContent = String(today.switches || 0);
    $('autoMouse').textContent = Number(moved).toLocaleString();
    const max = Math.max(1,...apps.map(a => a.activeMs || 0));
    const emptyCopy = !available
      ? ['Available in the desktop app', 'Open Minute on Windows to see real application usage here.']
      : enabled
      ? ['Listening for activity', 'Use a monitored application and it will appear here within a few seconds.']
      : ['No desktop activity yet', 'Enable tracking above to begin. Nothing is recorded until you do.'];
    $('autoAppList').innerHTML = apps.length ? apps.slice(0,14).map(a => `<div class="auto-app-row"><div class="auto-app-head"><div class="auto-app-label"><span class="auto-app-logo" aria-hidden="true">${escape((a.name||'?').replace(/[^a-z0-9]/gi,'').slice(0,2).toUpperCase() || '?')}</span><span class="auto-app-name" data-tip="${escape(a.name)}" data-tip-overflow>${escape(a.name)}</span></div><span class="auto-app-min">${formatUse(a.activeMs)} active</span></div><div class="auto-progress" aria-hidden="true"><div class="auto-progress-fill" style="width:${Math.max(0,Math.min(100,a.activeMs / max * 100))}%"></div></div><div class="auto-app-more">${formatUse(a.foregroundMs)} in front, ${formatUse(a.idleMs)} idle</div></div>`).join('')
      : `<div class="empty-state"><span class="icon-chip" aria-hidden="true"><svg class="icon"><use href="#i-monitor"/></svg></span><strong>${emptyCopy[0]}</strong><p>${emptyCopy[1]}</p></div>`;
    const range = days(7);
    const values = range.map(d => Object.values(summary.days?.[d.key]?.apps || {}).reduce((n,a) => n + (a.activeMs||0),0));
    const weekMax = Math.max(1,...values);
    const short = ms => { const m = Math.round(ms / 60000); return m < 1 ? "<1m" : m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m}m`; };
    $('autoWeek').innerHTML = range.map((day,i) => `<div class="auto-week-column${i === range.length - 1 ? ' is-today' : ''}" role="listitem" data-tip="${day.label}  ${format(values[i])}"><span class="auto-week-value" aria-hidden="true">${values[i] ? short(values[i]) : ''}</span><div class="auto-week-track" aria-hidden="true"><div class="auto-week-fill" style="height:${values[i] ? Math.max(3,values[i]/weekMax*100) : 0}%"></div></div><span class="auto-week-label" aria-hidden="true">${day.label}</span><span class="sr-only">${day.label}: ${format(values[i])}</span></div>`).join('');
  }
  const offlineSummary = { available: false, settings: {enabled:false,idleThresholdSeconds:120,trackOtherApps:false}, today:{apps:{},switches:0}, days:{} };
  if (!bridge) { render(offlineSummary); return; }
  bridge.getSummary().then(render).catch(err => notify(`Desktop tracking unavailable: ${err.message}`));
  bridge.onSummary(render);
  $('autoToggle').addEventListener('click', async () => {
    try { render(await bridge.setEnabled(!snapshot?.settings?.enabled)); }
    catch(err) { notify(`Could not change tracking: ${err.message}`); }
  });
  $('autoIdleSelect').addEventListener('change', async e => {
    try { render(await bridge.setIdleThreshold(Number(e.target.value))); }
    catch (err) { notify(`Could not change idle threshold: ${err.message}`); }
  });
  $('autoOtherApps').addEventListener('change', async e => {
    try { render(await bridge.setOtherApps(!!e.target.checked)); }
    catch(err) { notify(`Could not change app preferences: ${err.message}`); }
  });
  $('autoClear').addEventListener('click', async () => {
    const clear = await ask({ title: 'Clear automatic activity?', message: 'This permanently deletes all recorded application activity. Manual work sessions and projects are not affected.', confirmLabel: 'Clear activity', danger: true });
    if (!clear) return;
    try { render(await bridge.clearActivity()); notify('Automatic activity history cleared.'); }
    catch(err) { notify(`Could not clear activity: ${err.message}`); }
  });
  $('autoExport').addEventListener('click', async () => {
    try { const saved = await bridge.exportCsv(); if (saved) notify('Automatic activity CSV exported.'); }
    catch(err) { notify(`Export failed: ${err.message}`); }
  });
})();
