/* records.js — the v4 record store, shared.

   This lived inside ice.html, which was fine while Ice was the only page that
   held facilities. It is out here because the launcher needs the same records:
   it shows the fleet, and adding a rink there means writing a facility and a
   sheet rather than a Glass-only layout with a local name.

   The immediate reason is duplication that had already appeared. The launcher
   re-implemented the facility/sheet/session join and Ice's overdue rule, under
   a comment saying it had to match — and a comment is not a compiler. Two
   copies of a merge rule is one copy too many.

   What each page may do is deliberately different, and the API says so:

     Repo.read()       reads and joins. Never writes, never migrates.
     Repo.load()       what Ice boots on: also migrates off the old single-blob
                       key, which is a write.
     Repo.savePrefs()  device preferences only — never a synced record.
     Repo.save()       the whole state, records included.

   The launcher uses the first three. That it cannot write a synced record by
   accident is now a property of what it is able to call, rather than of
   somebody remembering a rule written down elsewhere.

   The record model itself is unchanged and ARCHITECTURE.md still explains it:
   per-record maps, each record carrying its own updatedAt, tombstones instead
   of deletes, and readings merged point by point inside a round. */
(function (global) {
  "use strict";

  const K = { fac:"ice_v4_facilities", sh:"ice_v4_sheets", se:"ice_v4_sessions",
              prefs:"ice_v4_prefs", legacy:"ice_sheet_v3" };

  /* Theme, units, which sheet you were last looking at, which screen you were
     on — held here and excluded from sync, so one device cannot move another's
     view. This is also what makes the launcher's rink picker safe. */
  const PREF_KEYS = ["theme","unit","lastBackup","contourIdx","contoursOn","smoothIdx","overdueDays",
                     "activeFacility","activeSheet","activeSession","screen","lastView","lastPage","mapMode"];

  /* The same wrapper all three pages had a copy of: a host-provided store if
     one exists, else this browser. */
  const Store = {
    async get(k){ try{ if(global.storage&&global.storage.get){const r=await global.storage.get(k); return r?r.value:null;} }catch(e){}
                  try{ return localStorage.getItem(k); }catch(e){ return null; } },
    async set(k,v){ try{ if(global.storage&&global.storage.set){ await global.storage.set(k,v); return; } }catch(e){}
                    try{ localStorage.setItem(k,v); }catch(e){} }};

  /* ---------- the shapes a new record takes ----------
     These moved in with the store because the launcher creates facilities and
     sheets now, and a sheet it made has to be indistinguishable from one Ice
     made. The specific way that goes wrong is a sheet with no session in it:
     Ice reaches straight for sheets[0].sessions[0] when it boots. */
  /* The standard corner is 27 ft 2 in. Ice's presets said 28 while the glass
     survey of Conway solves to 27' 2", so the two apps drew different outlines
     of the same ice. One value now. */
  const STD_CORNER = 27 + 2/12;
  const RINK_SIZES = [
    {id:"nhl",   name:"NHL — 200 × 85 ft",      L:200, W:85,  corner:STD_CORNER},
    {id:"intl",  name:"Olympic — 200 × 100 ft", L:200, W:100, corner:STD_CORNER},
    {id:"hybrid",name:"Hybrid — 200 × 90 ft",   L:200, W:90,  corner:STD_CORNER},
    {id:"studio",name:"Studio — 185 × 85 ft",   L:185, W:85,  corner:25}
  ];
  const NHL_SIZE = () => ({...RINK_SIZES[0]});
  /* Band edges, flood and shave levels and the target are in eighths of an inch,
     because that is what a reading is: sixteen labels in eighths, no sixteenth.
     The old edges sat between the eighths (5/8 to 11/16 and so on), which is why
     moving them to the eighth ABOVE keeps every reading in the band it is in now:
     a reading is compared with "is it below this edge", so an edge anywhere in the
     gap above the last reading it should exclude and at or below the first it
     should include gives the same answer. Rounding up lands in that gap every
     time. Today's 0.6875 / 1.4375 / 1.5625 / 1.9375 become 3/4, 1 1/2, 1 5/8, 2. */
  const DEFAULT_EDGES = [0.75,1.5,1.625,2];
  const eighthUp   = x => Math.ceil(x*8 - 1e-9)/8;
  const eighthNear = x => Math.round(x*8)/8;
  const SETTINGS_VERSION = 2;
  const uid = () => Math.random().toString(36).slice(2,9);
  const newSession = () => ({id:uid(),date:new Date().toISOString(),label:"",mode:"moderate",data:{},notes:{}});

  /* ---------- the shape of a sheet ----------
     One outline per sheet, drawn the same in Ice and Glass: length, width,
     corner radius (feet and inches), where the glass walk starts, and which way
     the building faces. It replaces the size, which stays on the record for a
     device on the older build.

     An old sheet is READ as though it had a shape, and only gains one when it is
     deliberately migrated or edited. Writing it on every save would restamp every
     sheet on every device, and a device holding a stale copy would then look
     newest on all of them. */
  const cornerOf = s => s.Rft + s.Rin/12;
  /* The boards a glass walk goes round: two sides, two ends, four quarter-corners. */
  const perimeterOf = (L, W, R) => 2*(W - 2*R) + 2*(L - 2*R) + 2*Math.PI*R;
  const shapePerimeter = s => perimeterOf(s.L, s.W, cornerOf(s));
  /* Conway's glass survey, compiled into glass.html: 523.3599 ft of boards. */
  const CONWAY_VERIFIED = 523.3599;
  function shapeFromSize(size){
    size = size || NHL_SIZE();
    /* Exactly 28 is the old preset's corner, the one that disagreed with the glass
       survey, so it moves to the standard. Any other corner was somebody's choice. */
    const c = size.corner===28 ? STD_CORNER : (+size.corner || STD_CORNER);
    const inches = Math.round(c*24)/2;                 // to the nearest half inch
    return {L:+size.L||200, W:+size.W||85, Rft:Math.floor(inches/12), Rin:inches%12,
            start:"zam", turn:false, flip:false};
  }
  const shapeOf = sh => (sh && sh.shape && sh.shape.L)
    ? Object.assign({start:"zam",turn:false,flip:false}, sh.shape)
    : shapeFromSize(sh && sh.size);
  /* What Ice's geometry takes: the old size object, with its numbers from the shape. */
  const sizeOf = sh => { const s = shapeOf(sh);
    return Object.assign({}, (sh && sh.size) || {}, {L:s.L, W:s.W, corner:cornerOf(s)}); };

  /* How far a measured shape is from the sheet's, for the glass builder. "Small"
     is the call between keeping the sheet's size and offering to update it:
     within half a foot on the length and width, three inches on the corner. */
  const SHAPE_TOLERANCE = {L:0.5, W:0.5, R:0.25};
  function compareShape(sheet, measured, tol){
    tol = Object.assign({}, SHAPE_TOLERANCE, tol||{});
    const dL = measured.L - sheet.L, dW = measured.W - sheet.W, dR = cornerOf(measured) - cornerOf(sheet);
    const differs = [];
    if(Math.abs(dL) > 1e-9) differs.push("L");
    if(Math.abs(dW) > 1e-9) differs.push("W");
    if(Math.abs(dR) > 1e-9) differs.push("R");
    return {dL, dW, dR, differs, same: !differs.length,
            small: Math.abs(dL) <= tol.L + 1e-9 && Math.abs(dW) <= tol.W + 1e-9 && Math.abs(dR) <= tol.R + 1e-9};
  }
  /* A shape that can be drawn: positive, a corner in half-inch steps, and a
     corner that fits. */
  function shapeProblem(s){
    if(!(s.L > 0 && s.W > 0)) return "a sheet needs a length and a width";
    if(!(s.Rft >= 0 && s.Rin >= 0 && s.Rin < 12 && s.Rft === Math.floor(s.Rft) && s.Rin*2 === Math.floor(s.Rin*2))) return "the corner is in feet and half inches";
    if(!(2*cornerOf(s) < Math.min(s.L, s.W))) return "that corner is too big for a sheet this size";
    return "";
  }

  const newSheet = (n,size) => { const sz = size || NHL_SIZE();
    return {id:uid(),name:n||"Main sheet",size:sz,shape:shapeFromSize(sz),sessions:[newSession()]}; };
  const defaultSettings = () => ({target:1.5,edges:[...DEFAULT_EDGES],tieAttention:true,floodBelow:1.25,shaveAbove:1.625,
                                  overdueDays:7,settingsVersion:SETTINGS_VERSION});

  /* ---------- reading a facility's settings ----------
     settingsOf is the only way a page should read them. It gives the settings as
     they will be once migrated, whether or not they have been, so a Staff device
     (which may not write a facility) and a Management device that has not run the
     migration yet classify every reading identically. It writes nothing and is
     idempotent: on already-migrated settings it returns the same numbers.

     overdueDays used to be a device preference. A facility that has none of its
     own falls back to the device's, then to 7. */
  const clampDays = n => Math.max(1, Math.min(90, Math.round(n)));
  function settingsOf(settings, prefs){
    const st = settings || {};
    const ok = Array.isArray(st.edges) && st.edges.length === 4 && st.edges.every(v => isFinite(v));
    const edges = ok ? st.edges.map(eighthUp) : [...DEFAULT_EDGES];
    const pick = (v, dflt) => (v == null || !isFinite(v)) ? dflt : v;
    const days = st.overdueDays != null && isFinite(st.overdueDays) ? st.overdueDays
               : prefs && prefs.overdueDays != null && isFinite(prefs.overdueDays) ? prefs.overdueDays : 7;
    return {
      target: eighthNear(pick(st.target, 1.5)),
      edges,
      tieAttention: st.tieAttention !== false,
      floodBelow: eighthUp(pick(st.floodBelow, edges[1])),
      shaveAbove: eighthUp(pick(st.shaveAbove, edges[2])),
      overdueDays: clampDays(days),
      settingsVersion: SETTINGS_VERSION
    };
  }
  /* Put a facility's settings into migrated form, in place, keeping any key this
     code does not know about. Returns true if anything changed. Used by the
     Management migration, and by the first real edit of a facility that has not
     been migrated, so a stepper never writes one new number beside three old. */
  function upgradeSettings(settings, prefs){
    const next = settingsOf(settings, prefs);
    let changed = false;
    for(const k in next){
      if(JSON.stringify(settings[k]) !== JSON.stringify(next[k])){ settings[k] = next[k]; changed = true; }
    }
    return changed;
  }
  const settingsNeedUpgrade = (settings, prefs) => upgradeSettings(JSON.parse(JSON.stringify(settings || {})), prefs);
  const overdueDaysOf = (facility, prefs) => settingsOf(facility && facility.settings, prefs).overdueDays;
  const newFacility = n => {const sh=newSheet();return{id:uid(),name:n||"Main facility",settings:defaultSettings(),sheets:[sh]};};

  const nowISO = () => new Date().toISOString();
  const rd = async k => { try{ return JSON.parse(await Store.get(k) || "null"); }catch(e){ return null; } };

  let SNAP = {fac:{},sh:{},se:{}};   // what we last wrote, so we only re-stamp what actually changed

  function decompose(st){
    const fac={},sh={},se={};
    (st.facilities||[]).forEach((f,fi)=>{
      /* fac names the facility a record belongs to, so the server can show it
         only to people given that facility. Everything here is derived from
         where the record sits, never typed, and bodyOf ignores it. */
      fac[f.id]=detach({id:f.id,name:f.name,settings:f.settings,ord:fi,fac:f.id});
      (f.sheets||[]).forEach((x,si)=>{
        sh[x.id]={id:x.id,facilityId:f.id,name:x.name,size:x.size,ord:si,fac:f.id,
                  ...(x.shape?{shape:x.shape}:{})};   // carried, never derived here: see the shape notes above
        (x.sessions||[]).forEach((z,zi)=>{ se[z.id]=detach(Object.assign({},z,{sheetId:x.id,ord:zi,fac:f.id})); });
      });
    });
    return {fac,sh,se};
  }
  /* changedBy is metadata the server stamps and hands back on every pull, like
     updatedAt. If it counted as content, every pull would look like an edit and
     every device would re-send what it had just received.

     fac is derived from where a record sits. If it counted, the first save on
     any device after this change would restamp every record it holds - and a
     device holding a stale copy would then look newest on all of them. Records
     pick it up when they are next really edited; management's backfill tags
     the rest. */
  /* Compared with the keys in a fixed order. Postgres jsonb does not keep the order a
     record was written in (it sorts keys by length, then by bytes), so a record pulled
     from the real server comes back reordered. Compared as written, the first save on any
     device after a pull would see every facility and sheet as changed and restamp the
     lot, and nothing on screen would show it. */
  const canon=v=>Array.isArray(v)?v.map(canon):(v&&typeof v==="object")?Object.keys(v).sort().reduce((o,k)=>{o[k]=canon(v[k]);return o;},{}):v;
  const bodyOf=r=>{const c=Object.assign({},r);delete c.updatedAt;delete c.deleted;delete c.changedBy;delete c.fac;delete c.seed;return JSON.stringify(canon(c));};

  /* A session carries two nested maps - the readings and the per-point notes -
     and Object.assign copies only the reference to them. That left the snapshot
     of "what was last written" pointing at the very object the app goes on to
     mutate, so by the time save() compared the two, bodyOf(prev) and
     bodyOf(next) were serialising the same object and nothing ever looked
     changed.

     The cost was silent and severe: a round was stamped once, when it was
     created, and never again. Every reading typed after that moment changed no
     timestamp, so the sent-map still matched and push skipped the record. The
     round reached the other devices; the numbers in it never did, and the
     device that took them looked perfectly healthy.

     Flat fields are copied by value, which is why renaming a sheet always
     worked and only the nested maps went missing - and why this hid for so
     long. Detach them on the way into the snapshot and on the way back out, so
     a snapshot is genuinely a snapshot and neither side can reach the other's. */
  /* A facility's settings are the same kind of nested object, and went unnoticed
     for the same reason: they were shared with the snapshot, so a change to a
     target or a band edge made save() compare an object with itself and the
     facility was never restamped. It reached no other device until something else
     about the facility changed. Detached with the rest, edges array included. */
  const detachSettings = st => !st ? st : Object.assign({}, st, Array.isArray(st.edges) ? {edges: [...st.edges]} : {});
  const detach = r => !r ? r : Object.assign({}, r,
    r.data  ? {data:  Object.assign({}, r.data)}  : {},
    r.notes ? {notes: Object.assign({}, r.notes)} : {},
    r.settings ? {settings: detachSettings(r.settings)} : {});

  /* Stamp only what changed, and leave a tombstone for anything removed, so a
     delete on one device isn't undone by a merge from another. */
  function stampChanges(next,prev){
    const out={},t=nowISO();
    for(const id in next){
      const p=prev[id];
      /* seed is a mark on the record, never part of it. It survives only while the
         record is exactly what was fabricated; the first real change drops it. */
      const base=Object.assign({},next[id]); delete base.seed;
      out[id]=(p&&!p.deleted&&bodyOf(p)===bodyOf(next[id]))
        ? Object.assign(base,{updatedAt:p.updatedAt||t},p.changedBy?{changedBy:p.changedBy}:{},p.seed?{seed:true}:{})
        : Object.assign(base,{updatedAt:t});
    }
    for(const id in prev){ if(!(id in next)) out[id]=prev[id].deleted?prev[id]:{id,deleted:true,updatedAt:t}; }
    return out;
  }
  function reassemble(fac,sh,se){
    const live=o=>Object.values(o).filter(r=>r&&!r.deleted);
    const byOrd=(a,b)=>(a.ord||0)-(b.ord||0)||String(a.id).localeCompare(String(b.id));
    return live(fac).sort(byOrd).map(f=>Object.assign({},detach(f),{
      sheets:live(sh).filter(x=>x.facilityId===f.id).sort(byOrd).map(x=>Object.assign({},x,{
        /* Detached on the way out too: what a page is handed to edit must not
           be the snapshot's own object, or the alias comes straight back. */
        sessions:live(se).filter(z=>z.sheetId===x.id).sort(byOrd).map(detach)
      }))
    }));
  }

  /* A sheet is behind if the last round that actually has readings in it is
     older than overdueDays. An empty session is a sheet nobody has been to
     yet, not a round. Both screens that show this call in here, so they cannot
     drift into disagreeing about what is overdue. */
  const hasReadings = s => !!(s && !s.deleted && s.data && Object.keys(s.data).length);
  function lastRound(sessions, sheetId){
    return (sessions||[])
      .filter(s => hasReadings(s) && s.sheetId === sheetId)
      .sort((a,b) => new Date(b.date) - new Date(a.date))[0] || null;
  }
  function isOverdue(last, overdueDays){
    if(!last) return false;
    const days = Math.floor((Date.now() - new Date(last.date)) / 86400000);
    return days > (overdueDays == null ? 7 : overdueDays);
  }

  /* ---------- seeds ----------
     A device with no records invents a facility, a sheet and a round so there is
     something to draw. That is where it starts, not something anybody observed -
     the same distinction Glass keeps for its survey notes. It is marked, kept off
     the wire while it is untouched, and dropped when real facilities arrive.
     Sent early, it added a phantom facility to everybody's list and shifted the
     real one's order.

     A tree is a facility with its sheets and their rounds. It is only a seed while
     every record in it is still marked: one real edit anywhere sends the whole
     tree, so a round never arrives under a sheet the server has not seen. */
  function treeOf(sh, se){
    const facOfSheet=id=>sh[id]&&sh[id].facilityId;
    return {facOfSheet, facOfRec:(kind,r)=>kind==="fac"?r.id:kind==="sh"?r.facilityId:facOfSheet(r.sheetId)};
  }
  function seedTrees(){
    const {fac,sh,se}=SNAP, t=treeOf(sh,se), real=new Set(), seen=new Set();
    [["fac",fac],["sh",sh],["se",se]].forEach(([k,m])=>{
      for(const id in m){ const r=m[id]; if(!r) continue; const f=t.facOfRec(k,r);
        if(f!=null) seen.add(f);
        if(!r.seed) real.add(f==null?"\u0000"+id:f); } });
    return new Set([...seen].filter(f=>!real.has(f)));
  }

  /* A reading is stored as a label: sixteen of them in eighths, and "2+" which
     counts as 2.1. This is the one parser; Ice's own parseFrac is the same rule,
     and facilitiestest checks the two agree on every label. */
  function readingValue(label){
    const f = String(label).replace(/"/g,"").trim();
    if(f === "2+") return 2.1;
    if(f.includes(" ")){ const [w,fr] = f.split(" "), [n,d] = fr.split("/"); return +w + (+n)/(+d); }
    if(f.includes("/")){ const [n,d] = f.split("/"); return (+n)/(+d); }
    return +f;
  }
  /* The average thickness of each of the last n rounds that has readings, oldest
     first. One calculation for the Sheets page and, later, Ice's Trends. */
  function trendOf(sessions, sheetId, n){
    return (sessions||[])
      .filter(s => hasReadings(s) && s.sheetId === sheetId)
      .sort((a,b) => new Date(a.date) - new Date(b.date))
      .slice(-(n||10))
      .map(s => { const v = Object.values(s.data).map(readingValue).filter(isFinite);
                  return {id:s.id, date:s.date, n:v.length, avg:v.reduce((a,b)=>a+b,0)/v.length}; });
  }
  /* What Glass has on this device for a sheet: whether it has a layout and how
     many pieces are flagged. Read from Glass's own storage, so a device that has
     not opened Glass says "not known" instead of guessing. Writes nothing. */
  async function glassSummary(sheetId){
    const v2 = await rd("glass_record_v2");
    if(!v2) return {known:false};
    const bound = v2.boundSheetId === sheetId;
    const spec = v2.specs && v2.specs[sheetId], drawn = v2.built && v2.built[sheetId];
    const layout = bound || !!(spec || drawn);
    /* The boards the glass was last built and checked against: the walk's own
       dimensions, the drawing's recorded perimeter, or Conway's survey. */
    const verified = bound ? CONWAY_VERIFIED
      : spec && isFinite(spec.L) && isFinite(spec.W) && isFinite(spec.R) ? perimeterOf(spec.L, spec.W, spec.R)
      : drawn && drawn.rink && isFinite(drawn.rink.perimeter_ft) ? drawn.rink.perimeter_ft : null;
    let replace = 0, plexi = 0;
    (bound ? [sheetId,"legacy"] : [sheetId]).forEach(b => Object.values((v2.records||{})[b]||{}).forEach(r => {
      if(r && r.status === "replace") replace++; else if(r && r.status === "plexi") plexi++; }));
    return {known:true, layout, replace, plexi, verified};
  }

  /* ---- Glass in the backup ------------------------------------------------------------------
     What Glass keeps on a device (panel conditions, the binding, the layouts walked, the spare-glass
     movements and the one-tap widths) lives under one key of its own. It travels in the same backup file as
     Ice's records, and comes back by the same rule: newest wins per record, movements are added, nothing is
     deleted. A Glass file saved before this ({rink, saved, panels}) is read as panels of Conway's glass. */
  const GLASS_KEY = "glass_record_v2";
  const glassStamp = r => (r && (r.updatedAt || r.at)) || "";
  function glassCounts(g){
    let panels = 0;
    for(const b in (g.records||{})) for(const id in g.records[b]){ const v = g.records[b][id]; if(v && !v.seed && !v.deleted) panels++; }
    return {panels, spares:Object.keys(g.spares||{}).length, widths:Object.keys(g.widths||{}).length, layouts:Object.keys(g.specs||{}).length};
  }
  function glassFromLegacy(obj){
    const recs = {};
    for(const id in obj.panels){ const v = obj.panels[id]; if(v) recs[id] = Object.assign({}, v, {updatedAt: v.updatedAt || v.at || obj.saved}); }
    return {records:{legacy:recs}};
  }
  function mergeGlass(cur, inc){
    const snap = cur && typeof cur === "object" ? JSON.parse(JSON.stringify(cur)) : {};
    ["records","spares","widths","specs","at","gone","names"].forEach(k => { snap[k] = snap[k] || {}; });
    let taken = 0;
    for(const b in (inc.records||{})){
      for(const pid in inc.records[b]){
        const v = inc.records[b][pid]; if(!v || v.seed) continue;
        const c = snap.records[b] && snap.records[b][pid];
        if(!c || c.seed || glassStamp(v) > glassStamp(c)){ (snap.records[b] = snap.records[b] || {})[pid] = v; taken++; }
      }
    }
    ["spares","widths"].forEach(k => { for(const id in (inc[k]||{})){
      const v = inc[k][id]; if(!v) continue;
      if(!snap[k][id] || glassStamp(v) > glassStamp(snap[k][id])){ snap[k][id] = v; taken++; } } });
    for(const b in (inc.specs||{})){
      const at = (inc.at||{})[b] || "";
      if(at > (snap.gone[b]||"") && (!snap.specs[b] || at > (snap.at[b]||""))){
        snap.specs[b] = inc.specs[b]; snap.at[b] = at; if(inc.names && inc.names[b]) snap.names[b] = inc.names[b]; taken++;
      }
    }
    for(const b in (inc.gone||{})){
      if(inc.gone[b] > (snap.gone[b]||"") && inc.gone[b] > (snap.at[b]||"")){ snap.gone[b] = inc.gone[b]; delete snap.specs[b]; snap.at[b] = inc.gone[b]; taken++; }
    }
    if(inc.boundSheetId && (inc.bindingAt||"") > (snap.bindingAt||"")){ snap.boundSheetId = inc.boundSheetId; snap.bindingAt = inc.bindingAt; taken++; }
    return {snap, taken};
  }

  const Repo = {
    async save(st,opts){
      const d=decompose(st);
      /* A sheet that has been removed is no longer in anyone's state, so neither are its
         rounds, and a save treats whatever is missing from the state as deleted. That would
         tombstone every reading on a hidden sheet the next time any page saved. Rounds of a
         hidden sheet are carried over exactly as they are, so removing a sheet really does
         keep its readings, and bringing it back finds them. */
      for(const id in SNAP.se){
        const z=SNAP.se[id], sh=z&&!z.deleted&&SNAP.sh[z.sheetId];
        if(sh&&sh.deleted&&sh.name&&!(id in d.se)) d.se[id]=z;
      }
      SNAP={fac:stampChanges(d.fac,SNAP.fac),sh:stampChanges(d.sh,SNAP.sh),se:stampChanges(d.se,SNAP.se)};
      if(opts&&opts.seed) [SNAP.fac,SNAP.sh,SNAP.se].forEach(m=>{for(const id in m) if(m[id]&&!m[id].deleted) m[id].seed=true;});
      const prefs={};PREF_KEYS.forEach(k=>prefs[k]=st[k]);
      await Promise.all([Store.set(K.fac,JSON.stringify(SNAP.fac)),Store.set(K.sh,JSON.stringify(SNAP.sh)),
                         Store.set(K.se,JSON.stringify(SNAP.se)),Store.set(K.prefs,JSON.stringify(prefs))]);
    },

    /* Read-only, and no migration: a page that only ever calls this cannot
       write anything at all. It also leaves SNAP alone, so nothing read here
       can later be saved back out by accident. */
    async read(){
      const [fac,sh,se,prefs]=await Promise.all([rd(K.fac),rd(K.sh),rd(K.se),rd(K.prefs)]);
      if(!(fac&&sh&&se)) return null;
      return { prefs: prefs||{}, facilities: reassemble(fac,sh,se),
               sessions: Object.values(se).filter(Boolean) };
    },

    async load(){
      let [fac,sh,se,prefs]=await Promise.all([rd(K.fac),rd(K.sh),rd(K.se),rd(K.prefs)]);
      if(fac&&sh&&se){
        SNAP={fac,sh,se};
        const st=Object.assign({},prefs||{},{facilities:reassemble(fac,sh,se)});
        if(st.facilities.length)return st;
      }
      const legacy=await rd(K.legacy);          // one-time move off the single blob
      if(legacy&&Array.isArray(legacy.facilities)&&legacy.facilities.length){
        await this.save(legacy);                // the old key is left untouched as a fallback
        return legacy;
      }
      return null;
    },

    /* Preferences only. Read, patch, write back — every other preference on
       this device lives in the same object, and no synced record is touched. */
    async savePrefs(patch){
      const prefs=(await rd(K.prefs))||{};
      Object.assign(prefs,patch);
      await Store.set(K.prefs,JSON.stringify(prefs));
      return prefs;
    },

    /* Adding a rink is adding an ice surface: a sheet, and a facility to hang
       it on if this is a new site.

       It goes through load() rather than read(), and that is the whole reason
       it lives in here. save() stamps against what was last written, so a save
       built on read() - which deliberately leaves that snapshot empty - would
       hand every record on the device a fresh updatedAt and make this device
       look newest on all of them. That is precisely the clobber the record
       store exists to prevent, and it is invisible until another device loses
       work. A page cannot get it wrong if it never does the dance itself. */
    async addSheet(opts){
      const o = opts || {};
      const st = (await this.load()) || {};
      if(!Array.isArray(st.facilities)) st.facilities = [];
      let fac = o.facilityId ? st.facilities.find(f => f && f.id === o.facilityId) : null;
      let sheet;
      if(fac){
        sheet = newSheet(o.name, o.size);
        fac.sheets = (fac.sheets || []).concat([sheet]);
      } else {
        fac = newFacility(o.facilityName);
        sheet = fac.sheets[0];
        if(o.name) sheet.name = o.name;
        if(o.size) sheet.size = o.size;
        st.facilities.push(fac);
      }
      /* Land on what you just added - it is why you added it. */
      st.activeFacility = fac.id;
      st.activeSheet = sheet.id;
      st.activeSession = sheet.sessions[0].id;
      await this.save(st);
      return { facilityId: fac.id, sheetId: sheet.id, sessionId: sheet.sessions[0].id };
    },

    /* Fold another copy in, newest wins per record. Readings inside a round are
       merged point by point, so two people logging different spots in the same
       round both keep their work. */
    merge(inc){
      let taken=0;
      const fold=(dst,src,isSession)=>{
        for(const id in src){
          const a=dst[id],b=src[id];
          if(!a){dst[id]=b;taken++;continue;}
          const newer=(b.updatedAt||"")>(a.updatedAt||"");
          if(isSession&&!a.deleted&&!b.deleted){
            const merged=Object.assign({},newer?b:a);
            merged.data =Object.assign({},newer?a.data :b.data ,newer?b.data :a.data );
            merged.notes=Object.assign({},newer?a.notes:b.notes,newer?b.notes:a.notes);
            merged.updatedAt=newer?b.updatedAt:a.updatedAt;
            if(JSON.stringify(merged)!==JSON.stringify(a)){dst[id]=merged;taken++;}
          }else if(newer){dst[id]=b;taken++;}
        }
      };
      /* Real facilities are arriving, so an untouched fabricated one has no reason
         to stay. It was never sent, so nothing needs a tombstone. */
      if(Object.values(inc.facilities||{}).some(f=>f&&!f.deleted)){
        const gone=seedTrees();
        if(gone.size){
          const t=treeOf(SNAP.sh,SNAP.se);
          for(const id in SNAP.se) if(gone.has(t.facOfSheet(SNAP.se[id].sheetId))){ delete SNAP.se[id]; taken++; }
          for(const id in SNAP.sh) if(gone.has(SNAP.sh[id].facilityId)){ delete SNAP.sh[id]; taken++; }
          for(const id in SNAP.fac) if(gone.has(id)){ delete SNAP.fac[id]; taken++; }
        }
      }
      fold(SNAP.fac,inc.facilities||{},false);
      fold(SNAP.sh ,inc.sheets    ||{},false);
      fold(SNAP.se ,inc.sessions  ||{},true);
      return {taken,facilities:reassemble(SNAP.fac,SNAP.sh,SNAP.se)};
    },

    /* Write the maps as they stand. A page that merged records but holds no
       nested state of its own has nothing to hand save() - and re-deriving the
       maps to get there would risk restamping records nobody touched. */
    async persistMaps(){
      await Promise.all([Store.set(K.fac,JSON.stringify(SNAP.fac)),
                         Store.set(K.sh,JSON.stringify(SNAP.sh)),
                         Store.set(K.se,JSON.stringify(SNAP.se))]);
    },

    /* The per-kind maps as last written — what sync collects, and what a
       backup is made of. */
    maps(){ return {fac:SNAP.fac, sh:SNAP.sh, se:SNAP.se}; },

    /* What sync sends: the maps without any tree that is still only a seed, and
       without the mark itself. */
    outgoing(){
      const gone=seedTrees(), t=treeOf(SNAP.sh,SNAP.se), out={fac:{},sh:{},se:{}};
      [["fac",SNAP.fac],["sh",SNAP.sh],["se",SNAP.se]].forEach(([k,m])=>{
        for(const id in m){ const r=m[id]; if(!r) continue;
          if(gone.has(t.facOfRec(k,r))) continue;
          const c=Object.assign({},r); delete c.seed; out[k][id]=c; } });
      return out;
    },

    /* What migrating the old sizes would do, without doing it. For the
       "preview, then approve" step: nothing is written. */
    async previewShapes(){
      const st = await this.read(); if(!st) return [];
      const out = [];
      st.facilities.forEach(f => (f.sheets||[]).forEach(x => {
        if(!x.shape) out.push({id:x.id, name:x.name, from:Object.assign({}, x.size||{}), to:shapeFromSize(x.size)});
      }));
      return out;
    },

    /* Give every sheet without one its shape. Goes through load()/save() like
       every other write, so only the sheets are restamped and Ice's readings are
       not touched. Returns how many it migrated; a second run finds none. */
    async backfillShapes(){
      const st = await this.load(); if(!st) return 0;
      let n = 0;
      st.facilities.forEach(f => (f.sheets||[]).forEach(x => { if(!x.shape){ x.shape = shapeFromSize(x.size); n++; } }));
      if(n) await this.save(st);
      return n;
    },

    /* The one way a sheet's own fields change: its name and its shape. An
       ordinary sheet edit, so it is stamped, tagged and synced like any other and
       nothing inside a round is touched. It goes through load()/save() for the
       reason addSheet() does: a write built on read() would restamp every record
       on the device.

       patch is {name?, shape?}, and shape may be partial - it is laid over the
       sheet's current one. Nothing is applied unless all of it is valid, so a good
       name never lands beside a shape that cannot be drawn. The older size field is
       kept in step for a device on the older build. Returns {changed} or
       {changed:false, error}. */
    async updateSheet(sheetId, patch){
      patch = patch || {};
      const st = await this.load(); if(!st) return {changed:false, error:"no records"};
      let sheet = null;
      st.facilities.forEach(f => (f.sheets||[]).forEach(x => { if(x.id === sheetId) sheet = x; }));
      if(!sheet) return {changed:false, error:"no such sheet"};
      let changed = false;
      if("name" in patch){
        const name = typeof patch.name === "string" ? patch.name.trim() : "";
        if(!name) return {changed:false, error:"a sheet needs a name"};
        if(name !== sheet.name){ sheet.name = name; changed = true; }
      }
      if("shape" in patch){
        const cur = shapeOf(sheet), next = Object.assign({}, cur, patch.shape||{});
        const bad = shapeProblem(next);
        if(bad) return {changed:false, error:bad};
        const same = ["L","W","Rft","Rin","start","turn","flip"].every(k => cur[k] === next[k]);
        if(!(same && sheet.shape)){
          sheet.shape = next;
          const preset = RINK_SIZES.find(r => r.L === next.L && r.W === next.W && Math.abs(r.corner - cornerOf(next)) < 1e-6);
          sheet.size = preset ? Object.assign({}, preset)
                              : {id:"custom", name:"Custom", L:next.L, W:next.W, corner:cornerOf(next)};
          changed = true;
        }
      }
      if(!changed) return {changed:false};
      await this.save(st);
      return {changed:true};
    },

    /* Hide a sheet from every list without losing anything. The tombstone keeps the
       sheet's whole body (name, shape, facility tag), and its rounds are left alone:
       they stay live, just unreachable until it comes back. That is why this does not
       go through save(), which would tombstone every round that is missing from the
       state, readings and all. A facility keeps at least one sheet, because Ice
       reaches straight for the first one. */
    async removeSheet(sheetId){
      await this.load();
      const rec = SNAP.sh[sheetId];
      if(!rec || rec.deleted) return {changed:false, error:"no such sheet"};
      const live = Object.values(SNAP.sh).filter(x => x && !x.deleted && x.facilityId === rec.facilityId);
      if(live.length < 2) return {changed:false, error:"a facility needs at least one sheet"};
      SNAP.sh[sheetId] = Object.assign({}, rec, {deleted:true, updatedAt:nowISO()});
      await this.persistMaps();
      return {changed:true};
    },
    /* ---------- backup ----------
       One file holds every record on the device: the same format Ice has always written,
       so a backup from any build restores into any other. It leaves out a facility that is
       still only an invented seed, strips the marks, and, given `only` (a test on a facility
       id), leaves out every facility the person is not allowed to see: a file is theirs to
       send anywhere, and the data being on the device does not make it theirs to export. */
    async exportAll(opts){
      await this.load();
      const only = opts && opts.only, m = this.outgoing(), t = treeOf(m.sh, m.se);
      const keep = (kind, r) => !only || (t.facOfRec(kind, r) != null && only(t.facOfRec(kind, r)));
      const out = {fac:{}, sh:{}, se:{}};
      [["fac", m.fac], ["sh", m.sh], ["se", m.se]].forEach(([k, o]) => { for(const id in o) if(o[id] && keep(k, o[id])) out[k][id] = o[id]; });
      const file = {format:"rink-ice-v4", exportedAt:nowISO(), facilities:out.fac, sheets:out.sh, sessions:out.se};
      /* Glass's own records are not tagged the way these are, so a person who may only see some facilities gets none of them. */
      const g = only ? null : await rd(GLASS_KEY);
      if(g) file.glass = g;
      return file;
    },
    /* What a backup file would bring in, without bringing it. Understands the record format
       and the older whole-state one. {ok:false} for anything else. */
    previewImport(obj){
      let inc = null, glass = null;
      if(obj && obj.format === "rink-ice-v4" && obj.sessions){
        inc = {facilities:obj.facilities||{}, sheets:obj.sheets||{}, sessions:obj.sessions||{}};
        if(obj.glass && typeof obj.glass === "object") glass = obj.glass;
      } else if(obj && !Array.isArray(obj.facilities) && obj.panels && typeof obj.panels === "object" && obj.saved){
        inc = {facilities:{}, sheets:{}, sessions:{}};                    // a Glass file from before Glass joined the backup
        glass = glassFromLegacy(obj);
      } else if(obj && Array.isArray(obj.facilities) && obj.facilities.length){          // an older whole-state backup
        const d = decompose(obj), t = obj.exportedAt || nowISO(), stamp = o => { const r = {}; for(const k in o) r[k] = Object.assign({}, o[k], {updatedAt:t}); return r; };
        inc = {facilities:stamp(d.fac), sheets:stamp(d.sh), sessions:stamp(d.se)};
      } else return {ok:false, error:"not a backup file"};
      const live = o => Object.values(o).filter(r => r && !r.deleted).length;
      return {ok:true, inc, glassSnap:glass, glass:glass ? glassCounts(glass) : null, rounds:Object.keys(inc.sessions).length, facilities:live(inc.facilities), sheets:live(inc.sheets)};
    },
    /* Merge a backup in, newest wins per record and readings inside a round kept from both. */
    async importAll(obj){
      const pv = this.previewImport(obj); if(!pv.ok) return pv;
      await this.load();
      const res = this.merge(pv.inc);
      if(res.taken) await this.persistMaps();
      let gt = 0;
      if(pv.glassSnap){
        const m = mergeGlass(await rd(GLASS_KEY), pv.glassSnap);
        if(m.taken){ await Store.set(GLASS_KEY, JSON.stringify(m.snap)); gt = m.taken; }
      }
      return {ok:true, taken:res.taken + gt, facilities:res.facilities, rounds:pv.rounds};
    },

    /* The sheets that have been removed, for a page that offers to bring them back. Reads
       local storage and leaves the snapshot alone, like read(): it cannot write a thing. */
    async readRemoved(){
      const sh = await rd(K.sh);
      return Object.values(sh || {}).filter(x => x && x.deleted && x.name && x.facilityId);
    },
    /* Bring a removed sheet back, with its rounds, if its facility is still there. */
    async restoreSheet(sheetId){
      await this.load();
      const rec = SNAP.sh[sheetId];
      if(!rec || !rec.deleted) return {changed:false, error:"that sheet is not removed"};
      if(!rec.name || !rec.facilityId) return {changed:false, error:"that sheet cannot be brought back"};
      const f = SNAP.fac[rec.facilityId];
      if(!f || f.deleted) return {changed:false, error:"its facility is gone"};
      const back = Object.assign({}, rec, {updatedAt:nowISO()}); delete back.deleted;
      SNAP.sh[sheetId] = back;
      await this.persistMaps();
      return {changed:true};
    },

    /* What migrating the settings would do, without doing it. Management's
       "preview, then approve" step, like the shapes. */
    async previewSettings(){
      const st = await this.read(); if(!st) return [];
      const out = [];
      st.facilities.forEach(f => {
        const from = f.settings || {};
        if(settingsNeedUpgrade(from, st.prefs)) out.push({id:f.id, name:f.name, from:Object.assign({}, from), to:settingsOf(from, st.prefs)});
      });
      return out;
    },

    /* Migrate every facility that has not been. Only those facilities are
       restamped, and nothing inside a round. A second run finds none. The device's
       own overdue-days preference is the fallback for a facility with none. */
    async backfillSettings(){
      const st = await this.load(); if(!st) return 0;
      let n = 0;
      st.facilities.forEach(f => {
        if(!f.settings) f.settings = {};
        if(upgradeSettings(f.settings, st)) n++;
      });
      if(n) await this.save(st);
      return n;
    },

    /* The glass builder measured the sheet and the person agreed to update it. */
    updateShape(sheetId, patch){ return this.updateSheet(sheetId, {shape: patch||{}}); },

    snapshot(){return {format:"rink-ice-v4",exportedAt:nowISO(),
      facilities:SNAP.fac,sheets:SNAP.sh,sessions:SNAP.se};}
  };

  global.Records = { KEYS:K, PREF_KEYS, Store, Repo,
                     decompose, reassemble, nowISO, hasReadings, lastRound, isOverdue,
                     RINK_SIZES, NHL_SIZE, DEFAULT_EDGES, SETTINGS_VERSION, eighthUp, eighthNear,
                     readingValue, trendOf, glassSummary, perimeterOf, shapePerimeter,
                     settingsOf, upgradeSettings, settingsNeedUpgrade, overdueDaysOf,
                     STD_CORNER, shapeFromSize, shapeOf, sizeOf, compareShape, shapeProblem, SHAPE_TOLERANCE,
                     uid, newSession, newSheet, defaultSettings, newFacility };
})(this);
