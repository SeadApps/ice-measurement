/* Export for TV: a 1920 x 1080 dark picture of a sheet's latest round, for the screen in the Zamboni room.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/tvtest.js

   The button is in Ice's Rink view with the other exports. It draws the sheet's newest round that has readings (not the
   round being looked at), dark whatever theme is on, with the sheet's name, the round's date and the three figures. A sheet
   with no round says so instead of making an empty picture. A laptop downloads it; a touch device is asked to share or save. */
const fs = require('fs');
const k = require('./shellkit');
const { ok, sleep, B } = k;

const STUB = () => { window.__shares = 0; navigator.share = async () => { window.__shares++; }; navigator.canShare = () => true; };

(async () => {
await fetch(B + '/__reset');
await k.seed();
const tok = await k.login('operations@conwayarena.local', k.ACCESS);
const data = { '100,42.5': '1 1/2"', '30,20': '1/2"', '170,60': '3"', '60,42.5': '1 3/4"', '140,25': '1 1/4"' };
await fetch(B + '/rest/v1/records?on_conflict=kind,id', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify([
  { kind: 'session', id: 'zold', deleted: false, body: { id: 'zold', fac: 'f1', sheetId: 's1', ord: 5, date: new Date(Date.now() - 9 * 86400000).toISOString(), mode: 'moderate', data: { '100,42.5': '2"' }, notes: {}, updatedAt: new Date().toISOString() } },
  { kind: 'session', id: 'znew', deleted: false, body: { id: 'znew', fac: 'f1', sheetId: 's1', ord: 6, date: new Date().toISOString(), mode: 'moderate', data, notes: {}, updatedAt: new Date().toISOString() } }]) });
const b = await k.chromium.launch();
const mk = async (opts) => {
  const ctx = await b.newContext(Object.assign({ serviceWorkers: 'block', acceptDownloads: true }, opts));
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  await ctx.addInitScript(STUB);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  p.dl = []; p.on('download', async d => { p.dl.push({ name: d.suggestedFilename(), path: await d.path() }); });
  return { ctx, p };
};
const iceIn = async (p, hash) => { await p.goto(B + '/ice.html#' + hash); await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button'); await p.waitForSelector('#expTv'); await sleep(1800); };

/* ---- a laptop ---------------------------------------------------------------------------------- */
let { ctx, p } = await mk({ viewport: { width: 1280, height: 900 } });
await iceIn(p, '/f/f1/s/s1/rink');
ok('the Rink view has Export for TV with the other exports', await p.evaluate(() => /Export for TV/.test(document.getElementById('expTv').textContent) && document.getElementById('expTv').parentElement === document.getElementById('expPng').parentElement));
await p.click('#expTv'); await sleep(2500);
const png = p.dl.find(d => /_TV_.*\.png$/.test(d.name));
ok('a laptop downloads it, named for the sheet and the round, and opens no share window', !!png && /^Conway_Arena_Main_TV_\d{4}-\d{2}-\d{2}\.png$/.test(png.name) && await p.evaluate(() => window.__shares) === 0, JSON.stringify(p.dl.map(d => d.name)));
const buf = png ? fs.readFileSync(png.path) : Buffer.alloc(0);
ok('it is a real PNG, 1920 x 1080', buf.slice(1, 4).toString() === 'PNG' && buf.readUInt32BE(16) === 1920 && buf.readUInt32BE(20) === 1080, buf.slice(0, 30).toString('hex'));

const px = await p.evaluate(() => {
  const R = Records, set = R.settingsOf({ target: 1.5, edges: [0.75, 1.5, 1.625, 2] }, {});
  const cv = ReportMaps.tvImage({ facility: 'Conway Arena', sheet: 'Main', round: { date: new Date().toISOString(), data: { '100,42.5': '1 1/2"', '30,20': '1/2"', '170,60': '3"' } }, size: { L: 200, W: 85, corner: 28 }, settings: set });
  const c = cv.getContext('2d'), top = 48 + 126, mw = 1790, ox = Math.round((1920 - mw) / 2) + 24, s = (mw - 48) / 200;
  const at = (x, y) => [...c.getImageData(Math.round(ox + x * s), Math.round(top + 24 + (85 - y) * s), 1, 1).data].slice(0, 3);
  let amber = 0; const hd = c.getImageData(0, 0, 1920, 150).data; for (let i = 0; i < hd.length; i += 4) if (hd[i] > 230 && hd[i + 1] > 150 && hd[i + 1] < 200 && hd[i + 2] < 40) amber++;
  const dim = [cv.width, cv.height], corner = [...c.getImageData(2, 2, 1, 1).data].slice(0, 3), foot = [...c.getImageData(960, 1075, 1, 1).data].slice(0, 3);
  return { dim, corner, foot, ideal: at(100, 42.5), thin: at(30, 20), thick: at(170, 60), amber };
});
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
ok('1920 x 1080 with a near-black background', px.dim[0] === 1920 && px.dim[1] === 1080 && near(px.corner, [11, 13, 15]) && near(px.foot, [11, 13, 15]), JSON.stringify(px));
ok('spots are the dark theme\'s band colours: Ideal, Too thin, Too thick', near(px.ideal, [0xee, 0xf4, 0xf6]) && near(px.thin, [0xd6, 0x45, 0x3f]) && near(px.thick, [0x2c, 0x6a, 0xa3]), JSON.stringify([px.ideal, px.thin, px.thick]));
ok('the title and figures are drawn in the scoreboard amber', px.amber > 1500, String(px.amber));

/* it draws the newest round with readings, not the one on screen and not an older one */
const which = await p.evaluate(() => { const sh = sheet(), r = Records.lastRound(sh.sessions, sh.id); return { n: Object.keys(r.data).length, id: r.id }; });
ok('the round is the newest one that has readings (five spots, not the older single spot)', which.n === 5 && which.id === 'znew', JSON.stringify(which));
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
const light = await p.evaluate(() => { const cv = ReportMaps.tvImage({ facility: 'A', sheet: 'B', round: { date: new Date().toISOString(), data: { '100,42.5': '1 1/2"' } }, size: { L: 200, W: 85, corner: 28 }, settings: Records.settingsOf({}, {}) }); return [...cv.getContext('2d').getImageData(2, 2, 1, 1).data].slice(0, 3); });
ok('and it is dark even when the page is in the light theme', near(light, [11, 13, 15]), light.join());
await ctx.close();

/* ---- a sheet with no round ---------------------------------------------------------------------- */
({ ctx, p } = await mk({ viewport: { width: 1280, height: 900 } }));
await iceIn(p, '/f/f2/s/s3/rink');
/* a device with nothing yet cannot honour the address on its very first load, so ask again once its sheets are there */
await p.goto(B + '/ice.html#/f/f2/s/s3/rink'); await p.reload(); await p.waitForSelector('#expTv'); await sleep(2500);
await p.waitForFunction(() => sheet().id === 's3', null, { timeout: 15000 });
await p.click('#expTv'); await sleep(600);
ok('a sheet with no round says so and makes no file', await p.evaluate(() => document.getElementById('sureScrim').classList.contains('on') && /no round with readings/i.test(document.getElementById('sureText').textContent)) && p.dl.length === 0);
await ctx.close();

/* ---- an iPad: share or save --------------------------------------------------------------------- */
({ ctx, p } = await mk({ viewport: { width: 820, height: 1100 }, hasTouch: true, isMobile: true }));
await iceIn(p, '/f/f1/s/s1/rink');
await p.click('#expTv'); await sleep(2500);
ok('an iPad is asked whether to share or save it', await p.evaluate(() => document.getElementById('sureScrim').classList.contains('on') && /Share or save/.test(document.getElementById('sureTitle').textContent)) && p.dl.length === 0);
await p.click('#sureNo'); await sleep(1200);
ok('Save to device downloads the TV picture', p.dl.some(d => /_TV_.*\.png$/.test(d.name)) && await p.evaluate(() => window.__shares) === 0);
await ctx.close();

/* ---- a phone: the button fits ------------------------------------------------------------------- */
({ ctx, p } = await mk({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true }));
await iceIn(p, '/f/f1/s/s1/rink');
ok('on a phone there is still no sideways scroll, and the button is on screen', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('expTv').getBoundingClientRect().right <= innerWidth));
await ctx.close();

await k.done(b);
})();
