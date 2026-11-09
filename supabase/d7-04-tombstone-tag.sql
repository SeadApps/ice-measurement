-- ============================================================================
-- D7, fix: a removal sent with no facility tag.
--
-- Deleting a round (or anything the app removes without keeping its fields) sent {id, deleted} and nothing else. The server
-- refused that for a Manager or Staff ("untagged records are Admin only") and, for an Admin, stored it with no facility, so
-- nobody scoped to a facility ever learned of the removal. The app now keeps the tag on a removal; this makes the server repair
-- one that arrives bare (an older app, or a change already waiting on a device) from the row it removes.
--
-- Run once in the SQL editor, after d7-01-roles.sql. It only replaces app.records_guard(): the same function as d7-01, plus the
-- block marked "A removal sent with no tag". Safe to run twice.
-- ============================================================================

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

-- ---------------------------------------------------------------------------------------------------------
-- Optional, read only: removals already stored with no facility. They are why a Manager's or Staff's device may still show a
-- round an Admin deleted earlier. Each can usually be placed from the change log:
--
--   select r.kind, r.id,
--          (select a.old_body ->> 'fac' from public.activity a where a.kind = r.kind and a.id = r.id
--             and a.old_body ->> 'fac' is not null order by a.seq desc limit 1) as was_in
--   from public.records r where r.deleted and r.facility_id is null order by r.kind, r.id;
--
-- Send me the result before anything is changed.
