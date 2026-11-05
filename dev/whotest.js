const {chromium}=require('playwright');
const B='http://localhost:8200';
const fs=require('fs');
/* D1: nobody types their name any more. Glass used to ask "Marked by" in a box
   and write whatever was typed onto the panel, so anyone could mark a panel as
   anyone. The server now stamps the signed-in person on every change, and the
   page shows that name read-only. Marks made before this keep the name that was
   typed on them, for display; nothing new is written with one. */
let pass=0, fail=0;
const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x&&!c?'   ['+x+']':''));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const addStaff=p=>fetch(B+'/__staff',{method:'POST',body:JSON.stringify(p)});
const rows=async()=>(await (await fetch(B+'/__rows')).json());
const EDIT='test-editing-code', DOM='@staff.conwayarena.local';

async function device(browser,name){
  const ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',acceptDownloads:true});
  await ctx.addInitScript(c=>{window.__SYNC_CONFIG__=c;}, {url:B, anon:'test'});
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  !! '+name+' pageerror: '+String(e).split('\n')[0]));
  return {ctx,p,name};
}
async function signIn(p,id,code){
  await p.waitForSelector('.sync-gate #sg-code',{timeout:8000});
  await p.fill('.sync-gate #sg-code','test-access-code'); await p.click('.sync-gate button');
  if(!id){ await sleep(2500); return; }
  await p.waitForSelector('.sync-gate .sync-name[data-id="'+id+'"]',{timeout:8000});
  await p.click('.sync-gate .sync-name[data-id="'+id+'"]');
  await p.fill('.sync-gate #sg-personal',code); await p.click('.sync-gate .sync-go'); await sleep(2500);
}
const mark=async(p,pid,status)=>{ await p.click('#pnl-'+pid); await sleep(300); await p.click('.sbtn[data-s="'+status+'"]'); await sleep(500); };
const csvOf=async p=>{ const d=p.waitForEvent('download'); await p.click('#csv'); const dl=await d; return fs.readFileSync(await dl.path(),'utf8'); };
const cell=(csv,panel,col)=>{ const lines=csv.split(/\r?\n/).map(l=>l.split('","').map(c=>c.replace(/^"|"$/g,'')));
  const head=lines[0], i=head.indexOf(col); const row=lines.find(r=>r[0]===panel); return row?row[i]:undefined; };
const stateOf=(p,pid)=>p.evaluate(id=>JSON.stringify(state[id]||null),pid).then(JSON.parse);

(async()=>{
await fetch(B+'/__reset');
const b=await chromium.launch();

/* ---- nobody has their own login yet ----------------------------------------- */
let L=await device(b,'L'); await L.p.goto(B+'/glass.html'); await sleep(1200);
await signIn(L.p,null);
ok('there is no box to type a name into', (await L.p.$('#who'))===null);
ok('and no "Marked by" control exists at all', await L.p.evaluate(()=>!document.getElementById('whoami') && !/Marked by/i.test(document.body.innerText)));
await mark(L.p,'045','replace'); await L.p.evaluate(()=>window.Sync.sync('t')); await sleep(2000);
const gp0=(await rows()).filter(r=>r.kind==='glass_panel');
ok('a mark is written with no name on it', gp0.length>0 && gp0.every(r=>!('by' in r.body) && !('changedBy' in r.body)), JSON.stringify(gp0.map(r=>r.body)));

/* ---- signed in --------------------------------------------------------------- */
await fetch(B+'/__reset');
await addStaff({id:'dana',name:'Dana',role:'staff',code:'dana-code-1',facilities:[]});
await addStaff({id:'pete',name:'Pete',role:'management',code:'pete-code-1'});
const D=await device(b,'D'); await D.p.goto(B+'/glass.html'); await sleep(1200);
await signIn(D.p,'dana','dana-code-1');
ok('the bar names who is signed in', (await D.p.textContent('#shellbar #whoName'))==='Dana', await D.p.textContent('#shellbar #whoName'));
ok('and there is still nothing to type into', (await D.p.$('#who'))===null && (await D.p.$('#whoname'))===null);
ok('Sync no longer keeps a typed name', await D.p.evaluate(()=>typeof window.Sync.who==='undefined'));

await D.p.evaluate(c=>window.Sync.unlockEditing(c),EDIT); await sleep(1200);
await mark(D.p,'045','replace');
ok('Dana\'s own mark carries her name locally, straight away', (await stateOf(D.p,'045')).changedBy==='Dana', JSON.stringify(await stateOf(D.p,'045')));
await D.p.evaluate(()=>window.Sync.sync('t')); await sleep(2000);
let row=(await rows()).find(r=>r.kind==='glass_panel');
ok('nothing sent says who: the server does', row && !('by' in row.body) && !('changedBy' in row.body), JSON.stringify(row&&row.body));
ok('and it says Dana', row.changed_by_name==='Dana');
let csv=await csvOf(D.p);
ok('the order list shows her under "Changed by"', cell(csv,'45','Changed by')==='Dana', String(cell(csv,'45','Changed by')));

/* ---- another person, another device ------------------------------------------ */
const P=await device(b,'P'); await P.p.goto(B+'/glass.html'); await sleep(1200);
await signIn(P.p,'pete','pete-code-1');
ok('Pete\'s bar names Pete', (await P.p.textContent('#shellbar #whoName'))==='Pete');
ok('he sees who marked the panel Dana did', (await stateOf(P.p,'045')).changedBy==='Dana', JSON.stringify(await stateOf(P.p,'045')));
csv=await csvOf(P.p);
ok('and the order list says so', cell(csv,'45','Changed by')==='Dana');

await P.p.evaluate(c=>window.Sync.unlockEditing(c),EDIT); await sleep(1200);
await mark(P.p,'045','plexi');
ok('Pete changing it makes it his, not Dana\'s', (await stateOf(P.p,'045')).changedBy==='Pete' && !(await stateOf(P.p,'045')).by);
await P.p.evaluate(()=>window.Sync.sync('t')); await sleep(2000);
row=(await rows()).find(r=>r.kind==='glass_panel');
ok('the server agrees', row.changed_by_name==='Pete');
await D.p.evaluate(()=>window.Sync.sync('t')); await sleep(2500);
ok('Dana\'s device learns it is Pete\'s now', (await stateOf(D.p,'045')).changedBy==='Pete', JSON.stringify(await stateOf(D.p,'045')));

/* ---- marks from before ------------------------------------------------------- */
const tok=(await (await fetch(B+'/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:'operations@conwayarena.local',password:'test-access-code'})})).json()).access_token;
await fetch(B+'/rest/v1/records?on_conflict=kind,id',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},
  body:JSON.stringify([{kind:'glass_panel',id:'100',deleted:false,body:{status:'replace',note:'cracked',by:'Old Name',at:'2026-09-01'}}])});
await D.p.evaluate(()=>window.Sync.sync('t')); await sleep(2500);
csv=await csvOf(D.p);
ok('an old mark still shows the name that was typed on it', cell(csv,'100','Changed by')==='Old Name', String(cell(csv,'100','Changed by')));
ok('and was not claimed by whoever pulled it', !(await stateOf(D.p,'100')).changedBy, JSON.stringify(await stateOf(D.p,'100')));

console.log('\n  '+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);})();
