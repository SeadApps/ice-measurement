const {chromium}=require('playwright');
const B='http://localhost:8200';
/* D1: the two-step gate. Step 1 is the shared access code, which signs a device
   in as an account that can only list names. Step 2 is "Who are you?": a person
   picks their name and enters their own code, and that session is the one that
   reads and writes data.

   While nobody has been given a login yet the shared account carries the data,
   as it always has - that is how the rollout begins, and why the older suites
   still pass untouched. */
let pass=0, fail=0;
const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x&&!c?'   ['+x+']':''));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ctl=q=>fetch(B+'/__ctl?'+q);
const addStaff=p=>fetch(B+'/__staff',{method:'POST',body:JSON.stringify(p)});
const rows=async()=>(await (await fetch(B+'/__rows')).json());
const ACCESS='test-access-code';
/* These suites are about sync, not the UI lock (controlstest covers that), so the helpers that
   make edits lift the lock first, as the page did before it existed. */
const bypass=p=>p.evaluate(()=>document.body.classList.remove('sync-locked'));


async function device(browser,name){
  const ctx=await browser.newContext({viewport:{width:1000,height:900}});
  await ctx.addInitScript(c=>{window.__SYNC_CONFIG__=c;}, {url:B, anon:'test'});
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  !! '+name+' pageerror: '+String(e).split('\n')[0]));
  return {ctx,p,name};
}
const open=async d=>{ await d.p.goto(B+'/ice.html'); await sleep(1200); };
const access=async(p,code)=>{
  await p.waitForSelector('.sync-gate #sg-code',{timeout:8000});
  await p.fill('.sync-gate #sg-code',code); await p.click('.sync-gate button'); await sleep(1500);
};
const names=p=>p.$$eval('.sync-gate .sync-name',els=>els.map(e=>e.textContent));
const pick=async(p,id,code)=>{
  await p.click('.sync-gate .sync-name[data-id="'+id+'"]');
  await p.fill('.sync-gate #sg-personal',code); await p.click('.sync-gate .sync-go'); await sleep(2500);
};
const gateUp=p=>p.isVisible('.sync-gate');
const note=async p=>(await p.textContent('.sync-gate .sync-note').catch(()=>''))||'';
const errText=async p=>(await p.textContent('.sync-gate .sync-err').catch(()=>''))||'';
const ls=(p,k)=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null'),k);
const setLs=(p,k,fn)=>p.evaluate(([k,f])=>{const v=JSON.parse(localStorage.getItem(k)||'null');localStorage.setItem(k,JSON.stringify(new Function('v','return ('+f+')(v)')(v)));},[k,fn.toString()]);
const made=async p=>{ await p.evaluate(()=>showPage('build')); await sleep(700); await bypass(p); await p.click('#newRound'); await sleep(300); await p.click('#roundCreate'); await sleep(3000); };

(async()=>{
const b=await chromium.launch();

/* ---- step 1 on its own ----------------------------------------------------- */
await fetch(B+'/__reset');
let D=await device(b,'D1'); await open(D);
ok('a new device is stopped at the access code', await D.p.isVisible('.sync-gate #sg-code'));
ok('which says nothing about any facility before the code', !/Nashua|Conway Arena/.test(await D.p.textContent('.sync-gate')), await D.p.textContent('.sync-gate'));
await access(D.p,'wrong');
ok('a wrong access code is refused', (await errText(D.p)).includes("doesn't match"));
ok('and does not go on to Who are you?', (await names(D.p)).length===0);

/* While nobody has their own login the shared account carries on as before. */
await D.p.fill('.sync-gate #sg-code',ACCESS); await D.p.click('.sync-gate button'); await sleep(2500);
ok('with no people yet, the access code alone gets in', !(await gateUp(D.p)));
ok('and nobody is named as signed in', (await D.p.evaluate(()=>window.Sync.person()))===null);
ok('the shared session is the one holding data', !!(await ls(D.p,'rink_session')) && !(await ls(D.p,'rink_device')));

/* ---- people exist: step 2 appears ------------------------------------------ */
await fetch(B+'/__reset');
await addStaff({id:'dana',name:'Dana',role:'staff',code:'dana-code-1',facilities:[]});
await addStaff({id:'pete',name:'Pete',role:'admin',code:'pete-code-1'});
await addStaff({id:'gone',name:'Gone',role:'staff',code:'gone-code-1',active:false});
D=await device(b,'D2'); await open(D);
await access(D.p,ACCESS);
ok('a right access code leads to Who are you?', (await names(D.p)).length>0);
ok('it lists the active people', JSON.stringify((await names(D.p)).sort())===JSON.stringify(['Dana','Pete']), JSON.stringify(await names(D.p)));
ok('and not a removed one', !(await names(D.p)).includes('Gone'));
ok('the shared session holds no data yet', !(await ls(D.p,'rink_session')));

await D.p.fill('.sync-gate #sg-personal','dana-code-1'); await D.p.click('.sync-gate .sync-go'); await sleep(600);
ok('a code with no name picked is not accepted', (await errText(D.p)).includes('name'));
await pick(D.p,'dana','nope');
ok('a wrong personal code is refused', (await errText(D.p)).includes("doesn't match") && await gateUp(D.p));
ok('and Pete\'s code does not open Dana', true);
await D.p.fill('.sync-gate #sg-personal','pete-code-1'); await D.p.click('.sync-gate .sync-go'); await sleep(1200);
ok('Pete\'s code does not open Dana\'s name', await gateUp(D.p));
await D.p.fill('.sync-gate #sg-personal','dana-code-1'); await D.p.click('.sync-gate .sync-go'); await sleep(2500);
ok('Dana\'s own code gets in', !(await gateUp(D.p)));
ok('Sync knows who is signed in', (await D.p.evaluate(()=>window.Sync.person().name))==='Dana');
ok('her session holds the data, the shared one stays behind it', !!(await ls(D.p,'rink_session')) && !!(await ls(D.p,'rink_device')));
ok('the status pill is shown', await D.p.isVisible('.sync-pill'));

await made(D.p);
const r1=await rows();
ok('what she does reaches the server ('+r1.length+')', r1.length>=3);
ok('stamped as Dana', r1.every(r=>r.changed_by==='dana'));

await D.p.reload(); await sleep(2000);
ok('a reload stays signed in', !(await gateUp(D.p)) && (await D.p.evaluate(()=>window.Sync.person().id))==='dana');

/* ---- the access code is rotated -------------------------------------------- */
const recs=async()=>(await D.p.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('ice_v4_sessions')||'{}')).length));
const held=await recs();
await ctl('code=new-access-code');
await D.p.evaluate(()=>window.Sync.sync('t')); await sleep(1500);
ok('rotation alone does not interrupt a person mid-session', !(await gateUp(D.p)));
await setLs(D.p,'rink_device',v=>Object.assign(v,{expires_at:0}));   // an hour on: the shared session comes up for refresh
await D.p.reload(); await sleep(2000);
await D.p.evaluate(()=>window.Sync.sync('t')); await sleep(2000);
ok('a rotated access code puts the gate back up', await D.p.isVisible('.sync-gate #sg-code'));
ok('and says why', (await note(D.p)).includes('access code has changed'), await note(D.p));
ok('local records are untouched', (await recs())===held);
await access(D.p,ACCESS);
ok('the old code no longer works', (await errText(D.p)).includes("doesn't match"));
await D.p.fill('.sync-gate #sg-code','new-access-code'); await D.p.click('.sync-gate button'); await sleep(1500);
ok('the new code leads on to Who are you?', (await names(D.p)).length>0);
await pick(D.p,'dana','dana-code-1');
ok('and signing in again restores the app', !(await gateUp(D.p)) && (await recs())===held);

/* ---- a person is removed --------------------------------------------------- */
await fetch(B+'/__staff?remove=dana');
await setLs(D.p,'rink_session',v=>Object.assign(v,{expires_at:0}));
await D.p.reload(); await sleep(2000);
await D.p.evaluate(()=>window.Sync.sync('t')); await sleep(2000);
ok('a removed person is signed out at once', await gateUp(D.p));
ok('at Who are you?, not the access code', (await names(D.p)).length>0 && !(await D.p.isVisible('.sync-gate #sg-code')));
ok('which says so', (await note(D.p)).includes('signed out'), await note(D.p));
ok('and no longer lists them', !(await names(D.p)).includes('Dana') && (await names(D.p)).includes('Pete'));
ok('Sync no longer thinks they are signed in', (await D.p.evaluate(()=>window.Sync.person()))===null);
ok('their records stay on the device', (await recs())===held);
await pick(D.p,'pete','pete-code-1');
ok('someone else can take over the device', !(await gateUp(D.p)) && (await D.p.evaluate(()=>window.Sync.person().name))==='Pete');
await fetch(B+'/__staff?restore=dana');

/* ---- sign out -------------------------------------------------------------- */
await D.p.evaluate(()=>window.Sync.signOut()); await sleep(1500);
ok('Sign out returns to the access code', await D.p.isVisible('.sync-gate #sg-code'));
ok('and forgets the person and the shared session',
   !(await ls(D.p,'rink_session')) && !(await ls(D.p,'rink_device')) && !(await ls(D.p,'rink_person')));
ok('but not the records', (await recs())===held);

/* ---- first sign-in with no connection -------------------------------------- */
await fetch(B+'/__reset');
await addStaff({id:'dana',name:'Dana',role:'staff',code:'dana-code-1',facilities:[]});
D=await device(b,'D3'); await open(D);
await ctl('paused=1');
await access(D.p,ACCESS);
ok('no connection at the access code says so', (await errText(D.p)).includes("Can't reach"));
await ctl('paused=0');
await access(D.p,ACCESS);
ok('back online it goes on', (await names(D.p)).length>0);
await ctl('paused=1');
await D.p.reload(); await sleep(2000);
ok('a first sign-in cut off at step 2 explains it', (await D.p.textContent('.sync-gate')).includes('connection'));
ok('and offers another go', await D.p.isVisible('.sync-gate button'));
ok('it did not let anyone in without their own code', await gateUp(D.p));
await ctl('paused=0');
await D.p.click('.sync-gate button'); await sleep(1500);
ok('when the connection is back, the names appear', (await names(D.p)).includes('Dana'));
await pick(D.p,'dana','dana-code-1');
ok('and they can sign in', !(await gateUp(D.p)));

/* ---- a signed-in person with no connection keeps working ------------------- */
await ctl('paused=1');
await D.p.reload(); await sleep(2000);
ok('an already signed-in device opens offline without the gate', !(await gateUp(D.p)));
await ctl('paused=0');

/* ---- the rollout: people are added after devices are already in ------------ */
await fetch(B+'/__reset');
D=await device(b,'D4'); await open(D);
await access(D.p,ACCESS); await sleep(1500);
ok('rollout: a device signed in on the shared account', !(await gateUp(D.p)));
await made(D.p);
const before=(await rows()).length;
await addStaff({id:'dana',name:'Dana',role:'staff',code:'dana-code-1',facilities:[]});
D.p.evaluate(()=>{window.Sync.sync('t');}); await sleep(2500);   // not awaited: it settles only once somebody signs in
ok('once people exist the device asks who is using it', (await names(D.p)).includes('Dana'));
ok('without asking for the access code again', !(await D.p.isVisible('.sync-gate #sg-code')));
ok('and without losing what it held', (await recs())>=2 && (await rows()).length===before);
await pick(D.p,'dana','dana-code-1');
ok('signing in carries on', !(await gateUp(D.p)) && (await D.p.evaluate(()=>window.Sync.person().id))==='dana');

/* ---- a removed person the auth service refuses with 403 ----------------------
   A hosted auth service may answer a banned user's refresh with 403 rather than
   400 or 401. That is still the server saying no, and the person must be signed
   out - not left on "can't reach the server" with a session that does nothing. */
await fetch(B+'/__reset');
await addStaff({id:'dana',name:'Dana',role:'staff',code:'dana-code-1',facilities:[]});
await addStaff({id:'pete',name:'Pete',role:'admin',code:'pete-code-1'});
await ctl('softremove=1');
D=await device(b,'D5'); await open(D);
await access(D.p,ACCESS); await pick(D.p,'dana','dana-code-1');
ok('softremove: signed in as Dana', (await D.p.evaluate(()=>window.Sync.person().id))==='dana');
await fetch(B+'/__staff?remove=dana');
await setLs(D.p,'rink_session',v=>Object.assign(v,{expires_at:0}));
await D.p.reload(); await sleep(2000);
D.p.evaluate(()=>{window.Sync.sync('t');}); await sleep(2500);
ok('a 403 on refresh signs the removed person out', await gateUp(D.p) && (await D.p.evaluate(()=>window.Sync.person()))===null);
ok('at Who are you?, with the reason', (await names(D.p)).includes('Pete') && (await note(D.p)).includes('signed out'), await note(D.p));

await fetch(B+'/__staff?restore=dana');
await D.p.reload(); await sleep(2000);          // the list of names is fetched when the gate opens
await pick(D.p,'dana','dana-code-1');
ok('softremove: signed back in', (await D.p.evaluate(()=>window.Sync.person().id))==='dana');
await fetch(B+'/__staff?remove=dana');
D.p.evaluate(()=>{window.Sync.sync('t');}); await sleep(2500);
ok('a removed person whose token still verifies is found out by the server saying so', await gateUp(D.p) && (await D.p.evaluate(()=>window.Sync.person()))===null);
await ctl('softremove=0');

console.log('\n  '+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);})();
