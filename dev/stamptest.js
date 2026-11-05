const {chromium}=require('playwright');
const B='http://localhost:8200';
/* D1: the server stamps who changed a record, the page cannot, and the stamp
   coming back on a pull must never make a record look edited.

   That last part is the trap the spec warns about. changedBy arrives with every
   pulled record, like updatedAt. If the comparison that decides "did this
   change?" counts it, every pull looks like an edit, every device re-sends
   everything, and the server restamps the lot - the clobber the record store
   exists to prevent, with nothing on screen to show it. */
let pass=0, fail=0;
const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x&&!c?'   ['+x+']':''));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rows=async()=>(await (await fetch(B+'/__rows')).json());
const ctl=q=>fetch(B+'/__ctl?'+q);
const addStaff=p=>fetch(B+'/__staff',{method:'POST',body:JSON.stringify(p)});
const DOM='@staff.conwayarena.local';
/* These suites are about sync, not the UI lock (controlstest covers that), so the helpers that
   make edits lift the lock first, as the page did before it existed. */
const bypass=p=>p.evaluate(()=>document.body.classList.remove('sync-locked'));


async function login(email,password){
  const r=await fetch(B+'/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
  return (await r.json()).access_token;
}
const post=(tok,list)=>fetch(B+'/rest/v1/records?on_conflict=kind,id',{method:'POST',
  headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify(list)});
const find=async(kind,id)=>(await rows()).find(r=>r.kind===kind&&r.id===id);

async function device(browser,name){
  const ctx=await browser.newContext({viewport:{width:1000,height:900}});
  await ctx.addInitScript(c=>{window.__SYNC_CONFIG__=c;}, {url:B, anon:'test'});
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  !! '+name+' pageerror: '+String(e).split('\n')[0]));
  return {ctx,p,name};
}
/* The real two-step gate: the shared access code, then pick your name and enter your own. */
async function signIn(p,id,code){
  await p.waitForSelector('.sync-gate #sg-code',{timeout:8000});
  await p.fill('.sync-gate #sg-code','test-access-code');
  await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="'+id+'"]',{timeout:8000});
  await p.click('.sync-gate .sync-name[data-id="'+id+'"]');
  await p.fill('.sync-gate #sg-personal',code);
  await p.click('.sync-gate .sync-go'); await sleep(2500);
}
const snap=async()=>(await rows()).map(r=>r.kind+' '+r.id+' '+r.updated_at).sort();

(async()=>{
await fetch(B+'/__reset');
await addStaff({id:'dana',name:'Dana',role:'staff',code:'dana-code-1',facilities:['f1']});
await addStaff({id:'pete',name:'Pete',role:'management',code:'pete-code-1'});

/* ---- the server stamps, whatever the page says --------------------------- */
const dana=await login('dana'+DOM,'dana-code-1');
const pete=await login('pete'+DOM,'pete-code-1');
const dev =await login('operations@conwayarena.local','test-access-code');
ok('a person can sign in with their own code', !!dana && !!pete);
ok('and a wrong personal code is refused', !(await login('dana'+DOM,'nope')));

let r=await post(dana,[{id:'x1',kind:'note',deleted:false,changed_by:'pete',
  body:{fac:'f1',text:'hello',changedBy:'Pete',changed_by:'pete'}}]);
ok('a write goes through', r.ok);
let row=await find('note','x1');
ok('changed_by is the session\'s person, not the one the page claimed', row.changed_by==='dana', row.changed_by);
ok('the name is stamped alongside', row.changed_by_name==='Dana');
ok('a changedBy smuggled into the body is discarded', row.body.changedBy===undefined && row.body.changed_by===undefined, JSON.stringify(row.body));
ok('the facility tag is copied to its column', row.facility_id==='f1');
ok('the page\'s own fields are left alone', row.body.text==='hello' && row.body.fac==='f1');

await post(pete,[{id:'x1',kind:'note',deleted:false,body:{fac:'f1',text:'hello again'}}]);
row=await find('note','x1');
ok('the next person to change it is the one stamped', row.changed_by==='pete' && row.changed_by_name==='Pete');

await post(dev,[{id:'x2',kind:'note',deleted:false,body:{fac:'f1',text:'from the shared account'}}]);
row=await find('note','x2');
ok('the shared account stamps nobody', row.changed_by===null, String(row.changed_by));

await post(dana,[{id:'x3',kind:'note',deleted:true,body:{fac:'f1'}}]);
ok('a tombstone is stamped too', (await find('note','x3')).changed_by==='dana');

const pull=await (await fetch(B+'/rest/v1/records?select=*',{headers:{Authorization:'Bearer '+pete}})).json();
ok('changed_by comes back on a pull', pull.every(x=>'changed_by' in x && 'changed_by_name' in x));

/* ---- the client: a pulled stamp must never look like an edit ------------- */
await fetch(B+'/__reset');
await addStaff({id:'dana',name:'Dana',role:'staff',code:'dana-code-1',facilities:[]});
await addStaff({id:'pete',name:'Pete',role:'management',code:'pete-code-1'});
const b=await chromium.launch();

const A=await device(b,'A');
await A.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(A.p,'dana','dana-code-1');
await A.p.evaluate(()=>showPage('build')); await sleep(800);
await bypass(A.p); await A.p.click('#newRound'); await sleep(400); await A.p.click('#roundCreate'); await sleep(3000);
const made=await rows();
ok('Dana\'s records reached the server ('+made.length+')', made.length>=3);
ok('every one is stamped Dana', made.every(x=>x.changed_by==='dana'), JSON.stringify(made.map(x=>x.changed_by)));

/* Pete's fresh device invents a phantom facility of its own before its first pull (D2 fixes
   that), which sorts first and moves Dana's facility from ord 0 to 1. That is a real content
   change, rightly restamped Pete, so the facility is left out of the "still Dana's" checks. */
const danas=made.filter(x=>x.kind!=='facility').map(x=>x.kind+' '+x.id);
const Pd=await device(b,'P');
await Pd.p.goto(B+'/ice.html'); await sleep(1200);
await signIn(Pd.p,'pete','pete-code-1'); await sleep(2500);
const local=()=>Pd.p.evaluate(()=>{
  const o={};
  ['ice_v4_facilities','ice_v4_sheets','ice_v4_sessions'].forEach(k=>Object.assign(o,JSON.parse(localStorage.getItem(k)||'{}')));
  return Object.values(o);
});
const pulled=await local();
ok('Pete pulled Dana\'s records down ('+pulled.length+')', pulled.length>=3);
ok('and can see who changed them', pulled.some(x=>x.changedBy==='Dana'), JSON.stringify(pulled.map(x=>x.changedBy)));

/* An idle device, a pull, and an ordinary save of what it already holds. The
   save is the point: it is what Ice does right after every apply(). */
await Pd.p.evaluate(()=>{                              // spy on what this device sends
  window.__sent=[]; const f=window.fetch;
  window.fetch=function(u,o){ if(o&&o.method==='POST'&&/rest\/v1\/records/.test(String(u))) window.__sent.push(o.body); return f.apply(this,arguments); };
});
const before=await snap();
for(let i=0;i<3;i++){
  await Pd.p.evaluate(()=>window.Records.Repo.load().then(st=>window.Records.Repo.save(st)));
  await Pd.p.evaluate(()=>window.Sync.sync('idle')); await sleep(1500);
}
const after=await snap();
ok('a pulled stamp does not make a record look changed', JSON.stringify(before)===JSON.stringify(after), 'server timestamps moved');
ok('nothing is pending', (await Pd.p.evaluate(()=>window.Sync.pending()))===0);
ok('nothing was sent at all', (await Pd.p.evaluate(()=>window.__sent.length))===0);
ok('Dana is still the one stamped on her own records', (await rows()).filter(x=>danas.includes(x.kind+' '+x.id)).every(x=>x.changed_by==='dana'), JSON.stringify((await rows()).filter(x=>danas.includes(x.kind+' '+x.id)).map(x=>[x.kind,x.id,x.changed_by])));
ok('and the local copy still knows it', (await local()).some(x=>x.changedBy==='Dana'));

/* A real edit by Pete is stamped Pete, and never carries a changedBy of its own. */
await Pd.p.evaluate(()=>showPage('build')); await sleep(700);
await bypass(Pd.p); await Pd.p.click('#newRound'); await sleep(300); await Pd.p.click('#roundCreate'); await sleep(3000);
const sent=await Pd.p.evaluate(()=>window.__sent);
ok('Pete\'s edit was sent', sent.length>0);
ok('without a changedBy in it', sent.every(s=>!/changedBy|changed_by/.test(s)), sent.join(' ').slice(0,200));
const fin=await rows();
ok('the new round is stamped Pete', fin.some(x=>x.kind==='session'&&x.changed_by==='pete'));
ok('Dana\'s first round is still Dana\'s', fin.some(x=>x.kind==='session'&&x.changed_by==='dana'));

console.log('\n  '+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);})();
