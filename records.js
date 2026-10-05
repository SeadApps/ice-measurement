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
                     "activeFacility","activeSheet","activeSession","screen","lastView"];

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
  const DEFAULT_EDGES = [0.6875,1.4375,1.5625,1.9375];
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
  function shapeFromSize(size){
    size = size || NHL_SIZE();
    /* Exactly 28 is the old preset's corner, the one that disagreed with the glass
       survey, so it moves to the standard. Any other corner was somebody's choice. */
    const c = size.corner===28 ? STD_CORNER : (+size.corner || STD_CORNER);
    const inches = Math.round(c*12);
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
  /* A shape that can be drawn: positive, whole inches, and a corner that fits. */
  function shapeProblem(s){
    if(!(s.L > 0 && s.W > 0)) return "a sheet needs a length and a width";
    if(!(s.Rft >= 0 && s.Rin >= 0 && s.Rin < 12 && s.Rin === Math.floor(s.Rin))) return "the corner is in feet and whole inches";
    if(!(2*cornerOf(s) < Math.min(s.L, s.W))) return "that corner is too big for a sheet this size";
    return "";
  }

  const newSheet = (n,size) => { const sz = size || NHL_SIZE();
    return {id:uid(),name:n||"Main sheet",size:sz,shape:shapeFromSize(sz),sessions:[newSession()]}; };
  const defaultSettings = () => ({target:1.5,edges:[...DEFAULT_EDGES],tieAttention:true,floodBelow:1.25,shaveAbove:1.5625});
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
      fac[f.id]={id:f.id,name:f.name,settings:f.settings,ord:fi,fac:f.id};
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
  const bodyOf=r=>{const c=Object.assign({},r);delete c.updatedAt;delete c.deleted;delete c.changedBy;delete c.fac;return JSON.stringify(c);};

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
  const detach = r => !r ? r : Object.assign({}, r,
    r.data  ? {data:  Object.assign({}, r.data)}  : {},
    r.notes ? {notes: Object.assign({}, r.notes)} : {});

  /* Stamp only what changed, and leave a tombstone for anything removed, so a
     delete on one device isn't undone by a merge from another. */
  function stampChanges(next,prev){
    const out={},t=nowISO();
    for(const id in next){
      const p=prev[id];
      out[id]=(p&&!p.deleted&&bodyOf(p)===bodyOf(next[id]))
        ? Object.assign({},next[id],{updatedAt:p.updatedAt||t},p.changedBy?{changedBy:p.changedBy}:{})
        : Object.assign({},next[id],{updatedAt:t});
    }
    for(const id in prev){ if(!(id in next)) out[id]=prev[id].deleted?prev[id]:{id,deleted:true,updatedAt:t}; }
    return out;
  }
  function reassemble(fac,sh,se){
    const live=o=>Object.values(o).filter(r=>r&&!r.deleted);
    const byOrd=(a,b)=>(a.ord||0)-(b.ord||0)||String(a.id).localeCompare(String(b.id));
    return live(fac).sort(byOrd).map(f=>Object.assign({},f,{
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

  const Repo = {
    async save(st){
      const d=decompose(st);
      SNAP={fac:stampChanges(d.fac,SNAP.fac),sh:stampChanges(d.sh,SNAP.sh),se:stampChanges(d.se,SNAP.se)};
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

    /* The glass builder measured the sheet and the person agreed to update it.
       An ordinary sheet edit: stamped, tagged and synced like any other, and
       nothing inside a round is touched. The old size field is kept in step for
       a device on the older build. */
    async updateShape(sheetId, patch){
      const st = await this.load(); if(!st) return {changed:false, error:"no records"};
      let sheet = null;
      st.facilities.forEach(f => (f.sheets||[]).forEach(x => { if(x.id === sheetId) sheet = x; }));
      if(!sheet) return {changed:false, error:"no such sheet"};
      const cur = shapeOf(sheet), next = Object.assign({}, cur, patch||{});
      const bad = shapeProblem(next);
      if(bad) return {changed:false, error:bad};
      const same = ["L","W","Rft","Rin","start","turn","flip"].every(k => cur[k] === next[k]);
      if(same && sheet.shape) return {changed:false};
      sheet.shape = next;
      const preset = RINK_SIZES.find(r => r.L === next.L && r.W === next.W && Math.abs(r.corner - cornerOf(next)) < 1e-6);
      sheet.size = preset ? Object.assign({}, preset)
                          : {id:"custom", name:"Custom", L:next.L, W:next.W, corner:cornerOf(next)};
      await this.save(st);
      return {changed:true};
    },

    snapshot(){return {format:"rink-ice-v4",exportedAt:nowISO(),
      facilities:SNAP.fac,sheets:SNAP.sh,sessions:SNAP.se};}
  };

  global.Records = { KEYS:K, PREF_KEYS, Store, Repo,
                     decompose, reassemble, nowISO, hasReadings, lastRound, isOverdue,
                     RINK_SIZES, NHL_SIZE, DEFAULT_EDGES,
                     STD_CORNER, shapeFromSize, shapeOf, sizeOf, compareShape, shapeProblem, SHAPE_TOLERANCE,
                     uid, newSession, newSheet, defaultSettings, newFacility };
})(this);
