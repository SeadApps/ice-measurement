const {chromium}=require('playwright');
const B='http://localhost:8200';
/* D1: changing anything needs the shared editing code, and the server is what
   enforces it. Hiding the buttons is only the polite half, so the first half of
   this file never opens a page: it talks to the server the way a modified page
   would. The second half is a real device finding out what the lock means. */
let pass=0, fail=0;
const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x&&!c?'   ['+x+']':''));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ctl=q=>fetch(B+'/__ctl?'+q);
const addStaff=p=>fetch(B+'/__staff',{method:'POST',body:JSON.stringify(p)});
const rows=async()=>(await (await fetch(B+'/__rows')).json());
const unlocks=async()=>(await (await fetch(B+'/__unlocks')).json());
const DOM='@staff.conwayarena.local', EDIT='test-editing-code';
/* These suites are about sync, not the UI lock (controlstest covers that), so the helpers that
   make edits lift the lock first, as the page did before it existed. */
const bypass=p=>p.evaluate(()=>document.body.classList.remove('sync-locked'));


async function login(email,password){
  const r=await fetch(B+'/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
  return (await r.json()).access_token;
}
const H=t=>({Authorization:'Bearer '+t,'Content-Type':'application/json'});
const write=(t,id,fac)=>fetch(B+'/rest/v1/records?on_conflict=kind,id',{method:'POST',headers:H(t),
  body:JSON.stringify([{id,kind:'note',deleted:false,body:{fac:fac||'f1',text:id}}])});
const rpc=(t,fn,body)=>fetch(B+'/rest/v1/rpc/'+fn,{method:'POST',headers:H(t),body:JSON.stringify(body||{})});
const has=async id=>(await rows()).some(r=>r.id===id);

async function device(browser,name){
  /* No service worker: here the fake server shares the page's origin, so the worker's
     cache-first rule answers a repeated identical pull from its cache. Supabase is
     cross-origin in production, which the worker leaves alone. A device that has sent
     nothing pulls with the same cursor every time, which is how this showed up. */
  const ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
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
const made=async p=>{ if(!(await p.isVisible('#newRound'))){ await p.click('.fl-row'); await sleep(700); } await bypass(p); await p.click('#newRound'); await sleep(300); await p.click('#roundCreate'); await sleep(3000); };
const pending=p=>p.evaluate(()=>window.Sync.pending());
const editing=p=>p.evaluate(()=>window.Sync.isEditing());
const pill=async p=>(await p.textContent('.sync-pill').catch(()=>''))||'';

(async()=>{
await fetch(B+'/__reset');
await addStaff({id:'dana',name:'Dana',role:'staff',code:'dana-code-1',facilities:['f1']});
await addStaff({id:'pete',name:'Pete',role:'management',code:'pete-code-1'});
await addStaff({id:'sam',name:'Sam',role:'staff',code:'sam-code-1',facilities:['f1']});
await ctl('tight=1');

const dana=await login('dana'+DOM,'dana-code-1');
const pete=await login('pete'+DOM,'pete-code-1');
const sam =await login('sam'+DOM,'sam-code-1');
const dev =await login('operations@conwayarena.local','test-access-code');

/* ---- the server, with no page involved ------------------------------------- */
let r=await write(dana,'a1');
ok('signed in is not enough: a write is refused until editing is unlocked', r.status===403, String(r.status));
ok('and nothing was stored', !(await has('a1')));
ok('the refusal says editing is locked', /locked/i.test((await r.json()).message||''));

r=await rpc(dana,'unlock_editing',{code:'nope'});
ok('a wrong editing code is refused', r.status===403);
ok('and leaves editing locked', (await write(dana,'a2')).status===403);
ok('the code is not the access code', (await rpc(dana,'unlock_editing',{code:'test-access-code'})).status===403);

r=await rpc(dana,'unlock_editing',{code:EDIT});
const j=await r.json();
ok('the right editing code is accepted', r.ok);
ok('and opens a window of about an hour', Math.abs(Date.parse(j.until)-Date.now()-3600000)<15000, j.until);
ok('now the write goes through', (await write(dana,'a3')).ok && await has('a3'));
ok('reading never needed the unlock', (await fetch(B+'/rest/v1/records?select=*',{headers:H(sam)})).ok);

ok('the window is per person: Sam is still locked', (await write(sam,'s1')).status===403);
ok('Management needs it too', (await write(pete,'p1')).status===403);
await rpc(pete,'unlock_editing',{code:EDIT});
ok('and can write once unlocked', (await write(pete,'p2')).ok);
ok('Pete unlocking did not unlock Sam', (await write(sam,'s2')).status===403);

r=await rpc(dana,'lock_editing');
ok('locking closes the window at once', r.ok && (await write(dana,'a4')).status===403);
ok('without touching what was written', await has('a3'));
ok('and without touching anyone else\'s window', (await write(pete,'p3')).ok);

ok('the shared account cannot unlock', (await rpc(dev,'unlock_editing',{code:EDIT})).status===403);
ok('or write', (await write(dev,'d1')).status===403);
ok('but can still list names', (await (await rpc(dev,'staff_names')).json()).length===3);

/* guessing the code is slowed: five wrong tries in ten minutes and the sixth is refused, right or wrong */
for(let i=0;i<5;i++) await rpc(sam,'unlock_editing',{code:'guess'+i});
r=await rpc(sam,'unlock_editing',{code:'guess-again'});
ok('after five wrong tries the next is turned away', r.status===403 && /too many/i.test((await r.json()).message||''));
ok('even with the right code, for now', (await rpc(sam,'unlock_editing',{code:EDIT})).status===403);
ok('and it is per person: Dana is not held up by Sam tries', (await rpc(dana,'unlock_editing',{code:EDIT})).ok);
await ctl('clearfailures=1');
ok('it lets go after the wait', (await rpc(sam,'unlock_editing',{code:EDIT})).ok);
await rpc(sam,'lock_editing');

/* the window really does end */
await ctl('unlockms=1200');
await rpc(sam,'unlock_editing',{code:EDIT});
ok('inside a short window a write goes through', (await write(sam,'s3')).ok);
await sleep(1500);
ok('after it ends the write is refused', (await write(sam,'s4')).status===403);
ok('and extending an ended window does not reopen it', (await rpc(sam,'extend_editing')).status===403);

await rpc(sam,'unlock_editing',{code:EDIT});
await sleep(800);
ok('extending an open window works', (await rpc(sam,'extend_editing')).ok);
await sleep(800);
ok('and keeps it open past where it would have ended', (await write(sam,'s5')).ok);
await ctl('unlockms=3600000');

ok('a changed editing code takes effect for the next unlock', await (async()=>{
  await ctl('editcode=new-edit-code');
  const a=(await rpc(dana,'unlock_editing',{code:EDIT})).status===403;
  const b=(await rpc(dana,'unlock_editing',{code:'new-edit-code'})).ok;
  await ctl('editcode='+EDIT); await rpc(dana,'lock_editing'); return a&&b; })());

/* ---- a real device ---------------------------------------------------------- */
await fetch(B+'/__reset');
await addStaff({id:'pete',name:'Pete',role:'management',code:'pete-code-1'});
await ctl('tight=1');
const b=await chromium.launch();
const P=await device(b,'P');
await P.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(P.p,'pete','pete-code-1');

ok('a person signs in locked', !(await editing(P.p)));
/* A fresh device holds only an invented facility, which is not work. Take a reading. */
await P.p.evaluate(()=>{ session().data['3']='1 1/2"'; persist(); }); await sleep(3000);
ok('what they do is kept on the device', (await pending(P.p))>0);
ok('and is not on the server', (await rows()).length===0);
ok('the status says why it is waiting', /unlock/i.test(await pill(P.p)), await pill(P.p));

let u=await P.p.evaluate(code=>window.Sync.unlockEditing(code),'wrong');
ok('a wrong editing code is explained', !u.ok && /does not match/.test(u.error), JSON.stringify(u));
ok('and nothing is sent', (await rows()).length===0 && !(await editing(P.p)));
let tm; for(let i=0;i<5;i++) tm=await P.p.evaluate(code=>window.Sync.unlockEditing(code),'wrong'+i);
ok('too many wrong tries are said so, in the servers words', !tm.ok && /too many/i.test(tm.error), JSON.stringify(tm));
ok('and the right code is refused while it lasts', !(await P.p.evaluate(c=>window.Sync.unlockEditing(c),EDIT)).ok);
await ctl('clearfailures=1');

u=await P.p.evaluate(code=>window.Sync.unlockEditing(code),EDIT);
await sleep(3000);
ok('the right code unlocks', u.ok && await editing(P.p));
ok('everything that was waiting goes out', (await pending(P.p))===0 && (await rows()).length>0);
ok('stamped as the person who unlocked', (await rows()).every(x=>x.changed_by==='pete'));
ok('the server agrees the window is open', !!(await unlocks()).pete);

await P.p.reload(); await sleep(2500);
ok('a reload remembers the window is open', await editing(P.p));

/* working keeps the window open */
const t0=Date.parse((await unlocks()).pete);
await sleep(1200);
await made(P.p);
ok('doing something pushes the window along', Date.parse((await unlocks()).pete)>t0, (await unlocks()).pete);

/* the window ends under a device that is still open */
await P.p.evaluate(()=>window.Sync.lockEditing());
await ctl('unlockms=1500');
await P.p.evaluate(code=>window.Sync.unlockEditing(code),EDIT);
await sleep(2500);
await made(P.p);
const stuck=await pending(P.p);
ok('after the window ends, a change is held, not lost ('+stuck+')', stuck>0);
ok('the device no longer thinks it can edit', !(await editing(P.p)));
ok('and says to unlock', /unlock/i.test(await pill(P.p)), await pill(P.p));
await ctl('unlockms=3600000');
await P.p.evaluate(code=>window.Sync.unlockEditing(code),EDIT); await sleep(3000);
ok('unlocking again sends it', (await pending(P.p))===0);

/* the button the pages carry */
await P.p.evaluate(()=>{ window.Sync.lockEditing(); document.body.appendChild(window.Sync.unlockEl()); });
await sleep(400);
ok('the button offers to unlock while locked', (await P.p.textContent('.sync-unlock'))==='Unlock to edit');
await P.p.click('.sync-unlock');
await P.p.fill('#sg-edit','wrong'); await P.p.click('.sync-editask .sync-go'); await sleep(1200);
ok('a wrong code is explained in the dialog', /does not match/.test(await P.p.textContent('.sync-editask .sync-err')));
await P.p.fill('#sg-edit',EDIT); await P.p.click('.sync-editask .sync-go'); await sleep(1800);
ok('the right code closes the dialog', !(await P.p.isVisible('.sync-editask')));
ok('and the button says until when', /^Editing until /.test(await P.p.textContent('.sync-unlock')), await P.p.textContent('.sync-unlock'));
await P.p.click('.sync-unlock'); await sleep(800);
ok('pressing it locks again, on the server too', (await P.p.textContent('.sync-unlock'))==='Unlock to edit' && !(await unlocks()).pete);
await P.p.click('.sync-unlock'); await P.p.click('.sync-editask .sync-cancel');
ok('Cancel leaves it locked', !(await P.p.isVisible('.sync-editask')) && !(await editing(P.p)));
await P.p.evaluate(code=>window.Sync.unlockEditing(code),EDIT); await sleep(1500);

/* switching user and signing out close the window on the server */
ok('before switching, the window is open on the server', !!(await unlocks()).pete);
await P.p.evaluate(()=>{window.Sync.switchUser();});
await sleep(3000);
ok('Switch user closes the window on the server', !(await unlocks()).pete);
ok('and lands on Who are you?', await P.p.isVisible('.sync-gate .sync-name'));
await P.p.click('.sync-gate .sync-name[data-id="pete"]');
await P.p.fill('.sync-gate #sg-personal','pete-code-1'); await P.p.click('.sync-gate .sync-go'); await sleep(2500);
ok('signing straight back in starts locked', !(await editing(P.p)));
const before=(await rows()).length;
await made(P.p);
ok('so a new change is held again', (await pending(P.p))>0 && (await rows()).length===before);

await P.p.evaluate(code=>window.Sync.unlockEditing(code),EDIT); await sleep(3000);
ok('unlocked once more', !!(await unlocks()).pete);
await P.p.evaluate(()=>{window.Sync.signOut();}); await sleep(3000);
ok('Sign out closes the window on the server', !(await unlocks()).pete);
ok('and returns to the access code', await P.p.isVisible('.sync-gate #sg-code'));

console.log('\n  '+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);})();
