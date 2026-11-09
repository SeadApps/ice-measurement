const {chromium}=require('playwright');
const B='http://localhost:8200';
/* D1: which facility a person may see and change. The server decides, from a
   facility tag the app writes on every record. A Staff person given only Flynn
   must not read or write a Conway record - directly, or through a session or a
   piece of glass. Management reads everything, including a facility created
   after the person was made. A record with no tag is Management's alone.

   The first half talks to the server the way a modified page would. The second
   half checks that the real apps write the tag, that writing it does not make
   anything look edited, and that a Staff device only ever holds its own. */
let pass=0, fail=0;
const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x&&!c?'   ['+x+']':''));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ctl=q=>fetch(B+'/__ctl?'+q);
const addStaff=p=>fetch(B+'/__staff',{method:'POST',body:JSON.stringify(p)});
const rows=async()=>(await (await fetch(B+'/__rows')).json());
const DOM='@staff.conwayarena.local', EDIT='test-editing-code';

async function login(email,password){
  const r=await fetch(B+'/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
  return (await r.json()).access_token;
}
const H=t=>({Authorization:'Bearer '+t,'Content-Type':'application/json'});
const send=(t,list)=>fetch(B+'/rest/v1/records?on_conflict=kind,id',{method:'POST',headers:H(t),body:JSON.stringify(list)});
const rpc=(t,fn,body)=>fetch(B+'/rest/v1/rpc/'+fn,{method:'POST',headers:H(t),body:JSON.stringify(body||{})});
const read=async t=>(await (await fetch(B+'/rest/v1/records?select=*',{headers:H(t)})).json());
const unlock=async t=>{ await rpc(t,'unlock_editing',{code:EDIT}); };
const rec=(kind,id,fac,extra)=>({kind,id,deleted:false,body:Object.assign(fac?{fac}:{},extra||{})});
const KINDS=['facility','sheet','session','glass_panel','glass_layout','glass_binding','glass_spare'];

async function device(browser,name){
  /* No service worker: here the fake server shares the page's origin, so the worker's
     cache-first rule would answer a repeated pull from its cache. Supabase is cross-origin
     in production, which the worker leaves alone. */
  const ctx=await browser.newContext({viewport:{width:1000,height:900},serviceWorkers:'block'});
  await ctx.addInitScript(c=>{window.__SYNC_CONFIG__=c;}, {url:B, anon:'test'});
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  !! '+name+' pageerror: '+String(e).split('\n')[0]));
  return {ctx,p,name};
}
async function signIn(p,id,code){
  await p.waitForSelector('.sync-gate #sg-code',{timeout:8000});
  await p.fill('.sync-gate #sg-code','test-access-code'); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="'+id+'"]',{timeout:8000});
  await p.click('.sync-gate .sync-name[data-id="'+id+'"]');
  await p.fill('.sync-gate #sg-personal',code); await p.click('.sync-gate .sync-go'); await sleep(2500);
}
const unlockUI=p=>p.evaluate(c=>window.Sync.unlockEditing(c),EDIT);

(async()=>{
await fetch(B+'/__reset');
await addStaff({id:'pete',name:'Pete',role:'admin',code:'pete-code-1'});
await addStaff({id:'flo', name:'Flo', role:'staff',code:'flo-code-1', facilities:['flynn']});
await addStaff({id:'cam', name:'Cam', role:'staff',code:'cam-code-1', facilities:['conway','flynn']});
await addStaff({id:'nan', name:'Nan', role:'staff',code:'nan-code-1', facilities:[]});
await ctl('tight=1');
const pete=await login('pete'+DOM,'pete-code-1'), flo=await login('flo'+DOM,'flo-code-1'),
      cam=await login('cam'+DOM,'cam-code-1'),   nan=await login('nan'+DOM,'nan-code-1'),
      dev=await login('operations@conwayarena.local','test-access-code');
await unlock(pete); await unlock(flo); await unlock(cam); await unlock(nan);

/* Two buildings, one of every kind in each, written by Management. */
const seed=fac=>KINDS.map(k=>rec(k,k+'-'+fac,fac,{n:fac}));
ok('Management can write both facilities', (await send(pete,[...seed('conway'),...seed('flynn')])).ok);
ok('and an untagged record, which only Management may', (await send(pete,[rec('note','loose',null,{n:'loose'})])).ok);

/* ---- reading --------------------------------------------------------------- */
const seen=async t=>(await read(t)).map(r=>r.kind+' '+r.id).sort();
const fl=await seen(flo);
ok('Flo, given Flynn, sees every kind of Flynn record', KINDS.every(k=>fl.includes(k+' '+k+'-flynn')), JSON.stringify(fl));
ok('and not one Conway record of any kind', !fl.some(x=>/conway/.test(x)), JSON.stringify(fl));
ok('and not the untagged one', !fl.includes('note loose'));
const cm=await seen(cam);
ok('Cam, given both, sees both', KINDS.every(k=>cm.includes(k+' '+k+'-conway')&&cm.includes(k+' '+k+'-flynn')));
ok('but still not the untagged one', !cm.includes('note loose'));
ok('Nan, given nothing, sees nothing', (await seen(nan)).length===0);
const pt=await seen(pete);
ok('Management sees everything', pt.length===KINDS.length*2+1 && pt.includes('note loose'), String(pt.length));
ok('the shared account sees nothing', (await seen(dev)).length===0);

/* ---- writing --------------------------------------------------------------- */
let r=await send(flo,[rec('session','new1','conway',{n:'x'})]);
ok('Flo cannot write a Conway session', r.status===403 && !(await rows()).some(x=>x.id==='new1'));
for(const k of ['glass_panel','glass_layout','glass_binding','glass_spare'])
  ok('nor Conway '+k, (await send(flo,[rec(k,'try-'+k,'conway')])).status===403);
ok('a batch with one Conway record in it is refused whole',
   (await send(flo,[rec('session','ok1','flynn'),rec('session','bad1','conway')])).status===403 && !(await rows()).some(x=>x.id==='ok1'));
ok('Flo can write a Flynn session', (await send(flo,[rec('session','f1','flynn')])).ok);
ok('and glass for Flynn', (await send(flo,[rec('glass_panel','fp1','flynn')])).ok);
ok('but not a record with no facility', (await send(flo,[rec('session','nofac',null)])).status===403);

ok('Flo cannot take over a Conway record by re-tagging it',
   (await send(flo,[rec('session','session-conway','flynn',{n:'stolen'})])).status===403);
ok('which left it as it was', (await rows()).find(x=>x.id==='session-conway').body.n==='conway');
ok('nor an untagged one', (await send(flo,[rec('note','loose','flynn')])).status===403);
ok('nor tombstone a Conway record', (await send(flo,[{kind:'session',id:'session-conway',deleted:true,body:{fac:'flynn'}}])).status===403
   && !(await rows()).find(x=>x.id==='session-conway').deleted);

ok('Staff may not change a facility\'s settings, even their own', (await send(flo,[rec('facility','facility-flynn','flynn',{n:'new'})])).status===403);
ok('or a sheet\'s', (await send(flo,[rec('sheet','sheet-flynn','flynn',{n:'new'})])).status===403);
ok('Management may', (await send(pete,[rec('facility','facility-flynn','flynn',{n:'renamed'})])).ok);

ok('Nan, given nothing, cannot write anywhere', (await send(nan,[rec('session','n1','flynn')])).status===403 && (await send(nan,[rec('session','n2','conway')])).status===403);
ok('Cam can write in either of hers', (await send(cam,[rec('session','c1','conway'),rec('session','c2','flynn')])).ok);
ok('Management can write untagged records', (await send(pete,[rec('note','loose2',null)])).ok);

/* ---- access changes take effect at once ------------------------------------ */
await addStaff({id:'flo',facilities:['flynn','conway']});
ok('giving Flo Conway shows her Conway at once', (await seen(flo)).includes('session session-conway'));
ok('and lets her write there', (await send(flo,[rec('session','c3','conway')])).ok);
await addStaff({id:'flo',facilities:['flynn']});
ok('taking it away hides it again', !(await seen(flo)).some(x=>/conway/.test(x)));
ok('and refuses the write again', (await send(flo,[rec('session','c4','conway')])).status===403);
ok('what she wrote while she had it is still there for Management', (await seen(pete)).includes('session c3'));

/* a facility made after the person was */
await send(pete,[rec('facility','facility-hartford','hartford'),rec('session','h1','hartford')]);
ok('a facility created later is seen by Management with no change', (await seen(pete)).includes('session h1'));
ok('and not by Staff who were not given it', !(await seen(flo)).includes('session h1') && !(await seen(cam)).includes('session h1'));
ok('until they are', await (async()=>{ await addStaff({id:'cam',facilities:['conway','flynn','hartford']}); return (await seen(cam)).includes('session h1'); })());

/* ---- the real apps ---------------------------------------------------------- */
await fetch(B+'/__reset');
await addStaff({id:'pete',name:'Pete',role:'admin',code:'pete-code-1'});
await ctl('tight=1');
/* A facility whose records are older than anything Zed will pull first. */
const pt2=await login('pete'+DOM,'pete-code-1'); await unlock(pt2);
await send(pt2,[rec('facility','late','late',{name:'Late',ord:5,settings:{target:1.5,edges:[0.6875,1.4375,1.5625,1.9375]}}),
  rec('sheet','late-sheet','late',{facilityId:'late',name:'Late sheet',ord:0}),
  rec('session','late-s1','late',{sheetId:'late-sheet',date:new Date().toISOString(),label:'',mode:'moderate',data:{},notes:{},ord:0})]);
const b=await chromium.launch();

const P=await device(b,'P');
await P.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(P.p,'pete','pete-code-1');
await unlockUI(P.p); await sleep(1500);
/* The device pulls 'late' and has no invention of its own now, so Pete makes a facility of his own for Ice to write. */
await P.p.evaluate(()=>{ const f=newFacility('Pete Rink'); state.facilities.push(f); state.activeFacility=f.id; state.activeSheet=f.sheets[0].id; state.activeSession=f.sheets[0].sessions[0].id; persist(); buildHome(); }); await sleep(800);
await P.p.evaluate(()=>showPage('build')); await sleep(700);
await P.p.click('#newRound'); await sleep(300); await P.p.click('#roundCreate'); await sleep(3500);
let all=await rows();
const byKind=k=>all.filter(x=>x.kind===k&&x.facility_id!=='late');   // the seeded 'late' facility is not Ice's
const fac=byKind('facility')[0], sheet=byKind('sheet')[0];
ok('Ice wrote its records ('+all.length+')', all.length>=3 && !!fac && !!sheet && byKind('session').length>=2);
ok('a facility is tagged with itself', fac.body.fac===fac.id && fac.facility_id===fac.id, JSON.stringify(fac.body.fac));
ok('a sheet with its facility', sheet.body.fac===sheet.body.facilityId && sheet.facility_id===fac.id);
ok('every session with its sheet\'s facility', byKind('session').every(s=>s.facility_id===fac.id), JSON.stringify(byKind('session').map(s=>s.facility_id)));
ok('so nothing Ice wrote is untagged', all.every(x=>!!x.facility_id));

/* Tagging must not look like an edit. An old record, from before tags
   existed, loaded and saved again must keep its timestamp. */
const stamps=()=>P.p.evaluate(()=>{
  const o={}; ['ice_v4_facilities','ice_v4_sheets','ice_v4_sessions'].forEach(k=>{
    const m=JSON.parse(localStorage.getItem(k)||'{}'); for(const id in m) o[k+id]=m[id].updatedAt; }); return o; });
await P.p.evaluate(()=>{ ['ice_v4_facilities','ice_v4_sheets','ice_v4_sessions'].forEach(k=>{
  const m=JSON.parse(localStorage.getItem(k)||'{}'); for(const id in m) delete m[id].fac; localStorage.setItem(k,JSON.stringify(m)); }); });
const was=await stamps();
await P.p.evaluate(()=>window.Records.Repo.load().then(st=>window.Records.Repo.save(st)));
const now=await stamps();
ok('an old untagged record is not restamped just to be tagged', JSON.stringify(was)===JSON.stringify(now));
const kept=await P.p.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('ice_v4_sessions'))).every(s=>s.fac));
ok('but it carries the tag locally from then on', kept);
const sv=(await rows()).map(x=>x.kind+x.id+x.updated_at).sort();
await P.p.evaluate(()=>window.Sync.sync('t')); await sleep(2000);
ok('and sends nothing', JSON.stringify(sv)===JSON.stringify((await rows()).map(x=>x.kind+x.id+x.updated_at).sort()));

/* Glass: a panel marked, and the rest that goes with it. */
const G=await device(b,'G');
await G.p.goto(B+'/glass.html'); await sleep(1200);
await signIn(G.p,'pete','pete-code-1');
await unlockUI(G.p); await sleep(2500);
await G.p.click('#pnl-045'); await G.p.click('.sbtn[data-s="replace"]'); await sleep(3500);
all=await rows();
const gp=all.filter(x=>x.kind==='glass_panel'), gb=all.filter(x=>x.kind==='glass_binding');
ok('Glass wrote the panel mark ('+gp.length+')', gp.length>0);
/* Glass binds to the first surface it knows, which is no longer always Ice's own facility. */
const gfac=await G.p.evaluate(()=>sheets[boundSheetId].facilityId);
ok('tagged with the facility its surface is in', !!gfac && gp.every(x=>x.facility_id===gfac), JSON.stringify(gp.map(x=>x.facility_id)));
ok('and the binding too', gb.length>0 && gb.every(x=>x.facility_id===gfac), JSON.stringify(gb.map(x=>x.facility_id)));
ok('nothing in the building is untagged', all.every(x=>!!x.facility_id), JSON.stringify(all.filter(x=>!x.facility_id).map(x=>x.kind)));

/* A Staff device given only another facility holds none of this. */
await addStaff({id:'zed',name:'Zed',role:'staff',code:'zed-code-1',facilities:['elsewhere']});
const Z=await device(b,'Z');
await Z.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(Z.p,'zed','zed-code-1'); await sleep(2500);
const held=await Z.p.evaluate(()=>{ const o=[]; ['ice_v4_facilities','ice_v4_sheets','ice_v4_sessions'].forEach(k=>{
  const m=JSON.parse(localStorage.getItem(k)||'{}'); for(const id in m) o.push(m[id]); }); return o; });
ok('a Staff device never pulls the other building\'s records', !held.some(x=>x.id===fac.id||x.id===sheet.id||x.sheetId===sheet.id), JSON.stringify(held.map(x=>x.id)));

await addStaff({id:'zed',facilities:[fac.id]});
await Z.p.evaluate(()=>window.Sync.sync('t')); await sleep(2500);
const later=await Z.p.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('ice_v4_sheets')||'{}')));
ok('and gets them once they are given the facility', later.includes(sheet.id), JSON.stringify(later));

/* Given a second facility whose records are older than the cursor, which stands at the first's newest. */
await addStaff({id:'zed',facilities:[fac.id,'late']});
await Z.p.evaluate(()=>window.Sync.sync('t')); await sleep(2500);
const older=await Z.p.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('ice_v4_sheets')||'{}')));
ok('a facility granted later arrives even though its records are older than his cursor', older.includes('late-sheet'), JSON.stringify(older));

/* A different person on the same device does not inherit the last one's place. */
await Z.p.evaluate(()=>{window.Sync.switchUser();}); await sleep(3000);
await Z.p.waitForSelector('.sync-gate .sync-name[data-id="pete"]',{timeout:8000});
await Z.p.click('.sync-gate .sync-name[data-id="pete"]'); await Z.p.fill('.sync-gate #sg-personal','pete-code-1');
await Z.p.click('.sync-gate .sync-go'); await sleep(3500);
const petes=await Z.p.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('ice_v4_facilities')||'{}')));
ok('Pete, on the device Zed used, gets everything', petes.includes(fac.id) && petes.includes('late'), JSON.stringify(petes));

console.log('\n  '+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);})();
