# Arena Management System — how it works

Static site on GitHub Pages: `seadapps.github.io/ice-measurement/`.
No build step, no framework, no dependencies. Edit a file, push, done.

```
index.html    the shell's page: loads shell.js and home.js and mounts them (D2)
shell.js      the shell: address, chrome, the one writer of where you are
shell.css     the Ice Board look for the chrome and its pages
home.js       the shell's pages: Facilities, Sheets (holding pages for settings and Staff)
launcher.html the old launcher, unlinked, kept as a fallback until D5 deletes it
ice.html      Ice Manager  — thickness rounds, contour map, trends (multi-facility)
glass.html    Glass Manager — 127 rink glass panels, condition record
sync.js       shared: Supabase auth, pull/push, the access gate, the status pill
records.js    shared: the v4 record store — decompose, merge, reassemble, prefs
sw.js         service worker — offline + cache strategy
manifest.json icon-192.png icon-512.png
.github/workflows/keepalive.yml   pings Supabase so the free tier never sleeps
supabase/     the server side of the people-and-access work: SQL, the manage-staff function, a README
dev/          the test suites and the fake Supabase they run against (development only)
```

Both apps are single files. `sync.js` and `records.js` are the shared code —
the network, and the store.

**Pages serves everything in this repo, `supabase/` and `dev/` included.** The scripts
there are meant to be readable, but they must never hold a real code, a key other than
the public anon key, or a filled-in copy of `d1-03-first-manager.sql`.

---

## Where the store lives

`records.js`. It was inside `ice.html`, which was fine while Ice was the only
page holding facilities. It came out when the launcher needed the same records
— and it came out because duplication had already appeared: the launcher had
re-implemented the facility/sheet/session join and Ice's overdue rule, under a
comment saying it had to match. A comment is not a compiler.

**What each page may do is the API, not a convention.** The store draws the
line that ARCHITECTURE.md used to draw in prose:

| call | what it does |
|---|---|
| `Repo.read()` | reads and joins. Never writes, never migrates. |
| `Repo.load()` | what Ice boots on: also migrates off `ice_sheet_v3`, which is a write. |
| `Repo.savePrefs(patch)` | device preferences only — never a synced record. |
| `Repo.addSheet(opts)` | adds an ice surface, and a facility if it is a new site. |
| `Repo.save(state)` | the whole state, records included. |
| `Repo.maps()` | the per-kind maps as last written: what sync collects. |
| `Repo.persistMaps()` | write those maps as they stand, for a page that merged records but holds no nested state to hand `save()`. |

The launcher uses the first three. That it cannot write a synced record by
accident is now a property of what it is able to call rather than of somebody
remembering the rule — and `homecheck` asserts it directly, including that
opening the launcher on a device holding only the old blob does not migrate it.

`Records.Store` is the storage wrapper all three pages had their own identical
copy of, and the constructors — `newSheet`, `newFacility`, `RINK_SIZES`,
`defaultSettings` — are in here for the same reason: a sheet the launcher made
has to be indistinguishable from one Ice made.

**`addSheet()` is a method rather than something the page assembles**, and the
reason is `save()`. It stamps against the snapshot of what was last written,
so a write built on `read()` — which deliberately leaves that snapshot empty —
would hand every record on the device a fresh `updatedAt` and make it look
newest on all of them. That is the clobber the record store exists to prevent,
and nothing on screen would show it until another device lost work. A page
cannot get the sequence wrong if it never performs it.

The other trap it closes: **a sheet must be created with a session in it.** Ice
reaches straight for `sheets[0].sessions[0]` when it boots, so a sheet with no
round would take the app down rather than merely look odd.

**A round is one somebody walked** — `Records.hasReadings()`. Every new sheet
is created with an empty session, and counting those made the launcher's Ice
card read "last round today" beside a fleet row saying "no rounds yet" about the
same sheet.

---

## The data model, and why it is shaped this way

**Read this before changing how anything is stored.**

Everything is a **record**: `{id, ...fields, updatedAt, deleted}`. Records live in
per-kind maps in local storage, and each carries its own timestamp.

| kind | local key | notes |
|---|---|---|
| `facility` | `ice_v4_facilities` | name, settings |
| `sheet` | `ice_v4_sheets` | `facilityId`, `size`, and `shape` once migrated (see *One shape per sheet*) |
| `session` | `ice_v4_sessions` | `sheetId`, date, mode, `data` (readings), `notes` |
| `glass_panel` | `glass_record_v2` | status, note, at, and `label`/`tag` where somebody has changed them. Who marked it is the server's stamp (`changedBy`); `by` survives only on marks from before it was retired |
| `glass_binding` | `glass_record_v2` | `sheetId` — which ice surface the Conway panels are the glass for |
| `glass_layout` | `glass_record_v2` | the walk a built rink was made from; the drawing is regenerated |
| `glass_spare` | `glass_record_v2` | one **movement** of spare glass in or out, against a facility — not a stock level |
| `glass_widths` | `glass_record_v2` | the builder's one-tap widths for a facility, id = the facility id; reads 43 and 48 until somebody changes it, and no record exists before then |
| — | `ice_v4_prefs` | **device-local, never synced** |

**Settings are read through `Records.settingsOf(settings, prefs)`.** It gives a facility's
settings as they will be once migrated: band edges, flood and shave rounded *up* to the
next eighth (a reading is one of sixteen labels in eighths, so this keeps every reading in
the band it is in now; the defaults become 3/4, 1 1/2, 1 5/8, 2), the target to the nearest
eighth, `overdueDays` from the facility, then the device preference, then 7, and
`settingsVersion` 2. It writes nothing and is idempotent, so a Staff device (which may not
write a facility) and a Management device that has not migrated classify identically. Pages
read through it (`EF()` in Ice); `Records.upgradeSettings(settings)` brings one facility's
stored settings across in place and runs on the first real edit, so a stepper never writes one
new number beside three old ones; `Repo.previewSettings()` / `backfillSettings()` and the
server scripts `supabase/d3-01a`/`d3-01b` migrate in bulk. The one thing rounding up cannot
keep is an edge above 2 inches against the legacy "2+" label (counted as 2.1).

A facility's `settings` (and its `edges` array) are detached from the snapshot like a round's
`data` and `notes`. Until that was done, editing a target or band edge made `save()` compare
an object with itself, so the facility was never restamped and the edit reached no other
device until something else about the facility changed.

**Restoring a backup is Management's.** `Sync.canRestore()` is true when nobody is
signed in as a person yet (the shared account carries the data, rollout step 3) or when
the person's scope is `*`, and false otherwise, including while a person's scope has not
been fetched. Ice's *Restore from backup* and Glass's *Load record* check it on the
button and again on the chosen file, say `Sync.restoreMessage`, and merge nothing. A
backup can hold any facility, and the server would refuse a Staff person's writes to
the ones they were not given record by record.

**Hidden sheets keep their rounds.** A hidden sheet is not in anyone's state, so neither are its
rounds, and `save()` treats whatever is missing from the state as deleted. `save()` therefore
carries over, untouched, every round whose sheet is hidden; without that, the next page that saved
(Ice, say) tombstoned every reading on the hidden sheet. `removeSheet` itself bypasses `save()` for
the same reason.

**Records are compared with their keys in a fixed order.** Postgres `jsonb` does not keep the order
keys were written in (it sorts them by length, then bytes) and PostgREST returns them that way. Compared
as written, the first save after a pull saw every facility and sheet as changed and restamped the lot,
which no test could see because the fake server kept insertion order. `bodyOf` now canonicalises key
order, and `dev/fake-supabase.js` returns bodies in `jsonb` order so a regression shows.

**Seeds.** A device with no records invents a facility, a sheet and a round
(`freshState()` in `ice.html`) so there is something to draw. That is where it
starts, not something anybody observed, so `Repo.save(state, {seed:true})` marks
the three records `seed`. The mark is never part of a record's content (`bodyOf`
ignores it), survives saves only while the record is unchanged, and goes with the
first real edit. `Repo.outgoing()` is what sync collects: it leaves out any
facility tree (facility, its sheets, their rounds) in which every record is still a
seed, and strips the mark from the rest, so one real edit sends the whole tree and a
round never arrives under a sheet the server has not seen. `Repo.merge()` drops an
untouched seed tree as soon as incoming data contains a live facility. Before this a
fresh device pushed its invention before its first pull and every device's list
gained a phantom "Main facility". Anything new that can fabricate a record on a
device must go through the same mark.

Every record also carries `fac` (the facility it belongs to) and, coming back from the
server, `changedBy`. Both are metadata the comparison in `bodyOf()` ignores: see
*Access, people and the activity log*.

### Why not one blob

The ice app originally stored its entire state under one key. Every save
rewrote everything. That is fine for one device and fatal for two: the iPad
logs a round, the desktop saves later from its stale copy, the round is gone —
cleanly, silently, no error.

Splitting into records with individual timestamps is what makes merging
possible. **Don't collapse it back.**

### The snapshot has to be a snapshot

`SNAP` is "the records as last written", and `save()` decides what changed by
comparing it against a fresh `decompose()` of the live state. That only works if
the two are genuinely separate objects.

They were not. `Object.assign({}, z, …)` copies a session's nested `data` and
`notes` maps **by reference**, so the snapshot pointed at the very object Ice
goes on to mutate. `bodyOf(prev)` and `bodyOf(next)` then serialised the same
object, `stampChanges` saw no change, and the record's `updatedAt` never moved —
so the sent-map still matched and push skipped it.

**A round was stamped once, when it was created, and never again.** Every reading
typed after that moment stayed on the device: the round reached the other
devices, the numbers in it did not, and the device that took them looked
perfectly healthy. Flat fields (`name`, `date`, `mode`) copy by value, which is
why renaming a sheet always worked and only the nested maps went missing — and
why this survived so long.

`detach()` copies those maps on the way into the snapshot and on the way back out
of `reassemble()`, so neither side can reach the other's. If you add another
nested map to a record, it belongs in `detach()` too, or it inherits the same
silence. `synctest` pins the whole chain, in the order that matters: sync the
round while it is empty, *then* enter readings, then look at what crossed.

### The merge rule

Newest `updatedAt` wins, per record. One exception: for `session` records the
`data` and `notes` maps are merged **key by key**, so two people logging
different spots in the same round both keep their work. Only a genuine
collision on the same reading falls back to newest-wins.

Deletes are **tombstones** (`deleted: true`), never row removal — which is why
there is deliberately no DELETE policy in the database. A mistaken delete stays
recoverable.

### Spare glass is a ledger, not a number

Two decisions, and both are the opposite of the obvious one.

**Stock hangs off the facility**, where panels hang off the sheet. G1 moved
glass onto sheets because an arena with two ice surfaces has two sets of glass,
two schedules and two condition records. Spare stock is not like that: it sits
on one rack in one building and gets fitted to whichever surface breaks. So
`glass_spare` carries a `fac`, and `activeFacilityId()` reaches it through the
sheet — or through the binding, for Conway. Where that is not known yet the card
says so rather than inventing a shelf, because a movement written against a
guessed facility is wrong on every other device.

**A level is never stored.** Each receipt or fitting is its own record —
`{fac, w, h, thk, qty, note, by, at}` with `qty` signed — and the level is their
sum. This is the important one: *a quantity is the single shape this record model
merges badly.* Newest-wins on a number means the iPad taking 3 → 2 and the
desktop doing the same from its own copy merge to **2 rather than 1**, and
nothing on screen would ever show it. That is precisely the silent-loss failure
the record store exists to prevent, reappearing in a new place.

Movements only ever appear, so summing them is right however they arrive, in
whatever order, on any number of devices. Correcting a mistake is another
movement; undoing one is a tombstone, never a deletion, or the next pull hands
it straight back. `sparestest` drives the two-device case directly and asserts
the shelf lands on 1 — if that check ever goes red, the design has been undone
rather than a detail broken.

A size is width **and** height **and** thickness **and** material. Conway carries
33" and 14.5" in both 1/2" and 5/8", a 1/2" pane will not fill a 5/8" hole, and
the shelf holds both tempered and plexi — which are not interchangeable. Plexi is
what goes in to keep the game on while the real pane is on order.

So **plexi never counts as cover.** A flagged pane wants tempered, because that is
what the rink is glazed in; counting a plexi sheet as cover would tell somebody
not to order glass they are going to need. It is reported alongside instead —
*"1 to order · 2 plexi to patch with"* — since knowing tonight's game is safe is
worth saying. A movement written before materials existed carries none and is read
as tempered, which is what the shelf held; nothing was rewritten to make that true,
and a device on the older build reads a plexi movement as tempered, overstating its
glass rather than losing the record.

**Fitting a pane deducts it, and the event is a transition.** `replace` means
*needs* replacing, so the moment glass actually goes in is the one where a
flagged panel returns to `ok` — clearing plexi included, since real glass
replaced the patch. `set()` compares the status it had against the one being
written and calls `autoFit()` only on that edge, so editing the note of a panel
that is already good deducts nothing.

**Which pile it comes off follows the same transition.** Back to `ok` is the real
fix, so that is tempered; going to `plexi` is the stopgap, and that takes a plexi
sheet. Both are real fittings out of different piles, which is why the
once-per-day guard is per panel *per material* — a pane patched in the morning
and glazed properly in the afternoon is two deductions, not a double.

The risk in deducting rather than offering is a flag cleared because it was
raised in error, which is not a fitting. The answer is that it is never silent:
it says what it did, the movement sits at the top of the card marked `auto`, and
retracting it is one click. Two guards sit under it — the shelf is never taken
negative (no spare of that size means the glass came from somewhere other than
the rack, so the ledger stays true to the rack), and the same panel is not
deducted twice in a day, which catches the realistic double of clearing,
re-flagging and clearing again. Two devices clearing the same panel before
either has synced will still record two fittings; that one is visible and
retractable, which is the whole reason stock is a ledger rather than a number.

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

**Auth began as one shared account** — `operations@conwayarena.local` — and is now
three layers (see *Access, people and the activity log*, below). What follows is
still true of the shared account and of rotating its code. The access code
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

## Access, people and the activity log

This replaces "one shared account" as the whole story. The shared account is
still there, but it is now only the first of three layers. The scripts that put
this on the real project are in `supabase/` (read its README first); everything
below is what the client and the fake server in `dev/` already do.

### Three layers

1. **The access code** — the shared account's password, as before. After it, a
   device holds a session that can do exactly one thing: ask `staff_names()` for
   the list of people. It reads no record.
2. **Who are you?** — each person is a real auth user whose email is
   `<login>@staff.conwayarena.local` and whose password is their own generated
   code. Their session replaces the shared one as the thing that reads and writes
   data. `Sync.person()` says who, `{id, name}`; `id` is the login.
3. **The editing code** — a shared code entered from "Unlock to edit". The server
   opens a one-hour window for that person (`unlock_editing`), extends it while
   they work (`extend_editing`) and closes it on Switch user and Sign out
   (`lock_editing`). Outside a window the server refuses every write, Management
   included. A wrong code answers 403, and five wrong tries in ten minutes block
   the next.

Until anyone has been given a login, the shared account carries the data exactly
as it always did — `staff_names()` returns nothing and the gate skips step 2. That
is how the rollout begins, and why the older suites needed no change. While no
person is signed in each sync asks whether people exist yet; once they do, the
shared session steps back to being the device's and the gate asks who is using it.

**`tight`** is one setting on the server (`app.settings`). Until it is true the new
row rules behave exactly like the old ones, and flipping it is the only step that
cannot be undone quietly for devices on the old build. `supabase/d1-04-untighten.sql`
flips it back.

### What the server stamps, and what the page may not

`changed_by` and `changed_by_name` are filled in by a trigger from the session, so
a page cannot claim to be someone else, and a `changedBy` smuggled into a record's
body is thrown away. They come back on every pull as `changedBy`.

**`changedBy` is not content.** It arrives with every pulled record, like
`updatedAt`. `bodyOf()` in `records.js` and `changed()` in `sync.js` both ignore
it, and `stampChanges` carries it forward. Count it, and every pull looks like an
edit, every device re-sends what it just received, and the server restamps the
lot — the clobber this whole design exists to prevent, with nothing on screen to
show it. `stamptest` pins it, and was run red first with only the pull changed.

**The typed name is gone.** Glass used to write whatever was in its "Marked by" box
into `by`. It now shows the signed-in name read-only and writes `changedBy` locally
for display; the server's stamp is the truth. A mark from before keeps its typed
`by` for display and is not claimed by whoever pulls it. `Sync.who()` and
`rink_who` no longer exist.

### Facilities: the tag, and who sees what

Every record carries `fac`, the facility it belongs to, and the server copies it to
a `facility_id` column. A Staff person sees and writes only the facilities they were
given; Management sees all of them, including ones created later; a record with no
tag is Management's alone. A Staff person cannot rewrite another facility's record
by re-tagging it, and cannot write a `facility` or `sheet` record at all.

`fac` is **derived from where a record sits**, so `bodyOf()` ignores it too. If it
counted, the first save on any device would restamp every record it holds, and a
device with a stale copy would then look newest on all of them. A record picks up
its tag when next really edited; the Management backfill
(`supabase/d1-02a`/`d1-02b`) tags the rest without moving a timestamp.

**The pull cursor is per person and per set of facilities.** A cursor only moves
forward, so a record the server hid from this person when it passed would never be
offered again — giving someone a facility later, or handing a device to a second
person, would miss everything older than where the cursor stood. The key is
`rink_sync_cursor:<kinds>:<personId>:<scope>`, where scope comes from
`my_facilities()` (`*` for Management). A change of either starts one fresh pull,
which is safe: pulling what is already held changes nothing.

### The activity log

Records keep only their latest version, so the `activity` table is the only place a
"before" exists. A trigger writes one row per insert or update — kind, id, facility,
who, when, old and new body — and nothing, not even Management, can update or
delete one. It is not a record: it is read with `Sync.activity(filters)` and never
passes through the sync loop, so reading it cannot make anything look edited.
Management only. A refused write leaves no row.

### Changing hands

On a shared iPad the server stamps a write with whoever's session sends it. That is
right when people send their own changes and wrong if Dana edits offline and Pete
signs in first. So Switch user, Sign out and the idle sign-out (an hour with no
input; a device left closed past it signs the person out on opening) all go through
`handOver()`:

- Online, the leaver's changes are sent first, under their name.
- Otherwise the screen locks in place and their session stays on the device,
  send-only (`rink_departed`). It sends on reconnect — even with nobody signed in —
  then closes their editing window and is discarded.
- **Which changes are whose is recorded exactly**: each hand-over claims the
  unsent records by key *and timestamp*. Comparing times would misattribute
  a record somebody else edits afterwards, or when two people leave in a row.
- If their window ended while they were away their changes wait, and are never
  sent in anyone else's name. They go when that person signs back in and unlocks.
  A removed person's claim is the one exception: it drops, and the changes go out
  under whoever is signed in, rather than being lost.

### The editing lock in the pages

The server is what refuses; the pages only stop offering what would be turned away.
While a person is signed in without an open window, `Sync.lockControls(selectors)`
greys the controls a page lists and a tap offers the unlock dialog instead. Pages
list **selectors**, not elements, because Glass rebuilds its panel card on every
selection. With nobody signed in nothing is locked.

### One shape per sheet

A sheet holds `shape` — length, width, corner radius in feet and inches, where the
glass walk starts, which way the building faces — and Ice and Glass both draw from
it. The standard corner is **27′ 2″**: Ice's presets used 28′ while the glass survey
of Conway solves to 27′ 2″, so the two disagreed about the same ice.

An old sheet is *read* as though it had a shape (`Records.shapeOf`) and only gains
one when deliberately migrated or edited, for the same reason `fac` is not derived
on write. The old `size` stays on the record, in step, for a device on the older
build. `Repo.previewShapes()` shows what a migration would do, `backfillShapes()`
does it. `Repo.updateSheet(id, {name?, shape?})` is the one way a sheet's own fields
change (the Sheet settings page, D2): it validates everything first and applies
nothing if any of it is bad, saves through `load()`/`save()` so only that sheet is
restamped, and keeps `size` in step. `updateShape()` is a shape-only call to it, what
the glass builder uses after comparing its own measurement (`compareShape()`) with
the sheet's.

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
data. It can also fake a paused project and flaky writes, and — for the access work —
people, per-person sessions, the editing window and its throttle, the facility rules,
the activity log and a removed person refused with 403 (`/__staff`, `/__ctl?tight=1`,
`softremove`, `clearfailures`, `/__unlocks`, `/__activity`). By default it behaves as
the real project does before step 5, so the older suites run unchanged; `tight=1`
turns the new rules on. **It is the only test bed the SQL in `supabase/` has had.**

One-time setup. Node and Playwright are development-only — nothing shipped
depends on them, and `node_modules` is gitignored because Pages serves
everything in this repo:

```
cd dev && npm install && npx playwright install chromium
```

Then from the repo root:

```
node dev/fake-supabase.js &
node dev/synctest.js       # 26 checks: sign-in, two devices, offline, paused, and the readings inside a round
node dev/conflicttest.js   # 10 checks: no churn, contested edits, retries
node dev/e2e.js            # 15 checks: legacy migration, backup merge, the scoped home screen
node dev/homecheck.js      # 78 checks: the gate, the fleet, adding a rink, syncing, a rotated code
node dev/cursortest.js     #  6 checks: one pull cursor per app, not per device
node dev/facilitytest.js   # 32 checks: facilities in Glass, ids scoped without a migration,
                           #            and the glass bound to a sheet rather than a building
node dev/layouttest.js     # 40 checks: the renderer draws a layout, and notes come off it - through the card, not just through set()
node dev/layoutsynctest.js # 24 checks: a built rink crosses devices as its walk, and goes back off
node dev/gentest.js        # 19 checks: the generator reproduces Conway's survey, either way round
node dev/buildertest.js    # 72 checks: walking a rink in, what it writes, the surface it hangs off, removing it
node dev/reg.js            # 14 checks: rounds persist, prefs stay separate, the switcher is reachable
node dev/resume.js         #  9 checks: coming back lands where you left off
node dev/phonetest.js      # 42 checks: no page scrolls sideways on a phone, tapping a panel shows it, and the desktop is untouched
node dev/scheduletest.js   # 31 checks: the schedule opens on what needs attention, and print still carries all 127
node dev/sparestest.js     # 46 checks: spare stock is a ledger per facility, tempered and plexi are different piles, and fitting a pane deducts the right one
node dev/stamptest.js      # 25 checks: the server stamps who changed a record; a pulled stamp never looks like an edit
node dev/authtest.js       # 57 checks: the two-step gate, a rotated code, a removed person, first sign-in offline, the rollout
node dev/editlocktest.js   # 62 checks: writes refused until the editing code; the window ends, extends, closes; the unlock button
node dev/scopetest.js      # 53 checks: a Staff person sees and writes only their facilities; the tag; the per-person cursor
node dev/activitytest.js   # 48 checks: one log row per write with old and new, append-only, Management only
node dev/handovertest.js   # 40 checks: changing hands on a shared iPad, offline, and the idle sign-out
node dev/shapetest.js      # 69 checks: one shape per sheet, the migration, the builder's compare and update, updateSheet
node dev/controlstest.js   # 35 checks: edit controls lock until unlocked; what only reads stays open
node dev/whotest.js        # 19 checks: nobody types their name; the server's stamp is shown
node dev/seedtest.js       # 20 checks: a fresh device's invented facility is a seed: never sent while untouched, sent whole when edited, dropped when real ones arrive
node dev/bandmigrationtest.js # 31 checks: eighths keep every reading in its band (15 readings, defaults and 2,000 random edge sets); the migration; a settings edit reaches the server
node dev/overduetest.js    # 16 checks: overdue days belong to the facility; Ice and the launcher agree
node dev/routetest.js       # 40 checks: the shell's addresses, back/forward, a Staff person and a shared iPad, the apps follow where you are
node dev/shelltest.js       # 91 checks: the chrome at 390/820/1024/1280, breakpoints, menus, theme, tab bar, rail
node dev/facilitiestest.js  # 45 checks: Facilities and Sheets agree with Ice, trends, adding, nothing restamped, an empty device, people
node dev/backuptest.js      # 44 checks: backup and restore from the account menu, merging, old files, units, Ice and the shell make the same file, Staff cannot restore and never export what they may not see
node dev/settingstest.js    # 68 checks: Sheet settings writes name and shape and nothing else; draft, validation, glass check, Staff read-only, remove and undo; Ice draws the new outline
node dev/restoretest.js    # 12 checks: restoring a backup (Ice) or a record file (Glass) is Management's; Staff are told and nothing merges
node dev/widthstest.js     # 25 checks: a facility's one-tap widths (default 43/48, no record until changed); only Management resolves or reopens a flag
```

848 checks in all. Tests point `window.__SYNC_CONFIG__` at the fake via
`addInitScript`; the real pages never read it.

**Lessons from the access work, each of which cost a debugging session:**

- `Sync.sync()` does not resolve while the gate is up, because it waits for somebody
  to sign in. A test that expects a gate must fire it and sleep, not await it.
- The fake server shares the page's origin, so the service worker's cache-first rule
  answers a repeated identical pull from cache. Production is cross-origin and the
  worker leaves it alone, so the newer suites open their contexts with
  `serviceWorkers: 'block'`.
- A suite that edits as a signed-in person must lift the editing lock first
  (`document.body.classList.remove('sync-locked')`), as the suites about sync do;
  `controlstest` is the one that tests the lock itself.
- A fresh device's invented facility is a seed (see *Seeds*): it is not sent until it is
  really edited and is dropped when real facilities arrive, so a test that needs the
  device to *use* its own facility must make a real edit first. Tests that judge "who last
  changed X" still look a sheet up by id rather than taking the first.

**Run them one at a time.** They share the one fake server, and several assert
what the server is holding — `synctest` prints its record count and checks it.
Two suites at once against `:8200` fail each other in ways that look like real
bugs and do not reproduce on a re-run.

`phonetest` is the only suite that does not drive a 1280x900 window, which is
how Glass came to ship a page that scrolled sideways by 121px at 390px: every
other suite would have had to be looking at a phone to see it.

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

## The shell (D2)

`index.html` is a thin page; `shell.js` mounts into it and `home.js` draws the pages. It
replaces the launcher, which lives on as `launcher.html` (unlinked, still tested by
`homecheck`) until D5.

- **The address is the truth.** `#/` Facilities, `#/f/FID` that facility's sheets,
  `#/f/FID/s/SID` the same with that sheet in hand, `#/f/FID/s/SID/settings` and `#/staff`
  (holding pages until D2b). An address that names nothing, or something this person was not
  given, lands on Facilities with the one message "That page is not available." and the address
  is corrected; it never says which, so it does not reveal what exists.
- **Where you are** is a device preference (`activeFacility`, `activeSheet`, `activeSession`)
  and the shell is its only writer, through `Repo.savePrefs`. Opening a facility or sheet
  address writes it; Facilities does not. Ice and Glass still read it from the preference;
  mounting the bar inside them (and reading the address there) is the last D2 step.
- **Layout follows the width**: up to 560 phone (tab bar, one context button), 561 to 1100 iPad
  (the full bar), 1101 and up laptop (the bar plus a rail). `Shell.layout()` /
  `Shell.onLayout()` / `Shell.breakpoints` are for D3 and D4 to ask.
- **Nothing about the rinks is read or drawn before the gate is passed**, and the shell never
  invents a facility: an empty device shows an empty Facilities page until the first pull.
- **Hiding by person**: `Sync.canSee(facilityId)` filters every list, the menus, the rail and
  the addresses. It hides, it is not a boundary (the data may already be on the device).
  `Sync.canManage()` gates Add facility and Add sheet (Management, or nobody signed in as a
  person yet); they also grey until the editing window is open, like every edit control.
- **Reads and writes**: `Repo.read()`, `Repo.savePrefs()` and `Repo.addSheet()` only, so the
  shell cannot restamp a record by looking. `Records.trendOf()` and `Records.glassSummary()`
  are the shared readers behind the sheet rows; `Records.readingValue()` is the one reading
  parser (checked against Ice's on every label).
- **Sheet settings** (`#/f/FID/s/SID/settings`, reached from a button on each sheet row): the
  sheet's name and shape, entered once for both apps. It keeps a draft while the numbers are
  stepped and writes nothing until Save, which is one `Repo.updateSheet` (all or none). Corner
  in half-inch steps, a bad corner or an empty name stops the save, and a glass check says when
  the boards no longer match what the glass was built against (`Records.glassSummary().verified`
  against `Records.shapePerimeter`; Conway's survey is 523.36 ft). Read-only for Staff and for
  Management until the editing window opens; it redraws when the window opens or closes.
  Remove hides a sheet (`Repo.removeSheet`: a tombstone that keeps the sheet's whole record),
  never the last one in a facility, with an in-page confirmation and an Undo; Management can
  bring any hidden sheet back from a *Removed sheets* list on the Sheets page
  (`Repo.restoreSheet`, `Repo.readRemoved`).
- **The account menu** holds theme, units (inches or millimetres, the `unit` preference Ice
  reads), and the data: *Back up all data*, *Restore from backup* and when the last backup was.
  The work is in the store: `Repo.exportAll({only})` writes the format Ice has always written
  (`rink-ice-v4`, so a backup from either place restores into the other), leaves out an invented
  seed and every facility `only` rejects (the shell passes `Sync.canSee`: a file is the person's to
  send anywhere, so it never carries a facility they may not see, even if it is on the device);
  `Repo.previewImport(obj)` reads the record format and the older whole-state one and says what is
  in it; `Repo.importAll(obj)` merges, newest wins, readings inside a round kept from both. Restore is
  Management's (`Sync.canRestore`) and needs the editing window, and is confirmed in the page, not a
  browser dialog; messages are a toast on the body, which a redraw cannot take away. Ice's own
  backup buttons call the same functions. Glass's separate record file is still its own until D4.
- **Not yet**: the Staff page (D2b), and the bar inside Ice and Glass. The
  account menu, and the bar inside Ice and Glass. The Ice Board fonts are system stacks, so
  the app stays offline-capable and makes no outside request.

Suites: `routetest` (addresses, back/forward, Staff and the shared iPad, the apps follow),
`shelltest` (the chrome at 390 to 1280, menus, theme, tab bar, rail), `facilitiestest`
(cards and the Fleet table agree with Ice, trends, adding, nothing restamped, empty device,
people).

## The launcher (superseded by the shell; kept as `launcher.html` until D5)

`index.html` is where you say which rink you are at; the tool comes second. You
are *at* a rink doing work there, not hopping between arenas mid-task. It shows
the fleet Ice's home screen shows — every live sheet, when it was last walked,
and whether that is overdue.

**It syncs, and that reverses the rule this page was built on.** It was
read-only, and the reason was real: sync.js keeps one `rink_sync_sent` map per
device, and a pull whose `collect()` cannot report what the device holds leaves
every pulled row looking unsent — so the next push echoes them all back and the
server restamps the lot, which is exactly the clobber the record store exists to
prevent.

What made that unavoidable was this page having no record store of its own. It
shares Ice's now, so its `collect()` **is** Ice's, off the same maps, and pulled
rows get marked as sent. `homecheck` guards the hazard directly: after the
launcher pulls, an idle round must restamp nothing.

The half of the rule about writing had already gone when adding a rink moved
here. Keeping the other half had a plain cost that turned up in use: **a rink
added on the launcher never left the device until somebody opened Ice, and never
reached another device until somebody opened Ice there too.**

Which sheet you are looking at is still `ice_v4_prefs` and still excluded from
sync — that is a device's own view, not a shared fact. Ice opens on that sheet
because it restores from those preferences.

**Overdue is Ice's rule, not a second one.** `Records.lastRound()` and
`Records.isOverdue()` — the last session that actually has readings in it,
older than `overdueDays` (7 by default, read from those same preferences). An
empty session is a sheet nobody has been to yet. Both screens call the same two
functions, so they cannot drift into disagreeing about what is behind; before
the store came out they were two copies held together by a comment.

**One sheet is not a choice.** The section hides itself below two, because a
mandatory "choose where you are" step for a one-rink operation is friction
wearing the costume of structure.

**The Ice/Glass switcher is in Ice's workspace at every width.** It used to be
hidden below 1180px — exactly the width you are on standing in the rink whose
glass you want to look at, mid-round, on a tablet. The `≡` that shared that bar
is gone, and Ice's own entry in the switcher does its job instead: it was a link
to the page you are already on, so it goes back to the sheets. The bar loses a
button rather than the route home.

**Nothing renders before the gate.** That already mattered for the card
figures; the fleet is worse, because it names every facility outright.

**Where you are and how the sheet is doing are two chips, not one.** They were
one, and standing on an overdue rink was then the thing that hid it was overdue.

**Adding a rink is adding an ice surface.** It writes a `facility` and a
`sheet` — the records Ice owns — rather than the Glass-only rink with a local
name the builder produces. The control sits in the bar rather than in the fleet,
so it is still reachable on a one-rink device where the fleet hides itself.

The page still does not sync. Those records sit here until Ice next opens and
pushes them, which is the same moment you would be opening it anyway to walk the
new sheet. Giving the launcher its own sync attachment is a separate decision:
the shared store now makes a faithful `collect()` possible, but the rule that
keeps this page out of the sent-map has not been revisited.

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

### The launcher's choice scopes both apps

Where you are is one fact and the launcher owns it, so the apps follow it rather
than each offering their own way to set it.

**Ice's home screen is the facility you are standing in.** It listed every
facility, which was a second way to choose one and could disagree with the
launcher. The fleet is that facility's sheets, and the facility row names it
with a link back to the launcher to go somewhere else. Every facility is still
listed in **settings**, where they are renamed and deleted — an imported backup
brings facilities in, and they have to be visible somewhere.

**Glass's rink picker offers that facility's surfaces.** A bucket whose facility
cannot be worked out is left in rather than hidden — hiding something you cannot
classify is worse than showing it — and so is whatever is on screen, so the
picker never hides the rink you are looking at.

### Taking a rink's glass back off

Glass walked by mistake had no way off the device: the picker listed it for ever
and there was nothing to press. The picker has a ✕ for whatever it is showing,
except Conway — that layout is compiled into the file rather than walked, so
there is nothing to take off.

**It tombstones rather than drops.** The layout has been on the server, so the
other devices have to be told it is gone; forgetting it locally would only mean
the next pull handed it back. `LAYOUT_GONE` holds the removals, `collect()`
sends them, and `apply()` takes the rink off any device that receives one.
Panel records under that bucket are tombstoned with it, which is the one place
a scoped panel is ever removed rather than merely re-marked — Conway's never
are.

The ice surface itself stays. Deleting that is Ice's job, in settings, and is a
different decision: a rink whose glass was walked wrong still has rounds on it.

### Which way the building faces

Nothing recorded it, so a rink walked back in through the builder could come out
mirrored against the survey — Conway's benches are at the top of the plan, and a
rebuilt Conway put them at the bottom. The walk carries `turn` and `flip`, and
step 4 offers both, which is where you are already holding the drawing up
against the room.

`orientWalk()` applies them **to the walk, not to the finished drawing**. Every
coordinate a panel carries — its outline, its label anchors, the angle its text
sits at — comes off `walk()`, so that is the only place it has to happen. Arc
lengths do not change, so the sections, the joints and the closing error are
untouched: it is the same rink, drawn the other way round, and `gentest`
asserts exactly that.

It lives in the spec, so it travels. A rink arriving on another device faces the
way the person with the tape was holding it.

### Taking a note back off

Two kinds of writing sit on the glass and they behaved differently, neither of
them well.

**Condition notes** are what somebody typed against a panel. Two are compiled
into `glass.html` from the measurement doc — panels 069 and 082 — and a device
with no records of its own starts from them. That much is right; what was wrong
is that it then *sent* them. A push restamps a record newest on the server, so a
note cleared last week came back for everybody the first time a new device
opened Glass. Those two notes were effectively permanent.

Seeded records are marked, and `collect()` never sends a marked one: it is
where this device starts, not something it observed. The mark comes off the
moment anybody edits the record, so clearing a note is a real observation and
travels like any other.

**Labels and tags** — "Cracked", "Added to close the end — verify" — lived in
the layout, and nothing in the app could edit them. A panel replaced last month
still read "Cracked" and the only fix was editing the file. They are now part of
the record too: `labelOf()` and `tagOf()` prefer the record and fall back to
the layout, so the survey is still the default and an edit is an override.
**An empty string is a deliberate clearing** and is not the same as never having
set one, which is why both check for the key rather than a truthy value.

**The survey notes under the plan are layout copy**, not markup. They were
written into the page, so every rink built since was shown Conway's findings
about Conway's bench openings. A note carrying `needsTag` is about something
still unresolved and is drawn only while some panel still has that tag — so
confirming panel 111 on a walk-round and clearing its tag takes the explanation
with it, rather than leaving a note about a question that has been answered.

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
  missed panel or the Zamboni doorway is wider than its two 57½″ leaves. The app
  can now be told the answer: clearing that panel's tag retires the dashes, the
  tick and the standing explanation together.
- **Glass Manager on a phone** has not been looked at. Desktop and tablet are fine.
- **Ice shows no "changed by".** Both apps now get the server's stamp on every
  record (`changedBy`), but only Glass displays it. Ice's Rink view will once the
  pages are rebuilt (D3).
- **No realtime.** Sync happens on open and on focus. Supabase realtime would
  make the desktop update while you watch; not needed so far.
- **A fresh device used to invent a facility (fixed).** Ice's `freshState()` made a "Main
  facility" that was pushed before the first pull, adding a phantom rink to everyone's list
  and shifting the real one's `ord`. The invention is a seed now (see *Seeds*): kept off
  the wire until somebody really edits it, dropped when real facilities arrive. The shell
  never creates a facility on its own. `facilitytest` still pins the active facility, as
  belt and braces.
- **The SQL in `supabase/` has not been run against a real database.** The README
  has the checklist, including the two behaviours the client depends on: the
  "editing is locked" wording, and what the auth service answers for a removed
  person.
- **Staff cannot update a sheet from the glass builder.** Writing a sheet is
  Management-only, so the builder's offer to update the sheet's shape (D4) needs
  to say so, or hand the update to a Manager.
- **A surface added on the launcher has no glass until somebody walks it.** That
  is the intended shape — glass comes off a tape measure, not a form — but the
  launcher does not yet say which of its rinks have none.
