'use strict';

let me = null;
let data = { members: [], entries: [], timer: null, active_timers: [], comments: [], audit_log: [] };
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
  $('#googleLogin').classList.add('hidden');
  $('#setupFields').classList.remove('hidden');$('#confirmField').classList.remove('hidden');$('#adminName').required=true;$('#confirmPassword').required=true;$('#password').autocomplete='new-password';
  if(status.setup_requires_key){$('#setupKeyField').classList.remove('hidden');$('#setupKey').required=true;$('#loginFoot').textContent='Use the one-time setup key saved in your hosting dashboard or password manager.';}
  $('#loginSubmit').textContent='Create administrator account';
}
function enterApp(member){
  me=member;$('#login').classList.add('hidden');$('#app').classList.remove('hidden');$('#topName').textContent=me.name;$('#avatar').textContent=initials(me.name);$('#profileName').value=me.name;$('#profileEmail').value=me.email;$('#profileRole').textContent=me.role==='admin'?'Administrator':(me.job_role||'Team member');$('#workspaceCaption').textContent=me.role==='admin'?'Administrator workspace':'Member workspace';$('#greeting').textContent=`${greeting()}, ${me.name.split(' ')[0]}`;
}
function pageConfig(page){
  const admin=me?.role==='admin';
  $('#manageMembersAction')?.classList.toggle('hidden',!admin||page!=='overview');
  const labels=admin?{overview:['Overview','TEAM WORKSPACE','Your team at a glance'],entries:['Time entries','TEAM RECORDS','Review and export all member time entries'],reports:['Reports','TEAM REPORTING','Compare team hours, projects, and work roles'],members:['Team members','ACCOUNT MANAGEMENT','Create accounts and open or update member profiles'],manage:['Project settings','ADMINISTRATION','Manage projects and available work roles']}:{overview:['Overview','MY WORKSPACE','Your timer, hours, and recent activity'],entries:['My time entries','PERSONAL RECORDS','Review and export your time entries'],reports:['My reports','PERSONAL REPORTING','Review your hours by date, project, and role']};
  const [title,eyebrow,sub]=labels[page]||labels.overview;$('#crumbPage').textContent=title;$('#pageTitle').textContent=page==='overview'?`${greeting()}, ${me.name.split(' ')[0]}`:title;$('#pageEyebrow').textContent=eyebrow;$('#pageSub').textContent=sub;
  $('#returnHome').classList.toggle('hidden',page==='overview');
  ['overview','entries','reports','members','manage'].forEach(name=>$('#page-'+name).classList.toggle('hidden',name!==page));
  currentPage=page;
  document.querySelectorAll('.nav-btn').forEach(button=>button.classList.toggle('active',button.dataset.page===page));
  renderCurrentPage();
}
function renderNav(){
  const pages=me.role==='admin'?[['overview','▦','Overview'],['entries','◷','Time entries'],['reports','⌁','Reports'],['members','♙','Team members'],['manage','⚙','Project settings']]:[['overview','▦','Overview'],['entries','◷','My time entries'],['reports','⌁','My reports']];
  $('#nav').innerHTML=pages.map(([page,icon,label])=>`<button class="nav-btn" type="button" data-page="${page}"><span class="nav-icon">${icon}</span>${label}</button>`).join('');
}
function setPage(page){if(['manage','members'].includes(page)&&me.role!=='admin')return;pageConfig(page);}
function paintCatalog(){
  const currentProject=$('#projectName').value;
  $('#projectName').innerHTML='<option value="">Select a project</option>'+catalog.projects.filter(p=>p.active!==false).map(p=>`<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
  const projectTypes=$('#projectTypeOptions');if(projectTypes){const types=[...new Set(['Production',...catalog.projects.map(project=>project.project_type).filter(Boolean)])];projectTypes.innerHTML=types.map(type=>`<option value="${escapeHtml(type)}"></option>`).join('');}
  if(catalog.projects.some(p=>p.name===currentProject))$('#projectName').value=currentProject;
  const selected=catalog.projects.find(p=>p.name===$('#projectName').value);
  $('#projectTypeDisplay').textContent=selected?.project_type||'Choose a project';
  const currentRole=$('#workRole').value||me?.job_role||'';
  $('#workRole').innerHTML='<option value="">Select a role</option>'+catalog.roles.filter(r=>r.active!==false).map(r=>`<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
  if(catalog.roles.some(r=>r.name===currentRole))$('#workRole').value=currentRole;
  $('#timerNote').textContent=catalog.projects.length&&catalog.roles.length?'Enter the project ID, choose a project, and select your work role.':'Ask your administrator to add a project and work role before starting a timer.';
  $('#timerButton').disabled=!data.timer&&(!catalog.projects.length||!catalog.roles.length);
  const memberTypes=[...new Set(['Production',...catalog.projects.filter(project=>project.active!==false).map(project=>project.project_type).filter(Boolean)])];
  ['#memberProjectType','#editMemberProjectType'].forEach(selector=>{const typeSelect=$(selector);if(typeSelect){const value=typeSelect.value;typeSelect.innerHTML=memberTypes.map(type=>`<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('');typeSelect.value=memberTypes.includes(value)?value:'Production';}});
  ['#memberJobRole','#editMemberRole'].forEach(selector=>{const jobRole=$(selector);if(jobRole){const v=jobRole.value;jobRole.innerHTML='<option value="">No default role</option>'+catalog.roles.filter(r=>r.active!==false).map(r=>`<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');if(catalog.roles.some(r=>r.name===v))jobRole.value=v;}});
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
    $('#teamPanelTitle').textContent='Team progress';$('#teamPanelSub').textContent='Hours tracked by member · select a member to review their records';$('#memberCount').textContent=`${data.members.length} members`;$('#teamHeader').innerHTML='<th>Member</th><th>Project type</th><th>Work role</th><th>Hours</th><th></th>';
    const rows=data.members.map((member,index)=>{const seconds=total(data.entries.filter(e=>e.member_id===member.id));const [bg,fg]=colors[index%colors.length];return `<tr><td><strong><span class="avatar" style="display:inline-grid;vertical-align:middle;width:26px;height:26px;margin-right:7px;background:${bg};color:${fg}">${initials(member.name)}</span>${escapeHtml(member.name)}</strong></td><td>${escapeHtml(member.project_type||'Production')}</td><td>${escapeHtml(member.job_role|| (member.role==='admin'?'Administrator':'—'))}</td><td>${hours(seconds)}</td><td><button type="button" class="soft-btn" data-open-member="${escapeHtml(member.id)}">View records</button></td></tr>`;}).join('');
    $('#teamRows').innerHTML=rows||'<tr><td colspan="5" class="empty">No team members yet.</td></tr>';
  }else{
    $('#teamPanelTitle').textContent='My work summary';$('#teamPanelSub').textContent='Your assignments and hours in this period';$('#memberCount').textContent=me.job_role||'Member';$('#teamHeader').innerHTML='<th>Summary</th><th>Value</th>';
    const entries=data.entries.filter(e=>e.member_id===me.id);$('#teamRows').innerHTML=`<tr><td><strong>Project type</strong></td><td>${escapeHtml(me.project_type||'Production')}</td></tr><tr><td><strong>Work role</strong></td><td>${escapeHtml(me.job_role||'Not assigned')}</td></tr><tr><td><strong>Tracked hours</strong></td><td>${hours(total(entries))}</td></tr><tr><td><strong>Logged sessions</strong></td><td>${entries.length}</td></tr><tr><td><strong>Projects used</strong></td><td>${new Set(entries.map(e=>e.project)).size}</td></tr>`;
  }
}
function entryRow(entry,includeDetails=false){
  const day=new Date(`${entry.date}T00:00:00`).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'});
  const row=[day,escapeHtml(memberName(entry.member_id)),escapeHtml(entry.project_id||'—'),escapeHtml(entry.project||'—'),escapeHtml(entry.project_type||'—'),escapeHtml(entry.work_role||'—'),escapeHtml(entry.description||'—'),escapeHtml(entry.start||'—'),hours(elapsed(entry)),durationCell(entry)];
  const comments=data.comments.filter(note=>note.entry_id===entry.id);
  const actions=`<button class="soft-btn note-entry" data-id="${entry.id}" type="button">Updates (${comments.length})</button>${me.role==='admin'&& !entry.running?` <button class="soft-btn edit-entry" data-id="${entry.id}" type="button">Edit</button> <button class="danger-btn delete-entry" data-id="${entry.id}" type="button">Delete</button>`:''}`;
  return `<tr>${(includeDetails?row:row.filter((_,i)=>[0,1,2,3,5,8,9].includes(i))).map(cell=>`<td>${cell}</td>`).join('')}<td>${actions}</td></tr>`;
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
  $('#entriesRows').innerHTML=entries.length?entries.map(e=>entryRow(e,true)).join():'<tr><td colspan="11" class="empty">No time entries in this date range.</td></tr>';
  const entryMap=new Map(entries.map(e=>[e.id,e]));const notes=data.comments.filter(c=>entryMap.has(c.entry_id));
  $('#updatesRows').innerHTML=notes.length?notes.map(c=>`<tr><td>${new Date(c.created_at).toLocaleString('en-ZA')}</td><td>${escapeHtml(c.member_name)}</td><td>${escapeHtml(entryMap.get(c.entry_id)?.project||'—')}</td><td>${escapeHtml(c.comment)}</td></tr>`).join():'<tr><td colspan="4" class="empty">No progress updates in this period. Add one from a session’s Updates button.</td></tr>';
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
  $('#membersRows').innerHTML=data.members.map(m=>`<tr><td><strong>${escapeHtml(m.name)}</strong><div class="small-note">${escapeHtml(m.email)}</div></td><td>${escapeHtml(m.job_role||'—')}</td><td><span class="pill ${m.active===false?'running':''}">${m.active===false?'Deactivated':'Active'}</span></td><td>${m.role==='member'?`<button class="soft-btn member-toggle" data-id="${m.id}" data-active="${m.active===false?'false':'true'}" type="button">${m.active===false?'Reactivate':'Deactivate'}</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No members yet.</td></tr>';
  $('#projectsList').innerHTML=catalog.projects.map(p=>`<div class="catalog-item"><div><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.project_type||'Project')}${p.active===false?' · Archived':''}</span></div><div><button class="soft-btn catalog-edit" data-kind="project" data-id="${p.id}">Edit</button> <button class="soft-btn catalog-toggle" data-kind="project" data-id="${p.id}" data-active="${p.active===false?'false':'true'}">${p.active===false?'Restore':'Archive'}</button></div></div>`).join('')||'<div class="small-note">No projects yet. Add a project above.</div>';
  $('#rolesList').innerHTML=catalog.roles.map(r=>`<div class="catalog-item"><div><strong>${escapeHtml(r.name)}</strong><span>${r.active===false?'Archived':'Available to members'}</span></div><div><button class="soft-btn catalog-edit" data-kind="role" data-id="${r.id}">Edit</button> <button class="soft-btn catalog-toggle" data-kind="role" data-id="${r.id}" data-active="${r.active===false?'false':'true'}">${r.active===false?'Restore':'Archive'}</button></div></div>`).join('')||'<div class="small-note">No work roles yet. Add a role above.</div>';
  $('#adminSummary').innerHTML=[['Members',String(data.members.length)],['Logged entries in selected range',String(data.entries.length)],['Currently running timers',String((data.active_timers||[]).length)],['Audit events in selected range',String((data.audit_log||[]).length)],['Selected period',rangeLabel()]].map(([a,b])=>`<div class="catalog-item"><strong>${escapeHtml(a)}</strong><span>${escapeHtml(b)}</span></div>`).join('');
  const events=data.audit_log||[];const target=$('#auditMemberFilter')?.value||'';const kind=$('#auditActionFilter')?.value||'';const actor=$('#auditActorFilter')?.value||'';
  if($('#auditRows')){
    const actorSelect=$('#auditActorFilter'),memberSelect=$('#auditMemberFilter'),actionSelect=$('#auditActionFilter');
    if(actorSelect){const old=actorSelect.value;const actors=[...new Map(events.map(e=>[e.actor_member_id,e.actor_name])).entries()];actorSelect.innerHTML='<option value="">All administrators</option>'+actors.map(([id,name])=>`<option value="${escapeHtml(id||'system')}">${escapeHtml(name)}</option>`).join('');if(actors.some(([id])=>(id||'system')===old))actorSelect.value=old;}
    if(memberSelect){const old=memberSelect.value;memberSelect.innerHTML='<option value="">All team members</option>'+data.members.filter(m=>m.role!=='admin').map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');if(data.members.some(m=>m.id===old))memberSelect.value=old;}
    if(actionSelect){const old=actionSelect.value;actionSelect.innerHTML='<option value="">All activity</option>'+[...new Set(events.map(e=>e.action))].map(a=>`<option value="${escapeHtml(a)}">${escapeHtml(a.replaceAll('_',' '))}</option>`).join('');if(events.some(e=>e.action===old))actionSelect.value=old;}
    $('#auditRows').innerHTML=events.filter(e=>(!target||e.target_member_id===target)&&(!kind||e.action===kind)&&(!actor||(actor==='system'?!e.actor_member_id:e.actor_member_id===actor))).map(e=>`<tr><td>${new Date(e.created_at).toLocaleString('en-ZA')}</td><td>${escapeHtml(e.actor_name)}</td><td>${escapeHtml(e.target_member_name||'—')}</td><td>${escapeHtml(e.action.replaceAll('_',' '))}</td><td>${escapeHtml(e.entity_type)}</td><td>${escapeHtml(e.entity_id||'—')}</td><td><details><summary>View</summary><pre>${escapeHtml(JSON.stringify({before:e.before_values||null,after:e.after_values||null,details:e.metadata||{}},null,2))}</pre></details></td></tr>`).join('')||'<tr><td colspan="7" class="empty">No audit activity for this period.</td></tr>';
  }
  paintCatalog();
}
function paintMemberDirectory(){
  const members=data.members.filter(m=>m.role==='member');
  $('#membersRows').innerHTML=members.map(m=>`<tr><td><strong>${escapeHtml(m.name)}</strong><div class="small-note">${escapeHtml(m.email)}</div></td><td>${escapeHtml(m.project_type||'Production')}</td><td>${escapeHtml(m.job_role||'—')}</td><td><span class="pill ${m.active===false?'running':''}">${m.active===false?'Deactivated':'Active'}</span></td><td><button class="soft-btn open-member" data-id="${escapeHtml(m.id)}" type="button">Open profile</button></td><td><button class="soft-btn member-toggle" data-id="${escapeHtml(m.id)}" data-active="${m.active===false?'false':'true'}" type="button">${m.active===false?'Reactivate':'Deactivate'}</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">No team member accounts yet. Create the first account using the form.</td></tr>';
}
function openMemberProfile(id){
  const member=data.members.find(m=>m.id===id&&m.role==='member');if(!member)return;
  const form=$('#memberProfileForm');form.reset();form.elements.id.value=member.id;form.elements.name.value=member.name;form.elements.email.value=member.email;form.elements.project_type.value=member.project_type||'Production';form.elements.job_role.value=member.job_role||'';
  const entries=data.entries.filter(e=>e.member_id===member.id);$('#memberDialogTitle').textContent=`${member.name} · profile`;
  $('#memberProfileSummary').textContent=`${member.active===false?'Deactivated':'Active'} account · ${entries.length} visible time ${entries.length===1?'entry':'entries'} · ${hours(total(entries))} tracked in this date range · Google sign-in uses this work email.`;$('#memberProfileError').textContent='';$('#memberDialog').showModal();
}
async function saveMemberProfile(event){
  event.preventDefault();const form=event.currentTarget,button=event.submitter;button.disabled=true;$('#memberProfileError').textContent='';
  try{const body=Object.fromEntries(new FormData(form));const id=body.id;delete body.id;if(!body.password)delete body.password;await api(`/api/admin/members/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});$('#memberDialog').close();await refresh();toast('Team member profile updated');}
  catch(error){$('#memberProfileError').textContent=error.message;}
  finally{button.disabled=false;}
}
function paintTimer(){
  const timer=data.timer;
  if(timer){
    $('#timerUpdate').classList.remove('hidden');
    const seconds=Math.max(0,Math.floor(Date.now()/1000-timer.started_at));
    $('#clock').textContent=`${pad(Math.floor(seconds/3600))}:${pad(Math.floor(seconds%3600/60))}:${pad(seconds%60)}`;
    $('#timerCaption').textContent=`${timer.project_id?timer.project_id+' · ':''}${timer.project||timer.description} · ${timer.work_role||'Work in progress'}`;
    $('#timerButton').classList.add('stop');$('#timerButton').textContent='■ Stop timer';
  }else{
    $('#timerUpdate').classList.add('hidden');
    $('#clock').textContent='00:00:00';$('#timerCaption').textContent='Ready when you are';$('#timerButton').classList.remove('stop');$('#timerButton').textContent='▶ Start timer';
  }
  ['#projectId','#projectName','#workRole'].forEach(selector=>$(selector).disabled=Boolean(timer));
  $('#timerButton').disabled=!timer&&(!catalog.projects.some(p=>p.active!==false)||!catalog.roles.some(r=>r.active!==false));
}
function paint(){
  if(!me)return;
  $('#topName').textContent=me.name;$('#avatar').textContent=initials(me.name);$('#profileRole').textContent=me.role==='admin'?'Administrator':(me.job_role||'Member');
  paintCatalog();paintMetrics();paintChart();renderTeam();paintRecent();paintEntriesPage();paintReports();if(me.role==='admin'){paintManage();paintMemberDirectory();}paintTimer();pageConfig(currentPage);
}
function renderCurrentPage(){
  $('#pageTitle').textContent=currentPage==='overview'?`${greeting()}, ${me.name.split(' ')[0]}`:$('#pageTitle').textContent;
  paintMetrics();paintChart();renderTeam();paintRecent();paintEntriesPage();paintReports();if(me.role==='admin'){paintManage();paintMemberDirectory();}paintTimer();
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
function exportAudit(){downloadCsv('tepu-audit-trail.csv',[['When','Actor','Team member','Action','Entity','Record ID','Before','After','Details'],...(data.audit_log||[]).map(e=>[e.created_at,e.actor_name,e.target_member_name,e.action,e.entity_type,e.entity_id,JSON.stringify(e.before_values||{}),JSON.stringify(e.after_values||{}),JSON.stringify(e.metadata||{})])]);}
async function showEntryUpdates(id){
  const notes=data.comments.filter(c=>c.entry_id===id);const history=notes.map(n=>`${new Date(n.created_at).toLocaleString('en-ZA')} · ${n.member_name}: ${n.comment}`).join('\n\n')||'No updates have been added to this session.';
  window.alert(history);const comment=window.prompt('Add a progress update (up to 2,000 characters):');if(comment===null||!comment.trim())return;
  try{await api(`/api/entries/${encodeURIComponent(id)}/comments`,{method:'POST',body:JSON.stringify({comment})});await refresh();toast('Update saved');}catch(error){showError(error);}
}
function openEntryEditor(id){
  const entry=data.entries.find(e=>e.id===id);if(!entry)return;const form=$('#entryEditForm');
  for(const [key,value] of Object.entries({id:entry.id,project_id:entry.project_id,project:entry.project,project_type:entry.project_type,description:entry.description,date:entry.date,start:entry.start,duration_minutes:Math.max(1,Math.round(elapsed(entry)/60))}))form.elements[key].value=value;
  $('#editWorkRole').innerHTML=catalog.roles.map(r=>`<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');$('#editWorkRole').value=entry.work_role;$('#entryDialog').showModal();
}
async function saveEditedEntry(event){event.preventDefault();const form=event.currentTarget,id=form.elements.id.value;const body=Object.fromEntries(new FormData(form));delete body.id;body.duration_minutes=Number(body.duration_minutes);
  try{await api(`/api/admin/entries/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});$('#entryDialog').close();await refresh();toast('Timesheet updated and audited');}catch(error){showError(error);}
}
async function deleteEntry(id){if(!window.confirm('Delete this recorded work session? The action will be preserved in the audit trail.'))return;
  try{await api(`/api/admin/entries/${encodeURIComponent(id)}`,{method:'DELETE',body:'{}'});await refresh();toast('Timesheet deleted and audited');}catch(error){showError(error);}
}
async function toggleMember(button){const active=button.dataset.active==='false';if(!active&&!window.confirm('Deactivate this member account? This stops future sign-ins and keeps their history.'))return;
  try{await api(`/api/admin/members/${encodeURIComponent(button.dataset.id)}`,{method:'PATCH',body:JSON.stringify({active})});await refresh();toast(active?'Member account reactivated':'Member account deactivated');}catch(error){showError(error);}
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
async function editCatalog(button){const kind=button.dataset.kind,id=button.dataset.id;const item=(kind==='project'?catalog.projects:catalog.roles).find(option=>option.id===id);if(!item)return;
  const name=window.prompt(`${kind==='project'?'Project':'Role'} name:`,item.name);if(name===null)return;const body={name:name.trim()};
  if(kind==='project'){const project_type=window.prompt('Project type (Production is available):',item.project_type||'Production');if(project_type===null)return;body.project_type=project_type.trim();}
  try{await api(`/api/admin/${kind}s/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});await refresh();toast(`${kind==='project'?'Project':'Role'} updated`);}catch(error){showError(error);}
}
async function saveProfile(event){
  event.preventDefault();const button=event.submitter;button.disabled=true;
  try{const result=await api('/api/profile',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});me=result.member;$('#profileName').value=me.name;$('#profileEmail').value=me.email;$('#currentPassword').value='';$('#newPassword').value='';$('#profileMenu').classList.add('hidden');await refresh();toast('Profile updated');}
  catch(error){showError(error);}
  finally{button.disabled=false;}
}
async function createMember(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');$('#memberError').textContent='';button.disabled=true;
  try{await api('/api/members',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();$('#memberProjectType').value='Production';await refresh();toast('Member account created');}
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
$('#googleLogin').addEventListener('click',()=>{window.location.assign('/api/auth/google');});
$('#timerButton').addEventListener('click',submitTimer);
$('#timerUpdate').addEventListener('click',()=>data.timer&&showEntryUpdates(data.timer.id));
$('#projectName').addEventListener('change',()=>{const p=catalog.projects.find(x=>x.name===$('#projectName').value);$('#projectTypeDisplay').textContent=p?.project_type||'Choose a project';});
$('#profileButton').addEventListener('click',()=>{const menu=$('#profileMenu');menu.classList.toggle('hidden');$('#profileButton').setAttribute('aria-expanded',String(!menu.classList.contains('hidden')));});
function closeProfileMenu(){ $('#profileMenu')?.classList.add('hidden');$('#profileButton')?.setAttribute('aria-expanded','false'); }
function closeRangePopover(){ $('#rangePopover')?.classList.add('hidden');$('#dateFilterBtn')?.setAttribute('aria-expanded','false'); }
document.addEventListener('click',event=>{
  if(!event.target.closest('.profile-wrap'))closeProfileMenu();
  if(!event.target.closest('.filter-wrap'))closeRangePopover();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeProfileMenu();closeRangePopover();}
});
$('#profileForm').addEventListener('submit',saveProfile);
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});}catch(error){showError(error);}me=null;data={members:[],entries:[],timer:null,active_timers:[]};$('#app').classList.add('hidden');$('#login').classList.remove('hidden');$('#profileMenu').classList.add('hidden');showAuthError('');});
$('#nav').addEventListener('click',event=>{const button=event.target.closest('[data-page]');if(button)setPage(button.dataset.page);});
$('#teamRows').addEventListener('click',event=>{const button=event.target.closest('[data-open-member]');if(!button)return;$('#memberFilter').value=button.dataset.openMember;setPage('entries');paintEntriesPage();});
document.addEventListener('click',event=>{const button=event.target.closest('[data-open-page]');if(button)setPage(button.dataset.openPage);});
$('#dateFilterBtn').addEventListener('click',()=>{const open=$('#rangePopover').classList.contains('hidden');$('#rangePopover').classList.toggle('hidden');$('#dateFilterBtn').setAttribute('aria-expanded',String(open));if(open){$('#rangeFrom').value=dateRange.from;$('#rangeTo').value=dateRange.to;}});
$('#calendarPrev').addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);paintCalendar();});
$('#calendarNext').addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);paintCalendar();});
$('#calendarDays').addEventListener('click',event=>{const button=event.target.closest('[data-date]');if(button)chooseCalendarDay(button.dataset.date);});
document.querySelectorAll('.preset-btn').forEach(button=>button.addEventListener('click',()=>applyPreset(button.dataset.preset)));
$('#rangeCancel').addEventListener('click',closeRangePopover);
$('#rangeApply').addEventListener('click',async()=>{const from=$('#rangeFrom').value,to=$('#rangeTo').value;if(!from||!to||from>to){toast('Choose a valid start and end date');return;}if(activePreset==='custom'||from!==dateRange.from||to!==dateRange.to)setRange(fromISO(from),fromISO(to),`${fromISO(from).toLocaleDateString('en-ZA',{day:'numeric',month:'short'})} – ${fromISO(to).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'})}`,'custom');closeRangePopover();try{await refresh();}catch(error){showError(error);}});
$('#rangeFrom').addEventListener('input',()=>{activePreset='custom';document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('selected'));});
$('#rangeTo').addEventListener('input',()=>{activePreset='custom';document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('selected'));});
$('#memberFilter').addEventListener('change',paintEntriesPage);
$('#exportEntries').addEventListener('click',exportEntries);$('#exportReport').addEventListener('click',exportReports);$('#exportAudit')?.addEventListener('click',exportAudit);
$('#auditActorFilter')?.addEventListener('change',paintManage);$('#auditMemberFilter')?.addEventListener('change',paintManage);$('#auditActionFilter')?.addEventListener('change',paintManage);
$('#entryEditForm').addEventListener('submit',saveEditedEntry);$('#cancelEntryEdit').addEventListener('click',()=>$('#entryDialog').close());
$('#memberForm').addEventListener('submit',createMember);
 $('#memberProfileForm').addEventListener('submit',saveMemberProfile);$('#closeMemberProfile').addEventListener('click',()=>$('#memberDialog').close());
 $('#memberRecords').addEventListener('click',()=>{const id=$('#memberProfileForm').elements.id.value;$('#memberDialog').close();$('#memberFilter').value=id;setPage('entries');paintEntriesPage();});
$('#projectForm').addEventListener('submit',event=>{event.preventDefault();saveCatalog('project',event.currentTarget);});
$('#roleForm').addEventListener('submit',event=>{event.preventDefault();saveCatalog('role',event.currentTarget);});
 document.addEventListener('click',event=>{const button=event.target.closest('.catalog-toggle');if(button)toggleCatalog(button);const catalogEdit=event.target.closest('.catalog-edit');if(catalogEdit)editCatalog(catalogEdit);const note=event.target.closest('.note-entry');if(note)showEntryUpdates(note.dataset.id);const edit=event.target.closest('.edit-entry');if(edit)openEntryEditor(edit.dataset.id);const del=event.target.closest('.delete-entry');if(del)deleteEntry(del.dataset.id);const member=event.target.closest('.member-toggle');if(member)toggleMember(member);const openMember=event.target.closest('.open-member');if(openMember)openMemberProfile(openMember.dataset.id);});
async function init(){
  const callbackParams=new URLSearchParams(window.location.hash.slice(1));
  const callbackToken=callbackParams.get('access_token');
  const callbackError=callbackParams.get('error_description')||callbackParams.get('error');
  if(callbackToken||callbackError){
    history.replaceState(null,'',window.location.pathname+window.location.search);
    if(callbackError){showAuthError(callbackError);return;}
    try{const result=await api('/api/auth/google',{method:'POST',body:JSON.stringify({access_token:callbackToken})});await openDashboard(result.member);return;}
    catch(error){showAuthError(error.message);}
  }
  try{const status=await api('/api/status');if(status.setup_required){configureSetup(status);return;}if(status.member){await openDashboard(status.member);return;}if(status.google_sign_in_available)$('#googleLogin').classList.remove('hidden');}
  catch(error){showAuthError(error.message);}
}
init();
setInterval(()=>{if(!me)return;if(data.timer)paintTimer();if(Date.now()-lastRefresh>25000)refresh().catch(showError);},1000);

