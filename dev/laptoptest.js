/* The Measurement builder on a laptop.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/laptoptest.js

   Readings are taken at the rink. When the shell reports a laptop layout the builder shows why and
   nothing on it can be used; Rink view and Trends are untouched. Narrowing the window to a tablet
   width brings the builder back without a reload. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();
const D = await k.device(b, 1280), p = D.p;
const errs = []; p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
const R = fn => p.evaluate(fn);
const vis = sel => p.isVisible(sel);
await p.goto(B + '/ice.html#/f/f1/s/s1/rink');
await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
await p.waitForSelector('#shellbar .nav'); await sleep(1800);
await p.evaluate(() => document.body.classList.remove('sync-locked'));

ok('the shell reports a laptop at 1280', await R(() => Shell.layout()) === 'laptop');
ok('Rink view has no message and is usable', !(await vis('#laptopMsg')) && await R(() => !document.querySelector('main').inert));
await p.click('#iceTabs [data-page=build]'); await sleep(500);
ok('the builder says it is for a phone or tablet', await vis('#laptopMsg') && /phone or tablet/.test(await p.textContent('#laptopMsg')));
ok('the builder is still shown, dimmed behind it', await vis('#chips') && await R(() => +getComputedStyle(document.querySelector('main')).opacity < 0.6));
ok('and the page itself is the builder (the address says so)', /\/s\/s1\/build$/.test(await R(() => location.hash)));

const before = await R(() => localStorage.getItem('ice_v4_sessions'));
const pend = await R(() => Sync.pending());
const bb = await p.locator('#rink').boundingBox();
await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2).catch(() => {}); await sleep(200);
await p.locator('.chip[data-opt]').first().click({ force: true, timeout: 1500 }).catch(() => {}); await sleep(300);
ok('a key cannot write a reading', await R(() => localStorage.getItem('ice_v4_sessions')) === before);
await p.locator('#noteInput').click({ force: true, timeout: 1500 }).catch(() => {}); await p.keyboard.type('x'); await sleep(200);
ok('a note cannot be typed', await p.inputValue('#noteInput') === '');
ok('there is nothing to focus on the builder', await R(() => { document.activeElement && document.activeElement.blur(); return ['chips', 'noteInput', 'undoBtn', 'impBtn', 'clearBtn', 'newRound'].every(id => { const e = document.getElementById(id); return e.closest('[inert]'); }); }));
ok('import and clear are blocked', await R(() => document.getElementById('impBtn').closest('[inert]') && document.getElementById('clearBtn').closest('[inert]')));
await p.locator('#newRound').click({ force: true, timeout: 1500 }).catch(() => {}); await sleep(300);
ok('and so is + New round', !(await vis('#roundCreate')));
ok('nothing was written or is waiting', await R(() => localStorage.getItem('ice_v4_sessions')) === before && await R(() => Sync.pending()) === pend);

/* the rest of Ice is untouched */
await p.click('#laptopToRink'); await sleep(500);
ok('"Go to Rink view" leaves the builder', /\/rink$/.test(await R(() => location.hash)) && !(await vis('#laptopMsg')) && await vis('#rink'));
ok('Rink view works: Compare to, exports', await vis('#cmpSel') && await vis('#expCsv') && await R(() => !document.querySelector('main').inert));
await p.click('#iceTabs [data-page=trends]'); await sleep(500);
ok('Trends works', await vis('#histChart') && !(await vis('#laptopMsg')));

/* the layout follows the width */
await p.click('#iceTabs [data-page=build]'); await sleep(400);
await p.setViewportSize({ width: 1000, height: 900 }); await sleep(600);
ok('narrowed to a tablet width, the message goes', await R(() => Shell.layout()) === 'ipad' && !(await vis('#laptopMsg')));
ok('and the builder works', await R(() => !document.querySelector('main').inert && !document.getElementById('impBtn').closest('[inert]')));
await p.setViewportSize({ width: 1280, height: 900 }); await sleep(600);
ok('widened again, it returns', await vis('#laptopMsg') && await R(() => document.querySelector('main').inert));
await p.setViewportSize({ width: 390, height: 800 }); await sleep(600);
ok('on a phone there is no message', !(await vis('#laptopMsg')) && await R(() => !document.querySelector('main').inert));

/* opening the builder's address directly on a laptop */
await p.setViewportSize({ width: 1280, height: 900 });
await p.goto(B + '/ice.html#/f/f1/s/s1/build'); await p.reload(); await sleep(1800);
if (await vis('.sync-gate')) { await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button'); await sleep(1800); }
ok('opening /build on a laptop shows the message', await vis('#laptopMsg') && await R(() => document.querySelector('main').inert));

ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
