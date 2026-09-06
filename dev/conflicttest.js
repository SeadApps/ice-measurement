const {chromium}=require('playwright');
const B='http://localhost:8200';
const ok=(n,c,x)=>console.log((c?'  PASS  ':'  FAIL  ')+n+(x&&!c?'   ['+x+']':''));
const CFG={url:B, anon:'test', email:'operations@conwayarena.local'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rows=async()=>(await (await fetch(B+'/__rows')).json());

async function device(browser){
  const ctx=await browser.newContext({viewport:{width:1280,height:900}});
  await ctx.addInitScript(c=>{window.__SYNC_CONFIG__=c;}, CFG);
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  !! pageerror: '+String(e).split('\n')[0]));
  return {ctx,p};
}
async function signIn(p){
  await p.waitForSelector('.sync-gate #sg-code',{timeout:8000});
  await p.fill('.sync-gate #sg-code','test-access-code');
  await p.click('.sync-gate button'); await sleep(2500);
}
const panels=p=>p.evaluate(()=>(() => {
  const v2 = JSON.parse(localStorage.getItem('glass_record_v2') || 'null');
  if (v2 && v2.records) return v2.records.legacy || {};
  return JSON.parse(localStorage.getItem('glass_record_v1') || '{}').panels || {};
})());

(async()=>{
await fetch(B+'/__reset');
const b=await chromium.launch();

const A=await device(b), C=await device(b);
await A.p.goto(B+'/glass.html'); await sleep(900); await signIn(A.p);
await A.p.click('#pnl-045'); await A.p.click('.sbtn[data-s="replace"]'); await sleep(3000);
await C.p.goto(B+'/glass.html'); await sleep(900); await signIn(C.p); await sleep(2500);

/* ---- an idle device must not churn the server ---------------------------- */
const before=(await rows()).map(r=>r.kind+' '+r.id+' '+r.updated_at).sort();
for(let i=0;i<3;i++){ await A.p.evaluate(()=>window.Sync.sync('idle')); await sleep(1200); }
const after=(await rows()).map(r=>r.kind+' '+r.id+' '+r.updated_at).sort();
ok('an idle device restamps nothing', JSON.stringify(before)===JSON.stringify(after),
   'timestamps moved without any edit');
ok('and reports nothing pending', (await A.p.evaluate(()=>window.Sync.pending()))===0);

/* ---- the real conflict: both devices edit the SAME panel ----------------- */
await A.p.click('#pnl-100'); await A.p.click('.sbtn[data-s="plexi"]'); await sleep(300);
await C.p.click('#pnl-100'); await C.p.click('.sbtn[data-s="replace"]'); await sleep(300);
await A.p.evaluate(()=>window.Sync.sync('t')); await sleep(1800);   // A first
await C.p.evaluate(()=>window.Sync.sync('t')); await sleep(1800);   // C second, so C wins
await A.p.evaluate(()=>window.Sync.sync('t')); await sleep(1800);
const a=await panels(A.p), c=await panels(C.p);
ok('both devices agree on the contested panel', a['100'] && c['100'] && a['100'].status===c['100'].status,
   'A='+(a['100']||{}).status+' C='+(c['100']||{}).status);
ok('the later edit is the one that stands', a['100'].status==='replace', 'got '+a['100'].status);

/* ---- an untouched panel from the other device must survive --------------- */
ok('A keeps its own earlier mark on 45', a['045'] && a['045'].status==='replace');
ok('C has it too', c['045'] && c['045'].status==='replace');

/* ---- a failed write is retried, not lost -------------------------------- */
await fetch(B+'/__ctl?flaky=1');            // every write fails
await C.p.click('#pnl-030'); await C.p.click('.sbtn[data-s="replace"]'); await sleep(2500);
const stuck=await C.p.evaluate(()=>window.Sync.pending());
ok('a rejected write stays pending ('+stuck+')', stuck>0);
await fetch(B+'/__ctl?flaky=0');
await C.p.evaluate(()=>window.Sync.sync('t')); await sleep(2000);
ok('and goes through on the next try', (await C.p.evaluate(()=>window.Sync.pending()))===0);
await A.p.evaluate(()=>window.Sync.sync('t')); await sleep(2000);
ok('reaching the other device', (await panels(A.p))['030'] &&(await panels(A.p))['030'].status==='replace');

/* ---- the seeded document marks are not trampled -------------------------- */
const fin=await panels(A.p);
ok('69 is still on plexi, 82 still cracked',
   fin['069'] && fin['069'].status==='plexi' && fin['082'] && fin['082'].status==='replace');

const all=await rows();
console.log('\n  server holds '+all.length+' glass records; '+
  Object.keys(fin).length+' panels marked locally');
await b.close();})();
