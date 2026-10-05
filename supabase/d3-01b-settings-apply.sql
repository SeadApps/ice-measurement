-- ============================================================================
-- D3, step 1b: SETTINGS APPLY. Run d3-01a first and read what it showed.
--
-- Rewrites the settings of every facility whose settingsVersion is below 2 into
-- eighths, with overdueDays and settingsVersion set. Nothing else on the
-- facility changes, and no sheet or round is touched.
--
-- Like the D1 backfill this must not look like an edit. The write guard sees
-- `app.backfill = on` with no signed-in caller and keeps the record's updated_at
-- and changed_by exactly as they were, so no device re-pulls or re-sends anything.
-- That is safe because every client already reads these settings through
-- settingsOf(), which gives the same numbers; and a device holding an older copy
-- that later sends it back just has its numbers read the same way again.
--
-- Safe to run twice: the second run finds nothing to do.
-- ============================================================================

begin;

do $$
declare n int;
begin
  perform set_config('app.backfill', 'on', true);          -- local to this transaction

  update public.records r
     set body = jsonb_set(r.body, '{settings}', app.settings_v2(r.body -> 'settings'))
   where r.kind = 'facility' and not r.deleted
     and coalesce((r.body -> 'settings' ->> 'settingsVersion')::int, 0) < 2;
  get diagnostics n = row_count;

  insert into public.activity (kind, id, "at", new_body, deleted)
  values ('_backfill', to_char(now(), 'YYYYMMDD"T"HH24MISS') || '-settings', now(),
          jsonb_build_object('facilities_given_settings_v2', n), false);

  raise notice 'migrated the settings of % facility(ies)', n;
end $$;

commit;

-- Should return no rows.
select id, body ->> 'name' as name from public.records
where kind = 'facility' and not deleted
  and coalesce((body -> 'settings' ->> 'settingsVersion')::int, 0) < 2;
