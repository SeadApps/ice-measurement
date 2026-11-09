-- ============================================================================
-- D7, undo: back to two roles, Management and Staff.
--
-- Run this, then re-run d1-01-add.sql (it is safe to run twice; it puts the d1 guard, helper functions and change-log
-- policy back). Do both before using the app, because an app that still knows only "management" does not understand "admin".
--
-- A Manager becomes Staff again with the same facilities, so nobody gains access and nobody loses sight of their
-- facilities. An Admin becomes Management.
-- ============================================================================

begin;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'app.staff'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table app.staff drop constraint %I', c.conname);
  end loop;
end $$;

update app.staff set role = 'staff'      where role = 'manager';
update app.staff set role = 'management' where role = 'admin';

alter table app.staff add constraint staff_role_check check (role in ('management', 'staff'));

-- The helpers go back to what d1 made them, before the ones d7 added are dropped (the change-log policy depends on them).
create or replace function app.is_mgmt() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.staff where user_id = auth.uid() and active and role = 'management')
$$;
create or replace function app.may_facility(fac text) returns boolean
language sql stable security definer set search_path = '' as $$
  select fac is not null and (
    app.is_mgmt() or exists (
      select 1 from app.staff_facilities f join app.staff s using (user_id)
      where f.user_id = auth.uid() and s.active and f.facility_id = fac))
$$;
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated
  using ((select app.is_mgmt()));

drop function if exists app.is_admin();
drop function if exists app.is_manager();

commit;

-- Now run d1-01-add.sql. Then check:
--   select login, name, role, active from app.staff order by role, name;
