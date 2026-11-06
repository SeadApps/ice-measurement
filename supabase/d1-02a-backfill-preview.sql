-- ============================================================================
-- D1, step 2a: BACKFILL PREVIEW. Read-only. Run it, read it, then decide.
--
-- It creates one view (app.backfill_plan) and writes no data.
--
-- Every record needs a facility tag so the server can show it only to people
-- given that facility. This works out the tag for each existing record from
-- what it already says about itself, and shows what d1-02b would write. Nothing
-- is written here.
--
--   facility        its own id
--   sheet           body.facilityId
--   session         the facility of the sheet it names (body.sheetId)
--   glass_binding   body.facilityId, else the facility of body.sheetId
--   glass_layout    its id is a sheet id: that sheet's facility
--   glass_panel     "<sheetId>:<panel>" -> that sheet's facility. A bare id is
--                   Conway's, tied to its sheet through the glass binding
--   glass_spare     body.fac
--
-- Anything it cannot place is listed as UNRESOLVED and is left alone. Until it
-- is tagged by hand a record like that is visible to Management only.
-- ============================================================================

create or replace view app.backfill_plan as
with sheet_fac as (
  select id as sheet_id, body ->> 'facilityId' as fac
  from public.records where kind = 'sheet' and not deleted
),
legacy_bind as (
  select coalesce(b.body ->> 'facilityId', sf.fac) as fac
  from public.records b left join sheet_fac sf on sf.sheet_id = b.body ->> 'sheetId'
  where b.kind = 'glass_binding' and b.id = 'legacy' and not b.deleted
  limit 1
)
select r.kind, r.id, r.facility_id as current_fac,
  case r.kind
    when 'facility'      then r.id
    when 'sheet'         then r.body ->> 'facilityId'
    when 'session'       then (select fac from sheet_fac where sheet_id = r.body ->> 'sheetId')
    when 'glass_binding' then coalesce(r.body ->> 'facilityId',
                                       (select fac from sheet_fac where sheet_id = r.body ->> 'sheetId'))
    when 'glass_layout'  then (select fac from sheet_fac where sheet_id = r.id)
    when 'glass_panel'   then case when position(':' in r.id) > 0
                                   then (select fac from sheet_fac where sheet_id = split_part(r.id, ':', 1))
                                   else (select fac from legacy_bind) end
    when 'glass_spare'   then r.body ->> 'fac'
  end as proposed_fac
from public.records r;

-- 1. The shape of it, by kind.
select kind,
       count(*)                                                        as records,
       count(*) filter (where current_fac is not null)                 as already_tagged,
       count(*) filter (where current_fac is null and proposed_fac is not null) as will_tag,
       count(*) filter (where current_fac is null and proposed_fac is null)     as unresolved
from app.backfill_plan
group by kind order by kind;

-- 2. Disagreements: tagged already, and the plan says something else. These are
--    NOT changed by the apply script. Look at each one.
select kind, id, current_fac, proposed_fac
from app.backfill_plan
where current_fac is not null and proposed_fac is not null and current_fac <> proposed_fac;

-- 3. What cannot be placed.
select kind, id from app.backfill_plan
where current_fac is null and proposed_fac is null order by kind, id;

-- 4. Facilities the plan would use, with how many records each gets. A name you
--    do not recognise here means a record points at a facility that is not there.
select p.proposed_fac as facility, f.body ->> 'name' as name, count(*) as records
from app.backfill_plan p
left join public.records f on f.kind = 'facility' and f.id = p.proposed_fac
where p.current_fac is null and p.proposed_fac is not null
group by 1, 2 order by 3 desc;

-- 5. Sheets that would get a shape from their size, and what changes. The old
--    28 ft corner becomes 27 ft 2 in; any other corner is kept as it is.
select id as sheet_id, body ->> 'name' as name,
       body #>> '{size,L}' as length, body #>> '{size,W}' as width,
       body #>> '{size,corner}' as old_corner_ft,
       case when (body #>> '{size,corner}')::numeric = 28 then '27 ft 2 in'
            else floor(round((body #>> '{size,corner}')::numeric * 24) / 24)::int || ' ft '
                 || ((round((body #>> '{size,corner}')::numeric * 24)
                      - 24 * floor(round((body #>> '{size,corner}')::numeric * 24) / 24)) / 2.0) || ' in'
       end as new_corner
from public.records
where kind = 'sheet' and not deleted and body -> 'shape' is null and body -> 'size' is not null;
