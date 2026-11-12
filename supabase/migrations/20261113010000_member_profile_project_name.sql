-- Store each member's administrator-assigned project name.
-- Existing accounts remain unassigned until an administrator selects a project.
alter table public.tracker_members
  add column if not exists project_name text;

