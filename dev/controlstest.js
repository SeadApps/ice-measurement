const {chromium}=require('playwright');
const B='http://localhost:8200';
/* D1: the controls that change records are locked until the person unlocks
   editing. The server is what actually refuses; this is the polite half, so the
   test is about what a person sees and can do: the controls are greyed, tapping
   one offers the unlock dialog instead of doing it, and what only reads - theme,
   navigation, exports, the map - is never in the way. */
let pass=0, fail=0;
const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x&&!c?'   ['+x+']':''));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ctl=q=>fetch(B+'/__ctl?'+q);
const addStaff=p=>fetch(B+'/__staff',{method:'POST',body:JSON.stringify(p)});
const EDIT='test-editing-code';

async function device(browser,name){
  const ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await ctx.addInitScript(c=>{window.__SYNC_CONFIG__=c;}, {url:B, anon:'test', idleCheckMs:400});
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  !! '+name+' pageerror: '+String(e).split('\n')[0]));
  return {ctx,p,name};
}
async function access(p){
  await p.waitForSelector('.sync-gate #sg-code',{timeout:8000});
  await p.fill('.sync-gate #sg-code','test-access-code'); await p.click('.sync-gate button');
}
async function signInAs(p,id,code){
  await access(p);
  await p.waitForSelector('.sync-gate .sync-name[data-id="'+id+'"]',{timeout:8000});
  await p.click('.sync-gate .sync-name[data-id="'+id+'"]');
  await p.fill('.sync-gate #sg-personal',code); await p.click('.sync-gate .sync-go'); await sleep(2500);
}
const locked=p=>p.evaluate(()=>document.body.classList.contains('sync-locked'));
const asking=p=>p.isVisible('.sync-editask');
const cancel=async p=>{ if(await asking(p)){ await p.click('.sync-editask .sync-cancel'); await sleep(200); } };
const pending=p=>p.evaluate(()=>window.Sync.pending());
const unlockViaDialog=async p=>{ await p.fill('#sg-edit',EDIT); await p.click('.sync-editask .sync-go'); await sleep(1500); };
const sessions=p=>p.evaluate(()=>localStorage.getItem('ice_v4_sessions'));

(async()=>{
await fetch(B+'/__reset');
const b=await chromium.launch();

/* ---- nobody has their own login yet: nothing is locked ---------------------- */
let D=await device(b,'D0'); await D.p.goto(B+'/ice.html'); await sleep(1200);
await access(D.p); await sleep(2500);
ok('with no people yet nothing is locked', !(await locked(D.p)));
await D.p.click('.fl-row'); await sleep(700);
await D.p.click('#newRound'); await sleep(400);
ok('and the controls work as they always did', await D.p.isVisible('#roundCreate') && !(await asking(D.p)));
await D.p.click('#roundCancel');

/* ---- Ice ------------------------------------------------------------------- */
await fetch(B+'/__reset');
await addStaff({id:'dana',name:'Dana',role:'staff',code:'dana-code-1',facilities:[]});
await addStaff({id:'pete',name:'Pete',role:'management',code:'pete-code-1'});
D=await device(b,'D1'); await D.p.goto(B+'/ice.html'); await sleep(1200);
await signInAs(D.p,'dana','dana-code-1');
ok('a person signs in locked', await locked(D.p));
await D.p.click('.fl-row'); await sleep(800);
ok('opening a facility is not editing, so it still works', await D.p.isVisible('#newRound'));

await D.p.click('#newRound'); await sleep(400);
ok('"+ New round" offers the unlock dialog', await asking(D.p));
ok('instead of opening the new-round form', !(await D.p.isVisible('#roundCreate')));
await cancel(D.p);

const was=await sessions(D.p), pend=await pending(D.p);
const box=await D.p.locator('#rink').boundingBox();
await D.p.mouse.click(box.x+box.width*0.5, box.y+box.height*0.5); await sleep(300);
await D.p.click('.chip[data-opt]'); await sleep(400);
ok('a thickness button does not set a reading', (await sessions(D.p))===was);
ok('it asks to unlock', await asking(D.p));
await cancel(D.p);
ok('and nothing is waiting to send', (await pending(D.p))===pend);

await D.p.click('#noteInput'); await D.p.keyboard.type('crack'); await sleep(300);
ok('a note cannot be typed', (await D.p.inputValue('#noteInput'))==='');
await cancel(D.p);
await cancel(D.p);
const dim=await D.p.evaluate(()=>getComputedStyle(document.querySelector('#newRound')).opacity);
ok('the locked controls are greyed', +dim<0.8, dim);

/* what only reads stays open */
const th0=await D.p.evaluate(()=>document.documentElement.getAttribute('data-theme'));
/* the theme is chosen in the shared bar's account menu now, and a locked person can still change it */
const pick=async name=>{await D.p.click('#shellbar #acctMenu'); await D.p.click('#shellbar .dropdown .it:has-text("'+name+'")'); await sleep(300);};
await pick(th0==='dark'?'Light':'Dark');
ok('the theme still works', (await D.p.evaluate(()=>document.documentElement.getAttribute('data-theme')))!==th0 && !(await asking(D.p)));
await pick(th0==='dark'?'Dark':'Light');
await D.p.click('#viewTrend'); await sleep(300);
ok('so do the view switches', !(await asking(D.p)));
await D.p.click('#viewMap');
await D.p.click('#next'); await sleep(200);
ok('and stepping between points', !(await asking(D.p)));
const dl=D.p.waitForEvent('download',{timeout:3000}).catch(()=>null);
await D.p.click('#expCsv'); await dl; await sleep(300);
ok('and exporting', !(await asking(D.p)));

/* preferences */
await D.p.click('#gear'); await sleep(500);
await D.p.click('#targetIn'); await D.p.keyboard.type('9'); await sleep(300);
ok('a preference that changes the facility cannot be typed into', (await D.p.inputValue('#targetIn'))!=='9' && await asking(D.p));
await cancel(D.p);
await D.p.click('#addSheetBtn'); await sleep(300);
ok('nor a sheet added', await asking(D.p)); await cancel(D.p);
await D.p.click('#backupImport'); await sleep(300);
ok('nor a backup restored', await asking(D.p)); await cancel(D.p);
await D.p.click('#settingsDone'); await sleep(300);

/* unlocking through the dialog */
await D.p.click('#newRound'); await sleep(300);
await unlockViaDialog(D.p);
ok('unlocking through the dialog lifts the lock', !(await locked(D.p)));
ok('the control that was tapped is not remembered: tap it again', !(await D.p.isVisible('#roundCreate')));
await D.p.click('#newRound'); await sleep(400);
ok('and it works', await D.p.isVisible('#roundCreate') && !(await asking(D.p)));
await D.p.click('#roundCreate'); await sleep(1500);
ok('a round can be made', (await pending(D.p))>0 || (await sessions(D.p))!==was);
ok('a note can now be typed', await (async()=>{ await D.p.click('#noteInput'); await D.p.keyboard.type('ok'); return (await D.p.inputValue('#noteInput'))==='ok'; })());

/* the window ends */
await D.p.evaluate(()=>window.Sync.lockEditing());
await sleep(300);
ok('locking again locks the controls', await locked(D.p));
await ctl('unlockms=1500');
await D.p.evaluate(c=>window.Sync.unlockEditing(c),EDIT); await sleep(500);
ok('inside a window they are open', !(await locked(D.p)));
await sleep(2600);
ok('when it ends by the clock they lock again without being asked', await locked(D.p));
await ctl('unlockms=3600000');

/* ---- Glass ----------------------------------------------------------------- */
const G=await device(b,'G1'); await G.p.goto(B+'/glass.html'); await sleep(1200);
await signInAs(G.p,'dana','dana-code-1');
ok('glass: signed in locked', await locked(G.p));
await G.p.click('#pnl-045'); await sleep(400);
const gstat=()=>G.p.evaluate(()=>{const e=document.querySelector('.sbtn[aria-pressed="true"]');return e&&e.dataset.s;});
const gs0=await gstat();
await G.p.click('.sbtn[data-s="replace"]'); await sleep(500);
ok('a panel status button offers the dialog', await asking(G.p));
ok('and does not mark the panel', (await gstat())===gs0 && gs0!=='replace', String(await gstat()));
await cancel(G.p);
await G.p.click('#note'); await G.p.keyboard.type('cracked'); await sleep(300);
ok('a note cannot be typed', (await G.p.inputValue('#note'))==='');
await cancel(G.p);
await G.p.evaluate(()=>document.getElementById('spAdd').click()); await sleep(300);   // the stock section is collapsed
ok('nor stock recorded', await asking(G.p)); await cancel(G.p);
await G.p.click('#addRink'); await sleep(300);
ok('nor a rink added', await asking(G.p) && !(await G.p.isVisible('#builder'))); await cancel(G.p);
await G.p.fill('#q','045'); await sleep(300);
ok('searching and filtering are never locked', !(await asking(G.p)) && (await G.p.inputValue('#q'))==='045');
await G.p.evaluate(c=>window.Sync.unlockEditing(c),EDIT); await sleep(1500);
await G.p.click('.sbtn[data-s="replace"]'); await sleep(600);
ok('unlocked, the panel can be marked', (await gstat())==='replace', String(await gstat()));
ok('and the lock is off', !(await locked(G.p)));

console.log('\n  '+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);})();
