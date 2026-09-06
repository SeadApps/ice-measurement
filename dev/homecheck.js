/* The launcher, and the access gate that now guards every page.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/homecheck.js

   Two things here are easy to break and expensive to notice:

   - The launcher must never pull. sync.js keeps one sent-map per device, and a
     pull whose apply() has nothing to apply still advances the cursor — so the
     apps would silently never see the rows it skipped. A test guards it.
   - A rejected token and a dead network both fail to produce an access token
     and must behave in opposite ways. Conflating them is what left a rotated
     access code unable to lock anybody out.
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
async function signInAtGate(p, code) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', code || CODE);
  await p.click('.sync-gate button');
  await sleep(1200);
}
const seedSession = p => p.evaluate(() => localStorage.setItem('rink_session',
  JSON.stringify({ access_token: 'seed', refresh_token: 'seed', expires_at: Date.now() + 3600000 })));

const T = '2026-09-01T00:00:00.000Z';
const V4 = {
  ice_v4_facilities: { f1: { id: 'f1', name: 'Conway Arena', ord: 0, updatedAt: T },
                       f2: { id: 'f2', name: 'Nashua Rink',  ord: 1, updatedAt: T } },
  ice_v4_sheets:     { s1: { id: 's1', facilityId: 'f1', name: 'Main sheet', ord: 0, updatedAt: T },
                       s2: { id: 's2', facilityId: 'f1', name: 'Studio',     ord: 1, updatedAt: T },
                       s3: { id: 's3', facilityId: 'f2', name: 'Rink 1',     ord: 0, updatedAt: T },
                       sX: { id: 'sX', deleted: true, updatedAt: T } },
  ice_v4_sessions:   { r1: { id: 'r1', sheetId: 's1', date: '2026-08-20T12:00:00.000Z', data: {}, notes: {}, updatedAt: T },
                       r2: { id: 'r2', sheetId: 's1', date: '2026-09-03T12:00:00.000Z', data: {}, notes: {}, updatedAt: T },
                       rX: { id: 'rX', deleted: true, updatedAt: T } },
  glass_record_v1:   { who: 'Pete', panels: { '069': { status: 'plexi' }, '082': { status: 'replace' },
                                              '083': { status: 'replace' }, '001': { status: 'ok' } } }
};
const seed = (p, obj) => p.evaluate(o => { for (const k in o) localStorage.setItem(k, JSON.stringify(o[k])); }, obj);

(async () => {
await fetch(B + '/__reset');
const b = await chromium.launch();

/* ---------------- the gate ---------------- */
{
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await sleep(1200);

  ok('launcher gates a device that has never signed in', await p.isVisible('.sync-gate'));

  /* The point of the gate here: an unauthorised device must learn nothing
     about the rinks, not even how many sheets exist. */
  const shown = await p.evaluate(() => document.getElementById('statIce').textContent
                                     + document.getElementById('statGlass').textContent);
  ok('no rink figures rendered behind the gate', shown.trim() === '', JSON.stringify(shown));

  await signInAtGate(p);
  ok('the code dismisses the gate', !(await p.isVisible('.sync-gate')));
  ok('a sign-out control is offered once in', await p.isVisible('.sync-signout'));
  await ctx.close();
}

/* ---------------- the card figures ---------------- */
{
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p); await seed(p, V4);
  await p.reload(); await sleep(1500);

  const ice = (await p.textContent('#statIce')).trim();
  const glass = (await p.textContent('#statGlass')).trim();

  /* This used to read ice_sheet_v3 — the blob the v4 record store replaced —
     so a device that started on v4 reported "Not set up yet" for ever. */
  ok('ice card reads the v4 records',      /3 sheets/.test(ice), ice);
  ok('ice card counts facilities',         /2 facilities/.test(ice), ice);
  ok('ice card skips deleted sheets',      !/4 sheets/.test(ice), ice);
  ok('ice card dates the newest round',    /last round/.test(ice), ice);
  ok('glass card counts what is flagged',  /2 to replace/.test(glass) && /1 on plexi/.test(glass), glass);
  await ctx.close();
}

/* A device that has not opened the Ice app since the move to v4 still has only
   the old blob. It should read that rather than claim there is nothing. */
{
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p);
  await p.evaluate(() => localStorage.setItem('ice_sheet_v3', JSON.stringify({
    facilities: [{ id: 'f1', name: 'Conway', sheets: [{ id: 's1', name: 'Main', sessions: [] }] }] })));
  await p.reload(); await sleep(1500);
  ok('ice card falls back to the legacy blob', /1 sheet\b/.test((await p.textContent('#statIce')).trim()));
  await ctx.close();
}

{
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p);
  await p.reload(); await sleep(1500);
  const ice = (await p.textContent('#statIce')).trim();
  ok('a signed-in but empty device says where to load from', /Open Ice Manager/i.test(ice), ice);
  await ctx.close();
}

/* ---------------- the launcher must not pull ---------------- */
{
  /* Put a record on the server, then open only the launcher. If it pulls, the
     cursor moves past that row and the Ice app never sees it. */
  const { ctx: c1, p: p1 } = await device(b);
  await p1.goto(B + '/ice.html'); await signInAtGate(p1); await sleep(2500);
  await c1.close();

  const before = (await (await fetch(B + '/__rows')).json()).length;

  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await signInAtGate(p); await sleep(2500);
  const cursor = await p.evaluate(() => localStorage.getItem('rink_sync_cursor'));
  ok('launcher leaves the sync cursor alone', cursor === null, String(cursor));
  ok('launcher writes no records of its own',
     (await (await fetch(B + '/__rows')).json()).length === before);
  await ctx.close();
}

/* ---------------- offline is not the same as revoked ---------------- */
{
  const { ctx, p } = await device(b);
  await p.goto(B + '/ice.html'); await signInAtGate(p); await sleep(2000);

  /* Expire the stored token so the next pass has to refresh, then take the
     network away. A dead connection must never sign anybody out — the crew
     works through outages and a code prompt mid-round is the wrong answer. */
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('rink_session'));
    s.expires_at = Date.now() - 1000;
    localStorage.setItem('rink_session', JSON.stringify(s));
  });
  await p.reload(); await sleep(800);
  await p.route('**/auth/v1/token**', r => r.abort());
  await p.evaluate(() => Sync.sync('offline-test'));
  await sleep(1500);

  ok('a dead network shows no gate', !(await p.isVisible('.sync-gate')));
  ok('a dead network keeps the session',
     await p.evaluate(() => !!localStorage.getItem('rink_session')));
  await p.unroute('**/auth/v1/token**');
  await ctx.close();
}

/* ---------------- a rotated code re-gates ---------------- */
{
  const { ctx, p } = await device(b);
  await p.goto(B + '/ice.html'); await signInAtGate(p); await sleep(2500);
  const sheetsBefore = await p.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem('ice_v4_sheets') || '{}')).length);

  /* Rotating the access code invalidates every stored refresh token. */
  await fetch(B + '/__reset');

  /* Expire the stored token, then reload. The reload is the point: sync.js
     keeps the session in a closure that start() populates once, so editing
     localStorage on a running page changes nothing it will ever read again.
     Booting fresh is what makes it pick the expired token up, try to refresh,
     and be turned away. */
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('rink_session'));
    s.expires_at = Date.now() - 1000;
    localStorage.setItem('rink_session', JSON.stringify(s));
  });
  await p.reload();
  await sleep(3000);                                   // boot, refresh, rejection, gate

  /* And a couple more while it is up, to prove they do not stack. */
  p.evaluate(() => Sync.sync('race-1')).catch(() => {});
  p.evaluate(() => Sync.sync('race-2')).catch(() => {});
  await sleep(800);

  ok('a rejected token puts the gate back up', await p.isVisible('.sync-gate'));
  ok('a rejected token clears the session',
     await p.evaluate(() => JSON.parse(localStorage.getItem('rink_session') || 'null') === null));

  /* Deliberately not wiped: a false positive here would destroy work that has
     not synced yet, and local storage is the primary copy. Hiding the data is
     what a rotated code can do; erasing it is not. */
  ok('a rejected token leaves local records alone',
     (await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ice_v4_sheets') || '{}')).length))
       === sheetsBefore);

  ok('only one gate, however many syncs raced', (await p.$$('.sync-gate')).length === 1);

  await signInAtGate(p);
  ok('signing in again dismisses the gate', !(await p.isVisible('.sync-gate')));
  ok('signing in again restores the session',
     await p.evaluate(() => !!localStorage.getItem('rink_session')));
  await ctx.close();
}

/* ---------------- naming ---------------- */
{
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p); await p.reload(); await sleep(900);
  ok('launcher is no longer called Rink Apps', (await p.title()) === 'Arena Management System', await p.title());
  const m = await p.evaluate(async () => (await (await fetch('manifest.json')).json()).name);
  ok('manifest is no longer called Rink Apps', m === 'Arena Management System', m);
  await ctx.close();
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();
