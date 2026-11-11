import { createClient } from '@supabase/supabase-js';
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';

const PASSWORD_ROUNDS = 310_000;
const SESSION_DAYS = 14;
const SESSION_COOKIE = 'tepu_session';
const TABLES = { members: 'tracker_members', sessions: 'tracker_sessions', entries: 'tracker_entries' };

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
  return { id: member.id, name: member.name, email: member.email, role: member.role };
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
    .select('id,name,email,role').eq('id', session.member_id).maybeSingle();
  return error ? null : member;
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
    return reply({ setup_required: setupRequired, setup_requires_key: true, member: member ? publicMember(member) : null });
  }
  if (request.method === 'GET' && path === '/api/me') {
    const member = await currentMember(db, request);
    return reply({ member: member ? publicMember(member) : null });
  }
  if (request.method === 'GET' && path === '/api/data') {
    const member = await currentMember(db, request);
    if (!member) return reply({ error: 'Please sign in to continue.' }, 401);
    const range = monthRange(url.searchParams.get('month'));
    if (!range) return reply({ error: 'Choose a valid reporting month.' }, 400);
    const [{ data: rows, error: entriesError }, { data: users, error: membersError }, { data: active, error: activeError }] = await Promise.all([
      db.from(TABLES.entries).select('*').gte('work_date', range.start).lt('work_date', range.end).order('started_at', { ascending: false }).limit(5000),
      db.from(TABLES.members).select('id,name,email,role').order('name', { ascending: true }),
      db.from(TABLES.entries).select('id,description,project,work_date,start_clock,started_at').eq('member_id', member.id).is('ended_at', null).limit(1).maybeSingle(),
    ]);
    if (entriesError || membersError || activeError) return reply({ error: 'Could not load tracker data.' }, 500);
    const memberNames = new Map(users.map((user) => [user.id, user.name]));
    const now = Date.now();
    const entries = rows.map((row) => ({
      id: row.id, member_id: row.member_id, member_name: memberNames.get(row.member_id) || 'Team member',
      description: row.description, project: row.project, date: row.work_date, start: String(row.start_clock).slice(0, 5),
      started_at: Math.floor(new Date(row.started_at).getTime() / 1000),
      ended_at: row.ended_at, seconds: row.seconds ?? Math.max(0, Math.floor((now - new Date(row.started_at).getTime()) / 1000)),
      running: row.ended_at === null,
    }));
    const timer = active ? { id: active.id, description: active.description, project: active.project,
      date: active.work_date, start: String(active.start_clock).slice(0, 5), started_at: Math.floor(new Date(active.started_at).getTime() / 1000) } : null;
    return reply({ member: publicMember(member), members: users.map(publicMember), entries, timer });
  }
  if (request.method !== 'POST') return reply({ error: 'Not found.' }, 404);
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
    return reply({ member: publicMember(admin) }, 201, { 'Set-Cookie': cookieHeader(token) });
  }

  if (path === '/api/login') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const { data: member, error } = await db.from(TABLES.members).select('*').eq('email', email).maybeSingle();
    const expected = member ? Buffer.from(member.password_hash, 'hex') : Buffer.alloc(32);
    const actual = pbkdf2Sync(password, member?.password_salt || '00000000000000000000000000000000', PASSWORD_ROUNDS, 32, 'sha256');
    if (error || !member || expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
      return reply({ error: 'Email or password is incorrect.' }, 401);
    }
    const token = await createSession(db, member.id);
    return reply({ member: publicMember(member) }, 200, { 'Set-Cookie': cookieHeader(token) });
  }

  if (path === '/api/logout') {
    const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
    if (token) await db.from(TABLES.sessions).delete().eq('token_hash', hashToken(token));
    return reply({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', 0) });
  }

  const member = await currentMember(db, request);
  if (!member) return reply({ error: 'Please sign in to continue.' }, 401);

  if (path === '/api/timer/start') {
    const description = String(body.description || '').trim().slice(0, 160);
    const project = String(body.project || '').trim().slice(0, 100);
    const workDate = body.date;
    const start = body.start;
    if (!project || !validDate(workDate) || typeof start !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) {
      return reply({ error: 'Add a project and use a valid date and start time.' }, 400);
    }
    const { data: entry, error } = await db.from(TABLES.entries).insert({
      member_id: member.id, description: description || project, project, work_date: workDate,
      start_clock: `${start}:00`, started_at: new Date().toISOString(),
    }).select('id').single();
    if (error) return reply({ error: error.code === '23505' ? 'You already have a timer running. Stop it before starting another.' : 'Could not start the timer.' }, error.code === '23505' ? 409 : 500);
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
    return reply({ ok: true, seconds });
  }

  if (path === '/api/members') {
    if (member.role !== 'admin') return reply({ error: 'Only an administrator can add team members.' }, 403);
    const validation = validateMember(body.name, body.email, body.password);
    if (validation) return reply({ error: validation }, 400);
    const salt = randomBytes(16).toString('hex');
    const { data: created, error } = await db.from(TABLES.members).insert({
      name: body.name.trim(), email: body.email.trim().toLowerCase(), role: 'member',
      password_salt: salt, password_hash: passwordHash(body.password, salt),
    }).select('id').single();
    if (error) return reply({ error: error.code === '23505' ? 'That email already has an account.' : 'Could not create the team member account.' }, error.code === '23505' ? 409 : 500);
    return reply({ ok: true, id: created.id }, 201);
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

