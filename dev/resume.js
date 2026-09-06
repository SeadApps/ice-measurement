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
(async()=>{const b=await chromium.launch();
const ctx = await b.newContext({viewport:{width:1400,height:900}}); await seedSignedIn(ctx);
const p=await ctx.newPage(); const errs=[];
p.on('pageerror',e=>errs.push(String(e).split('\n')[0]));
p.on('console',m=>{if(m.type()==='error'&&!/sw\.js|404/i.test(m.text()))errs.push('console: '+m.text())});

// first visit ever -> the front screen, as before
await p.goto('http://localhost:8200/ice.html'); await p.waitForTimeout(1400);
ok('a first visit still lands on the home screen', await p.isVisible('#home'));

// open a sheet, then go over to Glass
await p.click('.fl-row'); await p.waitForTimeout(900);
ok('sheet opens', await p.isVisible('#rink') && !(await p.isVisible('#home')));
const sheetName = await p.$eval('#wsName',e=>e.textContent);
await p.click('#viewTrend'); await p.waitForTimeout(500);   // and leave it on Trend

await p.goto('http://localhost:8200/glass.html'); await p.waitForTimeout(900);
ok('glass app loads', (await p.$$('.pnl')).length===127);

// ...and back again via the tab
await p.click('.appsw a[href="ice.html"]'); await p.waitForTimeout(1600);
ok('returns straight to the sheet, not home', await p.isVisible('#rink') && !(await p.isVisible('#home')));
ok('same sheet as before ('+sheetName.trim()+')', (await p.$eval('#wsName',e=>e.textContent)).trim()===sheetName.trim());
ok('and the same view (Trend)', await p.$eval('#viewTrend',e=>e.getAttribute('aria-pressed'))==='true');

// the home button still works, and that choice sticks
await p.click('#homeBtn'); await p.waitForTimeout(700);
ok('home button still goes home', await p.isVisible('#home'));
await p.goto('http://localhost:8200/glass.html'); await p.waitForTimeout(700);
await p.click('.appsw a[href="ice.html"]'); await p.waitForTimeout(1500);
ok('having chosen home, it stays home', await p.isVisible('#home'));

// a plain reload behaves the same way
await p.click('.fl-row'); await p.waitForTimeout(900);
await p.reload(); await p.waitForTimeout(1500);
ok('a reload also resumes the sheet', await p.isVisible('#rink'));

console.log('\nerrors:', errs.length?errs.slice(0,5):'none');
await b.close();})();
