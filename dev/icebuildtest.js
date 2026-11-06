/* Measurement builder, first part: the reading keys.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/icebuildtest.js

   Twenty-one keys, 1/2" to 3" in eighths: a complete 3x7 or 7x3 grid. Seven across on an iPad
   held upright, three across on a phone and in a wide screen's side panel. Each key carries the
   band's word beside its colour. Readings stored below 1/2" and the old "2+" have no key but
   still display, colour and feed the map. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();
const errs = [];
const open = async (w, url) => {
  const D = await k.device(b, w), p = D.p;
  p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
  await p.goto(B + url);
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('#shellbar .nav'); await sleep(1800);
  await p.click('#iceTabs [data-page=build]'); await sleep(500);
  return D;
};
const EXPECT = ['1/2"', '5/8"', '3/4"', '7/8"', '1"', '1 1/8"', '1 1/4"', '1 3/8"', '1 1/2"', '1 5/8"', '1 3/4"', '1 7/8"', '2"', '2 1/8"', '2 1/4"', '2 3/8"', '2 1/2"', '2 5/8"', '2 3/4"', '2 7/8"', '3"'];

let D = await open(1000, '/ice.html#/f/f1/s/s1/build'), p = D.p;
const R = fn => p.evaluate(fn);
const keys = () => R(() => [...document.querySelectorAll('#chips .chip[data-opt]')].map(c => c.dataset.opt));
const cols = () => R(() => getComputedStyle(document.getElementById('chips')).gridTemplateColumns.split(' ').length);

const ks = await keys();
ok('twenty-one keys', ks.length === 21, String(ks.length));
ok('from 1/2" to 3" in eighths, in order', JSON.stringify(ks) === JSON.stringify(EXPECT), ks.join());
ok('no key for 1/4", 3/8" or 2+', !ks.some(x => ['1/4"', '3/8"', '2+"'].includes(x)));
ok('every key carries the band\'s word', await R(() => [...document.querySelectorAll('#chips .chip[data-opt]')].every(c => /^(Too thin|Thin|Ideal|Thick|Too thick)$/.test(c.querySelector('.w').textContent))));
ok('1 1/2" says Ideal, 5/8" Too thin, 3" Too thick', await R(() => { const w = o => [...document.querySelectorAll('.chip[data-opt]')].find(c => c.dataset.opt === o).querySelector('.w').textContent; return w('1 1/2"') === 'Ideal' && w('5/8"') === 'Too thin' && w('3"') === 'Too thick'; }));
ok('a wide screen\'s side panel is three across (seven down)', await cols() === 3, String(await cols()));
ok('and a key is at least 44px tall', await R(() => document.querySelector('#chips .chip[data-opt]').getBoundingClientRect().height >= 44));

/* a tap writes the label, including the new ones */
const tapSpot = async () => { const bb = await p.locator('#rink').boundingBox(); await p.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5); await sleep(300); };
await p.evaluate(() => document.body.classList.remove('sync-locked'));
await tapSpot();
const sel = () => R(() => { const d = data(); return Object.values(d); });
for (const lab of ['3"', '2 1/8"', '1/2"']) {
  await tapSpot();
  await p.click(".chip[data-opt='" + lab + "']"); await sleep(250);
  ok('tapping ' + lab + ' stores ' + lab, (await sel()).includes(lab), JSON.stringify(await sel()));
}
ok('3" reads as 3 inches in the map and the field', await R(() => decOf.get('3"') === 3 && decOf.get('2 1/8"') === 2.125 && Records.readingValue('3"') === 3));
ok('and 3" is too thick', await R(() => bandOf(decOf.get('3"')).label === 'Too thick'));
await R(() => { selIdx = POINTS.findIndex(q => data()[keyOf(q)] === '1/2"'); refresh(); });
ok('the key shows what is set on the selected spot', await R(() => document.querySelector('#chips .chip.is-set')?.dataset.opt === '1/2"'));

/* older readings still work */
await R(() => { const d = data(); d['legacy1'] = '1/4"'; d['legacy2'] = '3/8"'; d['legacy3'] = '2+"'; });
ok('1/4", 3/8" and 2+ still parse', await R(() => decOf.get('1/4"') === 0.25 && decOf.get('3/8"') === 0.375 && decOf.get('2+"') === 2.1));
ok('and colour as the bands they were in', await R(() => bandOf(0.25).label === 'Too thin' && bandOf(0.375).label === 'Too thin' && bandOf(2.1).label === 'Too thick'));
ok('and are labelled, not thrown away', await R(() => fmtLabel('2+"') !== '' && fmtLabel('1/4"') !== ''));
await R(() => { const d = data(); delete d.legacy1; delete d.legacy2; delete d.legacy3; });
ok('an imported 2.125 becomes 2 1/8"', await R(() => labelOf(2.125)) === '2 1/8"');
ok('and an imported 0.25 stays 1/4"', await R(() => labelOf(0.25)) === '1/4"');
await D.ctx.close();

/* the grid turns with the screen */
D = await open(768, '/ice.html#/f/f1/s/s1/build'); p = D.p;
ok('upright iPad: seven across (three down)', await cols() === 7, String(await cols()));
ok('and each key is at least 44px square', await R(() => { const r = document.querySelector('#chips .chip[data-opt]').getBoundingClientRect(); return r.height >= 44 && r.width >= 44; }));
ok('with no horizontal scroll', await R(() => document.documentElement.scrollWidth <= window.innerWidth));
await D.ctx.close();

D = await open(390, '/ice.html#/f/f1/s/s1/build'); p = D.p;
ok('phone: three across (seven down)', await cols() === 3, String(await cols()));
ok('each key at least 44px square', await R(() => { const r = document.querySelector('#chips .chip[data-opt]').getBoundingClientRect(); return r.height >= 44 && r.width >= 44; }));
ok('and no horizontal scroll', await R(() => document.documentElement.scrollWidth <= window.innerWidth));
/* Undo sits with the keys, directly under Clear this point and the same size. In the card's header it was pushed off the edge of a narrower screen. */
for (const w of [1000, 390]) {
  const E = w === 1000 ? D : await open(w, '/ice.html#/f/f1/s/s1/build'), q = E.p;
  const geo = await q.evaluate(() => { const c = document.getElementById('chips'), kids = [...c.children], u = document.getElementById('undoBtn'), r = u.getBoundingClientRect(), cl = [...c.querySelectorAll('.chip.clear')][0].getBoundingClientRect();
    return { last: kids[kids.length - 1] === u, afterClear: kids[kids.length - 2].textContent === 'Clear this point', sameBox: Math.abs(r.width - cl.width) < 1 && Math.abs(r.height - cl.height) < 1 && Math.abs(r.left - cl.left) < 1,
      under: r.top >= cl.bottom - 1 && r.top - cl.bottom < 30, inView: r.left >= 0 && r.right <= innerWidth, tall: r.height >= 44, inHeader: !!document.querySelector('.card .head #undoBtn'), disabled: u.disabled }; });
  ok(w + 'px: Undo is the last box of the keys, right after Clear this point', geo.last && geo.afterClear);
  ok(w + 'px: the same size and left edge as Clear this point, directly under it', geo.sameBox && geo.under, JSON.stringify(geo) + JSON.stringify(await q.evaluate(() => [...document.querySelectorAll('#chips .chip.clear')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }))));
  ok(w + 'px: fully on screen, and at least 44px tall', geo.inView && geo.tall);
  ok(w + 'px: no longer in the card header', !geo.inHeader);
  ok(w + 'px: off until there is something to undo', geo.disabled);
  await q.evaluate(() => { const c = document.querySelector('#chips .chip[data-opt]'); c.click(); });
  await sleep(300);
  const after = await q.evaluate(() => ({ on: !document.getElementById('undoBtn').disabled, set: Object.keys(data()).length }));
  ok(w + 'px: a reading turns it on', after.on && after.set >= 1, JSON.stringify(after));
  await q.click('#undoBtn'); await sleep(300);
  ok(w + 'px: Undo takes the reading back, and turns itself off', await q.evaluate(() => Object.keys(data()).length) === after.set - 1 && await q.evaluate(() => document.getElementById('undoBtn').disabled));
  if (w !== 1000) await E.ctx.close();
}

await D.ctx.close();

ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
