const {chromium}=require('playwright');
const B='http://localhost:8200';
const ok=(n,c,x)=>console.log((c?'  PASS  ':'  FAIL  ')+n+(x&&!c?'   ['+x+']':''));
const CFG={url:B, anon:'test', email:'operations@conwayarena.local'};

async function device(browser, name){
  const ctx=await browser.newContext({viewport:{width:1280,height:900}});
  await ctx.addInitScript(c=>{window.__SYNC_CONFIG__=c;}, CFG);
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  !! '+name+' pageerror: '+String(e).split('\n')[0]));
  return {ctx,p,name};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function signIn(p, code){
  await p.waitForSelector('.sync-gate #sg-code',{timeout:8000});
  await p.fill('.sync-gate #sg-code', code);
  await p.click('.sync-gate button');
}
const rows=async()=> (await (await fetch(B+'/__rows')).json());

(async()=>{
await fetch(B+'/__reset',{method:'GET'});
const b=await chromium.launch();

/* ---------------- ice: sign in ---------------- */
const A=await device(b,'A');
await A.p.goto(B+'/ice.html'); await sleep(1200);
ok('gate appears on a new device', await A.p.isVisible('.sync-gate #sg-code'));

await signIn(A.p,'wrongcode'); await sleep(900);
ok('a wrong code is refused', (await A.p.textContent('.sync-gate .err')).includes("doesn't match"));

await A.p.fill('.sync-gate #sg-code','test-access-code');
await A.p.click('.sync-gate button'); await sleep(2500);
ok('the right code gets in', !(await A.p.isVisible('.sync-gate')));
ok('a status pill is shown', await A.p.isVisible('.sync-pill'));

/* ---------------- A creates work, it reaches the server ---------------- */
await A.p.click('.fl-row'); await sleep(800);
await A.p.click('#newRound'); await sleep(400); await A.p.click('#roundCreate'); await sleep(3000);
let r=await rows();
ok('A\'s records reached the server ('+r.length+')', r.length>=3, JSON.stringify(r.map(x=>x.kind)));
ok('sessions among them', r.filter(x=>x.kind==='session').length>=2);
ok('server stamped the times', r.every(x=>!!x.updated_at));

/* ---------------- B is a different device ---------------- */
const Bd=await device(b,'B');
await Bd.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(Bd.p,'test-access-code'); await sleep(3000);
const bBody=await Bd.p.textContent('body');
const bSess=await Bd.p.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('ice_v4_sessions')||'{}')).filter(x=>!x.deleted).length);
ok('B pulled A\'s rounds down ('+bSess+')', bSess>=2);

/* ---------------- B adds its own; A picks it up ---------------- */
await Bd.p.click('.fl-row'); await sleep(700);
await Bd.p.click('#newRound'); await sleep(300); await Bd.p.click('#roundCreate'); await sleep(3000);
const bAfter=await Bd.p.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('ice_v4_sessions')||'{}')).filter(x=>!x.deleted).length);

await A.p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
await A.p.evaluate(()=>window.Sync && window.Sync.sync('test'));
await sleep(2500);
const aAfter=await A.p.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('ice_v4_sessions')||'{}')).filter(x=>!x.deleted).length);
ok('B\'s new round reached A (A='+aAfter+', B='+bAfter+')', aAfter===bAfter && aAfter>=3);

/* ---------------- offline work queues, then lands ---------------- */
await Bd.ctx.setOffline(true);
await Bd.p.click('#newRound'); await sleep(300); await Bd.p.click('#roundCreate'); await sleep(2500);
const queued=await Bd.p.evaluate(()=>window.Sync.pending());
const offlineWorks=await Bd.p.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('ice_v4_sessions')||'{}')).filter(x=>!x.deleted).length);
ok('the app still works offline ('+offlineWorks+' rounds)', offlineWorks>=4);
ok('offline edits are pending ('+queued+' records)', queued>0);
const pill=await Bd.p.textContent('.sync-pill');
ok('the pill says so — "'+pill.trim()+'"', /device|waiting|offline/i.test(pill));

await Bd.ctx.setOffline(false);
await Bd.p.evaluate(()=>window.dispatchEvent(new Event('online'))); await sleep(3000);
const drained=await Bd.p.evaluate(()=>window.Sync.pending());
ok('everything sends on reconnect', drained===0, 'still '+drained+' pending');
await A.p.evaluate(()=>window.Sync.sync('test')); await sleep(2500);
const aFinal=await A.p.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('ice_v4_sessions')||'{}')).filter(x=>!x.deleted).length);
ok('the offline round reached A ('+aFinal+')', aFinal>=4);

/* ---------------- a paused project must not break the app ---------------- */
await fetch(B+'/__ctl?paused=1');
await A.p.reload(); await sleep(2500);
ok('app still opens when the project is asleep', await A.p.isVisible('#home') || await A.p.isVisible('#rink'));
const pausedPill=await A.p.textContent('.sync-pill');
ok('and says it is not syncing — "'+pausedPill.trim()+'"', /device|reach|offline|waiting/i.test(pausedPill));
await fetch(B+'/__ctl?paused=0');

/* ---------------- glass, two devices ---------------- */
const G1=await device(b,'G1'), G2=await device(b,'G2');
await G1.p.goto(B+'/glass.html'); await sleep(1000); await signIn(G1.p,'test-access-code'); await sleep(2500);
await G1.p.click('#pnl-045'); await G1.p.click('.sbtn[data-s="replace"]'); await sleep(3000);
await G2.p.goto(B+'/glass.html'); await sleep(1000); await signIn(G2.p,'test-access-code'); await sleep(3000);
const g2=await G2.p.evaluate(()=>JSON.parse(localStorage.getItem('glass_record_v1')||'{}').panels||{});
ok('glass mark crossed devices', g2['045'] && g2['045'].status==='replace');
await G2.p.click('#pnl-020'); await G2.p.click('.sbtn[data-s="plexi"]'); await sleep(3000);
await G1.p.evaluate(()=>window.Sync.sync('test')); await sleep(2500);
const g1=await G1.p.evaluate(()=>JSON.parse(localStorage.getItem('glass_record_v1')||'{}').panels||{});
ok('and back the other way', g1['020'] && g1['020'].status==='plexi');
ok('neither device lost its own mark', g1['045'] && g1['045'].status==='replace' && g2['045']);

/* ---------------- the session survives a reload ---------------- */
await G1.p.reload(); await sleep(2000);
ok('no second sign-in after a reload', !(await G1.p.isVisible('.sync-gate')));

const all=await rows();
console.log('\n  server holds '+all.length+' records: '+
  JSON.stringify(all.reduce((a,r)=>{a[r.kind]=(a[r.kind]||0)+1;return a;},{})));
await b.close();})();
