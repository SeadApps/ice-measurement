/* Glass on a laptop.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/glasslaptoptest.js

   Measuring is done at the boards, so on a laptop (the shell reports the layout) the Builder shows why it
   is unavailable and nothing in it can be used. The Rink view and Inventory work as anywhere, edits
   included. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
const b = await k.chromium.launch();
const errs = [];
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
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
const R = (fn, a) => p.evaluate(fn, a);
const vis = sel => p.isVisible(sel);

ok('the shell calls this a laptop', await R(() => Shell.layout()) === 'laptop');
await p.click('#glassTabs [data-page=build]'); await sleep(500);
ok('the Builder shows the message instead of the builder', await vis('#bldLaptop') && !(await vis('#builder')) && /phone or tablet/i.test(await p.textContent('#bldLaptop')));
ok('and offers the way back to the Rink view', await vis('#bldLaptopRink'));
await p.click('#bldLaptopRink'); await sleep(400);
ok('the way back works', await vis('#plan') && !(await vis('#bldLaptop')) && /\/rink$/.test(await R(() => location.hash)));

/* the Rink view still edits */
await R(() => select('045')); await sleep(300);
await p.click('.sbtn[data-s="replace"]'); await sleep(600);
ok('Rink view: a panel can be marked', await R(() => state['045'] && state['045'].status === 'replace'));
await sleep(3000);
ok('and it reached the server, stamped by the person', (await k.rows()).some(r => r.kind === 'glass_panel' && r.changed_by === 'pete'));

/* and so does Inventory */
await p.click('#glassTabs [data-page=inventory]'); await sleep(400);
await R(() => { addMovement(43, 75, '1/2"', 'tempered', 3, 'count'); store(); spares(); }); await sleep(300);
const q = '#spStock input.sp-qty-in[data-k="43|75|1/2\\"|tempered"]';
await p.fill(q, '5'); await p.press(q, 'Enter'); await sleep(500);
ok('Inventory: a count can be corrected', await R(() => (stockOf(activeFacilityId())['43|75|1/2"|tempered'] || { qty: 0 }).qty) === 5);

/* narrowing the window to an iPad makes the Builder available */
await p.setViewportSize({ width: 1000, height: 1000 }); await sleep(600);
await p.click('#glassTabs [data-page=build]'); await sleep(800);
ok('on an iPad-width window the laptop message is gone (the sheet has glass, so that is what it says)', await vis('#bldHasGlass') && !(await vis('#bldLaptop')));
ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
