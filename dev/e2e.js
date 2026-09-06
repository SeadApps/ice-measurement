const {chromium}=require('playwright'); const fs=require('fs'); const path=require('path');
const B='http://localhost:8200/ice.html';
const LEGACY={theme:"dark",unit:"in",lastBackup:null,contourIdx:2,contoursOn:true,smoothIdx:2,overdueDays:7,
  facilities:[{id:"fA",name:"Conway Arena",settings:null,sheets:[
    {id:"shA",name:"Rink 1",size:null,sessions:[
      {id:"seA1",date:"2026-08-30T12:00:00.000Z",mode:"moderate",data:{"a":3,"b":4},notes:{"a":"soft spot"}},
      {id:"seA2",date:"2026-09-02T12:00:00.000Z",mode:"moderate",data:{"c":5},notes:{}}]}]}],
  activeFacility:"fA",activeSheet:"shA",activeSession:"seA2"};

/* A device that signed in earlier, so no gate. The token must be one the fake
   server actually issued: a made-up one now takes a 401 on the first data call,
   which expires it locally and re-gates the device. That is correct behaviour —
   it is what makes a rotated access code bite — but it buries the rest of the
   test under a modal, so sign in properly and keep what comes back. */
async function seedSignedIn(ctx){
  const r = await fetch('http://localhost:8200/auth/v1/token?grant_type=password', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({email:'operations@conwayarena.local', password:'test-access-code'})});
  const tok = await r.json();
  await ctx.addInitScript(t=>{
    try{ localStorage.setItem('rink_session', JSON.stringify(
      {access_token:t.access_token, refresh_token:t.refresh_token,
       expires_at: Date.now()+3600000})); }catch(e){}
    window.__SYNC_CONFIG__={url:'http://localhost:8200', anon:'test', email:'operations@conwayarena.local'};
  }, tok);
}
const ok=(n,c)=>console.log((c?'  PASS  ':'  FAIL  ')+n);

(async()=>{
const b=await chromium.launch();
const errs=[];

// ---------- device A: an existing user, still on the old single-blob format ----------
const A = await b.newContext({acceptDownloads:true,viewport:{width:1280,height:900}}); await seedSignedIn(A);
const pa=await A.newPage();
pa.on('pageerror',e=>errs.push('A: '+String(e).split('\n')[0]));
await pa.goto(B);
await pa.evaluate(l=>localStorage.setItem('ice_sheet_v3',JSON.stringify(l)),LEGACY);
await pa.evaluate(()=>['ice_v4_facilities','ice_v4_sheets','ice_v4_sessions','ice_v4_prefs'].forEach(k=>localStorage.removeItem(k)));
await pa.reload(); await pa.waitForTimeout(1500);

const mig=await pa.evaluate(()=>({
  fac:JSON.parse(localStorage.getItem('ice_v4_facilities')||'null'),
  se :JSON.parse(localStorage.getItem('ice_v4_sessions')||'null'),
  legacyStillThere: !!localStorage.getItem('ice_sheet_v3')}));
ok('legacy blob migrates to records', !!(mig.fac && mig.fac.fA && mig.fac.fA.name==='Conway Arena'));
ok('both rounds carried over',        !!(mig.se && mig.se.seA1 && mig.se.seA2));
ok('readings and notes intact',       !!(mig.se && mig.se.seA1.data.a===3 && mig.se.seA1.notes.a==='soft spot'));
ok('every record has a timestamp',    !!mig.se && Object.values(mig.se).every(r=>!!r.updatedAt));
ok('old key kept as a fallback',      mig.legacyStillThere);
ok('facility shows on screen',        (await pa.textContent('body')).includes('Conway Arena'));

await pa.reload(); await pa.waitForTimeout(1400);
const t=await pa.textContent('body');
ok('survives a reload from records',  t.includes('Conway Arena') && t.includes('Rink 1'));

await pa.click('#gearHome'); await pa.waitForTimeout(500);
const [dl]=await Promise.all([pa.waitForEvent('download'),pa.click('#backupExport')]);
const file=path.join('/tmp',dl.suggestedFilename()); await dl.saveAs(file);
const snap=JSON.parse(fs.readFileSync(file,'utf8'));
ok('export is the record format',     snap.format==='rink-ice-v4' && Object.keys(snap.sessions).length===2);
ok('export carries no device prefs',  !('theme' in snap) && !('activeSheet' in snap));

/* Device B is a different machine with its own separate work, and the backup
   file is the only channel between it and A. Point it at a port nothing is
   listening on: it keeps a session, so no gate blocks the test, but it can
   never pull A's records and the merge being tested is genuinely a file merge.
   Signing it in properly would have it sync A's data down before the import
   and quietly test nothing. */
async function seedIsolated(ctx){
  await ctx.addInitScript(()=>{
    try{ localStorage.setItem('rink_session', JSON.stringify(
      {access_token:'isolated', refresh_token:'isolated', expires_at: Date.now()+3600000})); }catch(e){}
    window.__SYNC_CONFIG__={url:'http://localhost:8299', anon:'test', email:'operations@conwayarena.local'};
  });
}

// ---------- device B: a different machine with its own separate work ----------
const Bx = await b.newContext({viewport:{width:1280,height:900}}); await seedIsolated(Bx);
const pb=await Bx.newPage();
pb.on('pageerror',e=>errs.push('B: '+String(e).split('\n')[0]));
pb.on('dialog',d=>d.accept());
await pb.goto(B); await pb.waitForTimeout(1400);
const before=await pb.textContent('body');
ok('device B starts on its own data', before.includes('Main facility') && !before.includes('Conway Arena'));

await pb.click('#gearHome'); await pb.waitForTimeout(500);
await pb.setInputFiles('#backupFile', file);
await pb.waitForTimeout(1800);
const after=await pb.textContent('body');
ok("A's facility arrives on B",       after.includes('Conway Arena'));
ok('B keeps its own facility too',    after.includes('Main facility'));
const n=await pb.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('ice_v4_sessions')||'{}')).filter(r=>!r.deleted).length);
ok('B holds both sets of rounds ('+n+')', n===3);

await pb.reload(); await pb.waitForTimeout(1400);
const rl=await pb.textContent('body');
ok('merge survives a reload on B',    rl.includes('Conway Arena') && rl.includes('Main facility'));

console.log('\nerrors:', errs.length?errs.slice(0,6):'none');
await b.close();})();
