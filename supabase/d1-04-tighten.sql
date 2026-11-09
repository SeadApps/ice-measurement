-- ============================================================================
-- D1, step 5: TIGHTEN. The point of no return for devices on the old build.
--
-- Run only after: the new client is live on every device, the backfill is done,
-- the editing code is set, a Manager exists, and one real device has been
-- checked end to end. Everything before this step can be abandoned without
-- anyone noticing. This one cannot be done quietly: a device on the old build
-- stops syncing and shows the gate.
--
-- It is one switch. d1-04-untighten.sql turns it back.
-- ============================================================================

do $$
declare
  n_mgr int; n_codes int; n_untagged int; n_people int;
begin
  select count(*) into n_mgr from app.staff where role in ('admin', 'management') and active;
  select count(*) into n_people from app.staff where active;
  select count(*) into n_codes from app.codes where name = 'editing';
  select count(*) into n_untagged from public.records where facility_id is null;

  if n_mgr = 0 then
    raise exception 'No active Manager. Run d1-03-first-manager.sql first, or nobody can unlock editing and nobody can add anyone.';
  end if;
  if n_codes = 0 then
    raise exception 'No editing code. Run: select public.admin_set_editing_code(''...'');';
  end if;
  if n_people < 2 then
    raise notice 'Only % person exists. Everyone else on the old build will be locked out until they are added.', n_people;
  end if;
  if n_untagged > 0 then
    raise notice '% record(s) have no facility tag. Only Managers will see them. Run d1-02a to list them.', n_untagged;
  end if;

  update app.settings set value = 'true' where key = 'tight';
  raise notice 'Tight. The shared account can now only list names.';
end $$;

select key, value from app.settings where key = 'tight';
