/* Trends: the average round by round for the whole sheet, one third of it, or one spot.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/trendtest.js

   seriesOf (ice-core.js) is pure; the page picks it from "Show" and, for one spot, a second
   list of the spots that have readings. Each series is compared with a direct calculation. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();
const D = await k.device(b, 1280), p = D.p;
const errs = []; p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
const R = (fn, arg) => p.evaluate(fn, arg);
await p.goto(B + '/ice.html#/f/f1/s/s1/trends');
await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
await p.waitForSelector('#shellbar .nav'); await sleep(1800);

/* three rounds on real spots: one at each end and one in the middle */
const fix = await R(() => {
  const pts = POINTS.filter(q => q.y === CY);
  const left = keyOf(pts.find(q => thirdOf(q.x) === 0)), mid = keyOf(pts.find(q => thirdOf(q.x) === 1)), right = keyOf(pts.find(q => thirdOf(q.x) === 2));
  const [a, c] = sheet().sessions;
  a.data = { [left]: '1 1/2"', [mid]: '1 3/8"', [right]: '1 1/4"' };
  c.data = { [left]: '1 5/8"', [mid]: '1 1/2"', [right]: '1 1/2"' };
  sheet().sessions.push({ id: 'z9', sheetId: sheet().id, date: new Date(Date.now() - 1000 * 86400 * 30).toISOString(), mode: 'moderate', data: {}, notes: {} });
  buildHome();
  return { left, mid, right };
});
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const get = sel => R(s => seriesOf(sheet().sessions, s).map(o => [o.s.id, +o.st.avg.toFixed(6), o.st.n]), sel);
const same = (a, b2) => JSON.stringify(a) === JSON.stringify(b2);

const whole = await get({ kind: 'sheet' });
ok('whole sheet: one point per round with readings, oldest first, empty round left out', whole.length === 2 && whole[0][0] === 'z1' && whole[1][0] === 'z2', JSON.stringify(whole));
ok('and the averages are the plain average of every reading', same(whole.map(w => w[1]), [+avg([1.5, 1.375, 1.25]).toFixed(6), +avg([1.625, 1.5, 1.5]).toFixed(6)]));
const lz = await get({ kind: 'zone', third: 0 }), nz = await get({ kind: 'zone', third: 1 }), rz = await get({ kind: 'zone', third: 2 });
ok('left end: only that third\'s readings', same(lz.map(w => w[1]), [1.5, 1.625]) && lz.every(w => w[2] === 1), JSON.stringify(lz));
ok('neutral', same(nz.map(w => w[1]), [1.375, 1.5]));
ok('right end', same(rz.map(w => w[1]), [1.25, 1.5]));
const sp = await get({ kind: 'spot', key: fix.mid });
ok('one spot: that spot\'s reading in each round', same(sp.map(w => w[1]), [1.375, 1.5]));
ok('a spot nobody read gives no points', (await get({ kind: 'spot', key: '1,1' })).length === 0);
ok('seriesOf writes nothing and does not reorder the rounds', await R(() => { const ids = sheet().sessions.map(s => s.id).join(); seriesOf(sheet().sessions, { kind: 'sheet' }); return ids === sheet().sessions.map(s => s.id).join(); }));

/* the page */
await R(() => showPage('trends')); await sleep(500);
const sel = () => p.$$eval('#trendSel option', o => o.map(x => x.textContent));
ok('Show offers the whole sheet, the three thirds and one spot', same(await sel(), ['Whole sheet', 'Left end', 'Neutral', 'Right end', 'One spot…']), JSON.stringify(await sel()));
ok('the spot list is hidden until One spot is chosen', !(await p.isVisible('#trendSpot')));
await p.selectOption('#trendSel', 'z0'); await sleep(300);
ok('choosing Left end retitles the chart', /Left end/.test(await p.textContent('#trendTitle')));
ok('and the summary follows that series', /latest 1\.63/.test(await p.textContent('#trendMini')), await p.textContent('#trendMini'));
await p.selectOption('#trendSel', 'spot'); await sleep(300);
ok('One spot shows the list of spots that have readings', await p.isVisible('#trendSpot') && (await p.$$('#trendSpot option')).length === 3);
await p.selectOption('#trendSpot', fix.right); await sleep(300);
const where = await R(k2 => zoneOf({ x: +k2.split(',')[0], y: +k2.split(',')[1] }), fix.right);
ok('a spot is named by where it is', (await p.textContent('#trendTitle')).includes(where), await p.textContent('#trendTitle'));
ok('and its summary is that spot', /latest 1\.50/.test(await p.textContent('#trendMini')), await p.textContent('#trendMini'));
await p.selectOption('#trendSel', 'sheet'); await sleep(300);
ok('back to the whole sheet', !(await p.isVisible('#trendSpot')) && (await p.textContent('#trendTitle')) === 'Conway Arena · Main');
ok('the rounds list still lists every round', (await p.$$('#roundsList .round')).length === 3);

/* a sheet with no readings at all */
await R(() => { sheet().sessions.forEach(s => { s.data = {}; }); buildHome(); });
ok('with no readings the summary is empty and the list still stands', (await p.textContent('#trendMini')) === '' && (await p.$$('#roundsList .round')).length === 3);
ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
