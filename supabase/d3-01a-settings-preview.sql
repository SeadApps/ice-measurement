-- ============================================================================
-- D3, step 1a: SETTINGS PREVIEW. Read-only apart from one helper function.
--
-- Band edges, the flood and shave levels and the target move to eighths of an
-- inch, and the overdue rule moves from the device to the facility. This shows,
-- facility by facility, what d3-01b would write. Nothing is written here.
--
--   edges, flood, shave   rounded UP to the next eighth. A reading is one of
--                         sixteen labels in eighths, so an edge between two
--                         eighths means the eighth above it: every reading
--                         stays in the band it is in now.
--   target                to the nearest eighth
--   overdueDays           kept if set, else 7 (a device's own preference cannot
--                         be known from here; a Manager's device copies its own
--                         on its next migration if the facility still has none)
--   settingsVersion       2
--
-- Why this is a Management step and not something each device does when it
-- opens a page: a facility record is Management-only to write, so a Staff device
-- would be refused, and every device migrating the same facility at once would
-- race. The client reads settings through settingsOf(), which applies exactly
-- this arithmetic in memory, so nobody is waiting on this script for the right
-- colours; this only makes the stored records say what everyone already reads.
--
-- app.settings_v2 below is the same arithmetic as Records.settingsOf in
-- records.js. If one changes, change the other (bandmigrationtest checks the JS).
-- ============================================================================

create or replace function app.settings_v2(s jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  edges   jsonb;
  e1      numeric;
  e2      numeric;
  flood   numeric;
  shave   numeric;
  tgt     numeric;
  days    numeric;
begin
  s := coalesce(s, '{}'::jsonb);

  if jsonb_typeof(s -> 'edges') = 'array' and jsonb_array_length(s -> 'edges') = 4
     and not exists (select 1 from jsonb_array_elements(s -> 'edges') x where jsonb_typeof(x) <> 'number') then
    select jsonb_agg(ceil((x.v)::numeric * 8 - 0.000000001) / 8 order by x.ord)
      into edges from jsonb_array_elements_text(s -> 'edges') with ordinality as x(v, ord);
  else
    edges := '[0.75, 1.5, 1.625, 2]'::jsonb;
  end if;
  e1 := (edges ->> 1)::numeric;
  e2 := (edges ->> 2)::numeric;

  flood := case when jsonb_typeof(s -> 'floodBelow') = 'number'
                then ceil((s ->> 'floodBelow')::numeric * 8 - 0.000000001) / 8 else e1 end;
  shave := case when jsonb_typeof(s -> 'shaveAbove') = 'number'
                then ceil((s ->> 'shaveAbove')::numeric * 8 - 0.000000001) / 8 else e2 end;
  tgt   := case when jsonb_typeof(s -> 'target') = 'number'
                then round((s ->> 'target')::numeric * 8) / 8 else 1.5 end;
  days  := case when jsonb_typeof(s -> 'overdueDays') = 'number' then (s ->> 'overdueDays')::numeric else 7 end;
  days  := greatest(1, least(90, round(days)));

  -- keep any key this code does not know about, as upgradeSettings does
  return s || jsonb_build_object(
    'target', tgt,
    'edges', edges,
    'tieAttention', coalesce((s ->> 'tieAttention')::boolean, true),
    'floodBelow', flood,
    'shaveAbove', shave,
    'overdueDays', days,
    'settingsVersion', 2);
end $$;

-- Facilities that would change, and what each setting would become.
select r.id                                   as facility_id,
       r.body ->> 'name'                      as name,
       r.body -> 'settings' -> 'edges'        as edges_now,
       app.settings_v2(r.body -> 'settings') -> 'edges' as edges_after,
       r.body -> 'settings' ->> 'floodBelow'  as flood_now,
       app.settings_v2(r.body -> 'settings') ->> 'floodBelow' as flood_after,
       r.body -> 'settings' ->> 'shaveAbove'  as shave_now,
       app.settings_v2(r.body -> 'settings') ->> 'shaveAbove' as shave_after,
       r.body -> 'settings' ->> 'target'      as target_now,
       app.settings_v2(r.body -> 'settings') ->> 'target' as target_after,
       r.body -> 'settings' ->> 'overdueDays' as overdue_now,
       app.settings_v2(r.body -> 'settings') ->> 'overdueDays' as overdue_after
from public.records r
where r.kind = 'facility' and not r.deleted
  and coalesce((r.body -> 'settings' ->> 'settingsVersion')::int, 0) < 2
order by r.body ->> 'name';

-- A summary: how many are done and how many are waiting.
select count(*) filter (where coalesce((body -> 'settings' ->> 'settingsVersion')::int, 0) >= 2) as already_migrated,
       count(*) filter (where coalesce((body -> 'settings' ->> 'settingsVersion')::int, 0) <  2) as would_change
from public.records where kind = 'facility' and not deleted;
