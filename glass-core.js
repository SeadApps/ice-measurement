/* glass-core.js: the state of Glass Manager.
   The layouts and the survey of Conway's glass, the panel state and the status and tag helpers, and everything that keeps them:
   the record buckets, the facility and sheet bindings, the spare-glass movements and the arithmetic over them (stock, coverage,
   autoFit), the one-tap widths, set() and the glue to the record store and to sync. Moved out of glass.html unchanged, in its
   original order. Some of these functions still call the page's painters (paint, table, detail) when they run; those move with
   the Rink view. A classic script, so its names are the page's globals. */
/* DATA (Conway's survey) is in glass-data.js, loaded first. */
/* ---------------- layouts ----------------
   A layout is everything the renderer needs to draw one rink: its dimensions,
   its run of panels, the order its sections read in, and the handful of facts
   that are true of that building and no other. Conway's is the embedded DATA
   blob dressed with the strings that used to sit in the drawing code.

   The renderer below no longer knows anything about Conway. It does still draw
   Conway's specifics — they moved here rather than disappearing, which is what
   lets this change be verified by rendering identical output. */
/* Declared here rather than with the storage keys below: the layout
   registry is keyed by it and is evaluated first. */
const LEGACY = 'legacy';
const LAYOUTS = {};
LAYOUTS[LEGACY] = {
  rink: DATA.rink,
  panels: DATA.panels,
  meta: DATA.meta || {},
  glassHeight: 75,
  /* Where the four edges are named on the plan. */
  edges: { top:'Bleacher side', bottom:'Bench side', left:'Zamboni end', right:'Lobby end' },
  /* The Zamboni doorway gets a callout; a rink without one simply has no tag
     to find, and the plan must still draw. */
  zamDoorLabel: 'Zamboni doors · 9′7″',
  copy: {
    lede: ', Nashua NH · all 127 pieces in running order from the Zamboni doors, counter‑clockwise. '
        + 'Click any panel on the plan or in the schedule to record its condition.',
    planNote: 'Zamboni end at left · counter‑clockwise',
    footer: '127 pieces · all glass 75″ high · ends 5/8″ tempered, sides 1/2″ · measurements as recorded',
    /* Conway's survey notes. They were written into the markup, which meant
       every rink built since was shown Conway's findings about its own bench
       openings. A note with `needsTag` is about something still unresolved and
       goes when that is settled - clear panel 111's tag on the walk-round that
       confirms it and the explanation goes with it. */
    notes: [
      { tone:'info', title:'The bench openings check out',
        html:"Two openings of 29&prime; 6&Prime;, starting after panels 93 and 102 as recorded. That puts the penalty boxes and the scorekeeper opening between them, centred on centre ice to within half an inch &mdash; a good sign the 200&prime; length and the opening widths are right." },
      { needsTag:'assumed', title:'Panel 111 is inferred, not measured',
        html:"A 43&Prime; panel has been added at the bench&#8209;side corner to close the Zamboni end, on the assumption the original count missed one. It brings that end to 113&prime; 9&frac12;&Prime; against the lobby end's 113&prime; 10&Prime; &mdash; half an inch apart. Everything from 111 on is renumbered. <b>Confirm it on the next walk&#8209;round.</b>" },
      { tone:'info', title:'Corners &amp; joints',
        html:"The corner radius is solved from the glass, not assumed: 27&prime; 2&Prime; is the only radius that lets a true 200&prime; sheet close with one consistent joint. Joints come out at &#8776;&frac78;&Prime; on the bleacher side, lobby end and bench side alike. Panel sizes are exactly as measured." }
    ]
  }
};

let P, GLASS, R, L, W, SEC_ORDER, META, LAYOUT;
/* Reassigned rather than made accessors: every drawing function below already
   closes over L, W, R and GLASS, so switching layout here costs one call
   instead of touching a hundred call sites. */
function useLayout(bucket){
  LAYOUT = LAYOUTS[bucket] || LAYOUTS[LEGACY];
  P = LAYOUT.panels;
  GLASS = P.filter(p => p.kind === 'glass');
  R = LAYOUT.rink.R; L = LAYOUT.rink.L; W = LAYOUT.rink.W;
  META = LAYOUT.meta || {};
  /* Section order is the order the sections are first walked in, not a list
     anybody has to keep in step with the panels. */
  SEC_ORDER = [];
  P.forEach(x => { if (x.sectionKey && SEC_ORDER.indexOf(x.sectionKey) < 0) SEC_ORDER.push(x.sectionKey); });
}
useLayout(LEGACY);

/* A sheet that is not regulation gets its outline, its panels and a centre
   line, and nothing else. Blue lines and faceoff spots sit at fixed distances
   in feet; stretched onto a shorter sheet they would draw markings that are
   not painted on that ice, which is worse than drawing none. */
const isRegulation = () => L === 200 && W === 85;
const glassHeightOf = pnl => (pnl && pnl.height_in) || LAYOUT.glassHeight;
const STATUS = {
  ok:      {label:'Good',                short:'Good',  cls:'ok'},
  replace: {label:'Needs replacement',   short:'Replace',cls:'replace'},
  plexi:   {label:'Temporary plexi in',  short:'Plexi', cls:'plexi'}
};
let state = {};          // the active facility's panels: id -> {status, note}
let sel = null;          // selected panel id

/* The layout carries what a panel was surveyed as; the record carries what
   somebody has since decided it should say. Nothing in the app could edit
   these before, so a panel replaced last month still read "Cracked" and the
   only fix was editing the file.

   An empty string is a deliberate clearing and is not the same as never having
   set one - which is why this checks for the key rather than a truthy value. */
const TAGS = {'':'Nothing noted', door:'Door', damage:'Damage',
              assumed:'Assumed \u2014 verify', feature:'Feature', zamdoor:'Zamboni door'};
function labelOf(p){
  const r = p && state[p.id];
  return (r && r.label !== undefined) ? r.label : ((p && p.label) || '');
}
function tagOf(p){
  const r = p && state[p.id];
  return (r && r.tag !== undefined) ? r.tag : ((p && p.tag) || '');
}
let filter = null;       // status filter
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const st = id => (state[id] && state[id].status) || 'ok';
const nt = id => (state[id] && state[id].note) || '';

/* ---------------- persistence ---------------- */
/* Same wrapper the Ice app uses: a host-provided store if one exists, else this browser. */
const Store = Records.Store;      // the same wrapper all three pages had a copy of
/* Panels belong to a facility now.

   The original 127 live in a bucket called "legacy" and keep bare record ids
   on the wire - "045", not "<facility>:045". Nothing already on the server is
   re-keyed, so a device still running the old code stays consistent and there
   is no one-shot migration to get right. Facilities added later get scoped
   ids, "<facilityId>:<panelId>".

   The bucket key is the fixed string "legacy" rather than a sheet id, because
   sheet records arrive from sync - asynchronously, and possibly never on a
   device that has only ever run Glass. Which ice surface the bucket belongs to
   is a separate fact that syncs on its own (glass_binding), and only affects
   what the page is labelled.

   Glass hangs off a *sheet*, not a facility. An arena with two surfaces has
   two sets of glass, two schedules and two condition records. Conway has one
   sheet, which is why binding to the facility was indistinguishable here and
   wrong everywhere else. */
const KEY = 'glass_record_v2', KEY_V1 = 'glass_record_v1';
/* The panel card's note is only on screen while a panel is open; the toolbar's is always there. */
function sayTool(msg){ const n = document.getElementById('toolNote'); if(n) n.textContent = msg; }
function say(msg){ const n = document.getElementById('savenote'); if(n) n.textContent = msg; }
function stamp(){ return new Date().toISOString().slice(0,10); }
/* Nobody types their name any more. The server stamps whoever is signed in on every change, and
   this is only that name, for showing. Marks from before keep the name that was typed on them. */
const whoName = () => { const p = window.Sync && window.Sync.person && window.Sync.person(); return p ? p.name : ''; };
let records = {};             // bucket -> panelId -> {status,note,by,at,updatedAt}
let facilities = {};          // facilityId -> {id,name,ord} - the Ice app owns these
let sheets = {};              // sheetId -> {id,facilityId,name,ord} - the Ice app owns these too
let boundSheetId = null;      // which ice surface the legacy bucket is the glass for
let pendingFacilityId = null; // a pre-sheet binding, waiting for that facility's sheets
let FACILITY_NAMES = {};      // names for rinks built here, before Ice has a record for them
let LAYOUT_AT = {};           // bucket -> the layout's updatedAt, so layouts merge newest-wins
let bindingAt = '';           // its updatedAt, so the binding merges newest-wins
let activeBucket = LEGACY;

/* ---- spare glass -------------------------------------------------------

   Spares hang off the *facility*, and that is deliberately the opposite way
   round from the panels. G1 moved glass onto sheets because an arena with two
   ice surfaces has two sets of glass, two schedules and two condition records.
   Spare stock is not like that: it sits on a rack in one storage room and gets
   fitted to whichever surface breaks. One building, one shelf.

   Stock is not stored. Each receipt or fitting is its own record and the level
   is their sum, because a quantity is the one shape this record model merges
   badly: newest-wins on a number means the iPad taking 3 to 2 and the desktop
   doing the same from its own copy merge to 2 rather than 1, and nothing on
   screen would ever show it. Movements only ever appear, so summing them is
   right however they arrive, in whatever order, on any number of devices.
   Correcting a mistake is another movement, or a tombstone on the wrong one. */
let SPARES = {};              // movementId -> {id,fac,w,h,thk,mat,qty,note,by,at,updatedAt,deleted}
let spMat = 'tempered';       // which pile the record form is pointed at

/* The builder's one-tap widths, one record per facility, shared by all its
   sheets. A facility that has never saved a list reads the defaults and has no
   record: sending the defaults would stamp every facility on every device for
   nothing. The record appears the first time somebody really changes the list,
   and newest wins. */
const DEFAULT_WIDTHS = [43, 48];
let WIDTHS = {};              // facilityId -> {id,fac,widths:[inches],updatedAt}
const cleanWidths = list => [...new Set((list || []).map(Number).filter(w => w > 0 && isFinite(w)))].sort((a, b) => a - b);
function widthsOf(fac){
  const r = WIDTHS[fac];
  return r && Array.isArray(r.widths) ? r.widths.slice() : DEFAULT_WIDTHS.slice();
}
/* Returns false when the list is what the facility already reads, or there is
   no facility to put it under. */
function setWidths(fac, list){
  const w = cleanWidths(list);
  if(!fac || JSON.stringify(w) === JSON.stringify(widthsOf(fac))) return false;
  WIDTHS[fac] = {id:fac, fac, widths:w, updatedAt:nowISO()};
  return true;
}

const mvId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* The shelf carries both, and they are not interchangeable: a plexi pane is
   what goes in to keep the game on while the real one is on order. So material
   is part of what identifies a piece, not a note about it.

   Movements written before this existed carry no material and are read as
   tempered, which is what the shelf held at the time. A device on the older
   build reads a plexi movement as though it were tempered - it groups on
   width, height and thickness and knows nothing else - which overstates its
   glass rather than losing the record. It corrects itself the moment that
   device updates, because nothing was rewritten to make this work. */
const MATERIALS = {tempered:'Tempered', plexi:'Plexi'};
const matOf = m => (m && m.mat === 'plexi') ? 'plexi' : 'tempered';

/* Width, height, thickness and material together, because none of them alone
   identifies a piece: Conway carries 33" and 14.5" in both 1/2" and 5/8", a
   1/2" pane will not fill a 5/8" hole, and plexi will not do the job of glass
   for longer than it takes the order to arrive. */
const sizeKey = (w, h, thk, mat) => [w, h, thk, mat || 'tempered'].join('|');
const keyOfMove = m => sizeKey(m.w, m.h, m.thk, matOf(m));
const sizeLabel = s => `${s.w}″ × ${s.h}″ · ${s.thk}`
                     + (matOf(s) === 'plexi' ? ' · plexi' : '');

/* Which building's shelf are we looking at? A sheet names its facility; the
   legacy bucket reaches its sheet through the binding. Where that is not known
   yet - a device that has never synced - this is null and the card says so
   rather than inventing a shelf, the same way a facility-only binding is held
   pending rather than guessed at. */
function activeFacilityId(){
  const sid = activeBucket === LEGACY ? boundSheetId : activeBucket;
  const sh = sid && sheets[sid];
  if(sh && sh.facilityId) return sh.facilityId;
  if(activeBucket === LEGACY && pendingFacilityId) return pendingFacilityId;
  return null;
}

/* size key -> {w,h,thk,mat,qty,moves,last} for one facility. */
function stockOf(fac){
  const out = {};
  if(!fac) return out;
  for(const id in SPARES){
    const m = SPARES[id];
    if(!m || m.deleted || m.fac !== fac) continue;
    const k = keyOfMove(m);
    if(!out[k]) out[k] = {w:m.w, h:m.h, thk:m.thk, mat:matOf(m), qty:0, moves:0, last:''};
    out[k].qty += (+m.qty || 0);
    out[k].moves++;
    if((m.at || '') > out[k].last) out[k].last = m.at || '';
  }
  return out;
}

/* What the order list has to say: of the pieces flagged on this rink, which
   come off the shelf and which have to be bought. Allocation inside a size is
   in running order - the pieces are identical, so which one gets the spare is
   arbitrary, and only the counts matter. */
function coverage(){
  const fac = activeFacilityId(), have = stockOf(fac), left = {};
  for(const k in have) left[k] = have[k].qty;
  const rows = GLASS.filter(p => st(p.id) !== 'ok').map(p => {
    /* The rink is built from tempered, so a flagged pane wants tempered. A
       plexi sheet the same size is the stopgap, not the fix: counting it as
       cover would tell somebody not to order glass they are going to need.
       It is reported separately instead, because knowing you can keep the
       game on tonight is worth saying. */
    const k  = sizeKey(p.width_in, glassHeightOf(p), p.thickness, 'tempered');
    const pk = sizeKey(p.width_in, glassHeightOf(p), p.thickness, 'plexi');
    const covered = (left[k] || 0) > 0;
    if(covered) left[k] -= 1;
    const patch = !covered && (left[pk] || 0) > 0;
    if(patch) left[pk] -= 1;
    return {p, k, covered, patch};
  });
  return {fac, have, rows,
          flagged: rows.length,
          fromStock: rows.filter(r => r.covered).length,
          patchable: rows.filter(r => r.patch).length,
          toOrder: rows.filter(r => !r.covered).length};
}

/* A movement is only ever added. `qty` is signed: positive received, negative
   fitted or written off. */
function addMovement(w, h, thk, mat, qty, note){
  const fac = activeFacilityId();
  if(!fac || !qty) return null;
  const id = mvId();
  SPARES[id] = {id, fac, w:+w, h:+h, thk:String(thk), mat:matOf({mat:mat}), qty:+qty,
                note:note || '', changedBy:whoName(), at:stamp(), updatedAt:nowISO()};
  return id;
}
/* Undoing one is a tombstone rather than a deletion, or the next pull hands it
   straight back - the same rule the removed layouts follow. */
function dropMovement(id){
  if(!SPARES[id]) return false;
  /* The facility stays on the tombstone: without it the server could not tell
     whose it was, and would show it to nobody but management. */
  SPARES[id] = {id, fac:SPARES[id].fac, deleted:true, updatedAt:nowISO()};
  return true;
}

/* Fitting a pane takes it off the shelf.

   The event is not a status value, it is a *transition*: `replace` means needs
   replacing, so the moment a pane is actually fitted is the one where a flagged
   panel goes back to good. Clearing plexi counts too - real glass went in where
   the patch was.

   This is deducted rather than offered, which is what was asked for, so the
   guard against it being wrong is that it is never silent: it says what it did,
   the movement is at the top of the card marked `auto`, and retracting it is one
   click. A flag cleared because it was raised in error is a movement to take
   back, not a number to go hunting for.

   Two things it will not do. It will not take the shelf negative - no spare of
   that size means the glass came from somewhere other than the rack, so the
   ledger stays true to the rack and says nothing was deducted. And it will not
   deduct twice for the same panel on the same day, which is the realistic
   double: somebody clearing a flag, re-flagging, and clearing it again. Two
   devices clearing the same panel before either has synced will still record
   two fittings; that one is visible in the list and retractable, which is the
   whole reason stock is a ledger rather than a number. */
function autoFit(pid, mat){
  const p = GLASS.find(x => x.id === pid);
  if(!p) return null;
  const fac = activeFacilityId();
  if(!fac) return null;
  const h = glassHeightOf(p);
  const size = {w:p.width_in, h:h, thk:p.thickness, mat:mat || 'tempered'};
  const have = stockOf(fac)[sizeKey(size.w, size.h, size.thk, size.mat)];
  if(!have || have.qty <= 0) return {short:true, size};
  const today = stamp();
  /* Once per panel per day per material: a pane going to plexi and then to
     glass on the same day is two real fittings out of two different piles, so
     the guard cannot be on the panel alone. */
  const twice = Object.keys(SPARES).some(mid => {
    const m = SPARES[mid];
    return m && !m.deleted && m.fac === fac && m.forPanel === pid
        && m.at === today && matOf(m) === size.mat;
  });
  if(twice) return {already:true, size};
  const id = addMovement(size.w, size.h, size.thk, size.mat, -1,
                         'fitted panel ' + pid.replace(/^0+/, ''));
  if(!id) return null;
  SPARES[id].forPanel = pid;
  SPARES[id].auto = true;
  return {id, size};
}

const bucketOf = b => (records[b] = records[b] || {});

/* The only way to change which rink is on screen. `state` is a live alias for
   the active bucket's panels, so moving activeBucket without repointing it
   leaves edits landing on the rink you just left - which is exactly what
   happened when the builder first saved a rink and the next condition mark
   went to Conway instead. Keep the three together. */
function setBucket(b){
  activeBucket = b;
  state = bucketOf(b);
  useLayout(b);
}
const recId = (bucket, pid) => bucket === LEGACY ? pid : bucket + ':' + pid;
function splitId(rid){
  const i = String(rid).indexOf(':');
  return i < 0 ? { bucket: LEGACY, pid: String(rid) }
               : { bucket: rid.slice(0, i), pid: rid.slice(i + 1) };
}
/* A surface names its facility. The sheet's own name is appended only where
   that facility has more than one surface, so a one-rink operation still reads
   "Conway Arena" and not "Conway Arena - Main sheet". */
function nameForSheet(sid){
  const sh = sheets[sid], bf = sh && facilities[sh.facilityId];
  if(!(bf && bf.name)) return null;
  const many = Object.keys(sheets).filter(k => sheets[k].facilityId === bf.id).length > 1;
  return (many && sh.name) ? bf.name + ' - ' + sh.name : bf.name;
}
/* Conway reaches its surface through the binding; every rink walked since is
   keyed by the surface itself, so the bucket is the sheet id. */
function facilityName(bucket){
  const viaSheet = nameForSheet(bucket === LEGACY ? boundSheetId : bucket);
  if(viaSheet) return viaSheet;
  const f = facilities[bucket];
  /* A rink built here has no facility record until somebody adds one in the
     Ice app, so it carries the name it was given at the boards. */
  return (f && f.name) || FACILITY_NAMES[bucket]
      || (bucket === LEGACY ? 'Conway Arena' : 'Unnamed facility');
}
/* Everything except Conway, whose layout is compiled into this file. */
function BUILT_SPECS(){
  const out = {};
  for(const k in LAYOUTS){
    if(k === LEGACY || k.indexOf('__') === 0) continue;
    if(LAYOUTS[k] && LAYOUTS[k].spec) out[k] = LAYOUTS[k].spec;
  }
  return out;
}
/* Rinks built before the walk was kept have nothing to redraw from. They are
   written back exactly as they are, so a save cannot drop them - but there is
   no spec to send, so they stay on the device that made them until it is
   walked again. */
function BUILT_DRAWN(){
  const out = {};
  for(const k in LAYOUTS){
    if(k === LEGACY || k.indexOf('__') === 0) continue;
    if(LAYOUTS[k] && !LAYOUTS[k].spec) out[k] = LAYOUTS[k];
  }
  return out;
}
function paintFacility(){
  const set = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
  set('facName', facilityName(activeBucket));
  const copy = LAYOUT.copy || {};
  set('ledeRest', copy.lede || ' · click any panel on the plan or in the schedule to record its condition.');
  set('planNote', copy.planNote || '');
  set('pageFooter', copy.footer || '');
  set('specHeight', LAYOUT.glassHeight + '″');
  /* These three were Conway's, written into the markup. Read from the layout
     they reproduce Conway's own strip exactly, which is how the change was
     checked - and they are no longer wrong the moment you switch rink. */
  set('specSize', fmtFt(L * 12) + ' × ' + fmtFt(W * 12));
  set('specRadius', fmtFt(R * 12));
  set('specRun', fmtFt(GLASS.reduce((a, p) => a + p.width_in, 0)));
  paintNotes();
}

/* This rink's survey notes. A note tied to a tag is about something still
   unresolved, so it goes when that tag does: confirm panel 111 on a
   walk-round, clear its tag, and the explanation goes with it rather than
   leaving a note about a question that has been answered.

   The copy is compiled into this file, not typed by anybody, which is why it
   can carry its own markup. */
function paintNotes(){
  const el = document.getElementById('notes');
  if(!el) return;
  const list = ((LAYOUT.copy || {}).notes || [])
    .filter(x => !x.needsTag || GLASS.some(p => tagOf(p) === x.needsTag));
  el.innerHTML = list.map(x => '<div class="note' + (x.tone === 'info' ? ' info' : '') + '">'
    + '<h3>' + x.title + '</h3><p>' + x.html + '</p></div>').join('');
  el.hidden = !list.length;
}

/* The way back off a rink the builder just made. Before this, bldSave() moved
   you to the new rink and nothing could move you off it. */
/* Which facility a bucket's glass belongs to. Conway reaches its surface
   through the binding; everything walked since is keyed by the surface. */
function facilityOfBucket(k){
  const sh = sheets[k === LEGACY ? boundSheetId : k];
  return sh ? sh.facilityId : null;
}
/* Glass walked by mistake had no way off the device: the picker listed it for
   ever and there was nothing to press. Conway is not removable - its layout is
   compiled into this file, not something anybody built. */
/* Asks in the page (askG), never with a browser dialog. `then` runs once it is gone. */
function deleteRink(bucket, then){
  if(bucket === LEGACY || !LAYOUTS[bucket]) return;
  const name = facilityName(bucket);
  askG({title:'Remove this layout?',
        text:'The glass walked for "' + name + '", its panel run and anything recorded against it go, on every device. '
           + 'The ice surface itself stays - delete that in Ice if you want it gone too.',
        ok:'Remove layout'}, async () => { await removeRink(bucket); if(then) then(); });
}
async function removeRink(bucket){
  if(bucket === LEGACY || !LAYOUTS[bucket]) return;
  const name = facilityName(bucket);
  /* Tombstoned rather than quietly dropped. The layout has been on the server,
     so the other devices have to be told it is gone; forgetting it here would
     just mean the next pull brought it back. */
  const t = nowISO();
  LAYOUT_GONE[bucket] = t;
  LAYOUT_AT[bucket] = t;                 // so an older copy cannot re-add it
  const m = records[bucket] || {};
  for(const pid in m) m[pid] = {deleted:true, updatedAt:t};
  delete LAYOUTS[bucket];
  setBucket(LEGACY);
  store();
  defaultScope();
  buildPlan(); rail(); totals(); table(); detail(); paint(); paintFacility(); spares();
  say('Removed ' + name + '.');
}

async function switchRink(b){
  if(!LAYOUTS[b] || b === activeBucket) return;
  setBucket(b);                         // records, layout and `state`, together
  /* Written straight out rather than through store(), which would also nudge
     sync and claim a save. Looking at a different rink changes no record. */
  Store.set(KEY, snapshot());
  /* Which rink you are at is one fact, not one per app. Moving it here moves
     it for the shell and for Ice too. */
  const sid = (b === LEGACY) ? boundSheetId : b;
  if(sid){
    const patch = {activeSheet: sid}, sh = sheets[sid];
    if(sh && sh.facilityId) patch.activeFacility = sh.facilityId;
    await Records.Repo.savePrefs(patch);
    if(typeof Shell !== 'undefined' && patch.activeFacility) Shell.setAddress(patch.activeFacility, sid);
  }
  defaultScope();
  buildPlan(); rail(); totals(); table(); detail(); paint(); paintFacility(); spares();
  say('Showing ' + facilityName(b) + '.');
}

const byOrd = (a,b) => (a.ord||0)-(b.ord||0) || String(a.id).localeCompare(String(b.id));
const sheetsOf = fid => Object.keys(sheets).map(k=>sheets[k])
                              .filter(s => s && s.facilityId === fid).sort(byOrd);
function firstSheet(){
  const facs = Object.keys(facilities).map(k=>facilities[k]).filter(Boolean).sort(byOrd);
  for(const f of facs){ const own = sheetsOf(f.id); if(own.length) return own[0]; }
  return null;
}
/* Nothing names the legacy bucket until the Ice app's records arrive. Bind it
   to the first surface of the first facility once, and let that decision sync
   so every device agrees; never move it afterwards. */
function ensureBinding(){
  if(boundSheetId) return false;
  /* An unresolved facility binding outranks picking one. Wait for that
     facility's sheets rather than bind to a different rink and sync it out. */
  if(pendingFacilityId){
    if(facilities[pendingFacilityId]) return false;
    pendingFacilityId = null;                    // that facility is gone; pick again
  }
  const sh = firstSheet();
  if(!sh) return false;
  boundSheetId = sh.id; bindingAt = new Date().toISOString();
  return true;
}

let hereSheet = null;     // which surface the shell says you are standing in
let hereFacility = null;  // and which facility that surface is at
let LAYOUT_GONE = {};         // bucket -> updatedAt, for glass that has been removed

/* The facilities and sheets Ice and the shell keep. Read from this device
   rather than waited for over sync: a surface added on the Facilities page a moment
   ago is in local storage long before it has been near the server, and a
   builder that could not see it would be no join at all. */
async function loadSurfaces(){
  const st = await Records.Repo.read();
  if(!st) return null;
  (st.facilities || []).forEach(f => {
    facilities[f.id] = {id:f.id, name:f.name, ord:f.ord};
    (f.sheets || []).forEach(s => {
      sheets[s.id] = {id:s.id, facilityId:f.id, name:s.name, ord:s.ord, shape:Records.shapeOf(s)};
    });
  });
  hereSheet = (st.prefs && st.prefs.activeSheet) || null;
  hereFacility = (st.prefs && st.prefs.activeFacility) || null;
  return st;
}

const SYNC=(typeof Sync!=="undefined")?Sync:null;   // absent if sync.js failed to load; the page still works locally
const snapshot = () => JSON.stringify({records, boundSheetId, pendingFacilityId, bindingAt,
                                       activeBucket, names: FACILITY_NAMES, at: LAYOUT_AT, gone: LAYOUT_GONE,
                                       spares: SPARES, widths: WIDTHS,
                                       specs: BUILT_SPECS(), built: BUILT_DRAWN()});
function store(){ Store.set(KEY, snapshot()); say('Saved'); if(SYNC) SYNC.nudge(); }

async function restore(){
  let saved = null;
  try{ saved = JSON.parse(await Store.get(KEY) || 'null'); }catch(e){}
  if(saved && saved.records){
    records = saved.records;
    /* A device upgrading from the facility-bound build has boundFacilityId and
       no sheets yet. Hold it pending rather than guess - the next pull resolves
       it to that facility's first surface. */
    boundSheetId = saved.boundSheetId || null; bindingAt = saved.bindingAt || '';
    if(!boundSheetId) pendingFacilityId = saved.pendingFacilityId || saved.boundFacilityId || null;
    activeBucket = saved.activeBucket || LEGACY;
    FACILITY_NAMES = saved.names || {};
    /* Layouts built on this device come back with it. Conway's is compiled in,
       so it is never stored and never overwritten from storage. */
    LAYOUT_AT = saved.at || {};
    LAYOUT_GONE = saved.gone || {};
    SPARES = saved.spares || {};
    WIDTHS = saved.widths || {};
    const specs = saved.specs || {};
    for(const k in specs){
      if(k === LEGACY) continue;
      const lay = tryLayout(specs[k]);
      if(lay) LAYOUTS[k] = lay;
    }
    const built = saved.built || {};
    for(const k in built) if(k !== LEGACY && !LAYOUTS[k]) LAYOUTS[k] = built[k];
    if(!LAYOUTS[activeBucket]) activeBucket = LEGACY;
  } else {
    let v1 = null;
    try{ v1 = JSON.parse(await Store.get(KEY_V1) || 'null'); }catch(e){}
    records = {};
    if(v1 && v1.panels) records[LEGACY] = v1.panels;
    else {
      /* The two notes off the measurement doc. They are where a device with
         nothing starts, not something it observed - so they are marked, and
         collect() never sends them. Sending one restamps it newest on the
         server, and the note somebody cleared last week comes back for
         everybody: that is what made those two effectively permanent. */
      const seed = JSON.parse(JSON.stringify(DATA.cond || {}));
      for(const id in seed) seed[id].seed = true;
      records[LEGACY] = seed;
    }
    /* v1 is left untouched as a fallback, the same way the Ice app leaves
       ice_sheet_v3 alone after moving to records. */
  }
  const legacy = bucketOf(LEGACY);
  for(const id in legacy){ if(legacy[id] && !legacy[id].updatedAt) legacy[id].updatedAt = legacy[id].at || '1970-01-01'; }
  setBucket(activeBucket);
}
const nowISO = () => new Date().toISOString();
const stampOf = r => (r && (r.updatedAt || r.at)) || '';   // full timestamp, else the older date-only field
function set(id, patch, quiet){
  const was = (state[id] && state[id].status) || 'ok';
  const next = Object.assign({status:'ok',note:''}, state[id], patch,
                             {changedBy: whoName(), at: stamp(), updatedAt: nowISO()});
  delete next.by;              // the name typed on an earlier mark is not this person's
  delete next.seed;            // somebody has touched it, so it is an observation now
  state[id] = next;
  /* A pane fitted comes off the shelf, and which pile it comes off depends on
     what went in. Back to good is the real fix, so that is tempered. Going to
     plexi is the stopgap that keeps the game on, and that is a plexi sheet out
     of the same shelf. Only on a status change - editing the note of a panel
     that is already good is not somebody fitting anything. */
  const fitted =
      (patch && patch.status === 'ok'    && was !== 'ok')    ? autoFit(id, 'tempered')
    : (patch && patch.status === 'plexi' && was !== 'plexi') ? autoFit(id, 'plexi')
    : null;
  /* Flagging or clearing a panel changes what the shelf has to cover, so the
     spares card is part of the same redraw rather than something that catches
     up on the next reload. */
  store(); rail(); table(); paint(); spares();
  if(!quiet) detail();          // keep focus in the note box while typing
  /* After detail(), which rebuilds the element say() writes into. */
  if(fitted){
    const n = id.replace(/^0+/, ''), sz = sizeLabel(fitted.size);
    const verb = fitted.size.mat === 'plexi' ? 'patched' : 'good';
    say(fitted.short   ? `Panel ${n} ${verb} — no ${sz} on the shelf, so nothing was deducted.`
      : fitted.already ? `Panel ${n} ${verb} — already deducted today.`
      :                  `Panel ${n} ${verb} — one ${sz} off the shelf.`);
  }
}

/* ---------- Flags ----------
   Open flags on the panels of the rink on screen, so the plan can mark them and the card can say so. */
function flaggedPanels(){
  const out = {};
  if(typeof Flags === 'undefined') return out;
  Flags.all().forEach(f => { if(f.status === 'open' && f.targetKind === 'panel' && f.sheetId === flagSheetId()) out[f.panelId] = f; });
  return out;
}
const flagSheetId = () => activeBucket === LEGACY ? boundSheetId : activeBucket;
function panelFlags(pid){
  const f = flaggedPanels()[pid];
  return f ? `<span class="flag-open">Flagged: ${esc(f.reason)}${f.note ? ' — ' + esc(f.note) : ''}</span>` : '';
}
const panelStatus = id => (state[id] && state[id].status) || 'ok';
