-- ============================================================================
-- D1, step 1: ADD. Safe to run on the live project, and safe to run twice.
--
-- Adds the staff list, per-person facility access, the editing window, the
-- "changed by" stamp, the activity log and the functions the client calls.
--
-- Nothing changes for anyone yet. The new row rules below behave exactly like
-- the old ones (any signed-in account reads, inserts and updates) until the
-- single switch `app.settings.tight` is turned on in step 5. Turning it back
-- off puts the old behaviour back.
--
-- Run in the Supabase SQL editor, as the project owner. Read it first: it
-- replaces the policies on public.records, after saving the current ones to
-- app.old_policies (only the first time it runs).
-- ============================================================================

begin;

create schema if not exists app;
create extension if not exists pgcrypto with schema extensions;

-- Private tables live in `app`, which PostgREST does not expose, so none of
-- this can be reached over the API except through the functions below.
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------- tables ----
alter table public.records
  add column if not exists facility_id     text,
  add column if not exists changed_by      uuid,
  add column if not exists changed_by_name text;
create index if not exists records_facility_idx on public.records (facility_id);

create table if not exists app.settings (
  key   text primary key,
  value jsonb not null
);
insert into app.settings (key, value) values
  ('tight', 'false'),            -- step 5 sets this to true
  ('unlock_minutes', '60')
on conflict (key) do nothing;

create table if not exists app.staff (
  user_id    uuid primary key,                       -- auth.users.id
  login      text not null unique,                   -- what the picker sends; the email is login || '@staff.conwayarena.local'
  name       text not null,
  role       text not null check (role in ('management', 'staff')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists app.staff_facilities (
  user_id     uuid not null references app.staff (user_id) on delete cascade,
  facility_id text not null,
  primary key (user_id, facility_id)
);

create table if not exists app.unlocks (
  user_id uuid primary key,
  until   timestamptz not null
);

create table if not exists app.unlock_failures (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists unlock_failures_idx on app.unlock_failures (user_id, at);

create table if not exists app.codes (                 -- a hash of the editing code, never the code
  name text primary key,
  hash text                                            -- null for 'access': that code lives in the auth system
);
-- When each shared code was last changed, for the Staff page. A code set by
-- hand before this existed has no row until it is next changed.
alter table app.codes add column if not exists changed_at timestamptz not null default now();

alter table app.settings        enable row level security;
alter table app.staff           enable row level security;
alter table app.staff_facilities enable row level security;
alter table app.unlocks         enable row level security;
alter table app.unlock_failures enable row level security;
alter table app.codes           enable row level security;
-- No policies on any of them: only the functions below (which run as the
-- owner) and the service role can touch them.
revoke all on all tables in schema app from public, anon, authenticated;

-- The change log. Records keep only their latest version, so this is the only
-- place a "before" exists. Readable by Management, writable by nobody.
create table if not exists public.activity (
  seq             bigint generated always as identity primary key,
  kind            text not null,
  id              text not null,
  facility_id     text,
  changed_by      uuid,
  changed_by_name text,
  "at"            timestamptz not null,
  old_body        jsonb,
  new_body        jsonb,
  old_deleted     boolean,
  deleted         boolean not null
);
create index if not exists activity_record_idx   on public.activity (kind, id);
create index if not exists activity_facility_idx on public.activity (facility_id);
create index if not exists activity_at_idx       on public.activity ("at");
alter table public.activity enable row level security;

-- --------------------------------------------------------- helper functions --
-- All run as the owner so they can read the private tables, and read the
-- caller from the request's JWT through auth.uid().
create or replace function app.tight() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::boolean from app.settings where key = 'tight'), false)
$$;

create or replace function app.is_person() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.staff where user_id = auth.uid() and active)
$$;

create or replace function app.is_mgmt() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.staff where user_id = auth.uid() and active and role = 'management')
$$;

-- True if the caller is Management, or was given this facility.
create or replace function app.may_facility(fac text) returns boolean
language sql stable security definer set search_path = '' as $$
  select fac is not null and (
    app.is_mgmt() or exists (
      select 1 from app.staff_facilities f join app.staff s using (user_id)
      where f.user_id = auth.uid() and s.active and f.facility_id = fac))
$$;

create or replace function app.editing() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.unlocks where user_id = auth.uid() and until > now())
$$;

grant execute on function app.tight(), app.is_person(), app.is_mgmt(),
                          app.may_facility(text), app.editing() to authenticated;

-- ----------------------------------------------------- the write guard -------
-- BEFORE every insert and update on records. Always: the stamp comes from the
-- session, never from the row, and the facility column follows the body's tag.
-- When tight: the rules the fake server in dev/ was written against.
--
-- The messages matter. The client tells "editing is locked" (the person's to
-- fix by unlocking) from every other refusal by this wording, and PostgREST
-- turns errcode 42501 into HTTP 403 carrying the message.
--
-- Named zz_ so it runs after any existing updated_at trigger, which is what the
-- backfill relies on to keep a record's timestamp.
create or replace function app.records_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  person app.staff;
  fac    text;
begin
  -- The one-time backfill (d1-02b) runs from the SQL editor, with no JWT. It
  -- tags records and must not look like an edit: keep who and when.
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
    if person.role <> 'management' then
      if fac is null then
        raise exception 'untagged records are Management only' using errcode = '42501';
      end if;
      if not app.may_facility(fac)
         or (tg_op = 'UPDATE' and (old.facility_id is null or not app.may_facility(old.facility_id))) then
        raise exception 'not your facility' using errcode = '42501';
      end if;
      if new.kind in ('facility', 'sheet') then
        raise exception 'settings are Management only' using errcode = '42501';
      end if;
      if new.kind = 'flag' and (new.body ->> 'status' = 'resolved'
         or (tg_op = 'UPDATE' and old.body ->> 'status' = 'resolved')) then
        raise exception 'only Management resolves or reopens a flag' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists zz_records_guard on public.records;
create trigger zz_records_guard before insert or update on public.records
  for each row execute function app.records_guard();

-- ------------------------------------------------------ the change log -------
create or replace function app.records_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.backfill', true) = 'on' then
    return null;                                  -- the backfill writes one summary row instead
  end if;
  insert into public.activity
    (kind, id, facility_id, changed_by, changed_by_name, "at", old_body, new_body, old_deleted, deleted)
  values
    (new.kind, new.id, new.facility_id, new.changed_by, new.changed_by_name, new.updated_at,
     case when tg_op = 'UPDATE' then old.body end, new.body,
     case when tg_op = 'UPDATE' then old.deleted end, new.deleted);
  return null;
end $$;

drop trigger if exists records_log on public.records;
create trigger records_log after insert or update on public.records
  for each row execute function app.records_log();

-- Nothing, not even Management or the owner's tools by accident, edits the log.
create or replace function app.activity_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'the activity log is append-only' using errcode = '42501';
end $$;

drop trigger if exists activity_no_change   on public.activity;
drop trigger if exists activity_no_truncate on public.activity;
create trigger activity_no_change   before update or delete on public.activity
  for each row       execute function app.activity_immutable();
create trigger activity_no_truncate before truncate on public.activity
  for each statement execute function app.activity_immutable();

revoke all on public.activity from public, anon, authenticated;
grant select on public.activity to authenticated;
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated
  using ((select app.is_mgmt()));

-- ---------------------------------------------- row rules on records ---------
-- Save what is there, once, then replace it. Until `tight` is true these allow
-- exactly what the old rules did.
create table if not exists app.old_policies as
  select policyname, permissive, roles, cmd, qual, with_check
  from pg_policies where schemaname = 'public' and tablename = 'records';
revoke all on app.old_policies from public, anon, authenticated;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'records' loop
    execute format('drop policy %I on public.records', p.policyname);
  end loop;
end $$;

alter table public.records enable row level security;

create policy records_read on public.records for select to authenticated
  using (not (select app.tight())
         or ((select app.is_person()) and ((select app.is_mgmt()) or app.may_facility(facility_id))));

create policy records_insert on public.records for insert to authenticated
  with check (not (select app.tight()) or (select app.is_person()));

create policy records_update on public.records for update to authenticated
  using (not (select app.tight())
         or ((select app.is_person()) and ((select app.is_mgmt()) or app.may_facility(facility_id))))
  with check (not (select app.tight()) or (select app.is_person()));

-- Still no delete: removal is a tombstone, as before.
revoke delete, truncate on public.records from public, anon, authenticated;
grant select, insert, update on public.records to authenticated;

-- ------------------------------------------------- functions the client calls -
-- The list of names the picker shows. The shared access account may call this
-- and nothing else, which is why it is a function and not a table.
create or replace function public.staff_names() returns table (id text, name text)
language sql stable security definer set search_path = '' as $$
  select s.login, s.name from app.staff s where s.active order by s.name
$$;

-- What the signed-in person may see. The client keys its pull cursor on this,
-- so being given a facility later triggers one fresh pull.
create or replace function public.my_facilities() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s app.staff;
begin
  select * into s from app.staff where user_id = auth.uid() and active;
  if s.user_id is null then
    raise exception 'signed out' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'role', s.role,
    'facilities', coalesce((select jsonb_agg(f.facility_id order by f.facility_id)
                            from app.staff_facilities f where f.user_id = s.user_id), '[]'::jsonb));
end $$;

-- Open an editing window for the caller. A wrong code answers 403 WITHOUT
-- raising, because raising would roll back the record of the failed try.
-- response.status is PostgREST's way of setting the status from a function.
create or replace function public.unlock_editing(code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s     app.staff;
  h     text;
  mins  int;
  v_until timestamptz;
begin
  select * into s from app.staff where user_id = auth.uid() and active;
  if s.user_id is null then
    raise exception 'sign in as a person first' using errcode = '42501';
  end if;

  if (select count(*) from app.unlock_failures
      where user_id = s.user_id and at > now() - interval '10 minutes') >= 5 then
    perform set_config('response.status', '403', true);
    return jsonb_build_object('message', 'Too many tries. Wait a few minutes and try again.');
  end if;

  select hash into h from app.codes where name = 'editing';
  if h is null or extensions.crypt(coalesce(code, ''), h) <> h then
    insert into app.unlock_failures (user_id) values (s.user_id);
    delete from app.unlock_failures where at < now() - interval '1 day';
    perform set_config('response.status', '403', true);
    return jsonb_build_object('message', 'That editing code does not match.');
  end if;

  delete from app.unlock_failures where user_id = s.user_id;
  select coalesce((select (value #>> '{}')::int from app.settings where key = 'unlock_minutes'), 60) into mins;
  v_until := now() + make_interval(mins => mins);
  insert into app.unlocks (user_id, until) values (s.user_id, v_until)
    on conflict (user_id) do update set until = excluded.until;
  return jsonb_build_object('until', v_until);
end $$;

create or replace function public.lock_editing() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from app.unlocks where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- Push the window along while the person is working. Refuses once it has ended:
-- an ended window is reopened with the code, not by asking again.
create or replace function public.extend_editing() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  mins    int;
  v_until timestamptz;
begin
  if not app.editing() then
    raise exception 'editing is locked' using errcode = '42501';
  end if;
  select coalesce((select (value #>> '{}')::int from app.settings where key = 'unlock_minutes'), 60) into mins;
  v_until := now() + make_interval(mins => mins);
  update app.unlocks set until = v_until where user_id = auth.uid();
  return jsonb_build_object('until', v_until);
end $$;

revoke all on function public.staff_names(), public.my_facilities(), public.unlock_editing(text),
                       public.lock_editing(), public.extend_editing() from public, anon;
grant execute on function public.staff_names(), public.my_facilities(), public.unlock_editing(text),
                          public.lock_editing(), public.extend_editing() to authenticated;

-- ---------------------------------- functions for the manage-staff function ---
-- Reachable only with the service role key, which lives in the Edge Function's
-- own settings and nowhere else.
create or replace function public.admin_role_of(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from app.staff where user_id = p_user and active
$$;

create or replace function public.admin_user_id(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(p_email)
$$;

create or replace function public.admin_list_staff() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'login', s.login, 'name', s.name, 'role', s.role, 'active', s.active,
      'facilities', coalesce((select jsonb_agg(f.facility_id order by f.facility_id)
                              from app.staff_facilities f where f.user_id = s.user_id), '[]'::jsonb),
      'last_sign_in', (select u.last_sign_in_at from auth.users u where u.id = s.user_id)
    ) order by s.name), '[]'::jsonb)
  from app.staff s
$$;

create or replace function public.admin_save_staff(
  p_user uuid, p_login text, p_name text, p_role text, p_facilities text[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into app.staff (user_id, login, name, role) values (p_user, p_login, p_name, p_role)
    on conflict (user_id) do update set name = excluded.name, role = excluded.role;
  delete from app.staff_facilities where user_id = p_user;
  if p_role = 'staff' and p_facilities is not null then
    insert into app.staff_facilities (user_id, facility_id)
      select p_user, f from unnest(p_facilities) as f on conflict do nothing;
  end if;
end $$;

create or replace function public.admin_set_active(p_login text, p_active boolean) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid;
begin
  update app.staff set active = p_active where login = p_login returning user_id into u;
  if not p_active and u is not null then
    delete from app.unlocks where user_id = u;     -- a removed person's window closes with them
  end if;
  return u;
end $$;

create or replace function public.admin_user_of(p_login text) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from app.staff where login = p_login
$$;

create or replace function public.admin_set_editing_code(p_code text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if length(coalesce(p_code, '')) < 8 then
    raise exception 'an editing code needs at least 8 characters';
  end if;
  insert into app.codes (name, hash) values ('editing', extensions.crypt(p_code, extensions.gen_salt('bf')))
    on conflict (name) do update set hash = excluded.hash, changed_at = now();
  delete from app.unlocks where true;               -- the old code's windows end with it (Supabase refuses a DELETE with no WHERE)
end $$;

-- The access code is the shared account's password, so the auth system holds
-- it; this only notes when it was changed.
create or replace function public.admin_note_access_code() returns void
language sql volatile security definer set search_path = '' as $$
  insert into app.codes (name, hash) values ('access', null)
    on conflict (name) do update set changed_at = now()
$$;

create or replace function public.admin_code_times() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'access',  (select changed_at from app.codes where name = 'access'),
    'editing', (select changed_at from app.codes where name = 'editing'))
$$;

revoke all on function public.admin_role_of(uuid), public.admin_user_id(text), public.admin_list_staff(),
                       public.admin_save_staff(uuid, text, text, text, text[]),
                       public.admin_set_active(text, boolean), public.admin_user_of(text),
                       public.admin_set_editing_code(text), public.admin_note_access_code(),
                       public.admin_code_times() from public, anon, authenticated;
grant execute on function public.admin_role_of(uuid), public.admin_user_id(text), public.admin_list_staff(),
                          public.admin_save_staff(uuid, text, text, text, text[]),
                          public.admin_set_active(text, boolean), public.admin_user_of(text),
                          public.admin_set_editing_code(text), public.admin_note_access_code(),
                          public.admin_code_times() to service_role;

commit;

-- Set the editing code once, by hand, in the SQL editor. NEVER commit the real
-- code anywhere, and do not reuse it as a test value:
--
--   select public.admin_set_editing_code('PASTE-THE-CODE-HERE');
