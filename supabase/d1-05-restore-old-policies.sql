-- ============================================================================
-- D1: RESTORE THE ORIGINAL ROW RULES. Only if you want D1's policies gone.
--
-- d1-04-untighten.sql is the normal way back and is enough. This goes further:
-- it drops the policies step 1 installed on public.records and recreates the
-- ones that were there before, from the copy step 1 saved in app.old_policies.
--
-- The write guard and the activity trigger stay (they are additive). To remove
-- those as well:
--   drop trigger zz_records_guard on public.records;
--   drop trigger records_log      on public.records;
-- ============================================================================

begin;

do $$
declare p record;
begin
  if not exists (select 1 from app.old_policies) then
    raise exception 'app.old_policies is empty: step 1 saved no policies to restore. The table had none, or was changed since.';
  end if;

  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'records' loop
    execute format('drop policy %I on public.records', p.policyname);
  end loop;

  for p in select * from app.old_policies loop
    execute format('create policy %I on public.records as %s for %s to %s%s%s',
      p.policyname,
      p.permissive,
      p.cmd,
      (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(p.roles) as r),
      case when p.qual is not null then ' using (' || p.qual || ')' else '' end,
      case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end);
  end loop;
end $$;

select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'records';

commit;
