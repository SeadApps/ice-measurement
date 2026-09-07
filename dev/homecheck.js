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
     about the rinks, not even how many sheets exist. Records go on the device
     first, so there is something real to leak - and the fleet is worse than a
     figure, because it names every facility outright. */
  await seed(p, V4);
  await p.reload(); await sleep(1500);
  ok('records on the device do not open the gate', await p.isVisible('.sync-gate'));
  const shown = await p.evaluate(() => document.getElementById('statIce').textContent
                                     + document.getElementById('statGlass').textContent);
  ok('no rink figures rendered behind the gate', shown.trim() === '', JSON.stringify(shown));
  const leaked = await p.evaluate(() => document.getElementById('fleet').textContent
                                      + document.getElementById('fleetNote').textContent);
  ok('and no facility is named behind it', leaked.trim() === '', JSON.stringify(leaked));
  ok('the fleet stays hidden until the code is entered',
     await p.evaluate(() => document.getElementById('whereWrap').hidden));

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

/* ---------------- where you are ---------------- */
{
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p); await seed(p, V4);
  /* Rounds with readings in them, so the overdue rule has something to bite
     on. An empty session is a sheet nobody has actually been to. */
  await p.evaluate(d => localStorage.setItem('ice_v4_sessions', JSON.stringify({
    a: { id:'a', sheetId:'s1', date:new Date(Date.now() -  1*d).toISOString(),
         data:{'0':1}, notes:{}, updatedAt:'2026-09-01T00:00:00.000Z' },
    b: { id:'b', sheetId:'s2', date:new Date(Date.now() - 21*d).toISOString(),
         data:{'0':1}, notes:{}, updatedAt:'2026-09-01T00:00:00.000Z' }
  })), 86400000);
  await p.reload(); await sleep(1600);

  const rowsOf = () => p.evaluate(() =>
    [...document.querySelectorAll('#fleet .fl-row')].map(r => ({
      name: r.querySelector('.fl-name b').textContent,
      fac: r.querySelector('.fl-name span').textContent,
      here: !r.querySelector('.fl-here').hidden,
      badge: r.querySelector('.fl-badge').textContent })));

  const rows = await rowsOf();
  ok('the fleet lists every live sheet', rows.length === 3, JSON.stringify(rows));
  ok('a deleted sheet is not among them', !rows.some(r => r.name === 'sX'), JSON.stringify(rows));
  ok('each row names its sheet and the facility it is in',
     rows[0].name === 'Main sheet' && rows[0].fac === 'Conway Arena'
     && rows[2].fac === 'Nashua Rink', JSON.stringify(rows));

  /* Ice's rule, which this page has to agree with: overdue past seven days. */
  ok('a sheet walked yesterday reads ok', rows[0].badge === 'ok', JSON.stringify(rows));
  ok('one not walked for three weeks reads overdue', rows[1].badge === 'overdue', JSON.stringify(rows));
  ok('one never walked is empty, not overdue', rows[2].badge === 'empty', JSON.stringify(rows));
  const note = await p.textContent('#fleetNote');
  ok('the summary counts the fleet', /3 sheets across 2 facilities/.test(note), note);
  ok('and how many are behind', /1 overdue/.test(note), note);

  /* Picking a rink is the only thing this page writes, and it writes it to
     preferences that are device-local by design. */
  await p.click('#fleet .fl-row:nth-child(3)'); await sleep(700);
  const prefs = await p.evaluate(() => JSON.parse(localStorage.getItem('ice_v4_prefs') || '{}'));
  ok('choosing a rink points Ice at that sheet', prefs.activeSheet === 's3', JSON.stringify(prefs));
  ok('and at the facility it belongs to', prefs.activeFacility === 'f2', JSON.stringify(prefs));
  const picked = await rowsOf();
  ok('the chosen rink says so', picked[2].here && !picked[0].here, JSON.stringify(picked));
  ok('and it keeps its own status alongside that', picked[2].badge === 'empty',
     JSON.stringify(picked));

  /* Standing on a rink must not be what hides that it is behind. */
  await p.click('#fleet .fl-row:nth-child(2)'); await sleep(700);
  const onOverdue = await rowsOf();
  ok('an overdue rink you are standing on still reads overdue',
     onOverdue[1].here && onOverdue[1].badge === 'overdue', JSON.stringify(onOverdue));

  /* Theme, units and the rest live in that same object and must survive. */
  await p.evaluate(() => localStorage.setItem('ice_v4_prefs',
    JSON.stringify({ theme:'light', unit:'mm', overdueDays:30, screen:'work' })));
  await p.reload(); await sleep(1600);
  ok('the overdue threshold is whatever Ice was set to',
     (await rowsOf())[1].badge === 'ok', JSON.stringify(await rowsOf()));
  await p.click('#fleet .fl-row:nth-child(1)'); await sleep(700);
  const kept = await p.evaluate(() => JSON.parse(localStorage.getItem('ice_v4_prefs') || '{}'));
  ok('picking a rink leaves every other preference alone',
     kept.unit === 'mm' && kept.theme === 'light' && kept.screen === 'work', JSON.stringify(kept));
  ok('while still moving the sheet', kept.activeSheet === 's1', JSON.stringify(kept));
  await ctx.close();
}

/* Conway is one arena. A mandatory "choose where you are" step for a one-rink
   operation is friction wearing the costume of structure. */
{
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p);
  await p.evaluate(t => {
    localStorage.setItem('ice_v4_facilities', JSON.stringify({
      f1: { id:'f1', name:'Conway Arena', ord:0, updatedAt:t } }));
    localStorage.setItem('ice_v4_sheets', JSON.stringify({
      s1: { id:'s1', facilityId:'f1', name:'Main sheet', ord:0, updatedAt:t } }));
    localStorage.setItem('ice_v4_sessions', JSON.stringify({}));
  }, '2026-09-01T00:00:00.000Z');
  await p.reload(); await sleep(1500);
  ok('a one-rink operation is never asked to choose',
     await p.evaluate(() => document.getElementById('whereWrap').hidden));
  await ctx.close();
}

/* The Glass card used to say 127 for whatever rink you had, because that is
   Conway's figure and it was written into this page. */
{
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p);
  await p.evaluate(() => localStorage.setItem('glass_record_v2', JSON.stringify({
    records: { legacy: { '069':{status:'plexi'}, '082':{status:'replace'} },
               rab12x: { '004':{status:'replace'} } },
    counts: { legacy: 127, rab12x: 96 } })));
  await p.reload(); await sleep(1500);
  const g = (await p.textContent('#statGlass')).trim();
  ok('the glass card counts the pieces it actually has', /223 pieces/.test(g), g);
  ok('and says how many rinks they are across', /across 2 rinks/.test(g), g);
  ok('still flagging what needs doing', /2 to replace/.test(g) && /1 on plexi/.test(g), g);
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

  /* Nor when it is actually used. Picking a rink touches preferences only. */
  await seed(p, V4);
  await p.reload(); await sleep(1800);
  await p.click('#fleet .fl-row:nth-child(2)'); await sleep(1500);
  ok('nor when a rink is picked on it',
     (await (await fetch(B + '/__rows')).json()).length === before);
  ok('and it still has no cursor to advance',
     (await p.evaluate(() => localStorage.getItem('rink_sync_cursor'))) === null);
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
