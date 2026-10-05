const {chromium}=require('playwright');
const B='http://localhost:8200';
/* D1: one shape per sheet. Ice drew its outline from a size with a 28' corner
   and Glass from a walked layout with 27' 2", so the two could disagree about
   the same ice. A sheet now holds one shape - length, width, corner radius,
   where the glass walk starts, which way the building faces - and both apps
   draw from it.

   The records are touched as little as possible: an old sheet is READ as if it
   had a shape, but gains one only when it is deliberately migrated or edited.
   Adding it on every save would restamp every sheet on every device. */
let pass=0, fail=0;
const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x&&!c?'   ['+x+']':''));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rows=async()=>(await (await fetch(B+'/__rows')).json());
const near=(a,b,e)=>Math.abs(a-b)<(e||1e-3);
const STD=27+2/12;

async function device(browser,name){
  const ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await ctx.addInitScript(c=>{window.__SYNC_CONFIG__=c;}, {url:B, anon:'test'});
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  !! '+name+' pageerror: '+String(e).split('\n')[0]));
  return {ctx,p,name};
}
async function signIn(p){
  await p.waitForSelector('.sync-gate #sg-code',{timeout:8000});
  await p.fill('.sync-gate #sg-code','test-access-code'); await p.click('.sync-gate button'); await sleep(2500);
}
const store=(p,k)=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)||'{}'),k);
const sheetsOf=p=>store(p,'ice_v4_sheets');
const firstSheet=async p=>Object.values(await sheetsOf(p)).filter(s=>!s.deleted)[0];

(async()=>{
await fetch(B+'/__reset');
const b=await chromium.launch();
const A=await device(b,'A');
await A.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(A.p);
const R=(fn,arg)=>A.p.evaluate(fn,arg);

/* ---- migrating an old size ------------------------------------------------ */
const mig=size=>R(s=>window.Records.shapeFromSize(s),size);
let s=await mig({L:200,W:85,corner:28});
ok('the standard 28\' corner becomes 27\' 2"', s.L===200 && s.W===85 && s.Rft===27 && s.Rin===2, JSON.stringify(s));
ok('and the walk defaults match a new sheet', s.start==='zam' && s.turn===false && s.flip===false);
s=await mig({L:200,W:100,corner:28}); ok('so do the Olympic and hybrid sizes', s.Rft===27 && s.Rin===2 && s.W===100);
s=await mig({L:185,W:85,corner:25});  ok('a corner that was not the old default is kept', s.Rft===25 && s.Rin===0 && s.L===185);
s=await mig({L:200,W:85,corner:27});  ok('including one a builder rounded to 27\'', s.Rft===27 && s.Rin===0);
s=await mig({L:200,W:85,corner:27+2/12}); ok('and one already exact', s.Rft===27 && s.Rin===2);
s=await mig({L:200,W:85,corner:27+2.5/12}); ok('a half-inch corner is kept as it is', s.Rft===27 && s.Rin===2.5, JSON.stringify(s));
s=await mig({L:200,W:85,corner:27+2.4/12}); ok('and anything between rounds to the nearest half inch', s.Rft===27 && s.Rin===2.5, JSON.stringify(s));
s=await mig({L:200,W:85,corner:24.999}); ok('a corner just under a whole foot carries into the feet', s.Rft===25 && s.Rin===0, JSON.stringify(s));
const sp=r=>R(x=>window.Records.shapeProblem(x),r);
ok('a half-inch corner can be drawn', (await sp({L:200,W:85,Rft:27,Rin:2.5}))==='');
ok('a quarter inch cannot', (await sp({L:200,W:85,Rft:27,Rin:2.25}))!=='');
ok('nor twelve inches, nor a part of a foot', (await sp({L:200,W:85,Rft:27,Rin:12}))!=='' && (await sp({L:200,W:85,Rft:27.5,Rin:0}))!=='');
s=await mig(null); ok('a sheet with no size at all reads as the standard one', s.L===200 && s.W===85 && s.Rft===27 && s.Rin===2);
const pre=await R(()=>window.Records.RINK_SIZES.map(x=>[x.id,x.corner]));
ok('the presets use the new corner', pre.filter(p=>p[0]!=='studio').every(p=>near(p[1],STD)) && near(pre.find(p=>p[0]==='studio')[1],25), JSON.stringify(pre));

/* ---- reading a sheet --------------------------------------------------------- */
const sz=await R(()=>({
  legacy:window.Records.sizeOf({size:{id:'nhl',name:'NHL — 200 × 85 ft',L:200,W:85,corner:28}}),
  shaped:window.Records.sizeOf({size:{L:200,W:85,corner:28},shape:{L:200,W:100,Rft:20,Rin:6,start:'zam',turn:false,flip:false}}),
  none:window.Records.sizeOf({})}));
ok('a sheet with no shape is read from its size', near(sz.legacy.corner,STD) && sz.legacy.L===200 && sz.legacy.name.startsWith('NHL'), JSON.stringify(sz.legacy));
ok('a sheet with a shape is read from the shape, not the size', sz.shaped.W===100 && near(sz.shaped.corner,20.5), JSON.stringify(sz.shaped));
ok('a bare sheet still reads', sz.none.L===200 && near(sz.none.corner,STD));

/* ---- Ice and Glass draw the same outline ------------------------------------ */
const G=await device(b,'G');
await G.p.goto(B+'/glass.html'); await sleep(1500);
await signIn(G.p);
const survey=await G.p.evaluate(()=>DATA.rink);
const conway=await R(()=>window.Records.sizeOf({size:{id:'nhl',name:'NHL',L:200,W:85,corner:28}}));
ok('Conway\'s migrated sheet is the glass survey: length', near(conway.L,survey.L), conway.L+' vs '+survey.L);
ok('width', near(conway.W,survey.W));
ok('and corner radius, to the inch', near(conway.corner*12,survey.R*12,0.51), (conway.corner*12)+' vs '+(survey.R*12));
ok('the two preset corners were the mismatch, and are now one', !near(28,survey.R,0.5) && near(pre[0][1],survey.R,0.01));

/* Ice, booted on a sheet holding a shape, draws that shape. */
await R(()=>{
  const sh=JSON.parse(localStorage.getItem('ice_v4_sheets')||'{}');
  for(const id in sh){ sh[id].shape={L:200,W:100,Rft:20,Rin:6,start:'zam',turn:false,flip:false}; sh[id].size={id:'custom',name:'Custom',L:185,W:85,corner:25}; }
  localStorage.setItem('ice_v4_sheets',JSON.stringify(sh));
});
await A.p.reload(); await sleep(2500);
if(await A.p.isVisible('.fl-row')){ await A.p.click('.fl-row'); } await sleep(800);
const dr=await R(()=>({L:L,W:W,C:CORNER}));
ok('Ice draws the sheet\'s shape, not its old size', dr.L===200 && dr.W===100 && near(dr.C,20.5), JSON.stringify(dr));

await R(()=>{
  const sh=JSON.parse(localStorage.getItem('ice_v4_sheets')||'{}');
  for(const id in sh){ delete sh[id].shape; sh[id].size={id:'nhl',name:'NHL — 200 × 85 ft',L:200,W:85,corner:28}; }
  localStorage.setItem('ice_v4_sheets',JSON.stringify(sh));
});
await A.p.reload(); await sleep(2500);
if(await A.p.isVisible('.fl-row')){ await A.p.click('.fl-row'); } await sleep(800);
const old=await R(()=>({L:L,W:W,C:CORNER}));
ok('an old sheet is drawn with the corrected corner', old.L===200 && old.W===85 && near(old.C,STD), JSON.stringify(old));
ok('which is the glass survey\'s', near(old.C,survey.R,0.01));

/* ---- reading never writes ----------------------------------------------------- */
await A.p.evaluate(()=>window.Sync.sync('t')); await sleep(2000);
const stampsOf=async()=>{ const o={}; for(const k of ['ice_v4_facilities','ice_v4_sheets','ice_v4_sessions']){ const m=await store(A.p,k); for(const id in m) o[k+id]=m[id].updatedAt; } return o; };
const t0=await stampsOf(), srv0=(await rows()).map(r=>r.kind+r.id+r.updated_at).sort();
await R(()=>window.Records.Repo.load().then(st=>window.Records.Repo.save(st)));
ok('loading and saving an old sheet restamps nothing', JSON.stringify(t0)===JSON.stringify(await stampsOf()));
const sh0=await firstSheet(A.p);
ok('and does not quietly give it a shape', !sh0.shape, JSON.stringify(sh0.shape));
await A.p.evaluate(()=>window.Sync.sync('t')); await sleep(1500);
ok('so an idle device sends nothing', JSON.stringify(srv0)===JSON.stringify((await rows()).map(r=>r.kind+r.id+r.updated_at).sort()));

/* ---- the deliberate migration -------------------------------------------------- */
const prev=await R(()=>window.Records.Repo.previewShapes());
ok('the preview lists what would change', prev.length===1 && prev[0].id===sh0.id && prev[0].to.Rft===27 && prev[0].to.Rin===2, JSON.stringify(prev));
ok('showing the old corner beside the new', near(prev[0].from.corner,28) && near(prev[0].to.Rft+prev[0].to.Rin/12,STD));
ok('and writing nothing', JSON.stringify(t0)===JSON.stringify(await stampsOf()) && !(await firstSheet(A.p)).shape);

const done=await R(()=>window.Records.Repo.backfillShapes());
ok('approving it migrates the sheet', done===1 && !!(await firstSheet(A.p)).shape);
const t1=await stampsOf();
const moved=Object.keys(t1).filter(k=>t1[k]!==t0[k]);
ok('restamping the sheet and nothing else', moved.length===1 && moved[0].startsWith('ice_v4_sheets'), JSON.stringify(moved));
ok('a second run finds nothing to do', (await R(()=>window.Records.Repo.backfillShapes()))===0 && (await R(()=>window.Records.Repo.previewShapes())).length===0);
await A.p.evaluate(()=>window.Sync.sync('t')); await sleep(2000);
const srv=await rows(), shRow=srv.find(r=>r.kind==='sheet');
ok('the shape reaches the server', !!shRow.body.shape && shRow.body.shape.Rft===27 && shRow.body.shape.Rin===2, JSON.stringify(shRow.body));
ok('with the facility tag', !!shRow.facility_id);
ok('and the old size is still there for a device on the older build', !!shRow.body.size && shRow.body.size.L===200);

/* ---- a builder that measured something different ------------------------------- */
const cmp=await R(()=>{
  const C=window.Records.compareShape, sheet={L:200,W:85,Rft:27,Rin:2};
  return { same:C(sheet,{L:200,W:85,Rft:27,Rin:2}),
           close:C(sheet,{L:200.25,W:85,Rft:27,Rin:3}),
           far:C(sheet,{L:198,W:86,Rft:27,Rin:2}),
           corner:C(sheet,{L:200,W:85,Rft:26,Rin:0}) };});
ok('an identical measurement is the same', cmp.same.same===true && cmp.same.small===true);
ok('a small difference is reported, and can be ignored', cmp.close.same===false && cmp.close.small===true && near(cmp.close.dL,0.25) && near(cmp.close.dR,1/12), JSON.stringify(cmp.close));
ok('a larger one is not small', cmp.far.small===false && near(cmp.far.dL,-2) && near(cmp.far.dW,1), JSON.stringify(cmp.far));
ok('a corner that differs is not small either', cmp.corner.small===false && near(cmp.corner.dR,-(1+2/12)), JSON.stringify(cmp.corner));
ok('it says which dimensions differ', cmp.far.differs.join()==='L,W' && cmp.corner.differs.join()==='R', JSON.stringify([cmp.far.differs,cmp.corner.differs]));

/* ---- updating the sheet from the builder ---------------------------------------- */
await A.p.click('#newRound'); await sleep(300); await A.p.click('#roundCreate'); await sleep(3000);   // a round with readings in the facility
await A.p.evaluate(()=>window.Sync.sync('t')); await sleep(2000);
const srvSess0=JSON.stringify((await rows()).filter(r=>r.kind==='session').map(r=>[r.id,r.updated_at]).sort());
const before=await stampsOf(), id=(await firstSheet(A.p)).id;
const sessBefore=JSON.stringify(Object.values(await store(A.p,'ice_v4_sessions')).map(x=>[x.id,x.updatedAt,x.data]).sort());
const r1=await R(sid=>window.Records.Repo.updateShape(sid,{L:200.25,W:85,Rft:27,Rin:3}),id);
ok('updating the sheet changes its shape', r1.changed===true && (await firstSheet(A.p)).shape.L===200.25 && (await firstSheet(A.p)).shape.Rin===3);
ok('and keeps the older size field in step', near((await firstSheet(A.p)).size.L,200.25) && near((await firstSheet(A.p)).size.corner,27+3/12));
const after=await stampsOf(), moved2=Object.keys(after).filter(k=>after[k]!==before[k]);
ok('only the sheet is restamped', moved2.length===1 && moved2[0]==='ice_v4_sheets'+id, JSON.stringify(moved2));
ok('Ice\'s readings are untouched', sessBefore===JSON.stringify(Object.values(await store(A.p,'ice_v4_sessions')).map(x=>[x.id,x.updatedAt,x.data]).sort()));
ok('the same values again change nothing', (await R(sid=>window.Records.Repo.updateShape(sid,{L:200.25,W:85,Rft:27,Rin:3}),id)).changed===false && JSON.stringify(after)===JSON.stringify(await stampsOf()));
ok('an unknown sheet is refused', (await R(()=>window.Records.Repo.updateShape('nope',{L:1}))).changed===false);
ok('and so is a shape that cannot be drawn', (await R(sid=>window.Records.Repo.updateShape(sid,{L:10,W:10,Rft:27,Rin:2}),id)).changed===false && (await firstSheet(A.p)).shape.L===200.25);

await A.p.evaluate(()=>window.Sync.sync('t')); await sleep(2500);
ok('on the server the readings were not rewritten', srvSess0===JSON.stringify((await rows()).filter(r=>r.kind==='session').map(r=>[r.id,r.updated_at]).sort()));
ok('but the sheet was', (await rows()).find(r=>r.kind==='sheet').body.shape.L===200.25);

/* a second device receives the new shape and draws it */
const D=await device(b,'D');
await D.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(D.p);
/* D is a fresh device and invents a phantom facility of its own before its first pull (D2 fixes
   that), so look the sheet up by id rather than taking the first. */
const got=(await sheetsOf(D.p))[id];
ok('another device receives the new shape', got && got.shape && got.shape.L===200.25 && got.shape.Rin===3, JSON.stringify(got&&got.shape));
const dd=await D.p.evaluate(sid=>{ const sh=JSON.parse(localStorage.getItem('ice_v4_sheets'))[sid]; return window.Records.sizeOf(sh); },id);
ok('and would draw it', near(dd.L,200.25) && near(dd.corner,27.25), JSON.stringify(dd));

console.log('\n  '+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);})();
