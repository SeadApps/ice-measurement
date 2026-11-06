/* Exporting a file: a laptop downloads it, a touch device offers the share sheet.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/exporttest.js

   A laptop browser that has navigator.share (Edge and Chrome on Windows) used to open the operating system's
   share window for "Export image" instead of saving the file. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

const STUB = () => { window.__shares = 0; navigator.share = async () => { window.__shares++; }; navigator.canShare = () => true; };

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();

for (const [label, opts, touch] of [['laptop', { viewport: { width: 1280, height: 900 } }, false], ['iPad', { viewport: { width: 820, height: 1100 }, hasTouch: true, isMobile: true }, true]]) {
  const ctx = await b.newContext(Object.assign({ serviceWorkers: 'block', acceptDownloads: true }, opts));
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  await ctx.addInitScript(STUB);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  await p.goto(B + '/ice.html#/f/f1/s/s1/rink');
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('#expPng'); await sleep(1800);
  ok(label + ': the browser really does have a share sheet to be tempted by', await p.evaluate(() => matchMedia('(pointer: coarse)').matches) === touch);
  let dl = null; p.on('download', d => { dl = d.suggestedFilename(); });
  await p.click('#expPng'); await sleep(1200);
  const shares = await p.evaluate(() => window.__shares);
  if (touch) ok(label + ': Export image offers the share sheet and saves no file', shares === 1 && !dl, shares + ' ' + dl);
  else ok(label + ': Export image downloads a .png and opens no share window', shares === 0 && /\.png$/.test(dl || ''), shares + ' ' + dl);
  dl = null; await p.click('#expCsv'); await sleep(1000);
  const s2 = await p.evaluate(() => window.__shares);
  if (touch) ok(label + ': Export CSV shares too', s2 === 2);
  else ok(label + ': Export CSV downloads a .csv', s2 === 0 && /\.csv$/.test(dl || ''), s2 + ' ' + dl);
  await ctx.close();
}
await k.done(b);
})();
