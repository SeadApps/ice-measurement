/* The two drawings in a Quality report: the ice map and the glass plan.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/reportmapstest.js

   report-maps.js draws what Ice and Glass draw without either page being open. Here: the map's colours are the
   band rule's (so a spot at 1 1/2" is the Ideal colour and one at 1/2" the Too thin colour), it follows the
   facility's own edges, it is the light theme whatever theme is on; the plan colours panels by condition;
   and the Reports page carries both, the same in either theme, and writes nothing. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
/* a round with real spots, newest on Conway's sheet */
const tok = await k.login('operations@conwayarena.local', k.ACCESS);
await fetch(B + '/rest/v1/records?on_conflict=kind,id', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify([
  { kind: 'session', id: 'zmap', deleted: false, body: { id: 'zmap', fac: 'f1', sheetId: 's1', ord: 2, date: new Date().toISOString(), mode: 'moderate',
    data: { '100,42.5': '1 1/2"', '30,20': '1/2"', '170,60': '3"', '60,42.5': '1 3/4"' }, notes: {}, updatedAt: new Date().toISOString() } }]) });
const b = await k.chromium.launch();
const D = await k.device(b, 1280), p = D.p;
await p.goto(B + '/index.html'); await k.signIn(p);

/* ---- the map ----------------------------------------------------------------------------------- */
const px = await p.evaluate(() => {
  const R = Records, set = R.settingsOf({ target: 1.5, edges: [0.75, 1.5, 1.625, 2] }, {});
  const cv = ReportMaps.iceMap({ size: { L: 200, W: 85, corner: 28 }, data: { '100,42.5': '1 1/2"', '30,20': '1/2"', '170,60': '3"' }, settings: set, width: 1600, labels: false, legend: false });
  const c = cv.getContext('2d'), s = (1600 - 48) / 200, at = (x, y) => [...c.getImageData(Math.round(24 + x * s), Math.round(24 + (85 - y) * s), 1, 1).data].slice(0, 3);
  return { w: cv.width, h: cv.height, ideal: at(100, 42.5), thin: at(30, 20), thick: at(170, 60), outside: [...c.getImageData(2, 2, 1, 1).data].slice(0, 3) };
});
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
ok('the map is the width asked, with room for the legend', px.w === 1600 && px.h > 600, JSON.stringify(px));
ok('a spot at 1 1/2" is the Ideal colour (light theme)', near(px.ideal, [0xcf, 0xe3, 0xec]), px.ideal.join());
ok('a spot at 1/2" is the Too thin colour', near(px.thin, [0xc4, 0x33, 0x2d]), px.thin.join());
ok('a spot at 3" is the Too thick colour', near(px.thick, [0x2c, 0x6a, 0xa3]), px.thick.join());
ok('outside the boards it is paper white', near(px.outside, [255, 255, 255]), px.outside.join());
const edgeTest = await p.evaluate(() => { const set = Records.settingsOf({ target: 1.5, edges: [1, 1.75, 2, 2.5] }, {}), b = ReportMaps.bandsFor(set);
  return { rng: b.map(x => x.rng), mid: ReportMaps.colorFor(b, 1.875).map(Math.round), hi: ReportMaps.colorFor(b, 2.25).map(Math.round) }; });
ok('the legend follows the facility own edges', edgeTest.rng[0] === '< 1″' && edgeTest.rng[4] === '2 1/2″ +' && edgeTest.rng[1] === '1″ – 1 3/4″', edgeTest.rng.join(' | '));
ok('and 1 7/8 is Ideal and 2 1/4 Thick on those edges', near(edgeTest.mid, [0xcf, 0xe3, 0xec]) && near(edgeTest.hi, [0x5b, 0x9c, 0xcc]), edgeTest.mid.join() + ' / ' + edgeTest.hi.join());

/* ---- the plan ---------------------------------------------------------------------------------- */
await p.evaluate(() => {
  const rec = (status) => ({ status, updatedAt: '2026-11-01T00:00:00Z' });
  localStorage.setItem('glass_record_v2', JSON.stringify({ records: { legacy: { '045': rec('replace'), '046': rec('replace'), '050': rec('plexi') } }, boundSheetId: 's1', specs: {}, built: {}, spares: {}, widths: {} }));
});
const gf = await p.evaluate(async () => { const g = await Records.glassFor('s1'); const svg = ReportMaps.glassPlan(g, 'Conway Arena'), c = ReportMaps.glassCounts(g);
  return { layout: g.layout, bound: g.bound, c, svgOk: svg.startsWith('<svg'), red: (svg.match(/fill="#c8202f"/g) || []).length, amber: (svg.match(/fill="#a85d00"/g) || []).length, themeVars: /var\(--/.test(svg) }; });
ok('Conway glass is found for its bound sheet', gf.layout && gf.bound && gf.c.total > 100, JSON.stringify(gf.c));
ok('two panels need replacing and one is on plexi, and the counts say so', gf.c.replace === 2 && gf.c.plexi === 1 && gf.c.ok === gf.c.total - 3);
ok('and the plan draws them in those colours', gf.red === 2 && gf.amber === 1, gf.red + ' ' + gf.amber);
ok('written in plain colours, not theme variables, so it prints', gf.svgOk && !gf.themeVars);
const none = await p.evaluate(async () => { const g = await Records.glassFor('s3'); return { layout: g.layout, svg: ReportMaps.glassPlan(g) }; });
ok('a sheet with no glass built draws no plan', none.layout === false && none.svg === '');

/* ---- the Reports page -------------------------------------------------------------------------- */
const s0 = await k.stamps();
await p.goto(B + '/index.html#/review/reports'); await p.waitForSelector('#reportPaper'); await sleep(1500);
const rep = () => p.evaluate(() => ({ img: (document.querySelector('#reportPaper img.rp-map') || {}).src || '', svg: !!document.querySelector('#reportPaper svg.rp-plan'), cap: (document.querySelector('#reportPaper .rp-cap') || {}).textContent || '', sheet: document.getElementById('repSheet').selectedOptions[0].textContent }));
const r = await rep();
ok('the report carries the map image of the latest round', /^data:image\/png/.test(r.img) && r.img.length > 5000, r.sheet + ' ' + r.img.length);
ok('and the glass plan, with its counts', r.svg && /pieces: .* good, 2 need replacing, 1 on temporary plexi/.test(r.cap), r.cap);
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await sleep(300);
const rd = await rep();
ok('the plan has a colour key', await p.evaluate(() => /Good.*Needs replacing.*Temporary plexi/.test((document.querySelector('#reportPaper .rp-key') || {}).textContent || '')));
ok('the same drawings in the dark theme', rd.img === r.img && rd.svg);
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await p.uncheck('[data-sec="latest"]'); await p.uncheck('[data-sec="glass"]'); await sleep(300);
const off = await rep();
ok('unticking the sections takes the drawings out', !off.img && !off.svg);
await p.check('[data-sec="latest"]'); await p.check('[data-sec="glass"]'); await sleep(500);
const on = await rep();
ok('and ticking them brings them back', /^data:image/.test(on.img) && on.svg);
/* a sheet without rounds or glass: honest text, no empty picture */
await p.selectOption('#repSheet', 's3'); await sleep(600);
const e = await p.evaluate(() => ({ imgs: document.querySelectorAll('#reportPaper img.rp-map').length, svgs: document.querySelectorAll('#reportPaper svg.rp-plan').length, txt: document.getElementById('reportPaper').textContent }));
ok('a sheet with no round or glass shows no empty picture, only the words', e.imgs === 0 && e.svgs === 0 && /No round with readings/.test(e.txt) && /No glass has been built/.test(e.txt), JSON.stringify(e).slice(0, 200));
await p.selectOption('#repSheet', 's1'); await sleep(500);
await p.click('#repPrint'); await sleep(300);
ok('printing carries the drawings into the print copy', await p.evaluate(() => !!document.querySelector('#printRoot img.rp-map') && !!document.querySelector('#printRoot svg.rp-plan')));
await p.evaluate(() => Sync.sync('t')); await sleep(1000);
ok('looking at the report writes nothing', s0 === await k.stamps());
await D.ctx.close();
await k.done(b);
})();
