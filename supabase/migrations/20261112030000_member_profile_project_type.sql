-- Apply to the Tepu Solutions Supabase project before deploying the app update.
-- Existing member profiles receive the required default of Production.
alter table public.tracker_members
  add column if not exists project_type text not null default 'Production';

update public.tracker_members
set project_type = 'Production'
where project_type is null or length(trim(project_type)) = 0;
