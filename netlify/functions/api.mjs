import { createClient } from '@supabase/supabase-js';
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';

const PASSWORD_ROUNDS = 310_000;
const SESSION_DAYS = 14;
const SESSION_COOKIE = 'tepu_session';
const TABLES = { members: 'tracker_members', sessions: 'tracker_sessions', entries: 'tracker_entries', projects: 'tracker_projects', roles: 'tracker_work_roles', comments: 'tracker_entry_comments', audit: 'tracker_audit_log' };

function publicSupabaseKey() {
  return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
}

function reply(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      ...extraHeaders,
    },
  });
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function cookieHeader(token, maxAge = SESSION_DAYS * 86400) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
function passwordHash(password, salt) { return pbkdf2Sync(password, salt, PASSWORD_ROUNDS, 32, 'sha256').toString('hex'); }
function sameSecret(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}
function publicMember(member) {
  return { id: member.id, name: member.name, email: member.email, role: member.role, job_role: member.job_role || '', active: member.active !== false };
}
async function audit(db, { actorId = null, targetMemberId = null, action, entityType = 'system', entityId = null, before = null, after = null, metadata = {} }) {
  const { error } = await db.from(TABLES.audit).insert({ actor_member_id: actorId, target_member_id: targetMemberId, action, entity_type: entityType, entity_id: entityId, before_values: before, after_values: after, metadata });
  if (error) throw new Error('The change could not be recorded in the audit trail.');
}
function validateMember(name, email, password) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) return 'Enter a name up to 100 characters.';
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) return 'Password must be at least 10 characters.';
  return null;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function monthRange(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return null;
  const first = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(first.valueOf()) || first.toISOString().slice(0, 7) !== month) return null;
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  return { start: `${month}-01`, end: next.toISOString().slice(0, 10) };
}
function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in Netlify environment variables.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}
async function readBody(request) {
  const raw = await request.text();
  if (raw.length > 64_000) throw new Error('Request body is too large.');
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON request.'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('Request body must be a JSON object.');
  return body;
}
function verifyOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host.toLowerCase() === new URL(request.url).host.toLowerCase(); }
  catch { return false; }
}

async function currentMember(db, request) {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return null;
  const { data: session, error: sessionError } = await db.from(TABLES.sessions)
    .select('member_id,expires_at').eq('token_hash', hashToken(token)).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (sessionError || !session) return null;
  const { data: member, error } = await db.from(TABLES.members)
    .select('id,name,email,role,job_role,active').eq('id', session.member_id).maybeSingle();
  return error || !member || member.active === false ? null : member;
}

function isAdmin(member) { return member?.role === 'admin'; }
async function activeCatalogItem(db, table, name) {
  const { data, error } = await db.from(table).select('*').eq('name', name).eq('active', true).maybeSingle();
  return error ? null : data;
}

async function createSession(db, memberId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  const { error } = await db.from(TABLES.sessions).insert({ token_hash: hashToken(token), member_id: memberId, expires_at: expiresAt });
  if (error) throw new Error('Could not start a session. Please try again.');
  return token;
}

async function getSetupStatus(db) {
  const { data, error } = await db.from(TABLES.members).select('id').eq('role', 'admin').limit(1);
  if (error) throw new Error('Apply the Supabase tracker migration before connecting the site.');
  return data.length === 0;
}

async function handle(request, db, setupKey) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/status') {
    const setupRequired = await getSetupStatus(db);
    const member = await currentMember(db, request);
    return reply({ setup_required: setupRequired, setup_requires_key: true, google_sign_in_available: Boolean(process.env.SUPABASE_URL && publicSupabaseKey()), member: member ? publicMember(member) : null });
  }
  if (request.method === 'GET' && path === '/api/auth/google') {
    const apiKey = publicSupabaseKey();
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!apiKey || !supabaseUrl) return reply({ error: 'Google sign-in is not configured. Ask your administrator to finish the Supabase setup.' }, 503);
    const redirectTo = new URL('/', request.url).toString();
    const authorize = new URL('/auth/v1/authorize', supabaseUrl);
    authorize.searchParams.set('provider', 'google');
    authorize.searchParams.set('redirect_to', redirectTo);
    authorize.searchParams.set('apikey', apiKey);
    return new Response(null, { status: 302, headers: { Location: authorize.toString(), 'Cache-Control': 'no-store' } });
  }
  if (request.method === 'GET' && path === '/api/me') {
    const member = await currentMember(db, request);
    return reply({ member: member ? publicMember(member) : null });
  }
  if (request.method === 'GET' && path === '/api/catalog') {
    const member = await currentMember(db, request);
    if (!member) return reply({ error: 'Please sign in to continue.' }, 401);
    const includeArchived = isAdmin(member);
    const projectQuery = db.from(TABLES.projects).select('id,name,project_type,active').order('name');
    const roleQuery = db.from(TABLES.roles).select('id,name,active').order('name');
    if (!includeArchived) { projectQuery.eq('active', true); roleQuery.eq('active', true); }
    const [{ data: projects, error: projectError }, { data: roles, error: roleError }] = await Promise.all([projectQuery, roleQuery]);
    if (projectError || roleError) return reply({ error: 'Could not load project and role options.' }, 500);
    return reply({ projects: projects || [], roles: roles || [] });
  }
  if (request.method === 'GET' && path === '/api/data') {
    const member = await currentMember(db, request);
    if (!member) return reply({ error: 'Please sign in to continue.' }, 401);
    let start = url.searchParams.get('start'), end = url.searchParams.get('end');
    if (!start && !end) {
      const legacyRange = monthRange(url.searchParams.get('month'));
      if (!legacyRange) return reply({ error: 'Choose a valid reporting date range.' }, 400);
      start = legacyRange.start;
      end = new Date(`${legacyRange.end}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() - 1);
      end = end.toISOString().slice(0, 10);
    }
    if (!validDate(start) || !validDate(end) || start > end) return reply({ error: 'Choose a valid reporting date range.' }, 400);
    let entriesQuery = db.from(TABLES.entries).select('*').gte('work_date', start).lte('work_date', end).order('started_at', { ascending: false }).limit(5000);
    if (!isAdmin(member)) entriesQuery = entriesQuery.eq('member_id', member.id);
    const membersQuery = db.from(TABLES.members).select('id,name,email,role,job_role,active').order('name', { ascending: true });
    if (!isAdmin(member)) membersQuery.eq('id', member.id);
    let activeQuery = db.from(TABLES.entries).select('id,member_id,description,project,project_id,project_type,work_role,work_date,start_clock,started_at').is('ended_at', null);
    if (!isAdmin(member)) activeQuery = activeQuery.eq('member_id', member.id);
    const [{ data: rows, error: entriesError }, { data: users, error: membersError }, { data: active, error: activeError }] = await Promise.all([
      entriesQuery, membersQuery, activeQuery.order('started_at', { ascending: true }).limit(500),
    ]);
    if (entriesError || membersError || activeError) return reply({ error: 'Could not load tracker data.' }, 500);
    const memberNames = new Map(users.map((user) => [user.id, user.name]));
    const now = Date.now();
    const entries = rows.map((row) => ({
      id: row.id, member_id: row.member_id, member_name: memberNames.get(row.member_id) || 'Team member',
      description: row.description, project: row.project, project_id: row.project_id || '', project_type: row.project_type || '', work_role: row.work_role || '', date: row.work_date, start: String(row.start_clock).slice(0, 5),
      started_at: Math.floor(new Date(row.started_at).getTime() / 1000),
      ended_at: row.ended_at, seconds: row.seconds ?? Math.max(0, Math.floor((now - new Date(row.started_at).getTime()) / 1000)),
      running: row.ended_at === null,
    }));
    const activeTimers = active.map((row) => ({ id: row.id, member_id: row.member_id, member_name: memberNames.get(row.member_id) || 'Team member', description: row.description, project: row.project, project_id: row.project_id || '', project_type: row.project_type || '', work_role: row.work_role || '', date: row.work_date, start: String(row.start_clock).slice(0, 5), started_at: Math.floor(new Date(row.started_at).getTime() / 1000) }));
    const timer = activeTimers.find((row) => row.member_id === member.id) || null;
    const entryIds = rows.map((row) => row.id);
    let comments = [];
    if (entryIds.length) {
      const { data: notes, error: commentsError } = await db.from(TABLES.comments).select('id,entry_id,member_id,comment,created_at').in('entry_id', entryIds).order('created_at');
      if (commentsError) return reply({ error: 'Could not load work updates.' }, 500);
      comments = notes.map((note) => ({ ...note, member_name: memberNames.get(note.member_id) || 'Team member' }));
    }
    let auditLog = [];
    if (isAdmin(member)) {
      const endExclusive = new Date(`${end}T00:00:00.000Z`); endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      const { data: events, error: auditError } = await db.from(TABLES.audit).select('*').gte('created_at', `${start}T00:00:00.000Z`).lt('created_at', endExclusive.toISOString()).order('created_at', { ascending: false }).limit(5000);
      if (auditError) return reply({ error: 'Could not load audit activity.' }, 500);
      auditLog = events.map((event) => ({ ...event, actor_name: memberNames.get(event.actor_member_id) || 'System', target_member_name: memberNames.get(event.target_member_id) || '' }));
    }
    return reply({ member: publicMember(member), members: users.map(publicMember), entries, timer, active_timers: activeTimers, comments, audit_log: auditLog });
  }
  if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return reply({ error: 'Not found.' }, 404);
  if (!verifyOrigin(request)) return reply({ error: 'Request origin is not allowed.' }, 403);

  let body;
  try { body = await readBody(request); }
  catch (error) { return reply({ error: error.message }, 400); }

  if (path === '/api/setup') {
    if (!setupKey) return reply({ error: 'Set TEPU_SETUP_KEY in Netlify before creating the first administrator.' }, 503);
    if (!sameSecret(body.setup_key, setupKey)) return reply({ error: 'Enter the one-time setup key from Netlify site settings.' }, 403);
    const validation = validateMember(body.name, body.email, body.password);
    if (validation) return reply({ error: validation }, 400);
    if (!(await getSetupStatus(db))) return reply({ error: 'Workspace setup is already complete.' }, 409);
    const salt = randomBytes(16).toString('hex');
    const { data: admin, error } = await db.from(TABLES.members).insert({
      name: body.name.trim(), email: body.email.trim().toLowerCase(), role: 'admin',
      password_salt: salt, password_hash: passwordHash(body.password, salt),
    }).select('id,name,email,role').single();
    if (error) return reply({ error: error.code === '23505' ? 'Workspace setup is already complete.' : 'Could not create the administrator account.' }, error.code === '23505' ? 409 : 500);
    const token = await createSession(db, admin.id);
    await audit(db, { actorId: admin.id, targetMemberId: admin.id, action: 'workspace_admin_created', entityType: 'member', entityId: admin.id, after: { name: admin.name, email: admin.email, role: admin.role } });
    return reply({ member: publicMember(admin) }, 201, { 'Set-Cookie': cookieHeader(token) });
  }

  if (path === '/api/login') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const { data: member, error } = await db.from(TABLES.members).select('*').eq('email', email).maybeSingle();
    const expected = member ? Buffer.from(member.password_hash, 'hex') : Buffer.alloc(32);
    const actual = pbkdf2Sync(password, member?.password_salt || '00000000000000000000000000000000', PASSWORD_ROUNDS, 32, 'sha256');
    if (error || !member || member.active === false || expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
      await audit(db, { action: 'login_failed', entityType: 'authentication', metadata: { email, reason: 'invalid_credentials_or_inactive_account' } });
      return reply({ error: 'Email or password is incorrect.' }, 401);
    }
    const token = await createSession(db, member.id);
    await audit(db, { actorId: member.id, targetMemberId: member.id, action: 'login_succeeded', entityType: 'authentication' });
    return reply({ member: publicMember(member) }, 200, { 'Set-Cookie': cookieHeader(token) });
  }

  if (path === '/api/logout') {
    const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
    const signedIn = await currentMember(db, request);
    if (token) await db.from(TABLES.sessions).delete().eq('token_hash', hashToken(token));
    if (signedIn) await audit(db, { actorId: signedIn.id, targetMemberId: signedIn.id, action: 'logout', entityType: 'authentication' });
    return reply({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', 0) });
  }

  if (path === '/api/auth/google' && request.method === 'POST') {
    const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
    if (!accessToken || accessToken.length > 16_384) return reply({ error: 'Google sign-in could not be completed. Try again.' }, 400);
    const { data: authData, error: authError } = await db.auth.getUser(accessToken);
    const googleUser = authData?.user;
    if (authError || !googleUser?.email || !googleUser.email_confirmed_at || !(googleUser.app_metadata?.providers || []).includes('google')) {
      await audit(db, { action: 'google_login_failed', entityType: 'authentication', metadata: { reason: 'provider_identity_not_verified' } });
      return reply({ error: 'Google could not verify this account. Try again or use your work email and password.' }, 401);
    }
    const { data: member, error } = await db.from(TABLES.members).select('id,name,email,role,job_role,active')
      .eq('email', googleUser.email.trim().toLowerCase()).eq('active', true).maybeSingle();
    if (error || !member) {
      await audit(db, { action: 'google_login_denied', entityType: 'authentication', metadata: { email: googleUser.email.trim().toLowerCase(), reason: 'no_active_member_profile' } });
      return reply({ error: 'This Google email is not on your team account yet. Ask your administrator to create your profile first.' }, 403);
    }
    const token = await createSession(db, member.id);
    await audit(db, { actorId: member.id, targetMemberId: member.id, action: 'google_login_succeeded', entityType: 'authentication' });
    return reply({ member: publicMember(member) }, 200, { 'Set-Cookie': cookieHeader(token) });
  }

  const member = await currentMember(db, request);
  if (!member) return reply({ error: 'Please sign in to continue.' }, 401);

  if (request.method === 'PATCH' && path === '/api/profile') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return reply({ error: 'Enter a valid name and email address.' }, 400);
    const update = { name, email };
    if (body.new_password) {
      if (typeof body.current_password !== 'string' || typeof body.new_password !== 'string' || body.new_password.length < 10 || body.new_password.length > 200) return reply({ error: 'Enter your current password and choose a new password of at least 10 characters.' }, 400);
      const { data: credentials, error: credentialError } = await db.from(TABLES.members).select('password_salt,password_hash').eq('id', member.id).single();
      if (credentialError || !sameSecret(passwordHash(body.current_password, credentials.password_salt), credentials.password_hash)) return reply({ error: 'Current password is incorrect.' }, 403);
      const salt = randomBytes(16).toString('hex');
      update.password_salt = salt;
      update.password_hash = passwordHash(body.new_password, salt);
    }
    const { data: updated, error } = await db.from(TABLES.members).update(update).eq('id', member.id).select('id,name,email,role,job_role').single();
    if (error) return reply({ error: error.code === '23505' ? 'That email address is already in use.' : 'Could not update your profile.' }, error.code === '23505' ? 409 : 500);
    await audit(db, { actorId: member.id, targetMemberId: member.id, action: 'profile_updated', entityType: 'member', entityId: member.id, before: { name: member.name, email: member.email }, after: { name: updated.name, email: updated.email } });
    return reply({ member: publicMember(updated) });
  }

  const commentMatch = path.match(/^\/api\/entries\/([0-9a-f-]{36})\/comments$/i);
  if (commentMatch && request.method === 'POST') {
    const { data: entry, error: entryError } = await db.from(TABLES.entries).select('id,member_id').eq('id', commentMatch[1]).maybeSingle();
    if (entryError || !entry || (!isAdmin(member) && entry.member_id !== member.id)) return reply({ error: 'You can only add updates to your own work sessions.' }, 403);
    const comment = String(body.comment || '').trim();
    if (!comment || comment.length > 2000) return reply({ error: 'Enter an update of up to 2,000 characters.' }, 400);
    const { data: note, error } = await db.from(TABLES.comments).insert({ entry_id: entry.id, member_id: member.id, comment }).select('id,entry_id,member_id,comment,created_at').single();
    if (error) return reply({ error: 'Could not save your update.' }, 500);
    await audit(db, { actorId: member.id, targetMemberId: entry.member_id, action: 'comment_added', entityType: 'entry_comment', entityId: note.id, after: { comment }, metadata: { entry_id: entry.id } });
    return reply({ comment: { ...note, member_name: member.name } }, 201);
  }

  const adminEntryMatch = path.match(/^\/api\/admin\/entries\/([0-9a-f-]{36})$/i);
  if (adminEntryMatch && (request.method === 'PATCH' || request.method === 'DELETE')) {
    if (!isAdmin(member)) return reply({ error: 'Only an administrator can edit or delete timesheet records.' }, 403);
    const { data: prior, error: readError } = await db.from(TABLES.entries).select('*').eq('id', adminEntryMatch[1]).maybeSingle();
    if (readError || !prior) return reply({ error: 'Timesheet record not found.' }, 404);
    if (request.method === 'DELETE') {
      if (prior.ended_at === null) return reply({ error: 'Stop the active timer before deleting its record.' }, 409);
      const { error } = await db.from(TABLES.entries).delete().eq('id', prior.id);
      if (error) return reply({ error: 'Could not delete the timesheet record.' }, 500);
      await audit(db, { actorId: member.id, targetMemberId: prior.member_id, action: 'timesheet_deleted', entityType: 'timesheet', entityId: prior.id, before: prior });
      return reply({ ok: true });
    }
    const description = String(body.description ?? prior.description).trim().slice(0, 160);
    const project = String(body.project ?? prior.project).trim();
    const projectId = String(body.project_id ?? prior.project_id).trim();
    const projectType = String(body.project_type ?? prior.project_type).trim();
    const workRole = String(body.work_role ?? prior.work_role).trim();
    const workDate = body.date ?? prior.work_date;
    const start = body.start ?? String(prior.start_clock).slice(0, 5);
    const minutes = Number(body.duration_minutes ?? Math.round((prior.seconds || 0) / 60));
    if (!description || !project || !projectId || !projectType || !workRole || !validDate(workDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return reply({ error: 'Enter a valid date, start time, duration, project, and work role.' }, 400);
    if (prior.ended_at === null) return reply({ error: 'Stop the active timer before editing its timesheet record.' }, 409);
    const startedAt = new Date(`${workDate}T${start}:00+02:00`);
    const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
    const update = { description, project, project_id: projectId, project_type: projectType, work_role: workRole, work_date: workDate, start_clock: `${start}:00`, started_at: startedAt.toISOString(), ended_at: endedAt.toISOString(), seconds: minutes * 60 };
    const { data: updated, error } = await db.from(TABLES.entries).update(update).eq('id', prior.id).select('*').single();
    if (error) return reply({ error: 'Could not update the timesheet record.' }, 500);
    await audit(db, { actorId: member.id, targetMemberId: prior.member_id, action: 'timesheet_updated', entityType: 'timesheet', entityId: prior.id, before: prior, after: updated });
    return reply({ ok: true });
  }

  if (path === '/api/timer/start') {
    const description = String(body.description || '').trim().slice(0, 160);
    const project = String(body.project || '').trim().slice(0, 100);
    const projectId = String(body.project_id || '').trim().slice(0, 100);
    const projectType = String(body.project_type || '').trim().slice(0, 80);
    const workRole = String(body.work_role || '').trim().slice(0, 80);
    const workDate = body.date;
    const start = body.start;
    if (!projectId || !project || !projectType || !workRole || !validDate(workDate) || typeof start !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) {
      return reply({ error: 'Add a project ID, choose a project and role, and use a valid date and start time.' }, 400);
    }
    const [projectOption, roleOption] = await Promise.all([activeCatalogItem(db, TABLES.projects, project), activeCatalogItem(db, TABLES.roles, workRole)]);
    if (!projectOption || projectOption.project_type !== projectType) return reply({ error: 'That project is not available. Refresh the project list and try again.' }, 400);
    if (!roleOption) return reply({ error: 'That work role is not available. Refresh the role list and try again.' }, 400);
    const { data: entry, error } = await db.from(TABLES.entries).insert({
      member_id: member.id, description: description || project, project, project_id: projectId, project_type: projectType, work_role: workRole, work_date: workDate,
      start_clock: `${start}:00`, started_at: new Date().toISOString(),
    }).select('id').single();
    if (error) return reply({ error: error.code === '23505' ? 'You already have a timer running. Stop it before starting another.' : 'Could not start the timer.' }, error.code === '23505' ? 409 : 500);
    await audit(db, { actorId: member.id, targetMemberId: member.id, action: 'clock_in', entityType: 'timesheet', entityId: entry.id, after: { project, project_id: projectId, project_type: projectType, work_role: workRole, work_date: workDate, start } });
    return reply({ ok: true, id: entry.id }, 201);
  }

  if (path === '/api/timer/stop') {
    const { data: entry, error: findError } = await db.from(TABLES.entries).select('id,started_at')
      .eq('member_id', member.id).is('ended_at', null).limit(1).maybeSingle();
    if (findError || !entry) return reply({ error: 'You do not have a running timer.' }, 409);
    const endedAt = new Date();
    const seconds = Math.max(1, Math.floor((endedAt.getTime() - new Date(entry.started_at).getTime()) / 1000));
    const { data: stopped, error } = await db.from(TABLES.entries).update({ ended_at: endedAt.toISOString(), seconds })
      .eq('id', entry.id).is('ended_at', null).select('id').maybeSingle();
    if (error || !stopped) return reply({ error: 'The timer was already stopped.' }, 409);
    await audit(db, { actorId: member.id, targetMemberId: member.id, action: 'clock_out', entityType: 'timesheet', entityId: entry.id, after: { ended_at: endedAt.toISOString(), seconds } });
    return reply({ ok: true, seconds });
  }

  if (path === '/api/members') {
    if (member.role !== 'admin') return reply({ error: 'Only an administrator can add team members.' }, 403);
    const validation = validateMember(body.name, body.email, body.password);
    if (validation) return reply({ error: validation }, 400);
    const jobRole = String(body.job_role || '').trim().slice(0, 80);
    if (jobRole && !await activeCatalogItem(db, TABLES.roles, jobRole)) return reply({ error: 'Choose an active work role from the list.' }, 400);
    const salt = randomBytes(16).toString('hex');
    const { data: created, error } = await db.from(TABLES.members).insert({
      name: body.name.trim(), email: body.email.trim().toLowerCase(), role: 'member',
      job_role: jobRole, password_salt: salt, password_hash: passwordHash(body.password, salt),
    }).select('id').single();
    if (error) return reply({ error: error.code === '23505' ? 'That email already has an account.' : 'Could not create the team member account.' }, error.code === '23505' ? 409 : 500);
    await audit(db, { actorId: member.id, targetMemberId: created.id, action: 'member_created', entityType: 'member', entityId: created.id, after: { name: body.name.trim(), email: body.email.trim().toLowerCase(), role: 'member', job_role: jobRole, active: true } });
    return reply({ ok: true, id: created.id }, 201);
  }
  const adminMemberMatch = path.match(/^\/api\/admin\/members\/([0-9a-f-]{36})$/i);
  if (adminMemberMatch && request.method === 'PATCH') {
    if (!isAdmin(member)) return reply({ error: 'Only an administrator can manage team accounts.' }, 403);
    const { data: prior, error: readError } = await db.from(TABLES.members).select('id,name,email,role,job_role,active').eq('id', adminMemberMatch[1]).maybeSingle();
    if (readError || !prior || prior.role === 'admin') return reply({ error: 'Team member account not found.' }, 404);
    const update = {};
    if (typeof body.name === 'string') update.name = body.name.trim();
    if (typeof body.email === 'string') update.email = body.email.trim().toLowerCase();
    if (typeof body.job_role === 'string') update.job_role = body.job_role.trim();
    if (typeof body.active === 'boolean') update.active = body.active;
    if ((update.name !== undefined && (!update.name || update.name.length > 100)) || (update.email !== undefined && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.email) || update.email.length > 254))) return reply({ error: 'Enter a valid name and work email.' }, 400);
    if (update.job_role && !await activeCatalogItem(db, TABLES.roles, update.job_role)) return reply({ error: 'Choose an active work role from the list.' }, 400);
    if (!Object.keys(update).length) return reply({ error: 'Choose a profile field to update.' }, 400);
    const { data: updated, error } = await db.from(TABLES.members).update(update).eq('id', prior.id).select('id,name,email,role,job_role,active').single();
    if (error) return reply({ error: error.code === '23505' ? 'That email is already in use.' : 'Could not update this account.' }, error.code === '23505' ? 409 : 500);
    await audit(db, { actorId: member.id, targetMemberId: prior.id, action: update.active === false ? 'member_deactivated' : update.active === true ? 'member_reactivated' : 'member_profile_updated', entityType: 'member', entityId: prior.id, before: prior, after: updated });
    return reply({ member: publicMember(updated) });
  }
  if (path === '/api/admin/projects' && request.method === 'POST') {
    if (!isAdmin(member)) return reply({ error: 'Only an administrator can manage projects.' }, 403);
    const name = String(body.name || '').trim();
    const projectType = String(body.project_type || '').trim();
    if (!name || name.length > 100 || !projectType || projectType.length > 80) return reply({ error: 'Enter a project name and project type.' }, 400);
    const { data: project, error } = await db.from(TABLES.projects).insert({ name, project_type: projectType, active: true }).select('id,name,project_type,active').single();
    if (error) return reply({ error: error.code === '23505' ? 'A project with that name already exists.' : 'Could not add the project.' }, error.code === '23505' ? 409 : 500);
    await audit(db, { actorId: member.id, action: 'project_created', entityType: 'project', entityId: project.id, after: project });
    return reply({ project }, 201);
  }
  if (path === '/api/admin/roles' && request.method === 'POST') {
    if (!isAdmin(member)) return reply({ error: 'Only an administrator can manage work roles.' }, 403);
    const name = String(body.name || '').trim();
    if (!name || name.length > 80) return reply({ error: 'Enter a work role up to 80 characters.' }, 400);
    const { data: role, error } = await db.from(TABLES.roles).insert({ name, active: true }).select('id,name,active').single();
    if (error) return reply({ error: error.code === '23505' ? 'That work role already exists.' : 'Could not add the work role.' }, error.code === '23505' ? 409 : 500);
    await audit(db, { actorId: member.id, action: 'role_created', entityType: 'work_role', entityId: role.id, after: role });
    return reply({ role }, 201);
  }
  const catalogMatch = path.match(/^\/api\/admin\/(projects|roles)\/([0-9a-f-]{36})$/i);
  if (catalogMatch && request.method === 'PATCH') {
    if (!isAdmin(member)) return reply({ error: 'Only an administrator can manage project and role options.' }, 403);
    const table = catalogMatch[1] === 'projects' ? TABLES.projects : TABLES.roles;
    const { data: prior, error: readError } = await db.from(table).select('*').eq('id', catalogMatch[2]).maybeSingle();
    if (readError || !prior) return reply({ error: 'That option could not be found.' }, 404);
    const update = {};
    if (typeof body.active === 'boolean') update.active = body.active;
    if (catalogMatch[1] === 'projects') {
      if (typeof body.name === 'string') update.name = body.name.trim();
      if (typeof body.project_type === 'string') update.project_type = body.project_type.trim();
      if ((update.name !== undefined && (!update.name || update.name.length > 100)) || (update.project_type !== undefined && (!update.project_type || update.project_type.length > 80))) return reply({ error: 'Enter a project name and project type.' }, 400);
    } else if (typeof body.name === 'string') update.name = body.name.trim();
    if (catalogMatch[1] === 'roles' && update.name !== undefined && (!update.name || update.name.length > 80)) return reply({ error: 'Enter a role name up to 80 characters.' }, 400);
    if (!Object.keys(update).length) return reply({ error: 'Choose a project or role setting to update.' }, 400);
    const { data: updated, error } = await db.from(table).update(update).eq('id', catalogMatch[2]).select('*').maybeSingle();
    if (error || !updated) return reply({ error: 'Could not update that option.' }, 404);
    const entityType = catalogMatch[1] === 'projects' ? 'project' : 'work_role';
    await audit(db, { actorId: member.id, action: update.active !== undefined ? `${entityType}_${body.active ? 'restored' : 'archived'}` : `${entityType}_updated`, entityType, entityId: catalogMatch[2], before: prior, after: updated });
    return reply({ ok: true, item: { id: updated.id, name: updated.name, active: updated.active, project_type: updated.project_type } });
  }
  return reply({ error: 'Not found.' }, 404);
}

export default async function handler(request) {
  try {
    const db = getDb();
    const key = process.env.TEPU_SETUP_KEY || '';
    return await handle(request, db, key);
  } catch (error) {
    console.error('Tracker API error:', error.message);
    return reply({ error: error.message.includes('Set SUPABASE_URL') ? error.message : 'Tracker service is not configured. Check the Netlify environment variables and Supabase migration.' }, 503);
  }
}

export const config = { path: '/api/*' };


