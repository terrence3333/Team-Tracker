-- Seed the project and role options requested for the Tepu tracker.
-- Keep existing custom catalog rows and time records unchanged.

insert into public.tracker_projects (name, project_type)
values
  ('Building Repair (BR)', 'Production'),
  ('LandCover (LC)', 'Production'),
  ('Transportation', 'Production'),
  ('3D', 'Production')
on conflict (name) do update set project_type = excluded.project_type, active = true;

insert into public.tracker_work_roles (name)
values
  ('Annotator'),
  ('Team Lead'),
  ('QC'),
  ('Project Lead')
on conflict (name) do update set active = true;

