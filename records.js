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
  function lastRound(sessions, sheetId){
    return (sessions||[])
      .filter(s => s && !s.deleted && s.sheetId === sheetId && s.data && Object.keys(s.data).length)
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

    /* The per-kind maps as last written — what sync collects, and what a
       backup is made of. */
    maps(){ return {fac:SNAP.fac, sh:SNAP.sh, se:SNAP.se}; },

    snapshot(){return {format:"rink-ice-v4",exportedAt:nowISO(),
      facilities:SNAP.fac,sheets:SNAP.sh,sessions:SNAP.se};}
  };

  global.Records = { KEYS:K, PREF_KEYS, Store, Repo,
                     decompose, reassemble, nowISO, lastRound, isOverdue };
})(this);
