-- Comments, account deactivation, administrator timesheet controls, and append-only audit history.
-- The Netlify API uses the service key; browser roles receive no direct access to these tables.

alter table public.tracker_members
  add column if not exists active boolean not null default true;

create table if not exists public.tracker_entry_comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.tracker_entries(id) on delete cascade,
  member_id uuid not null references public.tracker_members(id),
  comment text not null check (length(trim(comment)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists tracker_comments_entry_created on public.tracker_entry_comments (entry_id, created_at);
create index if not exists tracker_comments_member_created on public.tracker_entry_comments (member_id, created_at);

create schema if not exists tracker_internal;
revoke all on schema tracker_internal from public, anon, authenticated;

create table if not exists public.tracker_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_member_id uuid references public.tracker_members(id) on delete set null,
  target_member_id uuid references public.tracker_members(id) on delete set null,
  action text not null check (length(trim(action)) between 1 and 80),
  entity_type text not null check (length(trim(entity_type)) between 1 and 80),
  entity_id text,
  before_values jsonb,
  after_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists tracker_audit_created on public.tracker_audit_log (created_at desc);
create index if not exists tracker_audit_actor_created on public.tracker_audit_log (actor_member_id, created_at desc);
create index if not exists tracker_audit_target_created on public.tracker_audit_log (target_member_id, created_at desc);
create index if not exists tracker_audit_action_created on public.tracker_audit_log (action, created_at desc);

create or replace function tracker_internal.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit history is append-only';
end;
$$;
revoke all on function tracker_internal.prevent_audit_mutation() from public, anon, authenticated;
drop trigger if exists tracker_audit_is_append_only on public.tracker_audit_log;
create trigger tracker_audit_is_append_only
  before update or delete on public.tracker_audit_log
  for each row execute function tracker_internal.prevent_audit_mutation();

alter table public.tracker_entry_comments enable row level security;
alter table public.tracker_audit_log enable row level security;
revoke all on public.tracker_entry_comments, public.tracker_audit_log from anon, authenticated;
grant all on public.tracker_entry_comments, public.tracker_audit_log to service_role;

