/* Glass Rink view.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/glassrinktest.js

   The Rink view keeps what the schedule, the plan and the stock already did, and changes four things:
   there is no "Marked by" control (the signed-in person is stamped by the server and named in the
   bar), the order list's column is "Changed by", a tap on a phone picks the nearest panel within
   44px, and on a phone the picked panel opens as a sheet at the bottom of the screen. */
const k = require('./shellkit');
const { ok, sleep, B } = k;
const fs = require('fs');

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });
const b = await k.chromium.launch();
const errs = [];

const open = async (width, mobile) => {
  const ctx = await b.newContext(Object.assign({ viewport: { width, height: mobile ? 760 : 1000 }, serviceWorkers: 'block', acceptDownloads: true },
    mobile ? { isMobile: true, hasTouch: true } : {}));
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
  await p.goto(B + '/glass.html#/f/f1/s/s1');
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="pete"]'); await p.click('.sync-gate .sync-name[data-id="pete"]');
  await p.fill('.sync-gate #sg-personal', 'pete-code-1'); await p.click('.sync-gate .sync-go');
  await p.waitForSelector('#shellbar .nav'); await sleep(2500);
  await p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(1500);
  return { ctx, p };
};

/* ---------------- the desktop Rink view ---------------- */
const D = await open(1280, false), p = D.p;
const R = (fn, a) => p.evaluate(fn, a);

ok('there is no "Marked by" control', await R(() => !document.getElementById('whoami') && !/Marked by/i.test(document.body.innerText)));
ok('Conway is drawn as it was: 127 pieces in the schedule scope "All"', await R(() => { scope && 0; return GLASS.length === 127; }));
ok('the spec strip says what it said', await R(() => document.getElementById('specRadius').textContent.replace(/\s/g, '') === '27′2″' && document.getElementById('specRun').textContent.replace(/\s/g, '') === '455′8″'));
ok('the plan has a panel for every piece', await R(() => document.querySelectorAll('#plan .pnl').length === GLASS.length));
ok('the rail shows the four tiles', await R(() => document.querySelectorAll('#rail .tile').length === 4));

/* a status change takes the right piece off the shelf, and says so */
const pid = '045';
const sz = await R(id => { const q = GLASS.find(x => x.id === id); return { w: q.width_in, h: glassHeightOf(q), thk: q.thickness }; }, pid);
await R(a => { addMovement(a.w, a.h, a.thk, 'tempered', 2, 'count'); store(); spares(); }, sz);
const have = () => R(a => (stockOf(activeFacilityId())[[a.w, a.h, a.thk, 'tempered'].join('|')] || { qty: 0 }).qty, sz);
const before = await have();
await R(id => { select(id); }, pid); await sleep(300);
await p.click('.sbtn[data-s="replace"]'); await sleep(600);
ok('marking a panel needs replacing takes nothing off the shelf', await have() === before);
await p.click('.sbtn[data-s="ok"]'); await sleep(700);
ok('marking it good takes one off the shelf', await have() === before - 1, String(await have()));
ok('and the card says so', /one .* off the shelf/.test(await p.textContent('#savenote')), await p.textContent('#savenote'));

/* who changed it is the signed-in person */
ok('the panel is stamped with the signed-in person, not a typed name', await R(id => state[id].changedBy === 'Pete' && !('by' in state[id]), pid), JSON.stringify(await R(id => state[id], pid)));
await sleep(3500);
const row = (await k.rows()).find(r => r.kind === 'panel' || (r.body && r.body.panel === pid) || r.id === pid || r.id === 's1:' + pid);
ok('and the server stamped the same person', !!row && row.changed_by === 'pete', JSON.stringify(row && [row.kind, row.id, row.changed_by]));

/* the order list */
await R(id => { select(id); set(id, { status: 'replace' }); }, pid); await sleep(500);
const dl = p.waitForEvent('download', { timeout: 8000 });
await p.click('#csv');
const csv = fs.readFileSync(await (await dl).path(), 'utf8');
const head = csv.split('\r\n')[0];
ok('the order list\'s column is "Changed by"', /"Changed by","Date"$/.test(head) && !/Marked by/.test(csv), head);
ok('and the rest of the header is as it was', head === '"Panel","Section","Width (in)","Height (in)","Thickness","Status","Source","Note","Changed by","Date"', head);
ok('and the flagged panel carries the person\'s name', /"45"[^\r]*"Pete"/.test(csv));

/* ---------------- a phone ---------------- */
const M = await open(390, true), q = M.p;
await sleep(500);
const centres = () => q.evaluate(() => [...document.querySelectorAll('#plan .pnl')].map(e => { const r = e.getBoundingClientRect(); return { id: e.dataset.id, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
await q.evaluate(() => document.getElementById('plan').scrollIntoView({ block: 'center' })); await sleep(400);
const cs = await centres();
const svg = await q.evaluate(() => { const r = document.querySelector('#plan svg').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const target = cs.find(c => c.y > 80 && c.y < 640 && c.x > 20 && c.x < 370) || cs[0];
/* a point 16px from the panel's centre, toward the middle of the rink: on the ice, not on a panel */
const dx = svg.x - target.x, dy = svg.y - target.y, len = Math.hypot(dx, dy) || 1;
const near = { x: target.x + dx / len * 16, y: target.y + dy / len * 16 };
const onPanel = await q.evaluate(pt => !!document.elementFromPoint(pt.x, pt.y).closest('.pnl'), near);
await q.evaluate(() => { sel = null; detail(); });
await q.mouse.click(near.x, near.y); await sleep(500);
const picked = await q.evaluate(() => sel);
const dists = cs.map(c => ({ id: c.id, d: Math.hypot(c.x - near.x, c.y - near.y) })).sort((a, c) => a.d - c.d);
ok('a tap near a panel (not on it) picks the nearest one', onPanel ? true : picked === dists[0].id, picked + ' vs ' + dists[0].id + ' (' + dists[0].d.toFixed(1) + 'px)');
await q.evaluate(() => { sel = null; detail(); });
await q.mouse.click(svg.x, svg.y); await sleep(400);
ok('a tap more than 44px from every panel picks nothing', (await q.evaluate(() => sel)) === null);

/* the picked panel opens as a sheet at the bottom */
await q.evaluate(() => select('045')); await sleep(500);
const sheet = await q.evaluate(() => { const e = document.getElementById('detail'), c = getComputedStyle(e), r = e.getBoundingClientRect(); return { pos: c.position, bottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width), vw: innerWidth, shown: r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden' }; });
ok('on a phone the picked panel opens as a sheet fixed to the bottom', sheet.pos === 'fixed' && sheet.bottom <= 1 && sheet.shown && sheet.w >= sheet.vw - 2, JSON.stringify(sheet));
ok('the sheet names the panel and has the status buttons', await q.evaluate(() => /45/.test(document.querySelector('#detail .pid').textContent) && document.querySelectorAll('#detail .sbtn').length === 3));
ok('it can be closed', await (async () => { const c = await q.$('#detail .sheet-x'); if (!c) return false; await c.click(); await sleep(300); return (await q.evaluate(() => sel)) === null && !(await q.isVisible('#detail .sbtn')); })());
const wide = await p.evaluate(() => getComputedStyle(document.getElementById('detail').parentElement).position);
ok('on a laptop the card stays where it was, beside the plan', wide === 'sticky', wide);

ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await M.ctx.close();
await k.done(b);
})();
