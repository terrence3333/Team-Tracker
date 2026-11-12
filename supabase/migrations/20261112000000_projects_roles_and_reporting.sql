-- Add admin-managed catalogs, richer time entries, and member work-role labels.
-- Existing accounts and time records are preserved.

alter table public.tracker_members
  add column if not exists job_role text not null default '';

alter table public.tracker_entries
  add column if not exists project_id text not null default '',
  add column if not exists project_type text not null default '',
  add column if not exists work_role text not null default '';

create table if not exists public.tracker_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 100),
  project_type text not null check (length(trim(project_type)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.tracker_work_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.tracker_projects (name, project_type)
values ('Internal operations', 'Operations')
on conflict (name) do nothing;

insert into public.tracker_work_roles (name)
values ('Team member')
on conflict (name) do nothing;

alter table public.tracker_projects enable row level security;
alter table public.tracker_work_roles enable row level security;
revoke all on public.tracker_projects, public.tracker_work_roles from anon, authenticated;
grant all on public.tracker_projects, public.tracker_work_roles to service_role;

create index if not exists tracker_entries_project_name on public.tracker_entries (project);
create index if not exists tracker_entries_work_role on public.tracker_entries (work_role);

