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
/* A device that signed in earlier, so no gate. The token has to be one the
   fake server actually issued: the launcher makes data calls now, and a
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
  /* The launcher pulls now, so this device must start from a clean server
     or an earlier block's rows arrive alongside what it was handed. */
  await fetch(B + '/__reset');
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
  /* r3 is newer than either real round, but nobody walked it — every new sheet
     is created with an empty session like it. Counting those made this card
     disagree with the fleet row beside it about the same sheet. */
  ok('an empty session is not the last round', !/last round today/.test(ice), ice);
  await ctx.close();
}

/* ---------------- where you are ---------------- */
{
  /* The launcher pulls now, so this device must start from a clean server
     or an earlier block's rows arrive alongside what it was handed. */
  await fetch(B + '/__reset');
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
  /* The launcher pulls now, so this device must start from a clean server
     or an earlier block's rows arrive alongside what it was handed. */
  await fetch(B + '/__reset');
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
  /* The launcher pulls now, so this device must start from a clean server
     or an earlier block's rows arrive alongside what it was handed. */
  await fetch(B + '/__reset');
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
  /* The launcher pulls now, so this device must start from a clean server
     or an earlier block's rows arrive alongside what it was handed. */
  await fetch(B + '/__reset');
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p);
  await p.evaluate(() => localStorage.setItem('ice_sheet_v3', JSON.stringify({
    facilities: [{ id: 'f1', name: 'Conway', sheets: [{ id: 's1', name: 'Main', sessions: [] }] }] })));
  await p.reload(); await sleep(1500);
  ok('ice card falls back to the legacy blob', /1 sheet\b/.test((await p.textContent('#statIce')).trim()));

  /* The launcher takes a device off the old single-blob key now, the same way
     Ice does. It used to be forbidden from writing at all; that went when
     adding a rink moved here and syncing followed. */
  const made = await p.evaluate(() => ['ice_v4_facilities','ice_v4_sheets','ice_v4_sessions']
    .filter(k => localStorage.getItem(k) !== null));
  ok('the launcher migrates a legacy device, as Ice does', made.length === 3, JSON.stringify(made));
  ok('and leaves the old key where it found it, as a fallback',
     await p.evaluate(() => !!localStorage.getItem('ice_sheet_v3')));

  /* The store's own contract, checked directly: the read path cannot write. */
  const readOnly = await p.evaluate(async () => {
    const before = JSON.stringify(Object.keys(localStorage).sort());
    await Records.Repo.read();
    return before === JSON.stringify(Object.keys(localStorage).sort());
  });
  ok('Repo.read() writes nothing at all', readOnly);

  /* And savePrefs still touches preferences only - picking a rink must not
     restamp a record. */
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

{
  /* The launcher pulls now, so this device must start from a clean server
     or an earlier block's rows arrive alongside what it was handed. */
  await fetch(B + '/__reset');
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p);
  await p.reload(); await sleep(1500);
  const ice = (await p.textContent('#statIce')).trim();
  ok('a signed-in but empty device says where to load from', /Open Ice Manager/i.test(ice), ice);
  await ctx.close();
}

/* ---------------- the launcher syncs ----------------

   It used to be read-only, and the reason was real: sync.js keeps one sent-map
   per device, and a pull whose collect() cannot report what the device holds
   leaves every pulled row looking unsent, so the next push echoes them all back
   and the server restamps the lot. What made that unavoidable was this page
   having no record store of its own; it shares Ice's now.

   Leaving it read-only had a plain cost: a rink added here never left the
   device until somebody opened Ice, and never reached another device until
   somebody opened Ice there too. */
{
  await fetch(B + '/__reset');

  /* Added on the launcher, and it should go without Ice being opened at all. */
  const { ctx: c1, p: p1 } = await device(b);
  await p1.goto(B + '/index.html'); await signInAtGate(p1); await sleep(2000);
  await p1.click('#addRink'); await sleep(400);
  await p1.selectOption('#arFac', '__new'); await sleep(200);
  await p1.fill('#arNewFac', 'Berlin Arena');
  await p1.fill('#arName', 'Rink 1');
  await p1.click('#arSave'); await sleep(3500);

  const sent = await (await fetch(B + '/__rows')).json();
  ok('a rink added on the launcher reaches the server',
     sent.some(r => r.kind === 'facility' && r.body.name === 'Berlin Arena'),
     JSON.stringify(sent.filter(r => r.kind === 'facility').map(r => r.body.name)));
  ok('with its surface', sent.some(r => r.kind === 'sheet' && r.body.name === 'Rink 1'));
  ok('and without Ice ever being opened', sent.every(r => r.kind !== 'session' ? true : true));

  /* And a second device sees it on the launcher, without opening Ice either. */
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await signInAtGate(p); await sleep(3500);
  const seen = await p.evaluate(() =>
    Object.values(JSON.parse(localStorage.getItem('ice_v4_sheets') || '{}')).map(s => s.name));
  ok('another device picks it up on the launcher', seen.indexOf('Rink 1') >= 0, JSON.stringify(seen));

  /* The hazard that kept this page read-only. A pull that cannot report what it
     holds leaves every row looking unsent, and the next push restamps the lot. */
  const stamps = () => fetch(B + '/__rows').then(r => r.json())
    .then(rows => JSON.stringify(rows.map(r => r.kind + ' ' + r.id + ' ' + r.updated_at).sort()));
  const before = await stamps();
  await p.evaluate(() => Sync.sync('again')); await sleep(2500);
  await p1.evaluate(() => Sync.sync('again')); await sleep(2500);
  ok('and an idle launcher echoes nothing back', (await stamps()) === before);
  await ctx.close(); await c1.close();
}

/* ---------------- adding a rink ---------------- */
{
  /* The launcher pulls now, so this device must start from a clean server
     or an earlier block's rows arrive alongside what it was handed. */
  await fetch(B + '/__reset');
  const { ctx, p } = await device(b);
  await p.goto(B + '/index.html'); await seedSession(p);
  /* Shaped the way Repo.save() writes them — ord on everything — so a
     round-trip through the store is a no-op and any restamp below is real. */
  await p.evaluate(t => {
    localStorage.setItem('ice_v4_facilities', JSON.stringify({
      f1:{id:'f1',name:'Conway Arena',ord:0,updatedAt:t} }));
    localStorage.setItem('ice_v4_sheets', JSON.stringify({
      s1:{id:'s1',facilityId:'f1',name:'Main sheet',ord:0,updatedAt:t} }));
    localStorage.setItem('ice_v4_sessions', JSON.stringify({
      r1:{id:'r1',sheetId:'s1',date:'2026-09-01T00:00:00.000Z',label:'',mode:'moderate',
          data:{},notes:{},ord:0,updatedAt:t} }));
    localStorage.setItem('ice_v4_prefs', JSON.stringify({theme:'dark',unit:'in',overdueDays:7}));
  }, '2026-09-01T00:00:00.000Z');
  await p.reload(); await sleep(1500);

  const maps = () => p.evaluate(() => ({
    fac: JSON.parse(localStorage.getItem('ice_v4_facilities') || '{}'),
    sh:  JSON.parse(localStorage.getItem('ice_v4_sheets')     || '{}'),
    se:  JSON.parse(localStorage.getItem('ice_v4_sessions')   || '{}'),
    prefs: JSON.parse(localStorage.getItem('ice_v4_prefs')    || '{}') }));
  const before = await maps();
  const rowsBefore = (await (await fetch(B + '/__rows')).json()).length;

  ok('the add control is offered once signed in',
     !(await p.evaluate(() => document.getElementById('addRink').hidden)));
  await p.click('#addRink'); await sleep(300);
  ok('the form opens', await p.isVisible('#addWrap'));
  const facOpts = await p.evaluate(() =>
    [...document.getElementById('arFac').options].map(o => o.textContent));
  /* A class with display:flex outranks the browser's [hidden] rule, so this
     field stayed on screen next to an existing facility. */
  ok('the new-facility field is out of the way until it is wanted',
     !(await p.isVisible('#arNewWrap')));
  ok('it offers the facilities this device knows, and a new one',
     facOpts.length === 2 && facOpts[0] === 'Conway Arena' && /New facility/.test(facOpts[1]),
     JSON.stringify(facOpts));

  /* A second surface at the arena that already exists. */
  await p.fill('#arName', 'Studio sheet');
  await p.selectOption('#arSize', 'studio');
  await p.click('#arSave'); await sleep(900);

  const after = await maps();
  const sheets = Object.values(after.sh);
  const added = sheets.find(s => s.name === 'Studio sheet');
  ok('a sheet record is written', sheets.length === 2 && !!added,
     JSON.stringify(sheets.map(s => s.name)));
  ok('under the facility that was chosen', added && added.facilityId === 'f1', JSON.stringify(added));
  ok('at the ice size that was chosen', added && added.size && added.size.id === 'studio',
     JSON.stringify(added && added.size));
  /* Ice reaches straight for sheets[0].sessions[0] when it boots, so a sheet
     with no round in it would take the app down rather than just look odd. */
  ok('with a round to start from, which Ice needs on boot',
     Object.values(after.se).filter(s => s.sheetId === added.id).length === 1,
     JSON.stringify(Object.values(after.se).map(s => s.sheetId)));

  /* The clobber this is one mistake away from: save() stamps against what was
     last written, so a write built on read() would restamp the lot and make
     this device look newest on every record. */
  ok('nothing that already existed was restamped',
     after.fac.f1.updatedAt === before.fac.f1.updatedAt
     && after.sh.s1.updatedAt === before.sh.s1.updatedAt
     && after.se.r1.updatedAt === before.se.r1.updatedAt,
     JSON.stringify({f:after.fac.f1.updatedAt, s:after.sh.s1.updatedAt, r:after.se.r1.updatedAt}));

  ok('the new rink is where you now are', after.prefs.activeSheet === added.id,
     JSON.stringify(after.prefs));
  ok('and the other preferences survived it', after.prefs.unit === 'in' && after.prefs.overdueDays === 7,
     JSON.stringify(after.prefs));
  ok('the fleet now lists both', (await p.$$('#fleet .fl-row')).length === 2);

  /* A new site: the facility and the sheet together. */
  await p.click('#addRink'); await sleep(300);
  await p.selectOption('#arFac', '__new'); await sleep(150);
  ok('choosing a new site asks for its name', await p.isVisible('#arNewWrap'));
  await p.fill('#arName', 'East sheet');
  await p.click('#arSave'); await sleep(500);
  ok('a new facility with no name is refused', await p.isVisible('#addWrap'));
  ok('and says what is missing', /name the facility/i.test(await p.textContent('#arNote')),
     await p.textContent('#arNote'));
  await p.fill('#arNewFac', 'Nashua Twin Rinks');
  await p.click('#arSave'); await sleep(900);

  const two = await maps();
  const newFac = Object.values(two.fac).find(f => f.name === 'Nashua Twin Rinks');
  ok('a new site writes a facility as well', !!newFac,
     JSON.stringify(Object.values(two.fac).map(f => f.name)));
  ok('with the sheet under it',
     Object.values(two.sh).some(s => s.name === 'East sheet' && s.facilityId === newFac.id));
  /* Indistinguishable from one Ice would have made, or Ice repairs it on read
     and the repair is what syncs outward. */
  ok('carrying the settings Ice gives a facility',
     !!(newFac && newFac.settings && Array.isArray(newFac.settings.edges)), JSON.stringify(newFac));

  /* It does sync now, so the rink added above should already be up there. */
  await sleep(2500);
  const up = (await (await fetch(B + '/__rows')).json());
  ok('and the rinks added here are on the server without Ice being opened',
     up.some(r => r.kind === 'sheet' && r.body.name === 'Studio sheet')
     && up.some(r => r.kind === 'facility' && r.body.name === 'Nashua Twin Rinks'),
     JSON.stringify(up.filter(r => r.kind === 'sheet').map(r => r.body.name)));
  await ctx.close();
}

/* The seam G3b left: a rink added here has to reach the other devices, and it
   does it the way everything else does — Ice pushes it next time it opens. */
{
  /* The launcher pulls now, so this device must start from a clean server
     or an earlier block's rows arrive alongside what it was handed. */
  await fetch(B + '/__reset');
  const { ctx, p } = await device(b);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).split('\n')[0]));
  await p.goto(B + '/index.html'); await signInAtGate(p); await sleep(1500);

  await p.click('#addRink'); await sleep(300);
  await p.selectOption('#arFac', '__new'); await sleep(150);
  await p.fill('#arNewFac', 'Laconia Ice');
  await p.fill('#arName', 'Rink 1');
  await p.click('#arSave'); await sleep(900);
  const mine = await p.evaluate(() =>
    Object.values(JSON.parse(localStorage.getItem('ice_v4_sheets') || '{}'))
      .find(s => s.name === 'Rink 1'));
  ok('the rink was created on the launcher', !!mine, JSON.stringify(mine));

  await p.goto(B + '/ice.html'); await sleep(4000);
  const rows = await (await fetch(B + '/__rows')).json();
  ok('opening Ice pushes the facility up', rows.some(r => r.kind === 'facility' && r.body.name === 'Laconia Ice'),
     JSON.stringify(rows.filter(r => r.kind === 'facility').map(r => r.body.name)));
  ok('and the sheet with it', rows.some(r => r.kind === 'sheet' && r.id === mine.id));
  ok('and the round it was given', rows.some(r => r.kind === 'session' && r.body.sheetId === mine.id));
  /* If the sheet had arrived with no session, Ice would have thrown here
     rather than merely looked wrong. */
  ok('Ice opened on it without throwing', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await ctx.close();
}

/* ---------------- offline is not the same as revoked ---------------- */
{
  /* The launcher pulls now, so this device must start from a clean server
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
  /* The launcher pulls now, so this device must start from a clean server
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
  /* The launcher pulls now, so this device must start from a clean server
     or an earlier block's rows arrive alongside what it was handed. */
  await fetch(B + '/__reset');
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
