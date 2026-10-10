'use strict';

/*
 * minute. — Local-first work tracking.
 * All stored times are milliseconds. Work sessions are composed of clock segments,
 * allowing paused time to be excluded and overnight sessions to be split by day.
 * Attention means foreground, focused, recently-interacted-with THIS TAB only.
 */

const STORAGE_KEY = 'minute.tracker.v1';
// Keep manual session intervals ordered across system-clock corrections.
const wallOrigin = Date.now();
const monotonicOrigin = performance.now();
const workNow = () => wallOrigin + performance.now() - monotonicOrigin;
const DEFAULT_STATE = () => ({
  version: 1,
  projects: [
    { id: 'personal', name: 'Personal projects', color: '#b9debf', archived: false },
    { id: 'client', name: 'Client work', color: '#bfd0fa', archived: false },
    { id: 'learning', name: 'Learning & research', color: '#f2dda7', archived: false }
  ],
  sessions: [],
  timer: null,
  attentionDays: {},
  settings: { dailyGoalHours: 8, idleMinutes: 2 }
});

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const onlyPositive = num => Number.isFinite(Number(num)) ? Math.max(0, Number(num)) : 0;
const dayKey = time => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const sameDay = (time, day) => dayKey(time) === day;
const todayMidnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const formatHms = ms => {
  const sec = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(sec / 3600);
  return `${String(hours).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};
const formatCompact = ms => {
  const min = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
};
const formatShort = ms => {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min >= 60) return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
  return `${min}m`;
};
const formatTime = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const formatDay = t => {
  const days = Math.round((todayMidnight().getTime() - new Date(t).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const sameYear = new Date(t).getFullYear() === new Date().getFullYear();
  return new Date(t).toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
};
const createId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function validateState(data) {
  if (data?.version !== 1 || !Array.isArray(data.projects) || !Array.isArray(data.sessions)) throw new Error('Invalid saved workspace');
  const output = DEFAULT_STATE();
  const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
  const timestamp = value => Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
  const ids = new Set();
  output.projects = data.projects.map(p => {
    if (!p || !text(p.id,100) || ids.has(p.id) || !text(p.name,100) || !/^#[0-9a-f]{6}$/i.test(p.color)) throw new Error('Invalid project');
    ids.add(p.id);
    return {id:p.id,name:p.name,color:p.color,archived:p.archived === true};
  });
  const sessionIds = new Set();
  const cleanSession = (s, timer = false) => {
    if (!s || !text(s.id,100) || sessionIds.has(s.id) || !text(s.projectId,100) || !text(s.task,1000) || !timestamp(s.createdAt) || !Array.isArray(s.segments) || (!timer && !timestamp(s.endedAt))) throw new Error('Invalid session');
    sessionIds.add(s.id);
    let previousEnd = s.createdAt;
    const segments = s.segments.map((part, index) => {
      if (!part || !timestamp(part.start) || part.start < previousEnd) throw new Error('Overlapping session segments');
      let end = part.end;
      if (end === null && timer && index === s.segments.length - 1) {
        // Restore paused at the last save; downtime is not confirmed work.
        end = timestamp(data.savedAt) ? Math.max(part.start,data.savedAt) : part.start;
      }
      if (!timestamp(end) || end < part.start || end - part.start > 366 * 86400000 || (!timer && end > s.endedAt)) throw new Error('Invalid session interval');
      previousEnd = end;
      return {start:part.start,end};
    });
    return {id:s.id,projectId:s.projectId,task:s.task,createdAt:s.createdAt,segments,status:timer ? 'paused' : 'completed',...(!timer ? {endedAt:s.endedAt} : {})};
  };
  output.sessions = data.sessions.map(s=>cleanSession(s));
  output.timer = data.timer ? cleanSession(data.timer,true) : null;
  if (data.attentionDays && typeof data.attentionDays === 'object') for (const [key,value] of Object.entries(data.attentionDays)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(value) && value >= 0 && value <= 90000000) output.attentionDays[key] = value;
  }
  const settings = data.settings || {};
  if (Number.isFinite(settings.dailyGoalHours) && settings.dailyGoalHours >= 1 && settings.dailyGoalHours <= 24) output.settings.dailyGoalHours = settings.dailyGoalHours;
  if (Number.isInteger(settings.idleMinutes) && settings.idleMinutes >= 1 && settings.idleMinutes <= 30) output.settings.idleMinutes = settings.idleMinutes;
  return output;
}
function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validateState(JSON.parse(raw)) : DEFAULT_STATE();
  } catch (error) {
    console.warn('Could not read local tracker data.', error);
    if (raw) {
      try { localStorage.setItem(`${STORAGE_KEY}.invalid.${Date.now()}`, raw); }
      catch { throw new Error('Cannot preserve damaged workspace. Free storage before restarting.'); }
    }
    return DEFAULT_STATE();
  }
}

let state = loadState();
let activeView = 'overview';
let lastInteraction = Date.now();
let lastAttentionTick = Date.now();
let attentionActive = document.visibilityState === 'visible' && document.hasFocus();
let toastTimeout;
let updateFrozen = false;
let resumeAfterUpdateFailure = false;

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({...state,savedAt:workNow()})); return true; }
  catch (error) { console.warn('Saving tracker data failed.', error); toast('Could not save in this browser. Check storage permissions.'); return false; }
}
function prepareWorkspaceForUpdate() {
  if (updateFrozen) throw new Error('Workspace already saving');
  trackAttention();
  updateFrozen = true;
  attentionActive = false;
  resumeAfterUpdateFailure = state.timer?.status === 'running';
  if (resumeAfterUpdateFailure) pauseSession();
  if (!saveState()) throw new Error('Workspace save failed');
  return JSON.stringify({state: localStorage.getItem(STORAGE_KEY), theme: localStorage.getItem('minute.theme')});
}
function cancelWorkspaceUpdate() {
  updateFrozen = false;
  if (resumeAfterUpdateFailure) { resumeAfterUpdateFailure = false; beginSession(); }
  lastAttentionTick = Date.now();
  attentionActive = attentionEligible();
}
function toast(message, action) {
  const el = $('toast');
  const text = document.createElement('span');
  text.textContent = message;
  el.replaceChildren(text);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => { el.classList.remove('is-visible'); action.run(); }, { once: true });
    el.append(button);
  }
  el.classList.add('is-visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('is-visible'), action ? 6500 : 3400);
}
function getProject(id) {
  return state.projects.find(p => p.id === id) || { id, name: 'Deleted project', color: '#e1e7dd' };
}
function totalSegments(segments, now = workNow()) {
  return segments.reduce((sum, part) => sum + Math.max(0, (part.end ?? now) - part.start), 0);
}
function ongoingDuration(now = workNow()) { return state.timer ? totalSegments(state.timer.segments, now) : 0; }
function sessionSegments() {
  const completed = state.sessions.map(s => ({ segments: s.segments, projectId: s.projectId }));
  if (state.timer) completed.push({ segments: state.timer.segments, projectId: state.timer.projectId });
  return completed;
}
function groupedByDay(now = workNow(), projectId = null) {
  const output = Object.create(null);
  for (const session of sessionSegments()) {
    if (projectId && session.projectId !== projectId) continue;
    for (const segment of session.segments) {
      let cursor = segment.start;
      const end = Math.min(segment.end ?? now, now);
      if (!Number.isFinite(cursor) || !Number.isFinite(end)) continue;
      while (cursor < end) {
        const midnight = new Date(cursor);
        midnight.setHours(24, 0, 0, 0);
        const bound = Math.min(end, midnight.getTime());
        const key = dayKey(cursor);
        output[key] = (output[key] || 0) + (bound - cursor);
        cursor = bound;
      }
    }
  }
  return output;
}
function lastDays(count) {
  const midnight = todayMidnight();
  return Array.from({ length: count }, (_, idx) => {
    const date = new Date(midnight);
    date.setDate(midnight.getDate() - (count - idx - 1));
    return { date, key: dayKey(date) };
  });
}
function getWeekStart() {
  const d = todayMidnight();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function weekWorkTotal(dayTotals) {
  const start = getWeekStart().getTime();
  return Object.entries(dayTotals).reduce((sum, [key, ms]) => sum + (new Date(`${key}T00:00:00`).getTime() >= start ? ms : 0), 0);
}
function projectTotals() {
  const totals = Object.create(null);
  const now = workNow();
  for (const item of sessionSegments()) totals[item.projectId] = (totals[item.projectId] || 0) + totalSegments(item.segments, now);
  return totals;
}
function activeProjectOptions() {
  return state.projects.filter(p => !p.archived || p.id === state.timer?.projectId);
}
function renderProjectSelects() {
  const select = $('projectSelect');
  const previous = state.timer?.projectId || select.value;
  select.innerHTML = activeProjectOptions().map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  if (activeProjectOptions().some(p => p.id === previous)) select.value = previous;
  const filter = $('sessionProjectFilter');
  const oldFilter = filter.value;
  filter.innerHTML = '<option value="all">All projects</option>' + state.projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  if (oldFilter && [...filter.options].some(o => o.value === oldFilter)) filter.value = oldFilter;
}
function beginSession() {
  if (updateFrozen) return;
  const now = workNow();
  if (!state.timer) {
    const project = $('projectSelect').value;
    if (!project) { toast('Create a project before starting a timer.'); return; }
    state.timer = {
      id: createId(),
      projectId: project,
      task: $('taskInput').value.trim() || 'Untitled work session',
      createdAt: now,
      status: 'running',
      segments: [{ start: now, end: null }]
    };
    toast('Session started. You’ve got this.');
  } else if (state.timer.status === 'paused') {
    state.timer.segments.push({ start: now, end: null });
    state.timer.status = 'running';
    toast('Timer resumed.');
  }
  saveState(); renderAll();
}
function pauseSession() {
  if (!state.timer || state.timer.status !== 'running') return;
  const open = state.timer.segments.findLast(s => s.end === null);
  if (open) open.end = workNow();
  state.timer.status = 'paused';
  saveState(); renderAll(); toast('Timer paused.');
}
// Glass confirmation dialog. Resolves true only when the confirm button is chosen;
// Escape, Cancel and a backdrop click all resolve false.
function askConfirm({ title, message, confirmLabel = 'Confirm', danger = false }) {
  const dialog = $('confirmDialog');
  if (typeof dialog.showModal !== 'function') return Promise.resolve(confirm(message));
  if (dialog.open) return Promise.resolve(false);
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  $('confirmOk').textContent = confirmLabel;
  $('confirmOk').className = `button ${danger ? 'button-danger-solid' : 'button-primary'}`;
  dialog.classList.toggle('is-danger', danger);
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
    // Destructive choices start on the safe button.
    (danger ? $('confirmCancel') : $('confirmOk')).focus();
  });
}
function finishSession() {
  if (!state.timer) return;
  const now = workNow();
  if (totalSegments(state.timer.segments, now) < 1000) {
    const timerId = state.timer.id;
    askConfirm({ title: 'Discard this session?', message: 'It is shorter than one second, so there is nothing worth saving.', confirmLabel: 'Discard', danger: true })
      .then(discard => { if (discard && state.timer?.id === timerId) completeSession(now); });
    return;
  }
  completeSession(now);
}
function completeSession(now) {
  if (state.timer.status === 'running') {
    const open = state.timer.segments.findLast(s => s.end === null);
    if (open) open.end = now;
  }
  const result = { ...state.timer, endedAt: now, status: 'completed' };
  if (totalSegments(result.segments, now) >= 1000) {
    state.sessions.push(result);
  }
  state.timer = null;
  $('taskInput').value = '';
  saveState(); renderAll();
  toast(result.segments.length && totalSegments(result.segments, now) >= 1000 ? 'Session saved to your history.' : 'Empty session discarded.');
}
function toggleSession() {
  if (state.timer?.status === 'running') pauseSession(); else beginSession();
}
function renderTimer() {
  const timer = state.timer;
  const isRunning = timer?.status === 'running';
  const status = !timer ? 'idle' : isRunning ? 'running' : 'paused';
  const elapsed = formatHms(ongoingDuration());
  $('timerDisplay').textContent = elapsed;
  $('timerPanel').dataset.state = status;
  document.documentElement.dataset.timer = status;
  $('startLabel').textContent = !timer ? 'Start session' : isRunning ? 'Pause' : 'Resume';
  $('startIcon').setAttribute('href', isRunning ? '#i-pause' : '#i-play');
  $('finishButton').disabled = !timer;
  $('timerState').textContent = !timer ? 'Ready' : isRunning ? 'Recording' : 'Paused';
  $('timerGuidance').textContent = !timer ? "Great things take time. Start whenever you're ready." : isRunning ? 'Your time is being recorded, even if you switch views.' : 'Take your time. Resume when you are ready.';
  $('timerDot').className = `pulse-dot${isRunning ? ' running' : timer ? ' paused' : ''}`;
  const chip = $('topTimer');
  chip.hidden = !timer || activeView === 'overview';
  chip.dataset.state = status;
  $('topTimerValue').textContent = elapsed;
  $('topTimerTask').textContent = timer ? timer.task : '';
  const title = timer ? `${elapsed}${isRunning ? '' : ' (paused)'} - Minute Tracker` : 'Minute Tracker';
  if (document.title !== title) document.title = title;
  $('taskInput').disabled = Boolean(timer);
  $('projectSelect').disabled = Boolean(timer);
  if (timer) {
    if ($('taskInput').value !== timer.task) $('taskInput').value = timer.task;
    if ($('projectSelect').value !== timer.projectId) $('projectSelect').value = timer.projectId;
  }
}
function renderMetrics() {
  const now = workNow();
  const totals = groupedByDay(now);
  const today = dayKey(now);
  const todayMs = totals[today] || 0;
  const weekMs = weekWorkTotal(totals);
  const attentionToday = onlyPositive(state.attentionDays[today]);
  $('metricToday').textContent = formatCompact(todayMs);
  $('metricWeek').textContent = formatCompact(weekMs);
  $('metricAttention').textContent = formatCompact(attentionToday);
  $('metricSessions').textContent = String(state.sessions.filter(s => sameDay(s.endedAt, today)).length);
  $('weeklyTotal').textContent = formatCompact(lastDays(7).reduce((sum, d) => sum + (totals[d.key] || 0), 0));
  $('attentionTodaySecondary').textContent = formatShort(attentionToday);
  const goal = Number(state.settings.dailyGoalHours) || 8;
  const percent = todayMs / (goal * 3600000) * 100;
  $('goalPercent').textContent = `${Math.round(percent)}%`;
  $('goalHours').textContent = `${goal}h`;
  const ring = Math.min(100, Math.max(0, percent));
  $('goalProgress').style.strokeDashoffset = String(100 - ring);
  $('goalProgress').style.opacity = ring > 0 ? '1' : '0';
  $('goalMessage').textContent = percent >= 100 ? 'Your daily goal is complete. Nicely done.' : todayMs > 0 ? `${formatCompact(Math.max(0, goal * 3600000 - todayMs))} left to reach your daily goal.` : 'Start a session and build your momentum.';
  $('weeklyGoalLabel').textContent = `${goal * 5}h weekly goal`;
}
function renderBarChart(elementId, days, totals, long = false) {
  const dailyGoal = Number(state.settings.dailyGoalHours) || 8;
  const highest = Math.max(dailyGoal * 3600000, ...days.map(d => totals[d.key] || 0));
  const today = dayKey(Date.now());
  const chart = $(elementId);
  chart.style.setProperty('--goal', `${Math.min(100, dailyGoal * 3600000 / highest * 100)}%`);
  chart.innerHTML = days.map(day => {
    const work = totals[day.key] || 0;
    const height = work === 0 ? 0 : Math.max(2, Math.min(100, work / highest * 100));
    const dayName = long ? day.date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : day.date.toLocaleDateString('en-US', { weekday: 'short' });
    const fullDay = day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    return `<div class="bar-column${day.key === today ? ' is-today' : ''}" role="listitem" data-tip="${escapeHtml(fullDay)}  ${escapeHtml(formatCompact(work))}"><div class="bar-rail" aria-hidden="true"><div class="bar-fill" style="height:${height}%"></div></div><span class="bar-day" aria-hidden="true">${escapeHtml(dayName)}</span><span class="sr-only">${escapeHtml(fullDay)}: ${escapeHtml(formatCompact(work))}</span></div>`;
  }).join('');
}
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const emptyState = (iconName, title, body, button = '') => `<div class="empty-state"><span class="icon-chip" aria-hidden="true">${icon(iconName)}</span><strong>${title}</strong><p>${body}</p>${button}</div>`;
function renderRecentSessions() {
  const recent = [...state.sessions].sort((a, b) => b.endedAt - a.endedAt).slice(0, 4);
  if (!recent.length) {
    $('recentSessions').innerHTML = emptyState('timer', 'Your story starts with one session.', 'Finish a timer and it will appear here.', '<button type="button" class="button button-ghost button-sm" data-focus-task>Start a session</button>');
    return;
  }
  $('recentSessions').innerHTML = recent.map(session => {
    const project = getProject(session.projectId);
    return `<div class="activity-row"><span class="activity-badge" style="--project:${escapeHtml(project.color)}" aria-hidden="true">${escapeHtml(project.name.slice(0, 1).toUpperCase())}</span><div class="activity-primary"><strong data-tip="${escapeHtml(session.task)}" data-tip-overflow>${escapeHtml(session.task)}</strong><span>${escapeHtml(project.name)}, ${escapeHtml(formatDay(session.endedAt))}</span></div><span class="activity-time">${formatShort(totalSegments(session.segments))}</span></div>`;
  }).join('');
}
function renderSessions() {
  const project = $('sessionProjectFilter').value || 'all';
  const query = ($('sessionSearch').value || '').trim().toLowerCase();
  const sessions = [...state.sessions]
    .filter(s => project === 'all' || s.projectId === project)
    .filter(s => !query || s.task.toLowerCase().includes(query) || getProject(s.projectId).name.toLowerCase().includes(query))
    .sort((a, b) => b.endedAt - a.endedAt);
  const total = formatCompact(sessions.reduce((t, s) => t + totalSegments(s.segments), 0));
  $('sessionsSubtitle').textContent = `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}, ${total} total`;
  if (!sessions.length) {
    const body = state.sessions.length
      ? emptyState('magnifying-glass', 'No sessions match.', 'Try another search or project filter.', '<button type="button" class="button button-ghost button-sm" data-clear-filters>Clear filters</button>')
      : emptyState('clock-counter-clockwise', 'No saved sessions yet.', 'Start a timer on Overview, then finish it to record your work.', '<button type="button" class="button button-ghost button-sm" data-focus-task>Start a session</button>');
    $('sessionsTable').innerHTML = `<tr class="table-empty-row"><td colspan="5">${body}</td></tr>`;
    return;
  }
  $('sessionsTable').innerHTML = sessions.map(s => {
    const p = getProject(s.projectId);
    return `<tr><td><span class="cell-task" data-tip="${escapeHtml(s.task)}" data-tip-overflow>${escapeHtml(s.task)}</span></td><td><span class="pill-project"><span class="swatch" style="--project:${escapeHtml(p.color)}"></span><span>${escapeHtml(p.name)}</span></span></td><td><span>${escapeHtml(formatDay(s.endedAt))}</span><span class="cell-sub">${escapeHtml(formatTime(s.endedAt))}</span></td><td class="num">${formatCompact(totalSegments(s.segments))}</td><td><button type="button" class="icon-button trash-button" data-delete-session="${escapeHtml(s.id)}" data-tip="Delete session" aria-label="Delete session ${escapeHtml(s.task)}">${icon('trash')}</button></td></tr>`;
  }).join('');
}
function renderProjects() {
  const totals = projectTotals();
  if (!state.projects.length) {
    $('projectsGrid').innerHTML = emptyState('folder-simple', 'No projects yet.', 'Create one to start grouping your sessions.');
    return;
  }
  $('projectsGrid').innerHTML = state.projects.map(project => {
    const sessionCount = state.sessions.filter(s => s.projectId === project.id).length;
    const isActive = state.timer?.projectId === project.id;
    const action = project.archived ? 'Restore' : 'Archive';
    return `<article class="project-card glass${project.archived ? ' is-archived' : ''}" style="--project:${escapeHtml(project.color)}"><div class="project-card-top"><span class="project-orb" aria-hidden="true">${escapeHtml(project.name[0]?.toUpperCase() || 'P')}</span><span class="state-pill">${project.archived ? 'Archived' : isActive ? 'Recording' : 'Active'}</span></div><h2 data-tip="${escapeHtml(project.name)}" data-tip-overflow>${escapeHtml(project.name)}</h2><p>${sessionCount} completed ${sessionCount === 1 ? 'session' : 'sessions'}</p><div class="project-card-bottom"><div class="project-total"><strong>${formatCompact(totals[project.id] || 0)}</strong><span>time tracked</span></div><span ${isActive ? 'data-tip="Finish the running session first"' : ''}><button class="button button-ghost button-sm" type="button" data-toggle-project="${escapeHtml(project.id)}" aria-label="${action} ${escapeHtml(project.name)}" ${isActive ? 'disabled' : ''}>${icon(project.archived ? 'arrow-counter-clockwise' : 'archive')}${action}</button></span></div></article>`;
  }).join('');
}
function renderInsights() {
  const totals = groupedByDay();
  const days = lastDays(14);
  const sum = days.reduce((acc, day) => acc + (totals[day.key] || 0), 0);
  const daySet = new Set(days.map(d => d.key));
  $('insightTotal').textContent = formatCompact(sum);
  $('insightSessions').textContent = String(state.sessions.filter(s => daySet.has(dayKey(s.endedAt))).length);
  $('insightAverage').textContent = formatCompact(sum / 14);
  renderBarChart('longChart', days, totals, true);
  const projects = projectTotals();
  const sumProject = Object.values(projects).reduce((acc, ms) => acc + ms, 0);
  if (sumProject <= 0) {
    $('projectBreakdown').innerHTML = emptyState('chart-bar', 'Nothing to compare yet.', 'Your time by project appears here after your first work session.');
    return;
  }
  $('projectBreakdown').innerHTML = state.projects.filter(p => projects[p.id]).sort((a, b) => projects[b.id] - projects[a.id]).map(project => {
    const width = projects[project.id] / sumProject * 100;
    return `<div class="breakdown-row" style="--project:${escapeHtml(project.color)}"><div class="breakdown-head"><span class="breakdown-name"><span class="swatch" aria-hidden="true"></span><span>${escapeHtml(project.name)}</span></span><span class="breakdown-value"><strong>${formatCompact(projects[project.id])}</strong><span>${Math.round(width)}%</span></span></div><div class="breakdown-track" aria-hidden="true"><div class="breakdown-fill" style="width:${width}%"></div></div></div>`;
  }).join('');
}
function renderSettings() {
  $('dailyGoalSetting').value = state.settings.dailyGoalHours;
  $('idleSetting').value = state.settings.idleMinutes;
  // aria-disabled (not disabled) keeps keyboard focus on a stepper that reaches its limit.
  document.querySelectorAll('[data-step-target]').forEach(button => {
    const input = $(button.dataset.stepTarget);
    const value = Number(input.value);
    const atLimit = Number(button.dataset.step) > 0 ? value >= Number(input.max) : value <= Number(input.min);
    button.setAttribute('aria-disabled', String(atLimit));
  });
}
function renderAll() {
  renderProjectSelects(); renderTimer(); renderMetrics();
  renderBarChart('weeklyChart', lastDays(7), groupedByDay());
  renderRecentSessions(); renderSessions(); renderProjects(); renderInsights(); renderSettings();
}

const VIEW_NAMES = { overview: 'Overview', sessions: 'Sessions', projects: 'Projects', insights: 'Insights', activity: 'App activity', settings: 'Settings' };
function showView(name) {
  activeView = Object.hasOwn(VIEW_NAMES, name) ? name : 'overview';
  document.querySelectorAll('.view-panel').forEach(node => { node.hidden = node.id !== `view-${activeView}`; });
  document.querySelectorAll('[data-view]').forEach(link => {
    const active = link.dataset.view === activeView;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  $('currentSection').textContent = VIEW_NAMES[activeView];
  closeMobileNav();
  $('mainShell').scrollTo({ top: 0, behavior: 'instant' });
  renderTimer();
}
function goTo(view) {
  if (location.hash.slice(1) !== view) location.hash = view;
  showView(view);
}
function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}
const THEME_KEY = 'minute.theme';
function applyTheme(value) {
  const theme = value === 'light' || value === 'dark' ? value : 'system';
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.querySelectorAll('input[name="theme"]').forEach(input => { input.checked = input.value === theme; });
}
function closeMobileNav() {
  $('sidebar').classList.remove('is-open');
  $('mobileScrim').hidden = true;
  $('menuButton').setAttribute('aria-expanded', 'false');
}
function attentionEligible(now = Date.now()) {
  return !updateFrozen && document.visibilityState === 'visible' && document.hasFocus() && now - lastInteraction < Number(state.settings.idleMinutes) * 60 * 1000;
}
function trackAttention() {
  const now = Date.now();
  if (attentionActive) {
    // Cap clock jumps. Sleep, debugger pauses or throttled tabs should not
    // turn a few seconds of viewing into hours of purported active screen time.
    const delta = Math.min(2000, Math.max(0, now - lastAttentionTick));
    const key = dayKey(now);
    state.attentionDays[key] = (onlyPositive(state.attentionDays[key]) + delta);
  }
  lastAttentionTick = now;
  attentionActive = attentionEligible(now);
}
function exportCsv() {
  const header = ['Task', 'Project', 'Started at', 'Finished at', 'Worked hours', 'Worked minutes', 'Elapsed milliseconds'];
  const quote = value => {
    const text = String(value ?? '');
    const safe = /^[\s\uFEFF]*[=+@\-\t\r\n]/.test(text) ? "'" + text : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = [...state.sessions].sort((a, b) => a.createdAt - b.createdAt).map(s => {
    const ms = totalSegments(s.segments);
    return [s.task, getProject(s.projectId).name, new Date(s.createdAt).toISOString(), new Date(s.endedAt).toISOString(), (ms / 3600000).toFixed(3), (ms / 60000).toFixed(2), Math.round(ms)];
  });
  const csv = '\ufeff' + [header, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = `minute-sessions-${dayKey(Date.now())}.csv`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(rows.length ? 'CSV report downloaded.' : 'Empty CSV downloaded. No completed sessions yet.');
}
function setProjectNameError(message) {
  const help = $('projectNameHelp');
  help.textContent = message || 'Between 2 and 40 characters.';
  if (message) help.classList.add('is-error'); else help.classList.remove('is-error');
  $('newProjectName').ariaInvalid = message ? 'true' : null;
}
function createProject(event) {
  event.preventDefault();
  const input = $('newProjectName');
  const name = input.value.trim();
  if (name.length < 2 || name.length > 40) { setProjectNameError('Use between 2 and 40 characters.'); input.focus?.(); return; }
  if (state.projects.some(p => p.name.toLowerCase() === name.toLowerCase())) { setProjectNameError('A project with this name already exists.'); input.focus?.(); return; }
  setProjectNameError('');
  const selected = document.querySelector('input[name="color"]:checked');
  state.projects.push({ id: createId(), name, color: selected?.value || '#b9debf', archived: false });
  $('projectDialog').close(); $('projectForm').reset();
  saveState(); renderAll(); toast('Project created.');
}
function handleClick(event) {
  const navButton = event.target.closest('[data-view]');
  if (navButton) goTo(navButton.dataset.view);
  const jump = event.target.closest('[data-jump]');
  if (jump) goTo(jump.dataset.jump);
  if (event.target.closest('[data-focus-task]')) {
    goTo('overview');
    if (!state.timer) $('taskInput').focus();
  }
  if (event.target.closest('[data-clear-filters]')) {
    $('sessionSearch').value = '';
    $('sessionProjectFilter').value = 'all';
    renderSessions();
    $('sessionSearch').focus();
  }
  const stepButton = event.target.closest('[data-step-target]');
  if (stepButton && stepButton.getAttribute('aria-disabled') !== 'true') {
    const input = $(stepButton.dataset.stepTarget);
    if (Number(stepButton.dataset.step) > 0) input.stepUp(); else input.stepDown();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const trash = event.target.closest('[data-delete-session]');
  if (trash) {
    // Deleting is immediate and undoable, so there is no blocking confirmation.
    const removed = state.sessions.find(s => s.id === trash.dataset.deleteSession);
    if (removed) {
      state.sessions = state.sessions.filter(s => s.id !== removed.id);
      saveState(); renderAll();
      toast('Session deleted.', { label: 'Undo', run: () => {
        if (state.sessions.some(s => s.id === removed.id)) return;
        state.sessions.push(removed);
        saveState(); renderAll(); toast('Session restored.');
      } });
    }
  }
  const archive = event.target.closest('[data-toggle-project]');
  if (archive && !archive.disabled) {
    const project = getProject(archive.dataset.toggleProject);
    if (!project || !state.projects.some(p => p.id === project.id)) return;
    if (!project.archived && state.projects.filter(p => !p.archived).length <= 1) { toast('Keep at least one active project.'); return; }
    project.archived = !project.archived;
    saveState(); renderAll(); toast(project.archived ? 'Project archived. History is preserved.' : 'Project restored.');
  }
}

function renderClock() {
  const now = new Date();
  $('topDate').textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  $('greeting').textContent = greeting();
}

// Glass tooltips for any [data-tip]. A double space separates a label from a shortcut or value,
// which renders as a key chip. Elements keep their own accessible names; the tooltip is visual only.
function initTooltips() {
  const tip = $('tooltip');
  const railQuery = matchMedia('(min-width: 701px) and (max-width: 1080px)');
  let current = null;
  const hide = () => { current = null; tip.classList.remove('is-visible'); };
  const show = el => {
    // Sidebar labels are already visible unless the sidebar is collapsed to an icon rail.
    if (el.classList.contains('side-link') && !railQuery.matches) return hide();
    // Text tooltips only appear when the text is actually cut off.
    if ('tipOverflow' in el.dataset && el.scrollWidth <= el.clientWidth) return hide();
    const [label, detail] = el.dataset.tip.split('  ');
    const text = document.createElement('span');
    text.textContent = label;
    tip.replaceChildren(text);
    if (detail) { const chip = document.createElement('kbd'); chip.textContent = detail; tip.append(chip); }
    current = el;
    const box = el.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const beside = el.closest('.sidebar');
    let x = beside ? box.right + 12 : box.left + box.width / 2 - size.width / 2;
    let y = beside ? box.top + box.height / 2 - size.height / 2 : box.top - size.height - 8;
    if (!beside && y < 8) y = box.bottom + 8;
    x = Math.max(8, Math.min(x, innerWidth - size.width - 8));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    tip.classList.add('is-visible');
  };
  document.addEventListener('pointerover', event => {
    const el = event.target.closest?.('[data-tip]');
    if (el === current) return;
    if (el) show(el); else hide();
  });
  document.addEventListener('focusin', event => {
    const el = event.target.closest?.('[data-tip]');
    if (el && event.target.matches(':focus-visible')) show(el); else hide();
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  $('mainShell').addEventListener('scroll', hide, { passive: true });
  window.addEventListener('blur', hide);
}

function initialize() {
  renderClock();
  initTooltips();
  let savedTheme = 'system';
  try { savedTheme = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* Follow the system theme. */ }
  applyTheme(savedTheme);
  document.querySelectorAll('input[name="theme"]').forEach(input => input.addEventListener('change', () => {
    if (!input.checked) return;
    try { if (input.value === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, input.value); }
    catch { toast('Theme applied, but it could not be saved for next time.'); }
    applyTheme(input.value);
  }));
  $('startButton').addEventListener('click', toggleSession);
  $('finishButton').addEventListener('click', finishSession);
  $('taskInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && !state.timer) { event.preventDefault(); beginSession(); }
  });
  ['exportOverview', 'exportSessions', 'exportInsights', 'exportSettings'].forEach(id => $(id).addEventListener('click', exportCsv));
  $('newProjectButton').addEventListener('click', () => $('projectDialog').showModal());
  $('closeProjectDialog').addEventListener('click', () => $('projectDialog').close());
  $('cancelProjectDialog').addEventListener('click', () => $('projectDialog').close());
  $('projectDialog').addEventListener('close', () => { $('projectForm').reset(); setProjectNameError(''); });
  // A click on the blurred backdrop (the dialog element itself, outside its form) closes either dialog.
  ['projectDialog', 'confirmDialog'].forEach(id => $(id).addEventListener('click', event => { if (event.target === $(id)) $(id).close(); }));
  $('projectForm').addEventListener('submit', createProject);
  $('newProjectName').addEventListener('input', () => setProjectNameError(''));
  $('sessionProjectFilter').addEventListener('change', renderSessions);
  $('sessionSearch').addEventListener('input', renderSessions);
  $('dailyGoalSetting').addEventListener('change', event => {
    const num = Number(event.target.value);
    if (num < 1 || num > 24 || !Number.isFinite(num)) { toast('Choose a goal between 1 and 24 hours.'); renderSettings(); return; }
    state.settings.dailyGoalHours = num;
    saveState(); renderAll(); toast('Daily goal updated.');
  });
  $('idleSetting').addEventListener('change', event => {
    const num = Number(event.target.value);
    if (!Number.isInteger(num) || num < 1 || num > 30) { toast('Choose a timeout between 1 and 30 minutes.'); renderSettings(); return; }
    state.settings.idleMinutes = num;
    saveState(); renderAll(); toast('Attention timeout updated.');
  });
  $('clearDataButton').addEventListener('click', async () => {
    const clear = await askConfirm({ title: 'Clear all saved data?', message: 'This permanently deletes every project, work session, setting and dashboard attention record on this device. Export a CSV first if you need a backup.', confirmLabel: 'Clear everything', danger: true });
    if (!clear) return;
    state = DEFAULT_STATE();
    $('taskInput').value = '';
    saveState(); renderAll(); toast('Local data cleared.');
  });
  $('menuButton').addEventListener('click', () => {
    const opening = !$('sidebar').classList.contains('is-open');
    $('sidebar').classList.toggle('is-open', opening);
    $('mobileScrim').hidden = !opening;
    $('menuButton').setAttribute('aria-expanded', String(opening));
  });
  $('mobileScrim').addEventListener('click', closeMobileNav);
  const viewOrder = Object.keys(VIEW_NAMES);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMobileNav();
    // Ctrl+1 to Ctrl+6 switch sections, matching the order in the sidebar.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && /^[1-6]$/.test(event.key) && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      goTo(viewOrder[Number(event.key) - 1]);
    }
  });
  document.addEventListener('click', handleClick);
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

  // All tracked attention is scoped to THIS PAGE, never other applications.
  // Do not treat mouse movement or keypresses in VS Code as available data.
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(type => {
    document.addEventListener(type, () => { trackAttention(); lastInteraction = Date.now(); attentionActive = attentionEligible(); }, { passive: true });
  });
  document.addEventListener('visibilitychange', () => { trackAttention(); if (!document.hidden) lastInteraction = Date.now(); attentionActive = attentionEligible(); saveState(); });
  window.addEventListener('focus', () => { trackAttention(); lastInteraction = Date.now(); attentionActive = attentionEligible(); });
  window.addEventListener('blur', () => { trackAttention(); attentionActive = false; saveState(); });
  window.addEventListener('pagehide', () => { trackAttention(); saveState(); });

  renderAll();
  showView(location.hash.slice(1));
  // Date.now() prevents throttling of setInterval from under-counting work.
  // Attention deliberately uses a capped delta to avoid counting time asleep.
  setInterval(() => { trackAttention(); renderTimer(); renderMetrics(); }, 1000);
  setInterval(() => { renderClock(); renderBarChart('weeklyChart', lastDays(7), groupedByDay()); renderRecentSessions(); renderProjects(); renderInsights(); saveState(); }, 15000);
}

initialize();
