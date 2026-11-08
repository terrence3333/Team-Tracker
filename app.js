'use strict';

let me = null;
let data = { members: [], entries: [], timer: null };
let chosenMonth = '';
let setupRequired = false;
let lastRefresh = 0;
const $ = (selector) => document.querySelector(selector);
const pad = (n) => String(n).padStart(2, '0');

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function currentMonth() { return chosenMonth || localDate().slice(0, 7); }
function initials(name) { return name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase(); }
const colors = [['#f3e6d4', '#8c6c48'], ['#e4eafa', '#536cac'], ['#f4e5ed', '#a05b7a'], ['#e3efe6', '#50805d'], ['#e8e7f4', '#655d9b']];
function colorFor(i) { return colors[i % colors.length]; }
function hours(seconds) {
  const h = seconds / 3600;
  return `${h.toLocaleString('en-ZA', { minimumFractionDigits: h % 1 ? 1 : 0, maximumFractionDigits: 1 })}h`;
}
function elapsed(entry) {
  return entry.running ? Math.max(entry.seconds, Math.floor(Date.now() / 1000 - entry.started_at)) : entry.seconds || 0;
}
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 2300);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const result = await response.json().catch(() => ({ error: 'Server response could not be read.' }));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
function showError(error) { toast(error.message || String(error)); }
function setMonthOptions() {
  const select = $('#month');
  if (select.options.length) return;
  const now = new Date();
  for (let x = -12; x <= 1; x += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + x, 1);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const option = document.createElement('option');
    option.value = key;
    option.textContent = d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
    select.appendChild(option);
  }
  select.value = currentMonth();
}
function monthTitle(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
}
async function refresh() {
  data = await api(`/api/data?month=${encodeURIComponent(currentMonth())}`);
  me = data.member;
  lastRefresh = Date.now();
  paint();
}
function enterApp(member) {
  me = member;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#topName').textContent = me.name;
  $('#avatar').textContent = initials(me.name);
  $('#greeting').textContent = `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${me.name.split(' ')[0]}`;
  setMonthOptions();
}
function showAuthError(message) { $('#loginError').textContent = message; }
function configureSetup() {
  setupRequired = true;
  $('#authTitle').textContent = 'Set up your workspace';
  $('#authText').textContent = 'Create the Tepu Solutions administrator account to get started.';
  $('#setupFields').classList.remove('hidden');
  $('#confirmField').classList.remove('hidden');
  $('#adminName').required = true;
  $('#confirmPassword').required = true;
  $('#password').autocomplete = 'new-password';
  $('#loginSubmit').textContent = 'Create administrator account';
  $('#loginFoot').textContent = 'This one-time setup is available only until the first administrator account is created.';
}
function total(entries) { return entries.reduce((sum, entry) => sum + elapsed(entry), 0); }

function paintMetrics() {
  const entries = data.entries;
  const mine = entries.filter((entry) => entry.member_id === me.id);
  const today = entries.filter((entry) => entry.date === localDate());
  const allSeconds = total(entries);
  const targetHours = data.members.length * 160;
  const progress = targetHours ? Math.round(allSeconds / 3600 / targetHours * 100) : 0;
  const cards = [
    ['Team hours', hours(allSeconds), `${monthTitle(currentMonth())} · all members`, '◷'],
    ['Hours today', hours(total(today)), `${today.length} entries logged today`, '◴'],
    ['My hours', hours(total(mine)), `${me.name.split(' ')[0]} · this month`, '♙'],
    ['Team target', `${progress}%`, `${hours(allSeconds)} of ${hours(targetHours * 3600)} monthly guide`, '↗'],
  ];
  $('#metrics').innerHTML = cards.map((card) => `<article class="metric"><div class="metric-label"><span>${card[0]}</span><i class="metric-ico">${card[3]}</i></div><div class="metric-value">${card[1]}</div><div class="metric-foot">${card[2]}</div></article>`).join('');
}
function paintChart() {
  const [year, month] = currentMonth().split('-').map(Number);
  const count = new Date(year, month, 0).getDate();
  const today = localDate();
  const byDate = {};
  for (const entry of data.entries) byDate[entry.date] = (byDate[entry.date] || 0) + elapsed(entry);
  const max = Math.max(12, ...Object.values(byDate));
  const step = Math.ceil(max / 4);
  const limit = step * 4;
  $('#chartSub').textContent = `Daily hours logged · ${monthTitle(currentMonth())}`;
  $('#chart').innerHTML = `<div class="ylabels">${[4, 3, 2, 1, 0].map((n) => `<span>${n * step}h</span>`).join('')}</div><div class="lines">${[0, 1, 2, 3, 4].map(() => '<i></i>').join('')}</div>` + Array.from({ length: count }, (_, i) => {
    const day = i + 1;
    const key = `${year}-${pad(month)}-${pad(day)}`;
    const value = byDate[key] || 0;
    const show = day === 1 || day === count || day % 5 === 0 || key === today;
    return `<div class="daybar" title="${monthTitle(currentMonth()).split(' ')[0]} ${day}: ${hours(value)}"><div class="stack"><i class="bar ${key === today ? 'today' : ''}" style="height:${value ? Math.max(2, value / limit * 100) : 0}%"></i></div><span class="daylabel ${key === today ? 'today' : ''}">${show ? day : ''}</span></div>`;
  }).join('');
}
function paintTeam() {
  const totals = data.members.map((member) => ({ member, seconds: total(data.entries.filter((entry) => entry.member_id === member.id)) }));
  $('#memberCount').textContent = `${data.members.length} members`;
  $('#team').innerHTML = totals.map((item, index) => {
    const [background, foreground] = colorFor(index);
    const percent = Math.min(100, Math.round(item.seconds / 3600 / 160 * 100));
    return `<div class="team-row"><i class="person-avatar" style="background:${background};color:${foreground};font-style:normal">${initials(item.member.name)}</i><div class="person-main"><div class="person-name">${escapeHtml(item.member.name)}</div><div class="person-role">${item.member.role === 'admin' ? 'Administrator' : 'Team member'}<div class="progress"><i style="width:${percent}%"></i></div></div></div><span class="hours">${hours(item.seconds)}</span></div>`;
  }).join('');
  $('#teamTotal').textContent = hours(total(data.entries));
}
function paintEntries() {
  const recent = data.entries.slice(0, 8);
  $('#entryRows').innerHTML = recent.length ? recent.map((entry) => {
    const index = data.members.findIndex((member) => member.id === entry.member_id);
    const [background, foreground] = colorFor(Math.max(index, 0));
    const day = new Date(`${entry.date}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
    return `<tr><td><span style="display:flex;align-items:center;gap:6px"><i class="person-avatar" style="width:22px;height:22px;background:${background};color:${foreground};font-style:normal">${initials(entry.member_name)}</i>${escapeHtml(entry.member_name.split(' ')[0])}</span></td><td>${escapeHtml(entry.description)}<span style="display:block;color:#a0a8a3;font-size:8px;margin-top:3px">${day} · ${escapeHtml(entry.start)}</span></td><td>${escapeHtml(entry.project)}</td><td class="entry-duration">${hours(elapsed(entry))}</td><td><span class="tag">${entry.running ? 'In progress' : 'Logged'}</span></td></tr>`;
  }).join('') : '<tr><td colspan="5"><div class="empty">No entries for this month yet. Start a timer to log a work session.</div></td></tr>';
}
function paintSnapshot() {
  const allSeconds = total(data.entries);
  const targetSeconds = data.members.length * 160 * 3600;
  const best = [...data.members].map((member) => ({ member, seconds: total(data.entries.filter((entry) => entry.member_id === member.id)) })).sort((a, b) => b.seconds - a.seconds)[0];
  const progress = targetSeconds ? Math.min(100, allSeconds / targetSeconds * 100) : 0;
  const dailyAverage = allSeconds / 22;
  const addMember = me.role === 'admin' ? `<form class="admin-form" id="addMember"><h3>Add a team member</h3><div class="admin-fields"><input name="name" placeholder="Full name" required maxlength="100"><input name="email" type="email" placeholder="Work email" required><input name="password" type="password" placeholder="Temporary password (10+ characters)" required minlength="10"><button class="primary">Create member account</button></div><div class="small-note">Share the initial password privately. Members can sign in with their work email.</div></form>` : '';
  $('#snapshot').innerHTML = `<div class="snap-row"><span>Average per member</span><b>${hours(allSeconds / Math.max(1, data.members.length))}</b></div><div class="snap-row"><span>Logged work sessions</span><b>${data.entries.length}</b></div><div class="snap-row"><span>Most hours logged</span><b>${best && best.seconds ? `${escapeHtml(best.member.name.split(' ')[0])} · ${hours(best.seconds)}` : '—'}</b></div><div class="snap-row"><span>Daily team average</span><b>${hours(dailyAverage)}</b></div><div class="target"><div class="target-line"><span>Monthly team target</span><b>${Math.round(progress)}%</b></div><div class="target-progress"><i style="width:${progress}%"></i></div><div class="small-note">Planning guide based on 160 hours per team member. Leave and holidays are not adjusted.</div>${addMember}</div>`;
  const form = $('#addMember');
  if (form) form.addEventListener('submit', createMember);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function paintTimer() {
  const timer = data.timer;
  if (!timer) {
    $('#clock').textContent = '00:00:00';
    $('#timerCaption').textContent = 'Ready when you are';
    $('#running').classList.add('hidden');
    $('#timerButton').classList.remove('stop');
    $('#timerButton').innerHTML = '▶ &nbsp; Start timer';
    $('#description').disabled = false;
    $('#project').disabled = false;
    return;
  }
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timer.started_at));
  $('#clock').textContent = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}:${pad(seconds % 60)}`;
  $('#timerCaption').textContent = `${timer.description} · ${timer.project}`;
  $('#running').classList.remove('hidden');
  $('#timerButton').classList.add('stop');
  $('#timerButton').innerHTML = '■ &nbsp; Stop timer';
  $('#description').disabled = true;
  $('#project').disabled = true;
}
function paint() { paintMetrics(); paintChart(); paintTeam(); paintEntries(); paintSnapshot(); paintTimer(); }

async function createMember(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await api('/api/members', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    await refresh();
    toast('Member account created');
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
}
async function openDashboard(member) {
  enterApp(member);
  try { await refresh(); }
  catch (error) {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    showAuthError(error.message);
  }
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#loginSubmit');
  button.disabled = true;
  showAuthError('');
  try {
    let result;
    if (setupRequired) {
      if ($('#password').value !== $('#confirmPassword').value) throw new Error('The passwords do not match.');
      result = await api('/api/setup', { method: 'POST', body: JSON.stringify({ name: $('#adminName').value, email: $('#email').value, password: $('#password').value }) });
    } else {
      result = await api('/api/login', { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
    }
    await openDashboard(result.member);
    $('#password').value = '';
    $('#confirmPassword').value = '';
  } catch (error) { showAuthError(error.message); }
  finally { button.disabled = false; }
});

$('#logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (error) { showError(error); }
  me = null;
  data = { members: [], entries: [], timer: null };
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  showAuthError('');
});
$('#timerButton').addEventListener('click', async () => {
  const button = $('#timerButton');
  button.disabled = true;
  try {
    if (data.timer) {
      await api('/api/timer/stop', { method: 'POST', body: '{}' });
      await refresh();
      toast('Time entry saved');
    } else {
      await api('/api/timer/start', { method: 'POST', body: JSON.stringify({ description: $('#description').value.trim(), project: $('#project').value, date: localDate(), start: new Date().toTimeString().slice(0, 5) }) });
      await refresh();
      toast('Timer started');
    }
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
});
$('#month').addEventListener('change', (event) => { chosenMonth = event.target.value; refresh().catch(showError); });
$('#thisMonth').addEventListener('click', () => { chosenMonth = localDate().slice(0, 7); $('#month').value = chosenMonth; refresh().catch(showError); });
$('#entriesNav').addEventListener('click', () => document.querySelector('.bottom').scrollIntoView({ behavior: 'smooth' }));
$('#reportsNav').addEventListener('click', () => document.querySelector('.grid').scrollIntoView({ behavior: 'smooth' }));

async function init() {
  try {
    const status = await api('/api/status');
    if (status.setup_required) {
      configureSetup();
    } else if (status.member) {
      await openDashboard(status.member);
    }
  } catch (error) {
    showAuthError(`${error.message} Start the tracker server, then reload this page.`);
  }
}
setInterval(() => {
  if (!me) return;
  if (data.timer) { paintTimer(); paintMetrics(); paintChart(); paintEntries(); }
  if (Date.now() - lastRefresh > 20_000) refresh().catch(showError);
}, 1000);
init();

