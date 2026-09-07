# Arena Management System — how it works

Static site on GitHub Pages: `seadapps.github.io/ice-measurement/`.
No build step, no framework, no dependencies. Edit a file, push, done.

```
index.html    launcher — gated; cards read this device's records, never the network
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
| `glass_panel` | `glass_record_v2` | status, note, by, at (`glass_record_v1` kept as a fallback) |
| `glass_binding` | `glass_record_v2` | `sheetId` — which ice surface the Conway panels are the glass for |
| `glass_layout` | `glass_record_v2` | the walk a built rink was made from; the drawing is regenerated |
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

**A page that shows records must not pull unless it also applies them.** The
launcher displays counts but owns no records, so it reads local storage and
calls `Sync.verify()` — which checks the token and nothing else. Giving it the
full loop would be worse than useless: a pull whose `apply()` has nothing to
apply still advances the cursor, so the apps would never see the rows it
skipped. Silent, and indistinguishable from the round never being logged.

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

Rotating the code = changing that account's password, which invalidates every
device's stored refresh token.

**What a rotated code does, precisely.** The next time a device syncs, its
refresh is rejected, `sync.js` drops the session and puts the gate back up — on
all three pages, launcher included. Two things make that reliable:

- *A rejection is not the same as being offline.* Both fail to produce a token,
  and they need opposite responses: offline keeps the session and retries,
  rejected clears it. Only an explicit 400 or 401 counts as rejected; a paused
  project or a 5xx stays offline, because a false positive throws a code prompt
  at somebody halfway through a round.
- *A 401 on a data call expires the token locally.* Otherwise a device whose
  token was invalidated server-side sits on "can't reach the server" until its
  own clock says the token expired — up to an hour.

What a rotated code **cannot** do is erase records already on a device. Those
stay in local storage and reappear when someone signs in again. Wiping them
would make a false positive destroy unsynced work, against the rule that local
storage is the primary copy. A lost tablet is a device-level problem.

There is also a sign-out control on every page, so re-entering the code is
possible on purpose rather than only by clearing site data.

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

`dev/fake-supabase.js` speaks the same auth and REST dialect as the real project
and serves the site on `localhost:8200`, so the suite never touches production
data. It can also fake a paused project and flaky writes.

One-time setup. Node and Playwright are development-only — nothing shipped
depends on them, and `node_modules` is gitignored because Pages serves
everything in this repo:

```
cd dev && npm install && npx playwright install chromium
```

Then from the repo root:

```
node dev/fake-supabase.js &
node dev/synctest.js       # 20 checks: sign-in, two devices, offline, paused
node dev/conflicttest.js   # 10 checks: no churn, contested edits, retries
node dev/e2e.js            # 14 checks: legacy migration, backup merge
node dev/homecheck.js      # 48 checks: the gate, the fleet, card figures, a rotated code
node dev/cursortest.js     #  6 checks: one pull cursor per app, not per device
node dev/facilitytest.js   # 27 checks: facilities in Glass, ids scoped without a migration,
                           #            and the glass bound to a sheet rather than a building
node dev/layouttest.js     # 19 checks: the renderer draws a layout, not Conway
node dev/layoutsynctest.js # 20 checks: a built rink crosses devices as its walk
node dev/gentest.js        # 14 checks: the generator reproduces Conway's survey
node dev/buildertest.js    # 42 checks: walking a rink in, what it writes, and the way back off it
node dev/reg.js            #  8 checks: rounds persist, prefs stay separate
node dev/resume.js         #  9 checks: coming back lands where you left off
```

124 checks in all. Tests point `window.__SYNC_CONFIG__` at the fake via
`addInitScript`; the real pages never read it.

**Seed a session the fake server actually issued.** A made-up token takes a 401
on its first data call, which expires it locally and re-gates the device. That
is correct — it is what makes a rotated access code bite — but the gate then
covers the page and every later click in the test fails on "sync-gate intercepts
pointer events", which reads like a dozen unrelated failures. `seedSignedIn()`
does a real password grant and keeps what comes back.

**A device that must not sync needs a dead port, not a bad token.** `e2e.js`
device B exists to prove a *backup file* merges two separate machines. Sign it in
properly and it pulls A's records down before the import, so the merge under test
does nothing. Point it at `localhost:8299` instead: it keeps a session, so no
gate, but it can never reach a server.

## The launcher

`index.html` is where you say which rink you are at; the tool comes second. You
are *at* a rink doing work there, not hopping between arenas mid-task. It shows
the fleet Ice's home screen shows — every live sheet, when it was last walked,
and whether that is overdue.

**It still never pulls, and writes no synced record.** The one thing it writes
is `ice_v4_prefs`, which is device-local and excluded from sync by design:
which sheet you are looking at is exactly the fact that should not drag another
device's view around. Ice then opens on that sheet because it already restores
from those preferences. The write is read-modify-write, because theme, units and
which screen Ice was on live in the same object.

**Overdue is Ice's rule, not a second one.** The last session that actually has
readings in it, older than `overdueDays` — 7 by default, and read from those
same preferences. An empty session is a sheet nobody has been to yet. Two
screens computing this differently would disagree about what is behind.

**One sheet is not a choice.** The section hides itself below two, because a
mandatory "choose where you are" step for a one-rink operation is friction
wearing the costume of structure.

**Nothing renders before the gate.** That already mattered for the card
figures; the fleet is worse, because it names every facility outright.

**Where you are and how the sheet is doing are two chips, not one.** They were
one, and standing on an overdue rink was then the thing that hid it was overdue.

The Glass card no longer claims 127 pieces whatever rink you have — that is
Conway's figure and it was written into this page. Glass writes a piece count
per rink into its own storage for this page to read, and a device that has not
opened Glass since that shipped says nothing rather than guessing.

---

## Glass layouts

**The renderer draws a layout, not Conway.** A layout is everything needed to
draw one rink: `rink` dimensions, the `panels` run, `meta` from the survey,
`glassHeight`, the names of its four `edges`, an optional `zamDoorLabel`, and
the page `copy`. Conway's is `LAYOUTS.legacy`, built from the embedded `DATA`
blob plus the strings that used to be written into the drawing code.

Conway's specifics did not disappear in G2 — they moved into its layout. That
is what let the change be verified by rendering: the output is byte-identical
apart from the plan's `aria-label`, which now names the facility.

`useLayout(bucket)` reassigns `L, W, R, GLASS, SEC_ORDER, META, LAYOUT` in one
place. Every drawing function closes over those, so switching rink costs one
call rather than threading a layout argument through all of them.

Three things follow from the sheet rather than being written down: the
`viewBox`, both overall dimension texts, and the four edge labels. `SEC_ORDER`
is the order sections are first walked in, so it cannot drift from the panels.

**Markings are drawn only on a regulation sheet.** Goal lines scale with `L`,
but blue lines sit at ±25 ft and faceoff spots at ±69/±22 — fixed distances, not
proportions. Stretched onto a shorter sheet they would draw lines that are not
painted on that ice. Anything other than 200×85 gets its outline, its panels and
a centre line.

**Anything a rink might not have is guarded.** The Zamboni callout was
`GLASS.find(p => p.tag === 'zamdoor')` dereferenced immediately; a rink whose
gate is tagged differently threw there and took the whole plan down with it,
not just the label. Openings are counted from the run instead of assumed to be
two benches, and the uniform-joint row appears only where a survey supplied one.

### Sending a rink: the walk, not the drawing

A generated layout is around 60KB — a panel per piece, each carrying an SVG
path, label anchors and arc-length positions. None of it travels.
`generateLayout()` is deterministic, so the roughly 2KB spec that produced it
redraws the same rink anywhere. `glass_layout` holds that walk — dimensions,
corner radius, origin, glass height, where the walk began, and the stretches
with their pieces — and every device regenerates the panels from it. Devices
store the walk too, under `specs`, and redraw on load.

`layoutFromSpec()` is the single way in. `bldSave()` goes through it as well,
rebuilding from the spec rather than keeping the preview it already had, so a
rink saved locally is exactly what every other device will draw from the
record. `layoutsynctest` asserts the strong form: two devices' panel runs hash
identical when only the walk was ever sent.

Three things follow that are worth knowing:

- **Conway is never sent.** Its layout is compiled into this file, so
  `collect()` skips `legacy` and `apply()` ignores any record claiming to be
  it.
- **A malformed spec is skipped, not fatal.** `tryLayout()` swallows the
  throw, because one bad record must not take down a pull that is also carrying
  good ones.
- **Rinks built before this shipped cannot be sent.** They have only the
  drawing, no walk. They are held under `built` and written back untouched so
  a save cannot drop them, and they stay on the device that made them until
  that rink is walked again.

### Switching rink, and a spec strip that follows

`bldSave()` moves to the rink it has just made. Until the picker existed
nothing could move you off it again short of clearing site data, which made the
builder a one-way door.

`fillRinks()` lists every layout the device holds and hides itself below two,
because a mandatory "choose where you are" step for a one-rink operation is
friction wearing the costume of structure. `switchRink()` writes through
`Store.set` rather than `store()`: looking at a different rink changes no
record, so it should neither nudge sync nor claim a save.

Three figures in the spec strip — sheet size, corner radius and glass in run —
were Conway's, written into the markup, and stayed Conway's on any rink you
switched to. They are read from the layout now. Derived that way they reproduce
Conway's own strip character for character, which is how the change was checked
and what `buildertest` asserts.

### Glass belongs to a sheet, not a facility

An arena with two ice surfaces has two sets of glass, two schedules and two
condition records. Conway has one sheet, so binding the panels to the
*facility* was indistinguishable here and wrong at any multi-surface site —
which is why it survived G1 unnoticed.

`glass_binding` therefore names a `sheetId`. The indirection G1 introduced
absorbed the correction exactly as intended: no panel record moved, and no row
on the server was rewritten.

Two things make the change safe on devices that have not caught up:

- **The record carries `facilityId` beside `sheetId`.** A device still on the
  facility-bound build reads a binding it understands, rather than seeing an
  empty one and re-binding on its own timestamp.
- **A facility-only binding is held pending, not guessed at.** Whether it comes
  from the server or out of this device's own storage, it resolves to that
  facility's first surface by `ord` once the sheets are known. Every device
  reaches the same answer from the same records, so the old row is left alone —
  and `ensureBinding()` will not pick a different rink while one is pending.

The name over the plan is the facility's. The sheet's name is appended only
where that facility has more than one surface, so Conway still reads
"Conway Arena" and not "Conway Arena - Main sheet".

---

## Known open items

- **Zamboni end, panel 111.** A 43″ panel inferred to close a 43½″ shortfall,
  drawn dashed and flagged in the schedule. Never confirmed on site. Either a
  missed panel or the Zamboni doorway is wider than its two 57½″ leaves.
- **Glass Manager on a phone** has not been looked at. Desktop and tablet are fine.
- **Ice app has no "marked by" field.** Glass does. Worth adding for parity —
  attribution without individual logins.
- **No realtime.** Sync happens on open and on focus. Supabase realtime would
  make the desktop update while you watch; not needed so far.
- **A built rink is not an ice surface yet.** The builder writes a Glass-only
  rink — a layout and a local name, with no `facility` or `sheet` record
  behind it, so Ice knows nothing about it and its glass hangs off a bucket id
  rather than a sheet. Adding a rink is really adding an ice surface and should
  write those records too, which belongs on the launcher rather than in Glass.
