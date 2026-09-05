# Arena Management System — how it works

Static site on GitHub Pages: `seadapps.github.io/ice-measurement/`.
No build step, no framework, no dependencies. Edit a file, push, done.

```
index.html    launcher — cards for each app, live status read from each app's store
ice.html      Ice Manager  — thickness rounds, contour map, trends (multi-facility)
glass.html    Glass Manager — 127 rink glass panels, condition record
sync.js       shared: Supabase auth, pull/push, the access gate, the status pill
sw.js         service worker — offline + cache strategy
manifest.json icon-192.png icon-512.png
.github/workflows/keepalive.yml   pings Supabase so the free tier never sleeps
```

Both apps are self-contained single files. `sync.js` is the only shared code.

---

## The data model, and why it is shaped this way

**Read this before changing how anything is stored.**

Everything is a **record**: `{id, ...fields, updatedAt, deleted}`. Records live in
per-kind maps in local storage, and each carries its own timestamp.

| kind | local key | notes |
|---|---|---|
| `facility` | `ice_v4_facilities` | name, settings |
| `sheet` | `ice_v4_sheets` | `facilityId`, size |
| `session` | `ice_v4_sessions` | `sheetId`, date, mode, `data` (readings), `notes` |
| `glass_panel` | `glass_record_v1` | status, note, by, at |
| — | `ice_v4_prefs` | **device-local, never synced** |

### Why not one blob

The ice app originally stored its entire state under one key. Every save
rewrote everything. That is fine for one device and fatal for two: the iPad
logs a round, the desktop saves later from its stale copy, the round is gone —
cleanly, silently, no error.

Splitting into records with individual timestamps is what makes merging
possible. **Don't collapse it back.**

### The merge rule

Newest `updatedAt` wins, per record. One exception: for `session` records the
`data` and `notes` maps are merged **key by key**, so two people logging
different spots in the same round both keep their work. Only a genuine
collision on the same reading falls back to newest-wins.

Deletes are **tombstones** (`deleted: true`), never row removal — which is why
there is deliberately no DELETE policy in the database. A mistaken delete stays
recoverable.

### Device preferences are separate on purpose

Theme, units, which sheet you were last looking at, which screen you were on —
all in `ice_v4_prefs`, all excluded from sync. Your desktop should not drag the
iPad's view around.

---

## Sync

`sync.js` is the only file that touches the network. An app wires in with:

```js
Sync.attach({
  kinds: ["facility","sheet","session"],
  collect: () => ({facility: {...}, sheet: {...}, session: {...}}),  // id -> record
  apply:   (incoming) => nApplied                                     // merge + re-render
});
Sync.start({title: "Arena Management System"});
```

Pull on open and on tab focus; push 1.5s after an edit. Local storage stays the
primary copy, so a paused project, dead wifi or a refused sign-in never stops
anyone working — it only stops changes crossing devices.

### Three traps

**Only send records that actually changed.** `rink_sync_sent` tracks the
`updatedAt` last sent per record. Pushing everything on every save restamps
every row server-side, which makes whichever device synced last look newest and
silently overwrites the others — the clobber bug, resurrected one layer up. A
test guards this: *an idle device restamps nothing*.

**The server sets `updated_at`.** A trigger does it. Devices never send their
own clock, so a tablet with the wrong date can't win every conflict forever.

**Records pulled down are marked as sent.** Otherwise the next push echoes them
straight back and bumps their timestamps.

---

## Supabase

Project `uiocwdacgbhjccodwrcy`. One table:

```sql
records(id text, kind text, body jsonb, deleted bool, updated_at timestamptz,
        primary key (kind, id))
```

RLS on. Signed-in users read/insert/update; no delete policy. A trigger stamps
`updated_at` on every write. Public signups are off.

**Auth is one shared account** — `operations@conwayarena.local`. The access code
*is* that account's password, so the code box is a real sign-in validated
server-side, not a JavaScript check. The code never appears in the repo. The
anon key does, and that is fine: on its own it grants nothing.

Rotating the code = changing that account's password, which signs every device
out once.

**Free tier pauses after ~7 days of no requests.** `keepalive.yml` pings every
three days. GitHub disables scheduled workflows after 60 days of no commits —
it emails you, one click to re-enable.

---

## Caching — the thing that will waste your afternoon

Two layers sit between a push and what you see:

- **GitHub Pages** sends `Cache-Control: max-age=600`. Your browser may serve a
  10-minute-old page. The service worker now fetches pages with
  `cache: "no-store"` to step over this.
- **The service worker** is network-first for pages, cache-first for icons and
  the manifest. `CACHE_VERSION` in `sw.js` must be bumped when the precache list
  changes.

For development: DevTools open, *Disable cache* + *Update on reload*. A private
window is the wrong tool — it has empty storage, so every feature that remembers
anything starts from nothing.

---

## Testing

The sandbox where Claude runs cannot reach `supabase.co` (egress policy). So
`dev/fake-supabase.js` speaks the same auth and REST dialect and serves the site
on `localhost:8200`. It can also fake a paused project and flaky writes.

```
node dev/fake-supabase.js &
node dev/synctest.js       # 20 checks: sign-in, two devices, offline, paused
node dev/conflicttest.js   # 10 checks: no churn, contested edits, retries
node dev/e2e.js            # 14 checks: legacy migration, backup merge
```

Tests point `window.__SYNC_CONFIG__` at the fake via `addInitScript`; the real
pages never read it.

---

## Known open items

- **Zamboni end, panel 111.** A 43″ panel inferred to close a 43½″ shortfall,
  drawn dashed and flagged in the schedule. Never confirmed on site. Either a
  missed panel or the Zamboni doorway is wider than its two 57½″ leaves.
- **Glass Manager on a phone** has not been looked at. Desktop and tablet are fine.
- **`index.html` `<title>` and `manifest.json`** still say "Rink Apps" while the
  visible name is "Arena Management System".
- **Ice app has no "marked by" field.** Glass does. Worth adding for parity —
  attribution without individual logins.
- **No realtime.** Sync happens on open and on focus. Supabase realtime would
  make the desktop update while you watch; not needed so far.
