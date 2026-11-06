/* The chrome by width.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/shelltest.js

   The layout follows the width of the page, not the kind of device, so an iPad in
   split view or a narrow laptop window gets the layout that fits. At 390, 820,
   1024 and 1280 wide: the right chrome for each, no sideways scroll, a tab bar on
   the phone, a rail on the laptop, the name chip on every page. */
const k = require('./shellkit');
const { ok, sleep, B, text } = k;

const visible = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false;
  const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
const noSideScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1);
const layout = p => p.evaluate(() => Shell.layout());

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();

const D = await k.device(b, 1280);
await D.p.goto(B + '/index.html'); await k.signIn(D.p);
const p = D.p;

const EXPECT = {
  390:  { name: 'phone',  tabbar: true,  rail: false, ctx: true,  facMenu: false, appSw: false },
  560:  { name: 'phone',  tabbar: true,  rail: false, ctx: true,  facMenu: false, appSw: false },
  561:  { name: 'ipad',   tabbar: false, rail: false, ctx: false, facMenu: true,  appSw: true },
  820:  { name: 'ipad',   tabbar: false, rail: false, ctx: false, facMenu: true,  appSw: true },
  1024: { name: 'ipad',   tabbar: false, rail: false, ctx: false, facMenu: true,  appSw: true },
  1100: { name: 'ipad',   tabbar: false, rail: false, ctx: false, facMenu: true,  appSw: true },
  1101: { name: 'laptop', tabbar: false, rail: true,  ctx: false, facMenu: true,  appSw: true },
  1280: { name: 'laptop', tabbar: false, rail: true,  ctx: false, facMenu: true,  appSw: true }
};
for (const hash of ['#/', '#/f/f2']) {
  await p.goto(B + '/index.html' + hash); await p.waitForSelector('#page .screen'); await sleep(400);
  for (const w of Object.keys(EXPECT)) {
    const e = EXPECT[w];
    await p.setViewportSize({ width: +w, height: 900 }); await sleep(250);
    const got = { name: await layout(p), tabbar: await visible(p, '#tabbar'), rail: await visible(p, '#rail'), ctx: await visible(p, '#ctxBtn'),
                  facMenu: await visible(p, '#facMenu'), appSw: await visible(p, '#appSw') };
    ok(w + 'px on ' + hash + ' is ' + e.name + ' with the right chrome', JSON.stringify(got) === JSON.stringify(e), JSON.stringify(got));
    ok(w + 'px on ' + hash + ': no sideways scroll', await noSideScroll(p));
    ok(w + 'px on ' + hash + ': the name chip is there', await visible(p, '#acctMenu'));
    ok(w + 'px on ' + hash + ': every control is at least 36px tall', await p.evaluate(() =>
      [...document.querySelectorAll('.nav button:not([hidden]), .nav a, #page .btn, .tabbar a, .tabbar button')]
        .filter(e => e.offsetParent !== null).every(e => e.getBoundingClientRect().height >= 36 || e.id === 'logo')));
  }
}

/* ---- the layout changes live, with the width -------------------------------------------- */
await p.setViewportSize({ width: 1280, height: 900 }); await sleep(250);
let seen = [];
await p.evaluate(() => { window.__lay = []; Shell.onLayout(n => window.__lay.push(n)); });
await p.setViewportSize({ width: 800, height: 900 }); await sleep(250);
await p.setViewportSize({ width: 400, height: 900 }); await sleep(250);
await p.setViewportSize({ width: 1200, height: 900 }); await sleep(250);
seen = await p.evaluate(() => window.__lay);
ok('a window that is resized is told, in order, and only when it changes', JSON.stringify(seen) === '["laptop","ipad","phone","laptop"]', JSON.stringify(seen));
ok('the breakpoints are exposed for D3 and D4 to ask', await p.evaluate(() => JSON.stringify(Shell.breakpoints)) === '{"phoneMax":560,"ipadMax":1100}');

/* ---- the bar --------------------------------------------------------------------------------- */
await p.goto(B + '/index.html#/'); await p.waitForSelector('#page .screen'); await sleep(400);
ok('on Facilities the sheet menu has nothing to act on and is dimmed', await p.evaluate(() => document.getElementById('sheetMenu').disabled));
ok('and the app switch is dimmed too', await p.evaluate(() => document.getElementById('appSw').classList.contains('off')));
await p.goto(B + '/index.html#/f/f2'); await p.waitForSelector('#page .screen'); await sleep(500);
ok('inside a facility the sheet menu is live', !(await p.evaluate(() => document.getElementById('sheetMenu').disabled)));
const hrefs = await p.$$eval('#appSw a', a => a.map(x => x.getAttribute('href')));
ok('and the app switch points both apps at the sheet in hand', hrefs.join() === 'ice.html#/f/f2/s/s2,glass.html#/f/f2/s/s2', hrefs.join());
await p.click('#sheetMenu');
ok('the sheet menu lists the facility\'s sheets with the current one marked', (await p.$$eval('.dropdown .it', e => e.map(x => x.textContent + (x.getAttribute('aria-current') ? '*' : '')))).join() === 'Standard*,Mini');
await p.keyboard.press('Escape');
ok('Escape closes it', !(await p.$('.dropdown')));
await p.click('#facMenu'); await p.click('#acctMenu');
ok('opening one menu closes the other', (await p.$$('.dropdown')).length === 1);
await p.mouse.click(700, 600); await sleep(150);
ok('and a click elsewhere closes it', !(await p.$('.dropdown')));

/* ---- the account menu ------------------------------------------------------------------------ */
await p.click('#acctMenu');
const items = await p.$$eval('.dropdown .it', e => e.map(x => x.textContent));
ok('Theme and Sign out are in it', items.includes('Light') && items.includes('Dark') && items.includes('Sign out'), items.join());
await p.click('.dropdown .it:has-text("Light")'); await sleep(200);
ok('Light changes the theme at once', await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');
ok('and it is remembered, in the key the apps share', await p.evaluate(() => localStorage.getItem('rink_theme')) === 'light');
await p.reload(); await p.waitForSelector('#page .screen'); await sleep(400);
ok('a reload keeps it', await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');
await p.goto(B + '/ice.html'); await sleep(1500);
ok('and Ice, which reads the same key, is in the same theme', await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');
await p.goto(B + '/index.html'); await p.waitForSelector('#page .screen'); await sleep(400);
await p.click('#acctMenu'); await p.click('.dropdown .it:has-text("Dark")'); await sleep(200);
ok('Dark puts it back', await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark');

/* ---- the phone's tab bar --------------------------------------------------------------------------- */
await p.setViewportSize({ width: 390, height: 800 }); await p.goto(B + '/index.html#/f/f2'); await p.waitForSelector('#page .screen'); await sleep(500);
ok('the phone shows one context button saying where you are', /Flynn Rink/.test(await text(p, '#ctxBtn')) && /Standard/.test(await text(p, '#ctxBtn')), await text(p, '#ctxBtn'));
ok('and a tab bar of Facilities, Ice, Glass and Menu', (await p.$$eval('#tabbar > *', e => e.map(x => x.textContent))).join() === 'Facilities,Ice,Glass,Menu');
ok('Facilities is the current tab only on Facilities', await p.$eval('#tabbar a', a => !a.getAttribute('aria-current')));
await p.click('#tabbar button');
ok('Menu opens the account menu', (await p.$$('.dropdown')).length === 1 && /Sign out/.test(await text(p, '.dropdown')));
await p.keyboard.press('Escape');
await p.click('#tabbar a:has-text("Facilities")'); await sleep(500);
ok('and Facilities goes home', (await p.evaluate(() => location.hash)) === '#/' && await p.$eval('#tabbar a', a => a.getAttribute('aria-current') === 'true'));
ok('on Facilities the Ice and Glass tabs are dimmed: there is no sheet', await p.$$eval('#tabbar a[data-app], #tabbar a.off', a => a.length >= 0) && (await p.$$eval('#tabbar a.off', a => a.length)) === 2);
await p.click('#ctxBtn');
ok('the context button lists facilities', /Conway Arena/.test(await text(p, '.dropdown')) && /Flynn Rink/.test(await text(p, '.dropdown')));

/* ---- the rail --------------------------------------------------------------------------------------- */
await p.setViewportSize({ width: 1280, height: 900 }); await p.goto(B + '/index.html#/f/f2/s/s3'); await p.waitForSelector('#page .screen'); await sleep(600);
ok('the rail lists each facility with its sheets, then Quality review', (await p.$$eval('#rail h3', e => e.map(x => x.textContent))).join() === 'Conway Arena,Flynn Rink,Quality review');
ok('the bar runs the width of the page, one row tall (no page style may shrink it: the settings steppers once did)', await p.evaluate(() => { const r = document.querySelector('.nav').getBoundingClientRect(); return r.width >= innerWidth - 20 && r.height < 100 && r.top < 5; }));
ok('with a dot on the overdue one only', (await p.$$eval('#rail a .dot', d => d.map(x => x.parentElement.textContent))).join() === 'Standard');
ok('and the sheet you are on marked', (await p.$$eval('#rail a[aria-current="true"]', a => a.map(x => x.textContent))).join() === 'Mini');
await p.click('#rail a:has-text("Main")'); await sleep(600);
ok('a sheet in the rail opens that facility', (await p.evaluate(() => location.hash)) === '#/f/f1/s/s1' && /Conway Arena/.test(await text(p, '#page h2')));

/* ---- ordinary text is text, whatever the name ---------------------------------------------------------- */
await k.done(b);
})();
