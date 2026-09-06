const {chromium}=require('playwright');

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
(async()=>{const b=await chromium.launch();const ctx = await b.newContext({viewport:{width:1280,height:900}}); await seedSignedIn(ctx);
const p=await ctx.newPage();const errs=[];
p.on('pageerror',e=>errs.push(String(e).split('\n')[0]));
p.on('console',m=>{if(m.type()==='error'&&!/sw\.js|service worker|404/i.test(m.text()))errs.push('console: '+m.text())});
p.on('dialog',d=>d.accept('Rink 2'));
await p.goto('http://localhost:8200/ice.html'); await p.waitForTimeout(1300);

await p.click('.fl-row'); await p.waitForTimeout(900);
ok('workspace opens', await p.isVisible('#rink'));

// add a round through the real dialog
await p.click('#newRound'); await p.waitForTimeout(400);
await p.click('#roundCreate'); await p.waitForTimeout(800);
const rounds = await p.$eval('#sessSel',e=>e.options.length);
ok('a new round is created ('+rounds+' in the picker)', rounds>=2);

await p.click('#homeBtn'); await p.waitForTimeout(600);

await p.reload(); await p.waitForTimeout(1500);
const st = await p.evaluate(()=>{
  const g=k=>Object.values(JSON.parse(localStorage.getItem(k)||'{}')).filter(r=>!r.deleted);
  return {fac:g('ice_v4_facilities').length, sh:g('ice_v4_sheets').length, se:g('ice_v4_sessions').length,
          prefs:JSON.parse(localStorage.getItem('ice_v4_prefs')||'{}')};});
ok('sheet record written ('+st.sh+')', st.sh>=1);
ok('rounds persisted ('+st.se+')',  st.se>=2);
ok('prefs kept separately',         'theme' in st.prefs && 'activeSheet' in st.prefs);
ok('prefs hold no rink data',       !('facilities' in st.prefs));
const body=await p.textContent('body');
ok('home renders after reload',     /fleet overview/i.test(body));

// the theme toggle still round-trips through the shared key
await p.click('#thLight'); await p.waitForTimeout(400);
ok('theme still saves',             (await p.evaluate(()=>localStorage.getItem('rink_theme')))==='light');

console.log('\nerrors:', errs.length?errs.slice(0,5):'none');
await b.close();})();
