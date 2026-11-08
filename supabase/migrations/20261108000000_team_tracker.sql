-- Tepu team tracker data. Apply once to the Supabase project selected for Netlify.
create extension if not exists pgcrypto;

create table if not exists public.tracker_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  email text not null unique,
  role text not null check (role in ('admin', 'member')),
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now()
);

-- The first admin is created through the protected one-time setup route.
create unique index if not exists tracker_one_admin
  on public.tracker_members (role) where role = 'admin';

create table if not exists public.tracker_sessions (
  token_hash text primary key,
  member_id uuid not null references public.tracker_members(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists tracker_sessions_expiry on public.tracker_sessions (expires_at);

create table if not exists public.tracker_entries (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.tracker_members(id),
  description text not null,
  project text not null,
  work_date date not null,
  start_clock time not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  seconds integer check (seconds is null or seconds >= 0),
  created_at timestamptz not null default now()
);
create index if not exists tracker_entries_work_date on public.tracker_entries (work_date);
create index if not exists tracker_entries_member on public.tracker_entries (member_id);
create unique index if not exists tracker_one_active_timer_per_member
  on public.tracker_entries (member_id) where ended_at is null;

alter table public.tracker_members enable row level security;
alter table public.tracker_sessions enable row level security;
alter table public.tracker_entries enable row level security;

revoke all on public.tracker_members, public.tracker_sessions, public.tracker_entries from anon, authenticated;
grant all on public.tracker_members, public.tracker_sessions, public.tracker_entries to service_role;

