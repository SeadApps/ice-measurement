/* Exporting a file: a laptop downloads it, a touch device chooses between sharing and saving.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/exporttest.js

   A laptop browser that has navigator.share (Edge and Chrome on Windows) used to open the operating system's
   share window for "Export image" instead of saving the file. On an iPad or phone the share sheet is still
   offered, but so is saving the file to the device, and backing out of the question does neither. The same
   holds for Ice's exports and for the backup in the account menu. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

const STUB = () => { window.__shares = 0; navigator.share = async () => { window.__shares++; }; navigator.canShare = () => true; };

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();

const mk = async (opts) => {
  const ctx = await b.newContext(Object.assign({ serviceWorkers: 'block', acceptDownloads: true }, opts));
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  await ctx.addInitScript(STUB);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  p.dl = []; p.on('download', d => p.dl.push(d.suggestedFilename()));
  return { ctx, p };
};
const iceIn = async p => { await p.goto(B + '/ice.html#/f/f1/s/s1/rink'); await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button'); await p.waitForSelector('#expPng'); await sleep(1800); };
const shares = p => p.evaluate(() => window.__shares);
/* An export draws a picture first, which takes as long as the machine takes: wait for what is expected, not for a fixed time. */
const until = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > (ms || 10000)) { if (process.env.TIMING) console.log('    waited ' + (Date.now() - t0) + 'ms'); return v; } await sleep(100); } };

/* ---- a laptop ---------------------------------------------------------------------------------- */
let { ctx, p } = await mk({ viewport: { width: 1280, height: 900 } });
await iceIn(p);
ok('laptop: the browser has a share sheet to be tempted by, and no touch', await p.evaluate(() => !matchMedia('(pointer: coarse)').matches && !!navigator.share));
await p.click('#expPng'); await until(() => p.dl.some(n => /\.png$/.test(n)));
ok('laptop: Export image downloads a .png at once, with no question and no share window', await shares(p) === 0 && p.dl.some(n => /\.png$/.test(n)) && !(await p.$('#sureScrim.on')), String(await shares(p)) + ' ' + p.dl);
await p.click('#expCsv'); await sleep(1000);
ok('laptop: Export CSV downloads a .csv', await shares(p) === 0 && p.dl.some(n => /\.csv$/.test(n)));
await ctx.close();

/* ---- an iPad ----------------------------------------------------------------------------------- */
({ ctx, p } = await mk({ viewport: { width: 820, height: 1100 }, hasTouch: true, isMobile: true }));
await iceIn(p);
await p.click('#expPng'); await until(() => p.$('#sureScrim.on'));
ok('iPad: Export image asks whether to share or save, and names the file', await p.evaluate(() => document.getElementById('sureScrim').classList.contains('on') && /Share or save/.test(document.getElementById('sureTitle').textContent) && /\.png/.test(document.getElementById('sureText').textContent)));
ok('and nothing has happened yet', await shares(p) === 0 && p.dl.length === 0);
await p.click('#sureYes'); await sleep(800);
ok('iPad: Share offers the share sheet and saves no file', await shares(p) === 1 && p.dl.length === 0, String(await shares(p)) + ' ' + p.dl);
await p.click('#expPng'); await until(() => p.$('#sureScrim.on')); await p.click('#sureNo'); await until(() => p.dl.some(n => /\.png$/.test(n)));
ok('iPad: Save to device downloads the .png and does not share', await shares(p) === 1 && p.dl.some(n => /\.png$/.test(n)), String(await shares(p)) + ' ' + p.dl);
const before = p.dl.length;
await p.click('#expCsv'); await sleep(500);
await p.mouse.click(5, 5); await sleep(600);
ok('iPad: tapping outside the question does neither', await shares(p) === 1 && p.dl.length === before && !(await p.$('#sureScrim.on')));
await p.click('#expCsv'); await sleep(500); await p.click('#sureNo'); await sleep(800);
ok('iPad: Export CSV can be saved too', p.dl.some(n => /\.csv$/.test(n)));
await ctx.close();

/* ---- the backup in the account menu, on an iPad ------------------------------------------------- */
({ ctx, p } = await mk({ viewport: { width: 820, height: 1100 }, hasTouch: true, isMobile: true }));
await p.goto(B + '/index.html'); await k.signIn(p);
const backup = async () => { await p.click('#acctMenu'); await sleep(250); await p.evaluate(() => [...document.querySelectorAll('.dropdown .it')].find(x => x.textContent === 'Back up all data').click()); };
ok('iPad: the account menu has the backup', await (async () => { await p.click('#acctMenu'); await sleep(250); const t = await p.$$eval('.dropdown .it', e => e.map(x => x.textContent)); await p.keyboard.press('Escape'); return t.includes('Back up all data'); })());
await backup(); await sleep(600);
ok('iPad: the backup asks whether to share or save', !!(await p.$('#shareDlg')) && await shares(p) === 0 && p.dl.length === 0);
await p.click('#saveYes'); await sleep(1000);
ok('iPad: Save to device downloads the backup .json and does not share', p.dl.some(n => /ice_sheet_backup_.*\.json$/.test(n)) && await shares(p) === 0, p.dl.join());
await backup(); await sleep(500); await p.click('#shareYes'); await sleep(800);
ok('iPad: Share offers the share sheet for the backup', await shares(p) === 1);
await backup(); await sleep(500); await p.click('#shareNo'); await sleep(600);
ok('iPad: Cancel does neither', await shares(p) === 1 && p.dl.length === 1 && !(await p.$('#shareDlg')));
await ctx.close();

await k.done(b);
})();
