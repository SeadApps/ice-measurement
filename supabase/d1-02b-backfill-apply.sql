-- ============================================================================
-- D1, step 2b: BACKFILL APPLY. Run d1-02a first and read what it showed.
--
-- Tags every record the preview said it could place, and gives each sheet its
-- shape. Records that already carry a tag are never changed, and neither is a
-- record the plan could not place.
--
-- This must not look like an edit. The write guard sees `app.backfill = on`
-- with no signed-in caller and keeps each record's updated_at and its
-- changed_by exactly as they were, so no device re-pulls or re-sends anything
-- and nobody's "last changed" moves. One summary row goes in the activity log.
--
-- Safe to run twice: the second run finds nothing to do.
-- ============================================================================

begin;

-- Two statements, one after the other. They must not be combined into one with
-- data-modifying CTEs: a sheet gets both a tag and a shape, and Postgres applies
-- only one of two modifications to the same row within a single statement.
do $$
declare n_tag int; n_shape int;
begin
  perform set_config('app.backfill', 'on', true);          -- local to this transaction

  update public.records r
     set facility_id = p.proposed_fac,
         body = jsonb_set(r.body, '{fac}', to_jsonb(p.proposed_fac))
    from app.backfill_plan p
   where p.kind = r.kind and p.id = r.id
     and r.facility_id is null and p.proposed_fac is not null;
  get diagnostics n_tag = row_count;

  update public.records r
     set body = jsonb_set(r.body, '{shape}', jsonb_build_object(
           'L',     (r.body #>> '{size,L}')::numeric,
           'W',     (r.body #>> '{size,W}')::numeric,
           -- the old preset's 28 ft is the one that disagreed with the glass survey
           'Rft',   case when (r.body #>> '{size,corner}')::numeric = 28 then 27
                         else floor((r.body #>> '{size,corner}')::numeric)::int end,
           'Rin',   case when (r.body #>> '{size,corner}')::numeric = 28 then 2
                         else round(((r.body #>> '{size,corner}')::numeric
                                     - floor((r.body #>> '{size,corner}')::numeric)) * 12)::int end,
           'start', 'zam', 'turn', false, 'flip', false))
   where r.kind = 'sheet' and not r.deleted
     and r.body -> 'shape' is null and r.body #>> '{size,L}' is not null
     and r.body #>> '{size,W}' is not null and r.body #>> '{size,corner}' is not null;
  get diagnostics n_shape = row_count;

  insert into public.activity (kind, id, "at", new_body, deleted)
  values ('_backfill', to_char(now(), 'YYYYMMDD"T"HH24MISS'), now(),
          jsonb_build_object('tagged', n_tag, 'sheets_given_a_shape', n_shape), false);

  raise notice 'tagged % record(s), gave % sheet(s) a shape', n_tag, n_shape;
end $$;

-- What is left: should be empty, or only what the preview said it could not place.
select kind, id from public.records where facility_id is null order by kind, id;

commit;
