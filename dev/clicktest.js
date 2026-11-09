/* Every page, reached by clicking.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/clicktest.js

   navtest opens each page by its address. This is the other half: a person starts at sign-in and gets to every
   page with taps alone, the way the flow chart draws it. A page that exists but has no way to it fails here.
   Management on an iPad reaches everything including Staff; Staff on a phone reach everything they may. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });
await k.addStaff({ id: 'dana', name: 'Dana', role: 'staff', code: 'dana-code-1', facilities: ['f1'] });
const b = await k.chromium.launch();
const errs = [];

async function walk(label, who, code, width) {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(label + ': ' + String(e).split('\n')[0]));
  const vis = sel => p.evaluate(s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);
  const step = async (what, click, probe, wait) => {
    if (click) await p.click(click);
    await sleep(wait || 1800);
    ok(label + ': ' + what, await p.evaluate(sel => [...document.querySelectorAll(sel)].some(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'), probe), probe + ' | ' + await p.evaluate(() => typeof boundSheetId === 'undefined' ? '' : [boundSheetId, location.hash, !!document.getElementById('builder') && !document.getElementById('builder').hidden].join(' ')));
  };
  /* sign in: the two gates */
  await p.goto(B + '/index.html');
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="' + who + '"]'); await p.click('.sync-gate .sync-name[data-id="' + who + '"]');
  await p.fill('.sync-gate #sg-personal', code); await p.click('.sync-gate .sync-go');
  await sleep(3000);
  ok(label + ': signing in lands on Facilities', await vis('#pageFacilities'));
  await step('a facility opens its sheets', '#facRows .frow[data-fid="f1"]', '#pageSheets');
  await step('a sheet has Sheet settings', '.srow[data-sid="s1"] [data-open="settings"]', '#pageSettings');
  /* the way back to the sheets is the facility menu in the bar (on a phone, the one button that says where you are) */
  await p.click(width <= 560 ? '#ctxBtn' : '#facMenu'); await sleep(300);
  await step('the facility menu in the bar goes back to the sheets', '.dropdown .it:has-text("Conway Arena")', '#pageSheets');
  /* Ice */
  await p.click('.srow[data-sid="s1"] [data-open="ice"]'); await sleep(3000);
  ok(label + ': Ice Manager opens on its Rink view', await vis('#rink') && await p.evaluate(() => document.querySelector('#iceTabs [aria-current=page]').dataset.page) === 'rink');
  await step('Ice: Trends', '#iceTabs [data-page=trends]', '#home', 900);
  await step('Ice: Measurement builder', '#iceTabs [data-page=build]', '#chips', 900);
  await step('Ice: back to the Rink view', '#iceTabs [data-page=rink]', '#rink', 900);
  await step('Ice: Preferences tab', '#iceTabs [data-page=prefs]', '#prefsPage.on', 600);
  await p.click('#iceTabs [data-page=rink]'); await sleep(300);
  /* across to Glass: the same sheet */
  await p.click('#shellbar #appSw a[data-app="glass"]'); await sleep(3500);
  ok(label + ': the Ice | Glass switch lands on Glass\'s Rink view for the same sheet', await vis('#plan') && /\/s\/s1/.test(await p.evaluate(() => location.hash)), await p.evaluate(() => location.hash));
  /* the Builder writes, so its tab asks for the editing code first, like every control that changes a record */
  await p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(1500);
  await step('Glass: Builder', '#glassTabs [data-page=build]', '#bldHasGlass, #builder, #bldLaptop', 900);
  await step('Glass: Inventory', '#glassTabs [data-page=inventory]', '#spares', 900);
  await step('Glass: back to the Rink view', '#glassTabs [data-page=rink]', '#plan', 900);
  /* and across again, and home by the logo */
  await p.click('#shellbar #appSw a[data-app="ice"]'); await sleep(3000);
  ok(label + ': and back to Ice', await vis('#rink'));
  await p.click('#shellbar #logo'); await sleep(2500);
  ok(label + ': the logo returns to Facilities', await vis('#pageFacilities'));
  /* the account menu */
  await p.click('#acctMenu'); await sleep(300);
  ok(label + ': the account menu opens', await vis('.dropdown'));
  const hasStaff = await p.isVisible('.dropdown .it:has-text("Staff")');
  if (who === 'pete') {
    ok(label + ': and offers Staff', hasStaff);
    await p.click('.dropdown .it:has-text("Staff")'); await sleep(1800);
    ok(label + ': Staff opens', await vis('#sharedCodes'));
  } else {
    ok(label + ': and does not offer Staff', !hasStaff);
  }
  await ctx.close();
}
await walk('Management on an iPad', 'pete', 'pete-code-1', 1000);
await walk('Staff on a phone', 'dana', 'dana-code-1', 390);
ok('nothing threw', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
