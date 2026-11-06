const {chromium}=require('playwright');
const B='http://localhost:8200';
/* D1: a shared iPad changes hands. The server stamps a write with whoever's
   session sends it, which is right when a person sends their own changes and
   wrong if Dana edits offline and Pete signs in before they have gone out.

   The rule: switching user, and the idle sign-out, first try to send pending
   changes under the person leaving. Offline, the screen locks but that
   person's session stays on the device, send-only, and their changes go out
   under their name when the connection returns. Which changes are whose is
   told by the local time of the hand-over. Nothing a person did is ever sent
   under someone else's name. */
let pass=0, fail=0;
const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x&&!c?'   ['+x+']':''));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ctl=q=>fetch(B+'/__ctl?'+q);
const addStaff=p=>fetch(B+'/__staff',{method:'POST',body:JSON.stringify(p)});
const rows=async()=>(await (await fetch(B+'/__rows')).json());
const unlocks=async()=>(await (await fetch(B+'/__unlocks')).json());
const EDIT='test-editing-code';
/* These suites are about sync, not the UI lock (controlstest covers that), so the helpers that
   make edits lift the lock first, as the page did before it existed. */
const bypass=p=>p.evaluate(()=>document.body.classList.remove('sync-locked'));

const sessions=async()=>(await rows()).filter(r=>r.kind==='session');
const by=async()=>(await sessions()).map(r=>r.changed_by);

async function device(browser,name,cfg){
  const ctx=await browser.newContext({viewport:{width:1000,height:900},serviceWorkers:'block'});
  await ctx.addInitScript(c=>{window.__SYNC_CONFIG__=c;}, Object.assign({url:B, anon:'test'},cfg||{}));
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  !! '+name+' pageerror: '+String(e).split('\n')[0]));
  return {ctx,p,name};
}
async function signIn(p,id,code,wait){
  await p.waitForSelector('.sync-gate #sg-code',{timeout:8000}).catch(()=>{});
  if(await p.isVisible('.sync-gate #sg-code')){
    await p.fill('.sync-gate #sg-code','test-access-code'); await p.click('.sync-gate button');
  }
  await p.waitForSelector('.sync-gate .sync-name[data-id="'+id+'"]',{timeout:8000});
  await p.click('.sync-gate .sync-name[data-id="'+id+'"]');
  await p.fill('.sync-gate #sg-personal',code); await p.click('.sync-gate .sync-go'); await sleep(wait||2500);
}
const round=async p=>{ if(!(await p.isVisible('#newRound'))){ await p.evaluate(()=>showPage('build')); await sleep(700); }
                       await bypass(p); await p.click('#newRound'); await sleep(300); await p.click('#roundCreate'); await sleep(600); };
const pending=p=>p.evaluate(()=>window.Sync.pending());
const person=p=>p.evaluate(()=>{const x=window.Sync.person();return x&&x.id;});
const gateUp=p=>p.isVisible('.sync-gate');
const departed=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('rink_departed')||'[]'));
const pill=async p=>(await p.textContent('.sync-pill').catch(()=>''))||'';
const unlock=p=>p.evaluate(c=>window.Sync.unlockEditing(c),EDIT);
const people=async()=>{
  await fetch(B+'/__reset');
  await addStaff({id:'dana',name:'Dana',role:'management',code:'dana-code-1'});
  await addStaff({id:'pete',name:'Pete',role:'management',code:'pete-code-1'});
};

(async()=>{
const b=await chromium.launch();

/* ---- online: the changes go out before the next person is in --------------- */
await people();
let D=await device(b,'D1'); await D.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(D.p,'dana','dana-code-1');
await round(D.p);
ok('Dana has something waiting', (await pending(D.p))>0);
const sentBefore=(await sessions()).length;
D.p.evaluate(()=>{window.Sync.switchUser();});
await sleep(3500);
ok('switching user sends it first, without waiting for the usual delay', (await sessions()).length>sentBefore);
ok('under Dana', (await sessions()).every(r=>r.changed_by==='dana'), JSON.stringify(await by()));
ok('nothing is held back when it all went out', (await departed(D.p)).length===0);
ok('the device is at Who are you?', await gateUp(D.p) && (await person(D.p))===null);
await signIn(D.p,'pete','pete-code-1');
await round(D.p); await sleep(3000);
const mixed=await by();
ok('Pete\'s own work goes out under Pete', mixed.includes('pete'), JSON.stringify(mixed));
ok('and Dana\'s stays Dana\'s', mixed.includes('dana') && mixed.filter(x=>x==='dana').length===(await sessions()).filter(r=>r.changed_by==='dana').length);
ok('nobody\'s work was sent under the other\'s name', !(await sessions()).some(r=>r.changed_by===null));

/* ---- offline: the session stays, send-only ---------------------------------- */
await people();
D=await device(b,'D2'); await D.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(D.p,'dana','dana-code-1');
await D.p.evaluate(()=>showPage('build')); await sleep(700);
await sleep(2500);                                    // the first round and facility are on the server
const base=(await rows()).length;
await D.ctx.setOffline(true); await sleep(500);
await round(D.p); await round(D.p);
const waiting=await pending(D.p);
ok('offline, Dana\'s changes wait on the device ('+waiting+')', waiting>0 && (await rows()).length===base);
await D.p.evaluate(()=>{window.Sync.switchUser();}); await sleep(1500);
ok('switching offline still locks the screen', await gateUp(D.p));
ok('nobody is signed in on it', (await person(D.p))===null);
const dep=await departed(D.p);
ok('but Dana\'s session is kept, for sending only', dep.length===1 && dep[0].id==='dana' && !!dep[0].session && !!dep[0].at, JSON.stringify(dep).slice(0,100));
ok('her changes are still waiting', (await pending(D.p))===waiting);
ok('and the server has heard nothing from her', (await rows()).length===base);

await D.ctx.setOffline(false); await sleep(4000);
ok('when the connection returns they go out, with nobody signed in', (await rows()).length>base);
ok('under Dana', (await sessions()).every(r=>r.changed_by==='dana'), JSON.stringify(await by()));
ok('and the kept session is discarded once it is done', (await departed(D.p)).length===0);
ok('the screen is still locked for the next person', await gateUp(D.p));

/* ---- offline, then a different person gets in before it is sent ------------- */
await people();
D=await device(b,'D3'); await D.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(D.p,'dana','dana-code-1');
await D.p.evaluate(()=>showPage('build')); await sleep(3000);
const base3=(await rows()).length;
await D.ctx.setOffline(true); await sleep(500);
await round(D.p);
await D.p.evaluate(()=>{window.Sync.switchUser();}); await sleep(1500);
await ctl('flaky=1');                                // reads and sign-in work, writes fail: nothing can be sent yet
await D.ctx.setOffline(false); await sleep(800);
await signIn(D.p,'pete','pete-code-1');
ok('Pete signs in while Dana\'s work is still waiting', (await person(D.p))==='pete');
ok('it is still held for Dana', (await departed(D.p)).length===1);
await round(D.p); await sleep(1000);
ok('Pete\'s own work waits beside it', (await pending(D.p))>=2);
ok('and nothing has been sent yet', (await rows()).length===base3);
await ctl('flaky=0');
await D.p.evaluate(()=>window.Sync.sync('t')); await sleep(3500);
const split=await sessions();
ok('both go out', split.length>=3 && (await pending(D.p))===0, String(split.length));
ok('Dana\'s under Dana', split.some(r=>r.changed_by==='dana'));
ok('Pete\'s under Pete', split.some(r=>r.changed_by==='pete'));
ok('the kept session is discarded', (await departed(D.p)).length===0);

/* ---- the editing window: never open for the wrong person -------------------- */
await people();
await ctl('tight=1');
D=await device(b,'D4'); await D.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(D.p,'dana','dana-code-1');
await unlock(D.p); await sleep(2500);
await D.p.evaluate(()=>showPage('build')); await sleep(2500);
const base4=(await rows()).length;
await ctl('unlockms=1500'); await D.p.evaluate(()=>window.Sync.lockEditing());
await unlock(D.p);                                  // a window that will have ended by the time anyone is back
await D.ctx.setOffline(true); await sleep(500);
await round(D.p);
await D.p.evaluate(()=>{window.Sync.switchUser();}); await sleep(1500);
await ctl('unlockms=3600000');
await sleep(1500);
await D.ctx.setOffline(false); await sleep(3000);
ok('her window ended while she was away, so her changes are still not sent', (await rows()).length===base4);
ok('they are kept for her', (await departed(D.p)).length===1);
await signIn(D.p,'pete','pete-code-1');
await unlock(D.p); await sleep(1500);
await round(D.p); await sleep(3500);
const after4=await sessions();
ok('Pete unlocks and works: his changes go out as his', after4.some(r=>r.changed_by==='pete'));
ok('Dana\'s are still held, not sent in his name', (await departed(D.p)).length===1 && (await pending(D.p))>0);
ok('the status says whose are waiting', /dana/i.test(await pill(D.p)), await pill(D.p));
D.p.evaluate(()=>{window.Sync.switchUser();}); await sleep(3500);
await signIn(D.p,'dana','dana-code-1');
await unlock(D.p); await sleep(3500);
ok('when Dana signs back in and unlocks, they go out', (await pending(D.p))===0);
ok('as hers', (await sessions()).filter(r=>r.changed_by==='dana').length>=2, JSON.stringify(await by()));
ok('and nothing is kept for her any more', (await departed(D.p)).length===0);

/* ---- idle sign-out ---------------------------------------------------------- */
await people();
await ctl('tight=1');
D=await device(b,'D5',{idleMs:6000,idleCheckMs:400});
await D.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(D.p,'dana','dana-code-1');
await unlock(D.p); await sleep(1500);
await D.p.evaluate(()=>showPage('build')); await sleep(700);
ok('using the device keeps the person signed in', await (async()=>{
  for(let i=0;i<5;i++){ await D.p.mouse.move(100+i*10,100+i*10); await D.p.mouse.click(300,300); await sleep(1300); }
  return (await person(D.p))==='dana' && !(await gateUp(D.p)); })());
await round(D.p);
const waiting5=await pending(D.p);
await sleep(9000);
ok('after the idle time they are signed out', await gateUp(D.p) && (await person(D.p))===null);
ok('what they had waiting was sent first, as theirs', (await sessions()).length>0 && (await sessions()).every(r=>r.changed_by==='dana'), JSON.stringify(await by()));
ok('the editing window closed with them', !(await unlocks()).dana);
ok('the next person starts locked', await (async()=>{ await signIn(D.p,'pete','pete-code-1'); return !(await D.p.evaluate(()=>window.Sync.isEditing())); })());

/* A device left closed overnight: opening it later signs the person out. */
await people();
D=await device(b,'D6',{idleMs:2000,idleCheckMs:60000});
await D.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(D.p,'dana','dana-code-1');
await D.p.evaluate(()=>{ localStorage.setItem('rink_active',JSON.stringify(Date.now()-3600000)); });
await D.p.reload(); await sleep(2500);
ok('a device reopened after the idle time is signed out', await gateUp(D.p) && (await person(D.p))===null);

console.log('\n  '+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);})();
