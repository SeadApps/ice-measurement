-- ============================================================================
-- D7, step 1: three roles. Admin, Manager and Staff.
--
--   admin    Everything, in every facility. The shared codes, backups, restores, adding and hiding a facility,
--            and who is a Manager or an Admin.
--   manager  Scoped to the facilities they were given, like Staff, and in them: settings, sheets, resolving flags,
--            the change log, and their own Staff (through the manage-staff function).
--   staff    As before.
--
-- ORDER MATTERS. Do these in this order, and do not skip the first two:
--   1. Merge and let the site deploy the version of the app that knows "admin" (it still understands "management").
--   2. Deploy the manage-staff function from this change (it understands both names too):
--        supabase functions deploy manage-staff
--   3. Run THIS file, once, in the SQL editor as the project owner. Read it first. It is one transaction: if anything
--      fails nothing changes.
--   4. Run the checks at the bottom of this file.
-- A device that has not reloaded the new app after step 1 shows the person as having no facilities after step 3,
-- until it is reloaded twice. That is the only side effect of the order.
--
-- To go back: d7-02-undo-roles.sql, then re-run d1-01-add.sql.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- the roles --
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'app.staff'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table app.staff drop constraint %I', c.conname);
  end loop;
end $$;

-- Today's only top-level person is the owner. Every existing "management" becomes an Admin, so nobody loses anything.
update app.staff set role = 'admin' where role = 'management';

alter table app.staff add constraint staff_role_check check (role in ('admin', 'manager', 'staff'));

-- --------------------------------------------------------- helper functions --
create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.staff where user_id = auth.uid() and active and role = 'admin')
$$;

create or replace function app.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.staff where user_id = auth.uid() and active and role = 'manager')
$$;

-- The old name stays, meaning what it always meant to the row rules: sees everything.
create or replace function app.is_mgmt() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin()
$$;

-- An Admin, or somebody (Manager or Staff) who was given this facility.
create or replace function app.may_facility(fac text) returns boolean
language sql stable security definer set search_path = '' as $$
  select fac is not null and (
    app.is_admin() or exists (
      select 1 from app.staff_facilities f join app.staff s using (user_id)
      where f.user_id = auth.uid() and s.active and f.facility_id = fac))
$$;

grant execute on function app.is_admin(), app.is_manager(), app.is_mgmt(), app.may_facility(text) to authenticated;

-- ----------------------------------------------------- the write guard -------
-- The same guard as d1-01, with the three roles. Messages are what the app reads; keep them.
create or replace function app.records_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  person app.staff;
  fac    text;
begin
  if current_setting('app.backfill', true) = 'on' and auth.uid() is null and tg_op = 'UPDATE' then
    new.facility_id     := nullif(new.body ->> 'fac', '');
    new.changed_by      := old.changed_by;
    new.changed_by_name := old.changed_by_name;
    new.updated_at      := old.updated_at;
    return new;
  end if;

  select * into person from app.staff where user_id = auth.uid() and active;

  new.body            := coalesce(new.body, '{}'::jsonb) - 'changedBy' - 'changed_by';
  fac                 := nullif(new.body ->> 'fac', '');
  -- A removal sent with no tag (an older app wrote them bare) takes the tag of the row it removes, so it is judged against
  -- the right facility and the right people see it. Looked up by kind and id: an upsert over an existing row fires the
  -- INSERT trigger first, where OLD does not exist.
  if fac is null and new.deleted then
    select r.facility_id into fac from public.records r where r.kind = new.kind and r.id = new.id;
    if fac is not null then
      new.body := jsonb_set(new.body, '{fac}', to_jsonb(fac));
    end if;
  end if;
  new.facility_id     := fac;
  new.changed_by      := person.user_id;        -- null for the shared account
  new.changed_by_name := person.name;

  if app.tight() then
    if person.user_id is null then
      raise exception 'the shared account may not write' using errcode = '42501';
    end if;
    if not app.editing() then
      raise exception 'editing is locked' using errcode = '42501';
    end if;
    if person.role <> 'admin' then
      if fac is null then
        raise exception 'untagged records are Admin only' using errcode = '42501';
      end if;
      if not app.may_facility(fac) then
        raise exception 'not your facility' using errcode = '42501';
      end if;
      -- Nested on purpose: OLD does not exist on an INSERT, and is only ever read inside a branch that knows it is an UPDATE.
      -- (An upsert over an existing row runs this trigger twice, as an INSERT and then as an UPDATE; the UPDATE leg is where OLD is checked.)
      if tg_op = 'UPDATE' then
        if old.facility_id is null or not app.may_facility(old.facility_id) then
          raise exception 'not your facility' using errcode = '42501';
        end if;
      end if;
      if person.role = 'staff' and new.kind in ('facility', 'sheet') then
        raise exception 'settings are for Managers and Admins only' using errcode = '42501';
      end if;
      -- A Manager changes their facility's settings and sheets. A facility itself is made, hidden and brought back by an Admin.
      -- Not judged by tg_op: the app writes with an upsert, and an upsert over an existing row fires the INSERT trigger first.
      -- So: it must already exist, live, and must stay live.
      if person.role = 'manager' and new.kind = 'facility' then
        if new.deleted or not exists (select 1 from public.records r
                                      where r.kind = 'facility' and r.id = new.id and not r.deleted) then
          raise exception 'only an Admin adds, removes or restores a facility' using errcode = '42501';
        end if;
      end if;
      if person.role = 'staff' and new.kind = 'flag' then
        if new.body ->> 'status' = 'resolved' then
          raise exception 'only a Manager or Admin resolves or reopens a flag' using errcode = '42501';
        end if;
        if tg_op = 'UPDATE' then
          if old.body ->> 'status' = 'resolved' then
            raise exception 'only a Manager or Admin resolves or reopens a flag' using errcode = '42501';
          end if;
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------- the change log ---
-- An Admin reads all of it, a Manager the facilities they were given. Staff none. Nobody writes it.
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated
  using ((select app.is_admin()) or ((select app.is_manager()) and app.may_facility(facility_id)));

-- The row rules on records (records_read, records_insert, records_update) already say "an Admin (is_mgmt) or somebody who
-- was given the facility", which is exactly right for all three roles, so they are left as they are.

-- ------------------------------------------------ for the manage-staff function --
-- Facilities are kept for Managers as well as Staff. Only an Admin has none (they cover all).
create or replace function public.admin_save_staff(
  p_user uuid, p_login text, p_name text, p_role text, p_facilities text[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_role not in ('admin', 'manager', 'staff') then
    raise exception 'unknown role %', p_role;
  end if;
  insert into app.staff (user_id, login, name, role) values (p_user, p_login, p_name, p_role)
    on conflict (user_id) do update set name = excluded.name, role = excluded.role;
  delete from app.staff_facilities where user_id = p_user;
  if p_role <> 'admin' and p_facilities is not null then
    insert into app.staff_facilities (user_id, facility_id)
      select p_user, f from unnest(p_facilities) as f on conflict do nothing;
  end if;
end $$;

commit;

-- ============================================================================
-- CHECKS. Run these after the commit. Read the answers.
-- ============================================================================
-- 1. Everybody who was Management is now an Admin, and nobody else changed. Expect: the owner as admin, the rest as staff.
--      select login, name, role, active from app.staff order by role, name;
-- 2. Exactly one active Admin at least (the app refuses to remove the last one):
--      select count(*) from app.staff where role = 'admin' and active;
-- 3. The rules are in place. Expect 'admin', 'manager', 'staff' in the constraint:
--      select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'app.staff'::regclass and contype = 'c';
-- 4. Nothing about the data moved:
--      select kind, count(*) from public.records group by kind order by kind;
-- Then sign in as the owner on a reloaded device. The Staff page should list everyone, and the facilities page should show
-- every facility.
