/* A stand-in for Supabase so the sync layer can be exercised here, where the
   sandbox can't reach the real one. Serves the app files and a good-enough
   slice of the auth + PostgREST behaviour we depend on:
     - password and refresh-token grants
     - GET /rest/v1/records with kind=in.(), updated_at=gt., order, limit
     - POST upsert with on_conflict=kind,id
     - the server, not the client, stamps updated_at
     - no bearer token, no data
   Also fakes a paused project (?pause=1) and flaky writes (?flaky=1). */
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');

const ROOT = require('path').join(__dirname, '..');   // serve the repo root
const EMAIL = 'operations@conwayarena.local';
const CODE  = 'test-access-code';
const TYPES = {'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png'};

let rows = new Map();                 // "kind id" -> {id,kind,body,deleted,updated_at}
let tokens = new Map();               // access -> expiry ; refresh -> access
let lastMs = 0;
let opts = {paused:false, flaky:0, writes:0};

function stamp(){                     // strictly increasing, so cursors never skip
  let ms = Date.now();
  if (ms <= lastMs) ms = lastMs + 1;
  lastMs = ms;
  return new Date(ms).toISOString();
}
const json = (res,code,obj) => { res.writeHead(code,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(obj)); };
const body = req => new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{r(JSON.parse(b||'null'))}catch(e){r(null)}})});

function authed(req){
  const h = req.headers.authorization || '';
  const t = h.replace(/^Bearer /,'');
  if (!t || !tokens.has(t)) return false;
  return tokens.get(t) > Date.now();
}

const server = http.createServer(async (req,res)=>{
  const u = url.parse(req.url, true);
  const p = u.pathname;

  if (req.method === 'OPTIONS'){ res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}); return res.end(); }

  // test controls
  if (p === '/__ctl'){ Object.assign(opts, u.query.paused!==undefined?{paused:u.query.paused==='1'}:{},
                                            u.query.flaky!==undefined?{flaky:+u.query.flaky}:{});
                       return json(res,200,{ok:true,opts,rows:rows.size}); }
  if (p === '/__rows'){ return json(res,200,[...rows.values()]); }
  if (p === '/__reset'){ rows = new Map(); tokens = new Map(); opts.writes=0; return json(res,200,{ok:true}); }

  if (opts.paused && p.startsWith('/auth') || opts.paused && p.startsWith('/rest')){
    res.writeHead(503,{'Access-Control-Allow-Origin':'*'}); return res.end('paused');
  }

  // ---- auth ----
  if (p === '/auth/v1/health') return json(res,200,{date:new Date().toISOString()});
  if (p === '/auth/v1/token'){
    const b = await body(req);
    if (u.query.grant_type === 'password'){
      if (!b || b.email !== EMAIL || b.password !== CODE)
        return json(res,400,{error:'invalid_grant',error_description:'Invalid login credentials'});
    } else if (u.query.grant_type === 'refresh_token'){
      if (!b || !tokens.has('r:'+b.refresh_token))
        return json(res,400,{error:'invalid_grant',error_description:'Invalid Refresh Token'});
    } else return json(res,400,{error:'unsupported_grant_type'});
    const at = 'at_'+Math.random().toString(36).slice(2), rt = 'rt_'+Math.random().toString(36).slice(2);
    const ttl = +(u.query.ttl || 3600);
    tokens.set(at, Date.now()+ttl*1000);
    tokens.set('r:'+rt, Date.now()+30*86400000);
    return json(res,200,{access_token:at, refresh_token:rt, expires_in:ttl, token_type:'bearer'});
  }

  // ---- records ----
  if (p === '/rest/v1/records'){
    if (!authed(req)) return json(res,401,{message:'JWT expired or missing'});

    if (req.method === 'GET'){
      let out = [...rows.values()];
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
      b.forEach(r=>{
        rows.set(r.kind+' '+r.id, {id:r.id, kind:r.kind, body:r.body||{},
                                   deleted:!!r.deleted, updated_at:stamp()});  // server stamps
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
