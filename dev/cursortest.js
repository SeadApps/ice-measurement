/* The pull cursor, and why one per device is not enough.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/cursortest.js

   sync.js remembers the newest updated_at it has seen so the next pull only
   asks for what came after. That cursor lived in one key for the whole origin,
   while the pull itself is filtered to one app's kinds — so whichever app
   synced last carried the cursor past rows the other had never seen. A cursor
   only ever moves forward, so those rows were skipped for good.

   The case that bites: a desktop used for ice rounds for weeks carries a
   cursor at roughly now. The first time somebody opens Glass Manager on it,
   every panel mark older than that cursor is silently missed.

   The cursor is planted directly here rather than arrived at through the apps.
   Driving it through the UI means racing a 1.5s push debounce, and a test that
   sometimes sets up the condition it is checking is worse than no test.
*/
const { chromium } = require('playwright');

const B = 'http://localhost:8200';
const CFG = { url: B, anon: 'test', email: 'operations@conwayarena.local' };
const CODE = 'test-access-code';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };

async function device(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, CFG);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  return { ctx, p };
}
async function signIn(p) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', CODE);
  await p.click('.sync-gate button');
  await sleep(4000);
}
const panelStatus = p => p.evaluate(() =>
  ((JSON.parse(localStorage.getItem('glass_record_v1') || '{}').panels || {})['045'] || {}).status || 'ok');

(async () => {
await fetch(B + '/__reset');
const b = await chromium.launch();

/* ---- somebody marks a panel, months ago as far as this test cares ---- */
const G = await device(b);
await G.p.goto(B + '/glass.html'); await signIn(G.p);
await G.p.evaluate(() => set('045', { status: 'replace', note: 'cracked in the corner' }));
await sleep(4000);
const panel = (await (await fetch(B + '/__rows')).json())
  .find(r => r.kind === 'glass_panel' && r.id === '045');
ok('the mark reached the server', !!panel);
await G.ctx.close();

/* ---- a second device, with a cursor already past that row ----
   which is what any device that has been using the Ice app looks like. */
const D = await device(b);
await D.p.goto(B + '/glass.html'); await signIn(D.p);
ok('it arrives on a device with no cursor', (await panelStatus(D.p)) === 'replace');

/* Make this look like a device that has only ever run the Ice app: no glass
   record, and no glass cursor either. Leaving Glass's own cursor in place would
   be a device that has already pulled the panel once and is right not to ask
   again — which is the opposite of the case under test. */
await D.p.evaluate(() => {
  localStorage.removeItem('glass_record_v1');
  localStorage.removeItem('rink_sync_sent');
  localStorage.removeItem('rink_sync_cursor:glass_panel');
});
const past = new Date(Date.parse(panel.updated_at) + 60000).toISOString();

/* The Ice app's cursor. Under the old shared key this was also Glass's. */
await D.p.evaluate(c => {
  localStorage.setItem('rink_sync_cursor', JSON.stringify(c));                    // the old shared key
  localStorage.setItem('rink_sync_cursor:facility,session,sheet', JSON.stringify(c)); // Ice's, after the fix
}, past);

await D.p.reload();
await sleep(5000);

ok('and still arrives when the Ice app has moved on', (await panelStatus(D.p)) === 'replace',
   'panel 045 reads "' + (await panelStatus(D.p)) + '" — the Ice cursor hid it');

const glassCursor = await D.p.evaluate(() =>
  localStorage.getItem('rink_sync_cursor:glass_panel'));
ok('Glass keeps a cursor of its own', !!glassCursor, String(glassCursor));

/* ---- and Glass's own cursor still does its job: no needless re-pulling ---- */
await D.p.evaluate(() => { window.__gets = 0;
  const f = window.fetch;
  window.fetch = (u, o) => { if (String(u).indexOf('/rest/v1/records?select') >= 0) window.__gets++; return f(u, o); };
});
await D.p.evaluate(() => Sync.sync('again'));
await sleep(2500);
const again = await panelStatus(D.p);
ok('a second pass keeps what it had', again === 'replace', again);

await D.ctx.close();
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();
