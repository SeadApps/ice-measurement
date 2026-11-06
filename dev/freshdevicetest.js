/* A fresh device.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/freshdevicetest.js

   A device with no records signs in, opens each page, and ends with exactly the facilities the server holds. It
   never invents one (Ice used to fall back to a fresh state and push a "Main facility" before its first pull,
   so every new device added a phantom rink to everybody's list), and nothing about a facility or sheet it was
   only given is sent back. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
await k.addStaff({ id: 'dana', name: 'Dana', role: 'staff', code: 'dana-code-1', facilities: ['f1'] });
await k.ctl('tight=1');                       // people see only their facilities, as on the real server
const b = await k.chromium.launch();
const errs = [];
const names = rows => rows.filter(r => r.kind === 'facility' && !r.deleted).map(r => r.body.name).sort();
const serverBefore = JSON.stringify(await k.rows());

for (const [who, code, want] of [['pete', 'pete-code-1', ['Conway Arena', 'Flynn Rink']], ['dana', 'dana-code-1', ['Conway Arena']]]) {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  const posts = [];
  p.on('request', r => { if (r.method() === 'POST' && /rest\/v1\/records/.test(r.url())) { try { JSON.parse(r.postData() || '[]').forEach(x => posts.push(x)); } catch (e) {} } });
  p.on('pageerror', e => errs.push(who + ': ' + String(e).split('\n')[0]));
  const local = () => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('ice_v4_facilities') || '{}')).filter(f => f && !f.deleted).map(f => f.name).sort());

  /* the very first thing a fresh device does is open whichever page the link was to */
  await p.goto(B + '/ice.html#/f/f1/s/s1/rink');
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  /* Ice has to start from something to draw. What it starts from is marked as a seed: kept off the wire, and gone at the first pull. */
  ok(who + ': before signing in, whatever is on the device is only a seed that is never sent', await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('ice_v4_facilities') || '{}')).every(f => f && f.seed === true)));
  await p.waitForSelector('.sync-gate .sync-name[data-id="' + who + '"]'); await p.click('.sync-gate .sync-name[data-id="' + who + '"]');
  await p.fill('.sync-gate #sg-personal', code); await p.click('.sync-gate .sync-go');
  await sleep(4500);
  ok(who + ': Ice ends with the facilities the server holds', JSON.stringify(await local()) === JSON.stringify(want), JSON.stringify(await local()));
  ok(who + ': and none called Main facility', !(await local()).includes('Main facility'));
  await p.goto(B + '/glass.html#/f/f1/s/s1'); await sleep(3500);
  ok(who + ': Glass leaves them as they are', JSON.stringify(await local()) === JSON.stringify(want), JSON.stringify(await local()));
  await p.goto(B + '/index.html#/'); await sleep(3000);
  ok(who + ': so does the shell', JSON.stringify(await local()) === JSON.stringify(want));
  ok(who + ': the Facilities page lists exactly those', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('#facRows .frow .name')].map(e => e.textContent.trim()).sort())) === JSON.stringify(want));
  ok(who + ': it never sent a facility or a sheet it was only given', !posts.some(x => x.kind === 'facility' || x.kind === 'sheet'), JSON.stringify(posts.filter(x => x.kind === 'facility' || x.kind === 'sheet').map(x => [x.kind, x.id, x.body && x.body.name])));
  await ctx.close();
}
const after = await k.rows();
ok('the server holds the same facilities as before, and no more', JSON.stringify(names(after)) === JSON.stringify(['Conway Arena', 'Flynn Rink']), JSON.stringify(names(after)));
ok('and nothing it held was restamped', JSON.stringify((await k.rows()).filter(r => r.kind === 'facility' || r.kind === 'sheet').map(r => [r.kind, r.id, r.updated_at]))
   === JSON.stringify(JSON.parse(serverBefore).filter(r => r.kind === 'facility' || r.kind === 'sheet').map(r => [r.kind, r.id, r.updated_at])));
ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
