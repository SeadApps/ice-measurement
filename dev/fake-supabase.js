/* A stand-in for Supabase so the sync layer can be exercised here, where the
   sandbox can't reach the real one. Serves the app files and a good-enough
   slice of the auth + PostgREST behaviour we depend on:
     - password and refresh-token grants
     - GET /rest/v1/records with kind=in.(), updated_at=gt., order, limit
     - POST upsert with on_conflict=kind,id
     - the server, not the client, stamps updated_at
     - no bearer token, no data
   Also fakes a paused project (?pause=1) and flaky writes (?flaky=1).

   D1 adds the person-by-person rules. Two modes, so the old suites keep
   exercising exactly what they always did:

     legacy (default)  the shared account reads and writes everything, as the
                       real project does until the rollout's "tighten" step.
                       The server still stamps changed_by and logs activity,
                       because those are additive.
     tight             /__ctl?tight=1. The shared account may only call
                       staff_names(). A person reads and writes only the
                       facilities they were given (Management: all), writes
                       need an unexpired editing window, Staff cannot write
                       facility or sheet records, and only Management may
                       resolve a flag.

   What a real person looks like here: an auth user whose email is
   <id>@staff.conwayarena.local and whose password is their own code.
   Tests add one with /__staff. */
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');

const ROOT = require('path').join(__dirname, '..');   // serve the repo root
const EMAIL = 'operations@conwayarena.local';
const STAFF_DOMAIN = '@staff.conwayarena.local';
const DEFAULT_CODE = 'test-access-code';
const EDIT_CODE = 'test-editing-code';
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png'};
const SETTINGS_KINDS = ['facility','sheet'];     // Staff may read these, never write them

let rows, tokens, staff, unlocks, failures, activity, opts, codeTimes, lastMs = 0;
function reset(){
  rows = new Map();       // "kind id" -> {id,kind,body,deleted,updated_at,facility_id,changed_by,changed_by_name}
  tokens = new Map();     // access -> {exp,user,kind} ; "r:"+refresh -> {exp,user,kind}
  staff = new Map();      // id -> {id,name,role,code,active,facilities:[]}
  unlocks = new Map();    // user id -> expiry ms
  failures = new Map();   // user id -> [ms of each wrong editing code]
  activity = [];          // append-only
  codeTimes = {access:null, editing:null};   // when each shared code was last changed through manage-staff
  opts = {paused:false, flaky:0, writes:0, tight:false, code:DEFAULT_CODE, editCode:EDIT_CODE, unlockMs:3600000,
          softremove:false};
}
reset();

function stamp(){                     // strictly increasing, so cursors never skip
  let ms = Date.now();
  if (ms <= lastMs) ms = lastMs + 1;
  lastMs = ms;
  return new Date(ms).toISOString();
}
const json = (res,code,obj) => { res.writeHead(code,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(obj)); };
const body = req => new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{r(JSON.parse(b||'null'))}catch(e){r(null)}})});

/* Who is calling: {kind:'device'} for the shared account, {kind:'person',user}
   for a signed-in person, null for nobody (or an expired token). */
function who(req){
  const t = (req.headers.authorization || '').replace(/^Bearer /,'');
  const s = t && tokens.get(t);
  if (!s || s.exp <= Date.now()) return null;
  if (s.kind === 'person'){
    const p = staff.get(s.user);
    if (!p || !p.active) return null;          // a removed person is signed out at once
    return {kind:'person', user:p};
  }
  return {kind:'device'};
}
/* Three roles. An Admin sees and does everything. A Manager is scoped to the facilities they were given, like Staff, and
   may also change those facilities' settings and sheets, resolve their flags, and look after their own Staff. */
const isAdmin = w => w && w.kind === 'person' && w.user.role === 'admin';
const isManagerRole = w => w && w.kind === 'person' && w.user.role === 'manager';
const mayFacility = (w, fac) => isAdmin(w) || (w.kind === 'person' && !!fac && (w.user.facilities || []).includes(fac));
const editing = w => w.kind === 'person' && (unlocks.get(w.user.id) || 0) > Date.now();

function visible(w, r){
  if (!opts.tight) return true;
  if (!w || w.kind !== 'person') return false;
  return isAdmin(w) || mayFacility(w, r.facility_id);
}

/* Applies one incoming row the way the table's triggers would. Returns an
   error string to refuse the whole batch, or null. */
function check(w, r){
  if (!opts.tight) return null;
  /* A row that already exists belongs to the facility it was written under.
     Without this a Staff person could take over another facility's record by
     rewriting it with their own facility's tag. */
  const old = rows.get(r.kind+' '+r.id);
  if (old && !isAdmin(w) && !(old.facility_id && mayFacility(w, old.facility_id))) return 'not your facility';
  if (!w || w.kind !== 'person') return 'the shared account may not write';
  if (!editing(w)) return 'editing is locked';
  const fac = r.body && r.body.fac;
  if (!fac && !isAdmin(w)) return 'untagged records are Admin only';
  if (!mayFacility(w, fac)) return 'not your facility';
  if (w.user.role === 'staff' && SETTINGS_KINDS.includes(r.kind)) return 'settings are for Managers and Admins only';
  /* A Manager may change their own facility's settings and its sheets, but a facility is made, hidden and brought back by an Admin. */
  if (isManagerRole(w) && r.kind === 'facility' && (!old || old.deleted || r.deleted)) return 'only an Admin adds, removes or restores a facility';
  /* Resolved is a Manager's or an Admin's to set, and so is taking it back: a Staff write
     over a resolved flag (reopening it, or editing it) is refused. */
  if (w.user.role === 'staff' && r.kind === 'flag' &&
      ((r.body && r.body.status === 'resolved') || (old && old.body && old.body.status === 'resolved')))
    return 'only a Manager or Admin resolves or reopens a flag';
  return null;
}

/* Postgres jsonb does not keep the order keys were written in: it stores them sorted by
   length, then by bytes, and PostgREST hands them back that way. Returning bodies like
   that is what makes a test able to notice code that depends on key order, which the
   insertion-ordered objects of a plain fake never could. */
function jsonb(v){
  if (Array.isArray(v)) return v.map(jsonb);
  if (v && typeof v === 'object'){
    const o = {};
    Object.keys(v).sort((a,b)=> a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).forEach(k => { o[k] = jsonb(v[k]); });
    return o;
  }
  return v;
}

function authToken(user, kind, ttl){
  const at = 'at_'+Math.random().toString(36).slice(2), rt = 'rt_'+Math.random().toString(36).slice(2);
  tokens.set(at, {exp:Date.now()+ttl*1000, user, kind});
  tokens.set('r:'+rt, {exp:Date.now()+30*86400000, user, kind});
  return {access_token:at, refresh_token:rt, expires_in:ttl, token_type:'bearer'};
}

const server = http.createServer(async (req,res)=>{
  const u = url.parse(req.url, true);
  const p = u.pathname;

  if (req.method === 'OPTIONS'){ res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}); return res.end(); }

  // test controls
  if (p === '/__ctl'){
    const q = u.query;
    if (q.paused !== undefined) opts.paused = q.paused === '1';
    if (q.flaky !== undefined) opts.flaky = +q.flaky;
    if (q.tight !== undefined) opts.tight = q.tight === '1';
    if (q.unlockms !== undefined) opts.unlockMs = +q.unlockms;
    if (q.editcode !== undefined) opts.editCode = q.editcode;
    if (q.softremove !== undefined) opts.softremove = q.softremove === '1';   // a removed person is refused with 403, not 400/401
    if (q.clearfailures === '1') failures = new Map();
    if (q.code !== undefined){                      // rotating the access code signs every device out
      opts.code = q.code;
      for (const [k,s] of tokens) if (s.kind === 'device') tokens.delete(k);
    }
    return json(res,200,{ok:true,opts,rows:rows.size});
  }
  if (p === '/__rows'){ return json(res,200,[...rows.values()]); }
  if (p === '/__unlocks'){ const o = {}; for (const [k,v] of unlocks) if (v > Date.now()) o[k] = new Date(v).toISOString(); return json(res,200,o); }
  if (p === '/__activity'){ return json(res,200,activity); }
  if (p === '/__reset'){ reset(); return json(res,200,{ok:true}); }
  /* Add, change or remove a person: POST {id,name,role,code,facilities} or
     ?remove=id / ?restore=id. Stands in for the manage-staff Edge Function. */
  if (p === '/__staff'){
    if (u.query.remove || u.query.restore){
      const s = staff.get(u.query.remove || u.query.restore);
      if (s) s.active = !u.query.remove;
      return json(res,200,{ok:!!s});
    }
    const b = await body(req);
    if (b && b.id){
      const old = staff.get(b.id) || {};
      staff.set(b.id, Object.assign({name:b.id, role:'staff', code:'', active:true, facilities:[]}, old, b));
    }
    return json(res,200,[...staff.values()]);
  }

  if (opts.paused && p.startsWith('/auth') || opts.paused && p.startsWith('/rest')){
    res.writeHead(503,{'Access-Control-Allow-Origin':'*'}); return res.end('paused');
  }

  // ---- auth ----
  if (p === '/auth/v1/health') return json(res,200,{date:new Date().toISOString()});
  if (p === '/auth/v1/token'){
    const b = await body(req);
    const bad = () => json(res,400,{error:'invalid_grant',error_description:'Invalid login credentials'});
    const ttl = +(u.query.ttl || 3600);
    if (u.query.grant_type === 'password'){
      if (!b) return bad();
      if (b.email === EMAIL){
        if (b.password !== opts.code) return bad();
        return json(res,200,authToken(null,'device',ttl));
      }
      const id = String(b.email||'').endsWith(STAFF_DOMAIN) ? b.email.slice(0, -STAFF_DOMAIN.length) : null;
      const s = id && staff.get(id);
      if (!s || !s.active || s.code !== b.password) return bad();
      s.lastSignIn = new Date().toISOString();
      return json(res,200,authToken(s.id,'person',ttl));
    } else if (u.query.grant_type === 'refresh_token'){
      const old = b && tokens.get('r:'+b.refresh_token);
      if (!old) return json(res,400,{error:'invalid_grant',error_description:'Invalid Refresh Token'});
      if (old.kind === 'person'){
        const s = staff.get(old.user);
        if (!s || !s.active) return json(res, opts.softremove ? 403 : 400,
                                         {error:'invalid_grant',error_description:opts.softremove ? 'User is banned' : 'Invalid Refresh Token'});
      }
      return json(res,200,authToken(old.user,old.kind,ttl));
    } else return json(res,400,{error:'unsupported_grant_type'});
  }

  /* ---- manage-staff: stands in for the Edge Function (supabase/functions/manage-staff) ----
     Same actions, same refusals, same wording, because the Staff page is tested against it.
     Only an active Admin or Manager may call it; a Manager only for Staff whose every facility is one of theirs. A code
     it makes is returned once and kept nowhere a list could read it back. */
  if (p === '/functions/v1/manage-staff'){
    if (req.method !== 'POST') return json(res,405,{error:'POST only'});
    const w = who(req);
    if (!w || w.kind !== 'person') return json(res,401,{error:'Sign in first.'});
    if (!isAdmin(w) && !isManagerRole(w)) return json(res,403,{error:'Only Managers and Admins can do this.'});
    const b = await body(req);
    if (!b || typeof b !== 'object') return json(res,400,{error:'Send JSON.'});
    const fail = (c, m) => json(res,c,{error:m});
    const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const makeCode = () => Array.from({length:10}, () => ALPHABET[Math.floor(Math.random()*ALPHABET.length)]).join('');
    const asList = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x).map(String) : [];
    const admins = () => [...staff.values()].filter(s => s.role === 'admin' && s.active);
    const find = () => staff.get(String(b.login || ''));
    const mine = (w.user.facilities || []);
    const notAdmin = () => { if (isAdmin(w)) return false; fail(403,'Only an Admin can do this.'); return true; };
    /* A Manager sees Staff who hold at least one of their facilities, and may change those who hold only theirs. */
    const seen = s => isAdmin(w) || (s.role === 'staff' && (s.facilities || []).some(f => mine.includes(f)));
    const editable = s => isAdmin(w) || (s.role === 'staff' && (s.facilities || []).length > 0 && s.facilities.every(f => mine.includes(f)));
    const ROLES = ['admin','manager','staff'];
    switch (b.action){
      case 'list':
        return json(res,200,{people:[...staff.values()].filter(seen).sort((a,c)=>String(a.name).localeCompare(c.name)).map(s => ({
          login:s.id, name:s.name, role:s.role, active:s.active, facilities:s.role === 'admin' ? [] : (s.facilities || []).slice().sort(),
          last_sign_in:s.lastSignIn || null, editable:editable(s)}))});
      case 'codes':
        if (notAdmin()) return;
        return json(res,200,{access:codeTimes.access, editing:codeTimes.editing});
      case 'add': {
        const name = String(b.name || '').trim(), role = ROLES.includes(b.role) ? b.role : 'staff';
        if (!name) return fail(400,'A name is needed.');
        const facs = asList(b.facilities);
        if (!isAdmin(w)){
          if (role !== 'staff') return fail(403,'Only an Admin can add a Manager or an Admin.');
          if (!facs.length) return fail(400,'Pick at least one of your facilities.');
          if (!facs.every(f => mine.includes(f))) return fail(403,'You can only give people your own facilities.');
        }
        const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24) || 'person';
        const login = slug + '-' + Array.from({length:3}, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random()*31)]).join('');
        const code = makeCode();
        staff.set(login, {id:login, name, role, code, active:true, facilities:role === 'admin' ? [] : facs});
        return json(res,200,{login, code});
      }
      case 'update': {
        const s = find(); if (!s || !seen(s)) return fail(404,'No such person.');
        if (!editable(s)) return fail(403,'You can only change people who are in your own facilities.');
        const role = b.role === undefined ? s.role : (ROLES.includes(b.role) ? b.role : 'staff');
        if (!isAdmin(w) && role !== s.role) return fail(403,'Only an Admin can change a role.');
        if (s.role === 'admin' && role !== 'admin' && admins().length <= 1) return fail(409,'That would leave no Admin.');
        const facs = b.facilities === undefined ? (s.facilities || []) : asList(b.facilities);
        if (!isAdmin(w) && b.facilities !== undefined){
          if (!facs.length) return fail(400,'Pick at least one of your facilities.');
          if (!facs.every(f => mine.includes(f))) return fail(403,'You can only give people your own facilities.');
        }
        if (b.name !== undefined) s.name = String(b.name).trim() || s.name;
        s.role = role;
        s.facilities = role === 'admin' ? [] : facs;
        return json(res,200,{ok:true});
      }
      case 'reset_code': {
        const s = find(); if (!s || !seen(s)) return fail(404,'No such person.');
        if (!editable(s)) return fail(403,'You can only change people who are in your own facilities.');
        s.code = makeCode();
        return json(res,200,{code:s.code});
      }
      case 'remove': case 'restore': {
        const s = find(); if (!s || !seen(s)) return fail(404,'No such person.');
        if (!editable(s)) return fail(403,'You can only change people who are in your own facilities.');
        const removing = b.action === 'remove';
        if (removing && s.id === w.user.id) return fail(409,'You cannot remove yourself.');
        if (removing && s.role === 'admin' && admins().filter(m => m.id !== s.id).length === 0) return fail(409,'That would leave no Admin.');
        s.active = !removing;
        if (removing) unlocks.delete(s.id);
        return json(res,200,{ok:true});
      }
      case 'set_access_code': {
        if (notAdmin()) return;
        const code = String(b.code || '');
        if (code.length < 8) return fail(400,'The access code needs at least 8 characters.');
        opts.code = code; codeTimes.access = new Date().toISOString();
        for (const [k,s] of tokens) if (s.kind === 'device') tokens.delete(k);     // every device is asked again
        return json(res,200,{ok:true});
      }
      case 'set_editing_code': {
        if (notAdmin()) return;
        const code = String(b.code || '');
        if (code.length < 8) return fail(400,'The editing code needs at least 8 characters.');
        opts.editCode = code; codeTimes.editing = new Date().toISOString();
        unlocks.clear();                                                           // everyone's open window ends with the old code
        return json(res,200,{ok:true});
      }
      default: return fail(400,'Unknown action.');
    }
  }

  // ---- functions ----
  if (p.startsWith('/rest/v1/rpc/')){
    const w = who(req);
    const fn = p.slice('/rest/v1/rpc/'.length);
    if (!w && opts.softremove && fn === 'my_facilities') {
      const t = (req.headers.authorization || '').replace(/^Bearer /,''), s = t && tokens.get(t);
      const gone = s && s.kind === 'person' && s.exp > Date.now() && staff.get(s.user) && !staff.get(s.user).active;
      if (gone) return json(res,403,{message:'signed out'});   // the token is still good; the person is not
    }
    if (!w) return json(res,401,{message:'JWT expired or missing'});
    if (fn === 'staff_names')                    // the one thing the shared account may call
      return json(res,200,[...staff.values()].filter(s=>s.active).map(s=>({id:s.id,name:s.name})));
    if (w.kind !== 'person') return json(res,403,{message:'sign in as a person first'});
    if (fn === 'my_facilities') return json(res,200,{role:w.user.role, facilities:w.user.facilities});
    if (fn === 'unlock_editing'){
      const b = await body(req);
      const recent = (failures.get(w.user.id) || []).filter(t => t > Date.now() - 600000);
      if (recent.length >= 5) return json(res,403,{message:'Too many tries. Wait a few minutes and try again.'});
      if (!b || b.code !== opts.editCode){
        failures.set(w.user.id, recent.concat(Date.now()));
        return json(res,403,{message:'That editing code does not match.'});
      }
      failures.delete(w.user.id);
      const until = Date.now() + opts.unlockMs;
      unlocks.set(w.user.id, until);
      return json(res,200,{until:new Date(until).toISOString()});
    }
    if (fn === 'lock_editing'){ unlocks.delete(w.user.id); return json(res,200,{ok:true}); }
    if (fn === 'extend_editing'){
      if (!editing(w)) return json(res,403,{message:'editing is locked'});
      const until = Date.now() + opts.unlockMs;
      unlocks.set(w.user.id, until);
      return json(res,200,{until:new Date(until).toISOString()});
    }
    return json(res,404,{message:'no such function'});
  }

  // ---- activity: readable by an Admin (all of it) and a Manager (their facilities), never written by a device ----
  if (p === '/rest/v1/activity'){
    const w = who(req);
    if (!w) return json(res,401,{message:'JWT expired or missing'});
    if (req.method !== 'GET') return json(res,403,{message:'the log is append-only'});
    if (!isAdmin(w) && !isManagerRole(w)) return json(res,403,{message:'Managers and Admins only'});
    /* The few PostgREST filters the Changes page needs. */
    let out = activity.slice();
    if (!isAdmin(w)) out = out.filter(r => r.facility_id && (w.user.facilities || []).includes(r.facility_id));
    const eq = k => { const m = u.query[k] && /^eq\.(.*)$/.exec(u.query[k]); return m ? decodeURIComponent(m[1]) : null; };
    for (const k of ['id','kind','facility_id','changed_by']) { const v = eq(k); if (v !== null) out = out.filter(r=>String(r[k]) === v); }
    const gt = u.query.at && /^gt\.(.*)$/.exec(u.query.at);
    if (gt) out = out.filter(r=>r.at > decodeURIComponent(gt[1]));
    const kin = u.query.kind && /^in\.\((.*)\)$/.exec(u.query.kind);
    if (kin) { const ks = decodeURIComponent(kin[1]).split(','); out = out.filter(r=>ks.includes(r.kind)); }
    const lt = u.query.seq && /^lt\.(.*)$/.exec(u.query.seq);
    if (lt) out = out.filter(r=>r.seq < +decodeURIComponent(lt[1]));
    if (u.query.order === 'seq.desc') out.reverse();
    if (u.query.limit) out = out.slice(0, +u.query.limit);
    return json(res,200,out);
  }

  // ---- records ----
  if (p === '/rest/v1/records'){
    const w = who(req);
    if (!w) return json(res,401,{message:'JWT expired or missing'});

    if (req.method === 'GET'){
      let out = [...rows.values()].filter(r=>visible(w,r));
      const kindIn = u.query.kind && /^in\.\((.*)\)$/.exec(u.query.kind);
      if (kindIn) { const ks = kindIn[1].split(','); out = out.filter(r=>ks.includes(r.kind)); }
      const gt = u.query.updated_at && /^gt\.(.*)$/.exec(u.query.updated_at);
      if (gt) out = out.filter(r=>r.updated_at > decodeURIComponent(gt[1]));
      out.sort((a,b)=> a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0);
      if (u.query.limit) out = out.slice(0, +u.query.limit);
      return json(res,200,out);
    }

    if (req.method === 'POST'){
      const b = await body(req);
      if (!Array.isArray(b)) return json(res,400,{message:'expected an array'});
      opts.writes++;
      if (opts.flaky && opts.writes % opts.flaky === 0)      // every Nth write fails
        return json(res,500,{message:'simulated failure'});
      for (const r of b){ const e = check(w, r); if (e) return json(res,403,{message:e}); }
      b.forEach(r=>{
        const key = r.kind+' '+r.id, old = rows.get(key);
        /* What the trigger does: the stamp comes from the session, never from
           the row, and a changedBy smuggled into the body is thrown away. */
        const nb = jsonb(Object.assign({}, r.body || {}));
        delete nb.changedBy; delete nb.changed_by;
        const person = w.kind === 'person' ? w.user : null;
        const row = {id:r.id, kind:r.kind, body:nb, deleted:!!r.deleted, updated_at:stamp(),
                     facility_id:nb.fac || null,
                     changed_by:person ? person.id : null,
                     changed_by_name:person ? person.name : null};
        rows.set(key, row);
        activity.push({seq:activity.length+1, kind:r.kind, id:r.id, facility_id:row.facility_id,
                       changed_by:row.changed_by, changed_by_name:row.changed_by_name, at:row.updated_at,
                       old_body:old ? old.body : null, new_body:nb, old_deleted:old ? old.deleted : null, deleted:row.deleted});
      });
      res.writeHead(201,{'Access-Control-Allow-Origin':'*'}); return res.end();
    }
    return json(res,405,{message:'no'});
  }

  // ---- static files ----
  let f = p === '/' ? '/index.html' : p;
  const full = path.join(ROOT, f);
  fs.readFile(full,(e,d)=>{
    if (e){ res.writeHead(404); return res.end('not found'); }
    res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'text/plain'});
    res.end(d);
  });
});

server.listen(8200, ()=>console.log('fake supabase + site on http://localhost:8200'));
