const {chromium}=require('playwright');
const B='http://localhost:8200';
/* D1: the activity log. Records keep only their latest version, so without a
   log there is no "before". Every insert and update writes one row: what, who,
   when, and the old and new values. Management reads it; nobody writes or
   alters it, not even Management; and it is not a record, so it can never make
   one look changed. The Quality review Changes page is built on it. */
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
const log=async(t,q)=>{ const r=await fetch(B+'/rest/v1/activity'+(q?'?'+q:''),{headers:H(t)}); return {status:r.status, rows:r.ok?await r.json():[]}; };
const unlock=async t=>{ await rpc(t,'unlock_editing',{code:EDIT}); };
const rec=(kind,id,fac,extra,deleted)=>({kind,id,deleted:!!deleted,body:Object.assign(fac?{fac}:{},extra||{})});

async function device(browser,name){
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

(async()=>{
await fetch(B+'/__reset');
await addStaff({id:'pete',name:'Pete',role:'management',code:'pete-code-1'});
await addStaff({id:'dana',name:'Dana',role:'staff',code:'dana-code-1',facilities:['f1']});
await ctl('tight=1');
const pete=await login('pete'+DOM,'pete-code-1'), dana=await login('dana'+DOM,'dana-code-1'),
      dev=await login('operations@conwayarena.local','test-access-code');
await unlock(pete); await unlock(dana);

/* ---- one row per write ----------------------------------------------------- */
await send(dana,[rec('session','s1','f1',{reading:100,note:'first'})]);
let a=(await log(pete)).rows;
ok('an insert writes one log row', a.length===1, String(a.length));
ok('naming what was written', a[0].kind==='session' && a[0].id==='s1' && a[0].facility_id==='f1');
ok('and who, by the session', a[0].changed_by==='dana' && a[0].changed_by_name==='Dana');
ok('and when, with the server\'s clock', !!a[0].at && Math.abs(Date.now()-Date.parse(a[0].at))<15000);
ok('an insert has no old value', a[0].old_body===null);
ok('and its new value is what was written', a[0].new_body.reading===100 && a[0].new_body.note==='first');

await send(pete,[rec('session','s1','f1',{reading:125,note:'first'})]);
a=(await log(pete)).rows;
ok('an update writes another, not over the first', a.length===2 && a[0].id==='s1');
const upd=a[a.length-1];
ok('by the person who made it', upd.changed_by==='pete');
ok('with the old value', upd.old_body.reading===100, JSON.stringify(upd.old_body));
ok('and the new', upd.new_body.reading===125);
ok('the first row still says what it said', a[0].new_body.reading===100 && a[0].changed_by==='dana');

await send(dana,[rec('session','s1','f1',{reading:125,note:'first'},true)]);
a=(await log(pete)).rows;
const tomb=a[a.length-1];
ok('a removal is logged as one', a.length===3 && tomb.deleted===true && tomb.old_deleted===false);

await send(pete,[rec('note','n1','f1'),rec('note','n2','f1'),rec('note','n3','f1')]);
ok('a batch of three writes three rows', (await log(pete)).rows.length===6);
a=(await log(pete)).rows;
ok('in the order they were written', a.every((x,i)=>i===0||x.seq>a[i-1].seq), JSON.stringify(a.map(x=>x.seq)));

/* a refused write leaves no trace */
const n=a.length;
await send(dana,[rec('session','bad','other-facility')]);
ok('a refused write is not logged', (await log(pete)).rows.length===n);
await rpc(dana,'lock_editing');
await send(dana,[rec('session','bad2','f1')]);
ok('nor one refused for a locked window', (await log(pete)).rows.length===n);

/* ---- who may read it ------------------------------------------------------- */
let r=await log(dana);
ok('Staff cannot read the log', r.status===403 && r.rows.length===0, String(r.status));
r=await log(dev);
ok('nor the shared account', r.status===403);
r=await fetch(B+'/rest/v1/activity');
ok('nor anyone with no sign-in', r.status===401);
ok('Management can', (await log(pete)).status===200);

/* ---- who may write it ------------------------------------------------------ */
const before=JSON.stringify((await log(pete)).rows);
const attempt=async(who,method,body,q)=>(await fetch(B+'/rest/v1/activity'+(q||''),{method,headers:H(who),body:body?JSON.stringify(body):undefined})).status;
for(const [nm,t] of [['Staff',dana],['Management',pete],['the shared account',dev]]){
  ok(nm+' cannot add a row', (await attempt(t,'POST',[{kind:'x',id:'x'}]))===403);
  ok(nm+' cannot change one', (await attempt(t,'PATCH',{new_body:{}},'?seq=eq.1'))===403);
  ok(nm+' cannot delete one', (await attempt(t,'DELETE',null,'?seq=eq.1'))===403);
}
ok('and none of that changed the log', JSON.stringify((await log(pete)).rows)===before);

/* what a person cannot do to a record cannot be done through it either */
await send(pete,[{kind:'activity',id:'forged',deleted:false,body:{fac:'f1'}}]);
ok('a record of kind "activity" is only a record, not a log row', (await log(pete)).rows.filter(x=>x.id==='forged').length===1
   && !(await log(pete)).rows.some(x=>x.kind==='activity'&&x.seq===undefined));

/* ---- it outlives what it describes ----------------------------------------- */
await fetch(B+'/__staff?remove=dana');
a=(await log(pete)).rows;
ok('a removed person is still named in what they did', a[0].changed_by_name==='Dana');
await addStaff({id:'dana',name:'Dana R',facilities:['f1']});
ok('and a rename does not rewrite history', (await log(pete)).rows[0].changed_by_name==='Dana');
ok('records are only ever the latest version', (await rows()).filter(x=>x.id==='s1').length===1);

/* ---- asking for part of it ------------------------------------------------- */
a=(await log(pete,'id=eq.s1')).rows;
ok('the history of one record', a.length===3 && a.every(x=>x.id==='s1'));
a=(await log(pete,'order=seq.desc&limit=2')).rows;
ok('the latest few, newest first', a.length===2 && a[0].seq>a[1].seq);
await send(pete,[rec('session','z9','f2',{q:1})]);
a=(await log(pete,'facility_id=eq.f2')).rows;
ok('one facility\'s changes', a.length===1 && a[0].id==='z9');
a=(await log(pete,'at=gt.'+encodeURIComponent(new Date(Date.now()-3600000).toISOString()))).rows;
ok('since a time', a.length>0);
a=(await log(pete,'at=gt.'+encodeURIComponent(new Date(Date.now()+3600000).toISOString()))).rows;
ok('and nothing from the future', a.length===0);

/* ---- a real device ---------------------------------------------------------- */
await fetch(B+'/__reset');
await addStaff({id:'pete',name:'Pete',role:'management',code:'pete-code-1'});
await addStaff({id:'dana',name:'Dana',role:'staff',code:'dana-code-1',facilities:[]});
await ctl('tight=1');
const b=await chromium.launch();

const P=await device(b,'P');
await P.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(P.p,'pete','pete-code-1');
await P.p.evaluate(c=>window.Sync.unlockEditing(c),EDIT); await sleep(1500);
await P.p.click('.fl-row'); await sleep(700);
await P.p.click('#newRound'); await sleep(300); await P.p.click('#roundCreate'); await sleep(3500);
const made=await rows();
const al=await P.p.evaluate(()=>window.Sync.activity());
ok('Management reads the log through Sync', al.ok && al.rows.length>=made.length, JSON.stringify(al).slice(0,120));
ok('it holds what Ice wrote', made.every(m=>al.rows.some(x=>x.kind===m.kind&&x.id===m.id)));
ok('by Pete', al.rows.every(x=>x.changed_by==='pete'));

/* The log is not a record: reading it, or it growing, cannot make anything look edited. */
const sv=(await rows()).map(x=>x.kind+x.id+x.updated_at).sort();
const rowsBefore=(await (await fetch(B+'/__activity')).json()).length;
for(let i=0;i<3;i++){ await P.p.evaluate(()=>window.Sync.activity()); await P.p.evaluate(()=>window.Sync.sync('idle')); await sleep(1500); }
ok('reading the log changes no record', JSON.stringify(sv)===JSON.stringify((await rows()).map(x=>x.kind+x.id+x.updated_at).sort()));
ok('an idle device adds nothing to it', (await (await fetch(B+'/__activity')).json()).length===rowsBefore);
ok('and has nothing pending', (await P.p.evaluate(()=>window.Sync.pending()))===0);
ok('the log never arrives as a record', !(await rows()).some(x=>x.kind==='activity'));

const D=await device(b,'D');
await D.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(D.p,'dana','dana-code-1');
const dl=await D.p.evaluate(()=>window.Sync.activity());
ok('Staff asking through Sync are told it is Management only', !dl.ok && /management/i.test(dl.error||''), JSON.stringify(dl));
ok('and get no rows', !dl.rows || dl.rows.length===0);

console.log('\n  '+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);})();
