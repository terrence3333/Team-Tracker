'use strict';

let me = null;
let data = { members: [], entries: [], timer: null, active_timers: [] };
let catalog = { projects: [], roles: [] };
let currentPage = 'overview';
let setupRequired = false;
let lastRefresh = 0;
let activePreset = 'this-month';
let dateRange = { from: '', to: '', label: 'This month' };
let calendarMonth = monthStart(new Date());
let calendarPickStart = true;
const $ = (selector) => document.querySelector(selector);
const pad = (n) => String(n).padStart(2, '0');
const colors = [['#f3e6d4','#8c6c48'],['#e4eafa','#536cac'],['#f4e5ed','#a05b7a'],['#e3efe6','#50805d'],['#e8e7f4','#655d9b']];

function localDate(date = new Date()) { return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function fromISO(value) { const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(date, days) { const copy = new Date(date); copy.setDate(copy.getDate()+days); return copy; }
function monthStart(date) { return new Date(date.getFullYear(),date.getMonth(),1); }
function monthEnd(date) { return new Date(date.getFullYear(),date.getMonth()+1,0); }
function startWeek(date) { const d = new Date(date); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return d; }
function setRange(from,to,label,preset='custom') { dateRange={from:localDate(from),to:localDate(to),label}; activePreset=preset; calendarMonth=monthStart(fromISO(dateRange.to)); calendarPickStart=true; $('#rangeFrom').value=dateRange.from; $('#rangeTo').value=dateRange.to; $('#dateRangeLabel').textContent=label; document.querySelectorAll('.preset-btn').forEach(b=>b.classList.toggle('selected',b.dataset.preset===preset)); paintCalendar(); }
function applyPreset(key) {
  const today=fromISO(localDate()); let from=today,to=today,label='';
  if(key==='today') label='Today';
  if(key==='yesterday'){from=to=addDays(today,-1);label='Yesterday';}
  if(key==='this-week'){from=startWeek(today);label='This week';}
  if(key==='last-7-days'){from=addDays(today,-6);label='Last 7 days';}
  if(key==='previous-week'){to=addDays(startWeek(today),-1);from=addDays(to,-6);label='Previous week';}
  if(key==='this-month'){from=monthStart(today);label='This month';}
  if(key==='previous-month'){to=monthEnd(new Date(today.getFullYear(),today.getMonth()-1,1));from=monthStart(to);label='Previous month';}
  if(key==='last-3-months'){from=monthStart(new Date(today.getFullYear(),today.getMonth()-2,1));label='Last 3 months';}
  if(key==='last-6-months'){from=monthStart(new Date(today.getFullYear(),today.getMonth()-5,1));label='Last 6 months';}
  setRange(from,to,label,key);
}
function rangeLabel(){return dateRange.from===dateRange.to?fromISO(dateRange.from).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'}):`${fromISO(dateRange.from).toLocaleDateString('en-ZA',{day:'numeric',month:'short'})} – ${fromISO(dateRange.to).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'})}`;}
function paintCalendar(){
  const grid=$('#calendarDays');if(!grid)return;
  const month=calendarMonth,first=startWeek(month),today=localDate();
  $('#calendarMonthLabel').textContent=month.toLocaleDateString('en-ZA',{month:'long',year:'numeric'});
  const cells=[];
  for(let i=0;i<42;i++){
    const date=addDays(first,i),key=localDate(date),inMonth=date.getMonth()===month.getMonth();
    const selected=key===dateRange.from||key===dateRange.to;
    const between=key>dateRange.from&&key<dateRange.to;
    cells.push(`<button type="button" class="calendar-day ${inMonth?'':'outside'} ${selected?'selected':''} ${between?'between':''} ${key===today?'today':''}" data-date="${key}" aria-pressed="${selected}">${date.getDate()}</button>`);
  }
  grid.innerHTML=cells.join('');
  $('#calendarSelection').textContent=calendarPickStart?'Select a start date':`Start: ${fromISO(dateRange.from).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'})} · choose an end date`;
}
function chooseCalendarDay(value){
  const picked=fromISO(value);
  if(calendarPickStart){setRange(picked,picked,'Choose an end date','custom');calendarPickStart=false;return;}
  const start=fromISO(dateRange.from);if(picked<start)setRange(picked,start,'custom','custom');else setRange(start,picked,'custom','custom');calendarPickStart=true;
}
function initials(name=''){return String(name).split(/\s+/).filter(Boolean).map(x=>x[0]).slice(0,2).join('').toUpperCase()||'TN';}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function hours(seconds){const h=Math.max(0,Number(seconds||0))/3600;return `${h.toLocaleString('en-ZA',{minimumFractionDigits:h%1?1:0,maximumFractionDigits:1})}h`;}
function elapsed(entry){return entry.running?Math.max(entry.seconds||0,Math.floor(Date.now()/1000-entry.started_at)):(entry.seconds||0);}
function total(entries){return entries.reduce((sum,entry)=>sum+elapsed(entry),0);}
function memberName(id){return data.members.find(m=>m.id===id)?.name||'Team member';}
function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('show');setTimeout(()=>node.classList.remove('show'),2800);}
function showError(error){toast(error.message||String(error));}
async function api(path,options={}) {
  const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const result=await response.json().catch(()=>({error:'The server returned an unreadable response.'}));
  if(!response.ok)throw new Error(result.error||`Request failed (${response.status})`);
  return result;
}
async function refresh(){
  const query=new URLSearchParams({start:dateRange.from,end:dateRange.to});
  const [nextData,nextCatalog]=await Promise.all([api(`/api/data?${query}`),api('/api/catalog')]);
  data=nextData;catalog=nextCatalog;me=data.member;lastRefresh=Date.now();paint();
}
function greeting(){const hour=new Date().getHours();return hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';}
function showAuthError(message){$('#loginError').textContent=message||'';}
function configureSetup(status){
  setupRequired=true;$('#authTitle').textContent='Set up your workspace';$('#authText').textContent='Create the Tepu Solutions administrator account to get started.';
  $('#setupFields').classList.remove('hidden');$('#confirmField').classList.remove('hidden');$('#adminName').required=true;$('#confirmPassword').required=true;$('#password').autocomplete='new-password';
  if(status.setup_requires_key){$('#setupKeyField').classList.remove('hidden');$('#setupKey').required=true;$('#loginFoot').textContent='Use the one-time setup key saved in your hosting dashboard or password manager.';}
  $('#loginSubmit').textContent='Create administrator account';
}
function enterApp(member){
  me=member;$('#login').classList.add('hidden');$('#app').classList.remove('hidden');$('#topName').textContent=me.name;$('#avatar').textContent=initials(me.name);$('#profileName').value=me.name;$('#profileEmail').value=me.email;$('#profileRole').textContent=me.role==='admin'?'Administrator':(me.job_role||'Team member');$('#workspaceCaption').textContent=me.role==='admin'?'Administrator workspace':'Member workspace';$('#greeting').textContent=`${greeting()}, ${me.name.split(' ')[0]}`;
}
function pageConfig(page){
  const admin=me?.role==='admin';
  const labels=admin?{overview:['Overview','TEAM WORKSPACE','Your team at a glance'],entries:['Time entries','TEAM RECORDS','Review and export all member time entries'],reports:['Reports','TEAM REPORTING','Compare team hours, projects, and work roles'],manage:['Team & setup','ADMINISTRATION','Manage members, projects, and available work roles']}:{overview:['Overview','MY WORKSPACE','Your timer, hours, and recent activity'],entries:['My time entries','PERSONAL RECORDS','Review and export your time entries'],reports:['My reports','PERSONAL REPORTING','Review your hours by date, project, and role']};
  const [title,eyebrow,sub]=labels[page]||labels.overview;$('#crumbPage').textContent=title;$('#pageTitle').textContent=page==='overview'?`${greeting()}, ${me.name.split(' ')[0]}`:title;$('#pageEyebrow').textContent=eyebrow;$('#pageSub').textContent=sub;
  ['overview','entries','reports','manage'].forEach(name=>$('#page-'+name).classList.toggle('hidden',name!==page));
  currentPage=page;
  document.querySelectorAll('.nav-btn').forEach(button=>button.classList.toggle('active',button.dataset.page===page));
  renderCurrentPage();
}
function renderNav(){
  const pages=me.role==='admin'?[['overview','▦','Overview'],['entries','◷','Time entries'],['reports','⌁','Reports'],['manage','⚙','Team & setup']]:[['overview','▦','Overview'],['entries','◷','My time entries'],['reports','⌁','My reports']];
  $('#nav').innerHTML=pages.map(([page,icon,label])=>`<button class="nav-btn" type="button" data-page="${page}"><span class="nav-icon">${icon}</span>${label}</button>`).join('');
}
function setPage(page){if(page==='manage'&&me.role!=='admin')return;pageConfig(page);}
function paintCatalog(){
  const currentProject=$('#projectName').value;
  $('#projectName').innerHTML='<option value="">Select a project</option>'+catalog.projects.filter(p=>p.active!==false).map(p=>`<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
  if(catalog.projects.some(p=>p.name===currentProject))$('#projectName').value=currentProject;
  const selected=catalog.projects.find(p=>p.name===$('#projectName').value);
  $('#projectTypeDisplay').textContent=selected?.project_type||'Choose a project';
  const currentRole=$('#workRole').value||me?.job_role||'';
  $('#workRole').innerHTML='<option value="">Select a role</option>'+catalog.roles.filter(r=>r.active!==false).map(r=>`<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
  if(catalog.roles.some(r=>r.name===currentRole))$('#workRole').value=currentRole;
  $('#timerNote').textContent=catalog.projects.length&&catalog.roles.length?'Enter the project ID, choose a project, and select your work role.':'Ask your administrator to add a project and work role before starting a timer.';
  $('#timerButton').disabled=!data.timer&&(!catalog.projects.length||!catalog.roles.length);
  const jobRole=$('#memberJobRole');
  if(jobRole){const v=jobRole.value;jobRole.innerHTML='<option value="">Select a role</option>'+catalog.roles.filter(r=>r.active!==false).map(r=>`<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');if(catalog.roles.some(r=>r.name===v))jobRole.value=v;}
}
function paintMetrics(){
  const entries=data.entries;const mine=entries.filter(e=>e.member_id===me.id);const todayEntries=entries.filter(e=>e.date===localDate());
  let cards;
  if(me.role==='admin'){
    const active=(data.active_timers||[]).length;
    cards=[['Team hours',hours(total(entries)),rangeLabel(),'◷'],['Hours today',hours(total(todayEntries)),`${todayEntries.length} entries today`,'◴'],['Team members',String(data.members.length),'Active accounts','♙'],['Running timers',String(active),active===1?'One member working':'Across the team','▶']];
  }else{
    cards=[['My hours',hours(total(mine)),rangeLabel(),'◷'],['Hours today',hours(total(todayEntries)),`${todayEntries.length} entries today`,'◴'],['My entries',String(mine.length),'In this date range','▤'],['Running timer',data.timer?'Active':'Stopped',data.timer?'Clock is running':'Ready when you are','▶']];
  }
  $('#metrics').innerHTML=cards.map(([label,value,foot,icon])=>`<article class="metric"><div class="metric-label"><span>${label}</span><i class="metric-icon">${icon}</i></div><div class="metric-value">${value}</div><div class="metric-foot">${escapeHtml(foot)}</div></article>`).join('');
}
function paintChart(){
  const entries=me.role==='admin'?data.entries:data.entries.filter(e=>e.member_id===me.id);
  const start=fromISO(dateRange.from),end=fromISO(dateRange.to),days=Math.max(1,Math.round((end-start)/86400000)+1),byDay={};
  for(const e of entries)byDay[e.date]=(byDay[e.date]||0)+elapsed(e);
  const max=Math.max(3600,...Object.values(byDay));
  const columns=[];
  for(let i=0;i<days;i++){const date=addDays(start,i),key=localDate(date),value=byDay[key]||0;const show=days<=16||i===0||i===days-1||date.getDate()===1||i%7===0;columns.push(`<div class="chart-bar-col"><i class="chart-bar ${key===localDate()?'today':''}" style="height:${value?Math.max(2,value/max*94):0}%" title="${key}: ${hours(value)}"></i><span class="chart-label">${show?date.toLocaleDateString('en-ZA',{day:'numeric',month:days>45?'short':undefined}):''}</span></div>`);}
  $('#chart').innerHTML='<div class="chart-grid"><i></i><i></i><i></i><i></i></div>'+columns.join('');
  $('#chartSub').textContent=`Daily hours · ${rangeLabel()}`;
}
function durationCell(entry){return `<span class="pill ${entry.running?'running':''}">${entry.running?'Running':'Logged'}</span>`;}
function renderTeam(){
  if(me.role==='admin'){
    $('#teamPanelTitle').textContent='Team progress';$('#teamPanelSub').textContent='Hours tracked by member · select a member to review their records';$('#memberCount').textContent=`${data.members.length} members`;$('#teamHeader').innerHTML='<th>Member</th><th>Work role</th><th>Hours</th><th></th>';
    const rows=data.members.map((member,index)=>{const seconds=total(data.entries.filter(e=>e.member_id===member.id));const [bg,fg]=colors[index%colors.length];return `<tr><td><strong><span class="avatar" style="display:inline-grid;vertical-align:middle;width:26px;height:26px;margin-right:7px;background:${bg};color:${fg}">${initials(member.name)}</span>${escapeHtml(member.name)}</strong></td><td>${escapeHtml(member.job_role|| (member.role==='admin'?'Administrator':'—'))}</td><td>${hours(seconds)}</td><td><button type="button" class="soft-btn" data-open-member="${escapeHtml(member.id)}">View records</button></td></tr>`;}).join('');
    $('#teamRows').innerHTML=rows||'<tr><td colspan="4" class="empty">No team members yet.</td></tr>';
  }else{
    $('#teamPanelTitle').textContent='My work summary';$('#teamPanelSub').textContent='Your hours in this period';$('#memberCount').textContent=me.job_role||'Member';$('#teamHeader').innerHTML='<th>Summary</th><th>Value</th>';
    const entries=data.entries.filter(e=>e.member_id===me.id);$('#teamRows').innerHTML=`<tr><td><strong>Work role</strong></td><td>${escapeHtml(me.job_role||'Not assigned')}</td></tr><tr><td><strong>Tracked hours</strong></td><td>${hours(total(entries))}</td></tr><tr><td><strong>Logged sessions</strong></td><td>${entries.length}</td></tr><tr><td><strong>Projects used</strong></td><td>${new Set(entries.map(e=>e.project)).size}</td></tr>`;
  }
}
function entryRow(entry,includeDetails=false){
  const day=new Date(`${entry.date}T00:00:00`).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'});
  const row=[day,escapeHtml(memberName(entry.member_id)),escapeHtml(entry.project_id||'—'),escapeHtml(entry.project||'—'),escapeHtml(entry.project_type||'—'),escapeHtml(entry.work_role||'—'),escapeHtml(entry.description||'—'),escapeHtml(entry.start||'—'),hours(elapsed(entry)),durationCell(entry)];
  return `<tr>${(includeDetails?row:row.filter((_,i)=>[0,1,2,3,5,8,9].includes(i))).map((cell,i)=>`<td>${cell}</td>`).join('')}</tr>`;
}
function paintRecent(){
  const recent=data.entries.slice(0,6);$('#recentRows').innerHTML=recent.length?recent.map(e=>entryRow(e,false)).join():'<tr><td colspan="7" class="empty">No time entries in this date range. Start a timer to log work.</td></tr>';
}
function paintEntriesPage(){
  const filter=$('#memberFilter'),selected=filter.value;
  filter.classList.toggle('hidden',me.role!=='admin');
  filter.innerHTML='<option value="">All members</option>'+data.members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  if(data.members.some(m=>m.id===selected))filter.value=selected;
  const entries=data.entries.filter(e=>!filter.value||e.member_id===filter.value);
  $('#entriesSub').textContent=`${entries.length} entries · ${rangeLabel()}`;
  $('#entriesRows').innerHTML=entries.length?entries.map(e=>entryRow(e,true)).join():'<tr><td colspan="10" class="empty">No time entries in this date range.</td></tr>';
}
function aggregate(list,keyFn){
  const map=new Map();
  for(const entry of list){const key=keyFn(entry);const item=map.get(key)||{seconds:0,count:0,entries:[]};item.seconds+=elapsed(entry);item.count++;item.entries.push(entry);map.set(key,item);}
  return [...map.entries()].map(([key,value])=>({key,...value}));
}
function paintReports(){
  const entries=me.role==='admin'?data.entries:data.entries.filter(e=>e.member_id===me.id);
  const totalSeconds=total(entries),days=Math.max(1,Math.round((fromISO(dateRange.to)-fromISO(dateRange.from))/86400000)+1);
  const cards=[['Total hours',hours(totalSeconds)],['Work sessions',String(entries.length)],['Daily average',hours(totalSeconds/days)]];
  $('#reportCards').innerHTML=cards.map(([label,value])=>`<article class="report-card"><span>${label}</span><strong>${value}</strong></article>`).join('');
  const members=me.role==='admin'?data.members:[me];
  $('#reportRows').innerHTML=members.map(member=>{const rows=entries.filter(e=>e.member_id===member.id),projects=aggregate(rows,e=>e.project||'—').sort((a,b)=>b.seconds-a.seconds);return `<tr><td><strong>${escapeHtml(member.name)}</strong></td><td>${escapeHtml(member.job_role||'—')}</td><td>${rows.length}</td><td>${hours(total(rows))}</td><td>${escapeHtml(projects[0]?.key||'—')}</td></tr>`;}).join('')||'<tr><td colspan="5" class="empty">No report data in this date range.</td></tr>';
  const groups=aggregate(entries,e=>`${e.project||'—'}\u0000${e.project_type||'—'}\u0000${e.work_role||'—'}`).sort((a,b)=>b.seconds-a.seconds);
  $('#projectReportRows').innerHTML=groups.map(g=>{const [project,type,role]=g.key.split('\u0000');return `<tr><td><strong>${escapeHtml(project)}</strong></td><td>${escapeHtml(type)}</td><td>${escapeHtml(role)}</td><td>${g.count}</td><td>${hours(g.seconds)}</td></tr>`;}).join('')||'<tr><td colspan="5" class="empty">No project activity in this date range.</td></tr>';
}
function paintManage(){
  $('#membersRows').innerHTML=data.members.map(m=>`<tr><td><strong>${escapeHtml(m.name)}</strong><div class="small-note">${escapeHtml(m.email)}</div></td><td>${escapeHtml(m.job_role||'—')}</td><td><span class="pill">${m.role==='admin'?'Administrator':'Member'}</span></td></tr>`).join('')||'<tr><td colspan="3" class="empty">No members yet.</td></tr>';
  $('#projectsList').innerHTML=catalog.projects.map(p=>`<div class="catalog-item"><div><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.project_type||'Project')}${p.active===false?' · Archived':''}</span></div><button class="soft-btn catalog-toggle" data-kind="project" data-id="${p.id}" data-active="${p.active===false?'false':'true'}">${p.active===false?'Restore':'Archive'}</button></div>`).join('')||'<div class="small-note">No projects yet. Add a project above.</div>';
  $('#rolesList').innerHTML=catalog.roles.map(r=>`<div class="catalog-item"><div><strong>${escapeHtml(r.name)}</strong><span>${r.active===false?'Archived':'Available to members'}</span></div><button class="soft-btn catalog-toggle" data-kind="role" data-id="${r.id}" data-active="${r.active===false?'false':'true'}">${r.active===false?'Restore':'Archive'}</button></div>`).join('')||'<div class="small-note">No work roles yet. Add a role above.</div>';
  $('#adminSummary').innerHTML=[['Members',String(data.members.length)],['Logged entries in selected range',String(data.entries.length)],['Currently running timers',String((data.active_timers||[]).length)],['Selected period',rangeLabel()]].map(([a,b])=>`<div class="catalog-item"><strong>${escapeHtml(a)}</strong><span>${escapeHtml(b)}</span></div>`).join('');
  paintCatalog();
}
function paintTimer(){
  const timer=data.timer;
  if(timer){
    const seconds=Math.max(0,Math.floor(Date.now()/1000-timer.started_at));
    $('#clock').textContent=`${pad(Math.floor(seconds/3600))}:${pad(Math.floor(seconds%3600/60))}:${pad(seconds%60)}`;
    $('#timerCaption').textContent=`${timer.project_id?timer.project_id+' · ':''}${timer.project||timer.description} · ${timer.work_role||'Work in progress'}`;
    $('#timerButton').classList.add('stop');$('#timerButton').textContent='■ Stop timer';
  }else{
    $('#clock').textContent='00:00:00';$('#timerCaption').textContent='Ready when you are';$('#timerButton').classList.remove('stop');$('#timerButton').textContent='▶ Start timer';
  }
  ['#projectId','#projectName','#workRole'].forEach(selector=>$(selector).disabled=Boolean(timer));
  $('#timerButton').disabled=!timer&&(!catalog.projects.some(p=>p.active!==false)||!catalog.roles.some(r=>r.active!==false));
}
function paint(){
  if(!me)return;
  $('#topName').textContent=me.name;$('#avatar').textContent=initials(me.name);$('#profileRole').textContent=me.role==='admin'?'Administrator':(me.job_role||'Member');
  paintCatalog();paintMetrics();paintChart();renderTeam();paintRecent();paintEntriesPage();paintReports();if(me.role==='admin')paintManage();paintTimer();pageConfig(currentPage);
}
function renderCurrentPage(){
  $('#pageTitle').textContent=currentPage==='overview'?`${greeting()}, ${me.name.split(' ')[0]}`:$('#pageTitle').textContent;
  paintMetrics();paintChart();renderTeam();paintRecent();paintEntriesPage();paintReports();if(me.role==='admin')paintManage();paintTimer();
}
async function openDashboard(member){
  enterApp(member);renderNav();currentPage='overview';
  try{await refresh();pageConfig('overview');}
  catch(error){$('#app').classList.add('hidden');$('#login').classList.remove('hidden');showAuthError(error.message);}
}
function csvEscape(value){return `"${String(value??'').replace(/"/g,'""')}"`;}
function downloadCsv(filename,rows){
  const csv=rows.map(row=>row.map(csvEscape).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}
function exportEntries(){
  const filter=$('#memberFilter').value;const entries=data.entries.filter(e=>!filter||e.member_id===filter);
  downloadCsv('tepu-time-entries.csv',[['Date','Member','Project ID','Project name','Project type','Work role','Description','Start','Hours','Status'],...entries.map(e=>[e.date,memberName(e.member_id),e.project_id,e.project,e.project_type,e.work_role,e.description,e.start,(elapsed(e)/3600).toFixed(2),e.running?'Running':'Logged'])]);
}
function exportReports(){
  const entries=me.role==='admin'?data.entries:data.entries.filter(e=>e.member_id===me.id);const members=me.role==='admin'?data.members:[me];
  downloadCsv('tepu-hours-report.csv',[['Member','Work role','Entries','Hours','Project'],...members.map(m=>{const rows=entries.filter(e=>e.member_id===m.id);return[m.name,m.job_role,rows.length,(total(rows)/3600).toFixed(2),aggregate(rows,e=>e.project||'—').sort((a,b)=>b.seconds-a.seconds)[0]?.key||'—'];})]);
}
async function saveCatalog(kind,form){
  const errorId=kind==='project'?'#projectError':'#roleError';$(errorId).textContent='';
  try{await api(`/api/admin/${kind}s`,{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();await refresh();toast(kind==='project'?'Project added':'Work role added');}
  catch(error){$(errorId).textContent=error.message;}
}
async function toggleCatalog(button){
  const kind=button.dataset.kind;const endpoint=kind==='project'?'/api/admin/projects/':'/api/admin/roles/';
  try{await api(endpoint+encodeURIComponent(button.dataset.id),{method:'PATCH',body:JSON.stringify({active:button.dataset.active==='false'})});await refresh();toast('Options updated');}
  catch(error){showError(error);}
}
async function saveProfile(event){
  event.preventDefault();const button=event.submitter;button.disabled=true;
  try{const result=await api('/api/profile',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});me=result.member;$('#profileName').value=me.name;$('#profileEmail').value=me.email;$('#currentPassword').value='';$('#newPassword').value='';$('#profileMenu').classList.add('hidden');await refresh();toast('Profile updated');}
  catch(error){showError(error);}
  finally{button.disabled=false;}
}
async function createMember(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');$('#memberError').textContent='';button.disabled=true;
  try{await api('/api/members',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();await refresh();toast('Member account created');}
  catch(error){$('#memberError').textContent=error.message;}
  finally{button.disabled=false;}
}
async function submitTimer(){
  const button=$('#timerButton');button.disabled=true;
  try{
    if(data.timer){await api('/api/timer/stop',{method:'POST',body:'{}'});await refresh();toast('Time entry saved');return;}
    const project=catalog.projects.find(p=>p.name===$('#projectName').value);const role=$('#workRole').value;
    if(!$('#projectId').value.trim())throw new Error('Enter the project ID.');
    if(!project)throw new Error('Choose a project from the administrator’s list.');
    if(!role)throw new Error('Choose a work role.');
    await api('/api/timer/start',{method:'POST',body:JSON.stringify({project_id:$('#projectId').value.trim(),project:project.name,project_type:project.project_type,work_role:role,description:project.name,date:localDate(),start:new Date().toTimeString().slice(0,5)})});
    await refresh();toast('Timer started');
  }catch(error){showError(error);}
  finally{button.disabled=false;paintTimer();}
}

setRange(monthStart(fromISO(localDate())),fromISO(localDate()),'This month','this-month');
$('#loginForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#loginSubmit');button.disabled=true;showAuthError('');
  try{
    let result;
    if(setupRequired){if($('#password').value!==$('#confirmPassword').value)throw new Error('The passwords do not match.');result=await api('/api/setup',{method:'POST',body:JSON.stringify({name:$('#adminName').value,email:$('#email').value,password:$('#password').value,setup_key:$('#setupKey').value})});}
    else result=await api('/api/login',{method:'POST',body:JSON.stringify({email:$('#email').value,password:$('#password').value})});
    await openDashboard(result.member);$('#password').value='';$('#confirmPassword').value='';$('#setupKey').value='';
  }catch(error){showAuthError(error.message);}
  finally{button.disabled=false;}
});
$('#timerButton').addEventListener('click',submitTimer);
$('#projectName').addEventListener('change',()=>{const p=catalog.projects.find(x=>x.name===$('#projectName').value);$('#projectTypeDisplay').textContent=p?.project_type||'Choose a project';});
$('#profileButton').addEventListener('click',()=>{const menu=$('#profileMenu');menu.classList.toggle('hidden');$('#profileButton').setAttribute('aria-expanded',String(!menu.classList.contains('hidden')));});
document.addEventListener('click',event=>{if(!event.target.closest('.profile-wrap')){$('#profileMenu')?.classList.add('hidden');$('#profileButton')?.setAttribute('aria-expanded','false');}});
$('#profileForm').addEventListener('submit',saveProfile);
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});}catch(error){showError(error);}me=null;data={members:[],entries:[],timer:null,active_timers:[]};$('#app').classList.add('hidden');$('#login').classList.remove('hidden');$('#profileMenu').classList.add('hidden');showAuthError('');});
$('#nav').addEventListener('click',event=>{const button=event.target.closest('[data-page]');if(button)setPage(button.dataset.page);});
$('#teamRows').addEventListener('click',event=>{const button=event.target.closest('[data-open-member]');if(!button)return;$('#memberFilter').value=button.dataset.openMember;setPage('entries');paintEntriesPage();});
document.addEventListener('click',event=>{const button=event.target.closest('[data-open-page]');if(button)setPage(button.dataset.openPage);});
$('#dateFilterBtn').addEventListener('click',()=>{$('#rangePopover').classList.toggle('hidden');$('#rangeFrom').value=dateRange.from;$('#rangeTo').value=dateRange.to;});
$('#calendarPrev').addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);paintCalendar();});
$('#calendarNext').addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);paintCalendar();});
$('#calendarDays').addEventListener('click',event=>{const button=event.target.closest('[data-date]');if(button)chooseCalendarDay(button.dataset.date);});
document.querySelectorAll('.preset-btn').forEach(button=>button.addEventListener('click',()=>applyPreset(button.dataset.preset)));
$('#rangeCancel').addEventListener('click',()=>$('#rangePopover').classList.add('hidden'));
$('#rangeApply').addEventListener('click',async()=>{const from=$('#rangeFrom').value,to=$('#rangeTo').value;if(!from||!to||from>to){toast('Choose a valid start and end date');return;}if(activePreset==='custom'||from!==dateRange.from||to!==dateRange.to)setRange(fromISO(from),fromISO(to),`${fromISO(from).toLocaleDateString('en-ZA',{day:'numeric',month:'short'})} – ${fromISO(to).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'})}`,'custom');$('#rangePopover').classList.add('hidden');try{await refresh();}catch(error){showError(error);}});
$('#rangeFrom').addEventListener('input',()=>{activePreset='custom';document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('selected'));});
$('#rangeTo').addEventListener('input',()=>{activePreset='custom';document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('selected'));});
$('#memberFilter').addEventListener('change',paintEntriesPage);
$('#exportEntries').addEventListener('click',exportEntries);$('#exportReport').addEventListener('click',exportReports);
$('#memberForm').addEventListener('submit',createMember);
$('#projectForm').addEventListener('submit',event=>{event.preventDefault();saveCatalog('project',event.currentTarget);});
$('#roleForm').addEventListener('submit',event=>{event.preventDefault();saveCatalog('role',event.currentTarget);});
document.addEventListener('click',event=>{const button=event.target.closest('.catalog-toggle');if(button)toggleCatalog(button);});
async function init(){
  try{const status=await api('/api/status');if(status.setup_required){configureSetup(status);return;}if(status.member){await openDashboard(status.member);return;}}
  catch(error){showAuthError(error.message);}
}
init();
setInterval(()=>{if(!me)return;if(data.timer)paintTimer();if(Date.now()-lastRefresh>25000)refresh().catch(showError);},1000);

