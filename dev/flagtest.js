/* Flags.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/flagtest.js

   Anyone can flag a reading (Ice) or a panel (Glass) from where they stand, on any device. A flag is a record
   of its own kind; the server stamps who raised it and tags its facility. Only Management resolves or reopens
   one, and the server says so even if a page did not. The Facilities cards and the Fleet table count the open
   ones, and the map and the plan mark the flagged spot and panel. Looking at flags writes nothing. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
await k.addStaff({ id: 'dana', name: 'Dana', role: 'staff', code: 'dana-code-1', facilities: ['f1'] });
await k.ctl('tight=1');
const b = await k.chromium.launch();
const errs = [];
const flagRows = async () => (await k.rows()).filter(r => r.kind === 'flag');

const open = async (who, code, path, width) => {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(who + ': ' + String(e).split('\n')[0]));
  await p.goto(B + path);
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="' + who + '"]'); await p.click('.sync-gate .sync-name[data-id="' + who + '"]');
  await p.fill('.sync-gate #sg-personal', code); await p.click('.sync-gate .sync-go');
  await sleep(3500);
  await p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(1200);
  return { ctx, p };
};

/* ---------------- Staff flag a reading, on a phone ---------------- */
const P = await open('dana', 'dana-code-1', '/ice.html#/f/f1/s/s1/rink', 390), p = P.p;
await p.evaluate(() => { const d = data(); d[keyOf(POINTS[3])] = '1 1/2"'; selIdx = 3; refresh(); persist(); });
await sleep(800);
ok('the Flag button is on the Rink view', await p.isVisible('#flagBtn'));
await p.click('#flagBtn'); await sleep(300);
ok('it asks in the page, naming the spot', await p.isVisible('#flagScrim.on') && /Conway/.test(await p.textContent('#flagWhat')));
ok('with the five reasons', JSON.stringify(await p.$$eval('#flagReason option', o => o.map(x => x.textContent))) === JSON.stringify(['Wrong reading', 'Missing data', 'Glass does not match the building', 'Check reading', 'Other']));
await p.selectOption('#flagReason', 'Wrong reading'); await p.fill('#flagNote', 'drain is nearer than that');
await p.click('#flagGo'); await sleep(3500);
let rows = await flagRows();
ok('a flag reaches the server', rows.length === 1, String(rows.length));
const f1 = rows[0] || { body: {} };
ok('open, for that spot, with the reading it had', f1.body.status === 'open' && f1.body.targetKind === 'reading' && f1.body.reading === '1 1/2"' && f1.body.sheetId === 's1', JSON.stringify(f1.body));
ok('tagged with its facility', f1.body.fac === 'f1' && f1.facility_id === 'f1');
ok('and stamped by the person who raised it', f1.changed_by === 'dana');
ok('the spot is marked on the map', await p.evaluate(() => Object.keys(flaggedSpots()).length === 1));
await P.ctx.close();

/* ---------------- and a panel in Glass, on an iPad ---------------- */
const G = await open('dana', 'dana-code-1', '/glass.html#/f/f1/s/s1', 820), g = G.p;
await g.evaluate(() => select('045')); await sleep(500);
await g.click('#flagBtn'); await sleep(300);
ok('Glass asks in the page too', await g.isVisible('#flagScrim.on'));
await g.selectOption('#flagReason', 'Glass does not match the building'); await g.fill('#flagNote', 'panel 45 is wider than the sheet says');
await g.click('#flagGo'); await sleep(3500);
rows = await flagRows();
ok('a second flag, for a panel', rows.length === 2 && rows.some(r => r.body.targetKind === 'panel' && r.body.panelId === '045'), JSON.stringify(rows.map(r => r.body.targetKind)));
ok('the panel is marked on the plan', await g.evaluate(() => document.getElementById('pnl-045').classList.contains('flagged')));
ok('and its card says so', /Flagged: Glass does not match the building/.test(await g.textContent('#detail')));
await G.ctx.close();

/* ---------------- Staff cannot resolve, and the server says so ---------------- */
const dana = await k.login('dana' + k.DOM, 'dana-code-1'), pete = await k.login('pete' + k.DOM, 'pete-code-1');
const send = (tok, id, body) => fetch(B + '/rest/v1/records?on_conflict=kind,id', { method: 'POST', headers: k.H ? k.H(tok) : { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ kind: 'flag', id, deleted: false, body: Object.assign({}, (rows.find(r => r.id === id) || { body: {} }).body, body) }]) });
const unlock = tok => fetch(B + '/rest/v1/rpc/unlock_editing', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: k.EDIT }) });
await unlock(dana); await unlock(pete);
const target = rows[0].id;
const refused = await send(dana, target, { status: 'resolved' });
ok('Staff cannot resolve a flag', refused.status === 403 && /Management/.test(await refused.text()));
ok('Management can', (await send(pete, target, { status: 'resolved' })).ok);
ok('Staff cannot reopen it', (await send(dana, target, { status: 'open' })).status === 403);
ok('Management can reopen it', (await send(pete, target, { status: 'open' })).ok);

/* ---------------- the counts, for Management ---------------- */
const M = await open('pete', 'pete-code-1', '/ice.html#/f/f1/s/s1/rink', 1000), m = M.p;
await sleep(1500);
await m.goto(B + '/index.html#/'); await m.waitForSelector('#facRows .frow', { timeout: 15000 }).catch(() => {}); await sleep(1500);
ok('the Facilities card counts the open flags', /2 open flags/.test(await m.textContent('#facRows .frow[data-fid="f1"]')), await m.textContent('#facRows .frow[data-fid="f1"]'));
await m.click('#viewFleet'); await sleep(400);
const trs = await m.$$eval('#fleetTable tbody tr', r => r.map(x => [...x.children].map(c => c.textContent)));
const main = trs.find(t => t[1] === 'Main') || [];
ok('and so does the Fleet table', main[5] === '2', JSON.stringify(trs));
await m.goto(B + '/index.html#/f/f1'); await sleep(2000);
ok('and the sheet row', /2 open flags/.test(await m.textContent('.srow[data-sid="s1"]')));
/* resolving removes the count and the marks, and the flag stays on record */
await m.evaluate(async id => { await Flags.setStatus(id, 'resolved'); Sync.nudge && Sync.nudge(); }, target);
await m.goto(B + '/ice.html#/f/f1/s/s1/rink'); await sleep(4000);
await m.goto(B + '/index.html#/'); await sleep(1500); await m.click('#viewCards').catch(() => {}); await m.waitForSelector('#facRows .frow', { timeout: 15000 }).catch(() => {}); await sleep(800);
ok('resolving one drops the count to 1', /1 open flag(?!s)/.test(await m.textContent('#facRows .frow[data-fid="f1"]')), await m.textContent('#facRows .frow[data-fid="f1"]'));
ok('the resolved flag is still on record', (await flagRows()).some(r => r.id === target && r.body.status === 'resolved'));

/* ---------------- looking writes nothing ---------------- */
const snap = async () => JSON.stringify((await k.rows()).map(r => [r.kind, r.id, r.updated_at]).sort());
const s0 = await snap();
await m.goto(B + '/glass.html#/f/f1/s/s1'); await sleep(3500);
await m.goto(B + '/ice.html#/f/f1/s/s1/rink'); await sleep(3500);
ok('opening the pages afterwards restamps nothing', (await snap()) === s0);
ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await M.ctx.close();
await k.done(b);
})();
