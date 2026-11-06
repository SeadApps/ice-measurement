/* The access gate that guards every page, and the store contracts it rests on.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/gatetest.js

   Carried over from the old front page's suite; that page is gone and what it
   guarded is guarded here, against the shell's own page:

   - A device that has never signed in learns nothing: no facility is named behind the gate, even with
     records already on it.
   - A rejected token and a dead network both fail to produce an access token and must behave in opposite
     ways. Conflating them is what left a rotated access code unable to lock anybody out.
   - The read path of the record store writes nothing, saving preferences touches no record, and a device
     that only has the very old single blob is still taken onto the record format (kept through D5).
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
/* A device that signed in earlier, so no gate. The token has to be one the
   fake server actually issued: the shell makes data calls, and a
   made-up one takes a 401 on the first, which expires it locally and re-gates
   the device. That is correct behaviour — it is what makes a rotated code bite
   — but it buries the rest of the test under a modal. */
async function seedSession(p){
  const r = await fetch(B + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CFG.email, password: CODE }) });
  const tok = await r.json();
  await p.evaluate(t => { try{ localStorage.setItem('rink_session', JSON.stringify(
    { access_token: t.access_token, refresh_token: t.refresh_token,
      expires_at: Date.now() + 3600000 })); }catch(e){} }, tok);
}

const T = '2026-09-01T00:00:00.000Z';
const V4 = {
  ice_v4_facilities: { f1: { id: 'f1', name: 'Conway Arena', ord: 0, updatedAt: T },
                       f2: { id: 'f2', name: 'Nashua Rink',  ord: 1, updatedAt: T } },
  ice_v4_sheets:     { s1: { id: 's1', facilityId: 'f1', name: 'Main sheet', ord: 0, updatedAt: T },
                       s2: { id: 's2', facilityId: 'f1', name: 'Studio',     ord: 1, updatedAt: T },
                       s3: { id: 's3', facilityId: 'f2', name: 'Rink 1',     ord: 0, updatedAt: T },
                       sX: { id: 'sX', deleted: true, updatedAt: T } },
  ice_v4_sessions:   { r1: { id: 'r1', sheetId: 's1', date: '2026-08-20T12:00:00.000Z', data: {'0,0':1.5}, notes: {}, updatedAt: T },
                       r2: { id: 'r2', sheetId: 's1', date: '2026-09-03T12:00:00.000Z', data: {'0,0':1.5}, notes: {}, updatedAt: T },
                       r3: { id: 'r3', sheetId: 's2', date: '2026-09-05T12:00:00.000Z', data: {}, notes: {}, updatedAt: T },
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

  ok('the shell gates a device that has never signed in', await p.isVisible('.sync-gate'));

  /* The point of the gate here: an unauthorised device must learn nothing about the rinks, not even how
     many sheets exist. Records go on the device first, so there is something real to leak. */
  await seed(p, V4);
  await p.reload(); await sleep(1500);
  ok('records on the device do not open the gate', await p.isVisible('.sync-gate'));
  const leaked = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok('and no facility is named behind it', !/Conway Arena|Nashua Rink/.test(leaked), leaked.slice(0, 120));

  await signInAtGate(p);
  ok('the code dismisses the gate', !(await p.isVisible('.sync-gate')));
  await p.click('#acctMenu');
  ok('a sign-out is offered once in, in the account menu', await p.isVisible('.dropdown .it:has-text("Sign out")'));
  await ctx.close();
}

/* ---------------- the store's contracts, and the very old blob ---------------- */
{
  await fetch(B + '/__reset');
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p);
  await p.evaluate(() => localStorage.setItem('ice_sheet_v3', JSON.stringify({
    facilities: [{ id: 'f1', name: 'Conway', sheets: [{ id: 's1', name: 'Main', sessions: [] }] }] })));
  await p.reload(); await sleep(1500);
  const loaded = await p.evaluate(async () => { const st = await Records.Repo.load(); return st && st.facilities.length; });
  ok('a device that only has the old single blob is taken onto the record format', loaded === 1, String(loaded));
  const made = await p.evaluate(() => ['ice_v4_facilities','ice_v4_sheets','ice_v4_sessions']
    .filter(k => localStorage.getItem(k) !== null));
  ok('into all three record keys', made.length === 3, JSON.stringify(made));
  ok('and leaves the old key where it found it, as a fallback',
     await p.evaluate(() => !!localStorage.getItem('ice_sheet_v3')));

  /* The store's own contract, checked directly: the read path cannot write. */
  const readOnly = await p.evaluate(async () => {
    const before = JSON.stringify(Object.keys(localStorage).sort());
    await Records.Repo.read();
    return before === JSON.stringify(Object.keys(localStorage).sort());
  });
  ok('Repo.read() writes nothing at all', readOnly);

  /* And savePrefs still touches preferences only - picking a rink must not restamp a record. */
  const prefsOnly = await p.evaluate(async () => {
    const before = ['ice_v4_facilities','ice_v4_sheets','ice_v4_sessions']
      .map(k => localStorage.getItem(k)).join('|');
    await Records.Repo.savePrefs({ activeSheet: 'whatever' });
    const after = ['ice_v4_facilities','ice_v4_sheets','ice_v4_sessions']
      .map(k => localStorage.getItem(k)).join('|');
    return { prefs: JSON.parse(localStorage.getItem('ice_v4_prefs') || '{}'), same: before === after };
  });
  ok('savePrefs writes preferences and leaves every record alone',
     prefsOnly.prefs.activeSheet === 'whatever' && prefsOnly.same, JSON.stringify(prefsOnly));
  await ctx.close();
}

/* ---------------- offline is not the same as revoked ---------------- */
{
  /* The shell pulls now, so this device must start from a clean server
     or an earlier block's rows arrive alongside what it was handed. */
  await fetch(B + '/__reset');
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
  /* The shell pulls now, so this device must start from a clean server
     or an earlier block's rows arrive alongside what it was handed. */
  await fetch(B + '/__reset');
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
  await fetch(B + '/__reset');
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p); await p.reload(); await sleep(900);
  ok('the shell is called Arena Management System', (await p.title()) === 'Arena Management System', await p.title());
  await ctx.close();
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();
