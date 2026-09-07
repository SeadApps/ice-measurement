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
  const RINK_SIZES = [
    {id:"nhl",   name:"NHL — 200 × 85 ft",      L:200, W:85,  corner:28},
    {id:"intl",  name:"Olympic — 200 × 100 ft", L:200, W:100, corner:28},
    {id:"hybrid",name:"Hybrid — 200 × 90 ft",   L:200, W:90,  corner:28},
    {id:"studio",name:"Studio — 185 × 85 ft",   L:185, W:85,  corner:25}
  ];
  const NHL_SIZE = () => ({...RINK_SIZES[0]});
  const DEFAULT_EDGES = [0.6875,1.4375,1.5625,1.9375];
  const uid = () => Math.random().toString(36).slice(2,9);
  const newSession = () => ({id:uid(),date:new Date().toISOString(),label:"",mode:"moderate",data:{},notes:{}});
  const newSheet = (n,size) => ({id:uid(),name:n||"Main sheet",size:size||NHL_SIZE(),sessions:[newSession()]});
  const defaultSettings = () => ({target:1.5,edges:[...DEFAULT_EDGES],tieAttention:true,floodBelow:1.25,shaveAbove:1.5625});
  const newFacility = n => {const sh=newSheet();return{id:uid(),name:n||"Main facility",settings:defaultSettings(),sheets:[sh]};};

  const nowISO = () => new Date().toISOString();
  const rd = async k => { try{ return JSON.parse(await Store.get(k) || "null"); }catch(e){ return null; } };

  let SNAP = {fac:{},sh:{},se:{}};   // what we last wrote, so we only re-stamp what actually changed

  function decompose(st){
    const fac={},sh={},se={};
    (st.facilities||[]).forEach((f,fi)=>{
      fac[f.id]={id:f.id,name:f.name,settings:f.settings,ord:fi};
      (f.sheets||[]).forEach((x,si)=>{
        sh[x.id]={id:x.id,facilityId:f.id,name:x.name,size:x.size,ord:si};
        (x.sessions||[]).forEach((z,zi)=>{ se[z.id]=Object.assign({},z,{sheetId:x.id,ord:zi}); });
      });
    });
    return {fac,sh,se};
  }
  const bodyOf=r=>{const c=Object.assign({},r);delete c.updatedAt;delete c.deleted;return JSON.stringify(c);};

  /* Stamp only what changed, and leave a tombstone for anything removed, so a
     delete on one device isn't undone by a merge from another. */
  function stampChanges(next,prev){
    const out={},t=nowISO();
    for(const id in next){
      const p=prev[id];
      out[id]=(p&&!p.deleted&&bodyOf(p)===bodyOf(next[id]))
        ? Object.assign({},next[id],{updatedAt:p.updatedAt||t})
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
        sessions:live(se).filter(z=>z.sheetId===x.id).sort(byOrd)
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

    snapshot(){return {format:"rink-ice-v4",exportedAt:nowISO(),
      facilities:SNAP.fac,sheets:SNAP.sh,sessions:SNAP.se};}
  };

  global.Records = { KEYS:K, PREF_KEYS, Store, Repo,
                     decompose, reassemble, nowISO, hasReadings, lastRound, isOverdue,
                     RINK_SIZES, NHL_SIZE, DEFAULT_EDGES,
                     uid, newSession, newSheet, defaultSettings, newFacility };
})(this);
