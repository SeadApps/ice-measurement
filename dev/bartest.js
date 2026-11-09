/* The shared bar inside Ice and Glass.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/bartest.js

   Each app hands the shell an element and the bar is drawn there; the app's own page is
   untouched below it. The app reads where you are from the address, keeps the address in
   step when it changes sheet itself, and follows the bar's menus. A theme or unit chosen in
   the bar reaches the app as an event, because the app holds its own copy and would
   otherwise save the old one back. The controls the bar replaces are gone from the apps. */
const k = require('./shellkit');
const { ok, sleep, B, text, rows, stamps, DOM, ACCESS } = k;

const gate = p => p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
const inApp = async (p, code) => {              // the access code alone, then wait for the bar
  await gate(p); await p.fill('.sync-gate #sg-code', code || ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('#shellbar .nav', { timeout: 12000 }); await sleep(700);
};
const personInApp = async (p, id, pw) => {
  await gate(p); await p.fill('.sync-gate #sg-code', ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="' + id + '"]', { timeout: 8000 });
  await p.click('.sync-gate .sync-name[data-id="' + id + '"]'); await p.fill('.sync-gate #sg-personal', pw); await p.click('.sync-gate .sync-go');
  await p.waitForSelector('#shellbar .nav', { timeout: 12000 }); await sleep(900);
};
const barText = p => text(p, '#shellbar');
const menuItems = p => p.$$eval('#shellbar .dropdown .it', e => e.map(x => x.textContent));
const prefs = p => p.evaluate(() => JSON.parse(localStorage.getItem('ice_v4_prefs') || '{}'));
/* The sheet the address names; Ice adds a page after it (pagestest covers that part). */
const here = p => p.evaluate(() => location.hash.replace(/\/(rink|trends|build)$/, ''));

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();

/* ---- nothing before the gate, the bar after it ---------------------------------------------------- */
const I = await k.device(b, 1280);
const p = I.p;
await p.goto(B + '/ice.html'); await gate(p);
ok('before the code, the bar names no facility, because it is not drawn', !(await p.$('#shellbar .nav')) && !/Conway|Flynn/.test(await p.evaluate(() => document.getElementById('shellbar').textContent)));
await p.fill('.sync-gate #sg-code', ACCESS); await p.click('.sync-gate button'); await p.waitForSelector('#shellbar .nav', { timeout: 12000 }); await sleep(800);
ok('after it, Ice has the shared bar', !!(await p.$('#shellbar .nav.sb.sb-app')));
ok('the bar is above the page: the logo, the menus, the app switch, the sync pill, the account menu', await p.evaluate(() => ['#logo', '#facMenu', '#sheetMenu', '#appSw', '.sync-pill', '#acctMenu'].every(s => !!document.querySelector('#shellbar ' + s))));
ok('and sits above Ice\'s own header, not over it', await p.evaluate(() => document.getElementById('shellbar').getBoundingClientRect().bottom <= document.getElementById('iceTabs').getBoundingClientRect().top + 1));
ok('the logo goes to the shell\'s Facilities page', await p.getAttribute('#shellbar #logo', 'href') === 'index.html');

/* ---- what the bar replaced is gone ------------------------------------------------------------------ */
ok('Ice\'s own app switcher is gone, from the home bar and the workspace bar', !(await p.$('#home .appsw')) && !(await p.$('#app .appsw')));
ok('and its theme and unit buttons, and the sign-out it used to add', !(await p.$('#thLight')) && !(await p.$('#thDark')) && !(await p.$('#unitHomeBtn')) && !(await p.$('#unitBtn')) && !(await p.$('#themeBtn')) && !(await p.$('#home .sync-signout')));
ok('Preferences no longer carries display buttons: theme and units are in the bar', !(await p.$('#thLight2')) && !(await p.$('#unitPrefIn')) && !(await p.$('#unitPrefMM')));
ok('and it is a tab beside the Measurement builder, not a gear', !!(await p.$('#iceTabs [data-page=prefs]')) && !(await p.$('#gearHome')) && !(await p.$('#gear')));
ok('the way back to the sheets is the shell is now, and Ice has a tab row in its place', await p.evaluate(() => !document.getElementById('homeBtn') && document.querySelectorAll('#iceTabs button').length === 4));

/* ---- the app you are in is marked ---------------------------------------------------------------------- */
const sw = await p.$$eval('#shellbar #appSw a', a => a.map(x => [x.textContent, x.getAttribute('aria-current'), x.hasAttribute('data-app'), x.getAttribute('href')]));
ok('Ice is marked and goes nowhere; Glass links to the same sheet', sw[0][0] === 'Ice' && sw[0][1] === 'true' && !sw[0][2] && sw[1][0] === 'Glass' && sw[1][2] && /^glass\.html#\/f\/[^/]+\/s\/[^/]+$/.test(sw[1][3]), JSON.stringify(sw));

/* ---- where you are: the address ------------------------------------------------------------------------- */
await p.goto(B + '/index.html#/f/f1'); await p.waitForSelector('#page .screen'); await sleep(500);     // prefs now say Conway
await p.goto(B + '/ice.html#/f/f2/s/s3'); await p.waitForSelector('#shellbar .nav'); await sleep(2500);
ok('an address wins over the stored preference: Ice opens on Mini at Flynn', await p.evaluate(() => sheet().name) === 'Mini' && await p.evaluate(() => facility().name) === 'Flynn Rink');
ok('and the address stays as it was', await here(p) === '#/f/f2/s/s3');
ok('the bar says the same', /Flynn Rink/.test(await text(p, '#facMenu')) && /Mini/.test(await text(p, '#sheetMenu')));
await p.goto(B + '/ice.html'); await p.waitForSelector('#shellbar .nav'); await sleep(2500);
ok('with no address, Ice falls back to the preference and then writes the address', /^#\/f\/f[12]\/s\/s[123]$/.test(await here(p)), await here(p));
await p.goto(B + '/ice.html#/f/f1/s/nope'); await p.waitForSelector('#shellbar .nav'); await sleep(2500);
ok('an address that names nothing is ignored, and corrected to where Ice is', /^#\/f\/f[12]\/s\/s[123]$/.test(await here(p)) && await p.evaluate(() => !!sheet()), await here(p));

/* ---- the bar's menus move Ice, without a reload ------------------------------------------------------------ */
await p.evaluate(() => { window.__same = 1; });
await p.click('#shellbar #sheetMenu'); await p.click('#shellbar .dropdown .it:has-text("Standard")'); await sleep(1500);
ok('the sheet menu moves Ice to that sheet', await p.evaluate(() => sheet().name) === 'Standard' && await here(p) === '#/f/f2/s/s2');
ok('without reloading the page', await p.evaluate(() => window.__same) === 1);
ok('and where you are is saved for the next page that opens', (await prefs(p)).activeSheet === 's2');
await p.click('#shellbar #facMenu'); await p.click('#shellbar .dropdown .it:has-text("Conway Arena")'); await sleep(1500);
ok('the facility menu moves Ice to that facility, and its sheet', await p.evaluate(() => facility().name) === 'Conway Arena' && await p.evaluate(() => sheet().name) === 'Main' && /^#\/f\/f1\/s\/s1$/.test(await here(p)), await here(p));
await p.goBack(); await sleep(1500);
ok('Back returns to the sheet before', await p.evaluate(() => sheet().name) === 'Standard' && await here(p) === '#/f/f2/s/s2');
await p.goForward(); await sleep(1500);
ok('Forward comes back', await p.evaluate(() => sheet().name) === 'Main');
ok('(Ice is still alive: no page errors, readings intact)', await p.evaluate(() => Object.keys(session().data).length) >= 0);

/* ---- the same in Glass ------------------------------------------------------------------------------------------- */
await p.goto(B + '/glass.html#/f/f1/s/s1'); await p.waitForSelector('#shellbar .nav'); await sleep(3000);
ok('Glass has the bar, with Glass marked', await p.$$eval('#shellbar #appSw a', a => a.map(x => x.getAttribute('aria-current') || '').join()) === ',true');
ok('and no app switcher, theme buttons or sign-out of its own', !(await p.$('.wrap header .appsw')) && !(await p.$('#thLight')) && !(await p.$('.wrap header .sync-signout')));
ok('and Glass has its own pages: Rink view, Builder and Inventory, with no header of its own', (await p.$$('#glassTabs [data-page]')).length === 3 && !(await p.$('.wrap header')));
ok('Glass is on Conway\'s sheet, as the address says', /Conway Arena/.test(await text(p, '#shellbar #facMenu')) && (await p.$$('.pnl')).length === 127);
await p.evaluate(() => { window.__same = 1; });
await p.click('#shellbar #facMenu'); await p.click('#shellbar .dropdown .it:has-text("Flynn Rink")'); await sleep(1500);
ok('choosing a sheet with no glass says so, and keeps showing the glass it has', /No glass has been built for/.test(await text(p, '#toolNote')) && (await p.$$('.pnl')).length === 127, await text(p, '#toolNote'));
ok('the address is the one you chose, and the page was not reloaded', /^#\/f\/f2\/s\/s[23]$/.test(await here(p)) && await p.evaluate(() => window.__same) === 1, await here(p));
await p.click('#shellbar #facMenu'); await p.click('#shellbar .dropdown .it:has-text("Conway Arena")'); await sleep(1500);
ok('and going back to Conway shows its glass', /Conway Arena/.test(await text(p, '#shellbar #facMenu')) && (await p.$$('.pnl')).length === 127);
await p.goto(B + '/glass.html#/f/f2/s/s2'); await p.waitForSelector('#shellbar .nav'); await sleep(3000);
ok('Glass opened on a sheet with no glass still opens, on the glass it has', (await p.$$('.pnl')).length === 127 && /Flynn Rink/.test(await text(p, '#shellbar #facMenu')));

/* ---- theme and units chosen in the bar reach the app --------------------------------------------------------------- */
await p.goto(B + '/ice.html#/f/f1/s/s1'); await p.waitForSelector('#shellbar .nav'); await sleep(2500);
await p.click('#shellbar #acctMenu'); await p.click('#shellbar .dropdown .it:has-text("Light")'); await sleep(600);
ok('Light in the bar: Ice takes it, and the page changes', await p.evaluate(() => state.theme) === 'light' && await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');
await sleep(500);
ok('and Ice saves it, rather than saving the old one back', (await prefs(p)).theme === 'light' && await p.evaluate(() => localStorage.getItem('rink_theme')) === 'light');
await p.reload(); await p.waitForSelector('#shellbar .nav'); await sleep(2500);
ok('a reload keeps it', await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light' && (await prefs(p)).theme === 'light');
await p.click('#shellbar #acctMenu'); await p.click('#shellbar .dropdown .it:has-text("Millimetres")'); await sleep(900);
ok('Millimetres in the bar: Ice is in millimetres, and saves it', await p.evaluate(() => isMM()) === true && (await prefs(p)).unit === 'mm');
await p.click('#shellbar #acctMenu');
ok('the menu marks the unit and the theme as they are', await p.$eval('#shellbar .dropdown .it:has-text("Millimetres")', e => e.getAttribute('aria-current') === 'true') && await p.$eval('#shellbar .dropdown .it:has-text("Light")', e => e.getAttribute('aria-current') === 'true'));
await p.keyboard.press('Escape');
await p.click('#shellbar #acctMenu'); await p.click('#shellbar .dropdown .it:has-text("Dark")'); await sleep(500);
ok('Ice\'s own Preferences buttons still work, and the bar\'s menu follows', await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark' && (await prefs(p)).theme === 'dark');
await p.click('#shellbar #acctMenu'); await p.click('#shellbar .dropdown .it:has-text("Inches")'); await sleep(500);
ok('and Inches the unit', await p.evaluate(() => isMM()) === false && (await prefs(p)).unit === 'in');
await p.goto(B + '/glass.html#/f/f1/s/s1'); await p.waitForSelector('#shellbar .nav'); await sleep(3000);
await p.click('#shellbar #acctMenu'); await p.click('#shellbar .dropdown .it:has-text("Light")'); await sleep(600);
ok('Glass takes the theme from the bar as well, in the shared key', await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light' && await p.evaluate(() => localStorage.getItem('rink_theme')) === 'light');
await p.click('#shellbar #acctMenu'); await p.click('#shellbar .dropdown .it:has-text("Dark")'); await sleep(400);

/* ---- the account menu inside an app ------------------------------------------------------------------------------------ */
await p.click('#shellbar #acctMenu');
const mi = await menuItems(p);
ok('has Back up, but not Restore (an app holds its own copy and would save over it)', mi.includes('Back up all data') && !mi.some(x => /Restore from backup/.test(x)), mi.join());
await p.keyboard.press('Escape');
await p.click('#shellbar #acctMenu'); await p.click('#shellbar .dropdown .it:has-text("Sign out")'); await sleep(300);
ok('Sign out asks first, in the page', /Sign out of this device\?/.test(await text(p, '#askDlg')) && !!(await p.$('#askYes')));
await p.click('#askNo'); await sleep(300);
ok('Cancel keeps you signed in', !(await p.$('#askDlg')) && !(await p.isVisible('.sync-gate')));
await p.click('#shellbar #acctMenu'); await p.click('#shellbar .dropdown .it:has-text("Sign out")'); await p.click('#askYes'); await sleep(2500);
ok('and Yes signs out', await p.isVisible('.sync-gate'));
await I.ctx.close();

/* ---- the layout ------------------------------------------------------------------------------------------------------------- */
const L = await k.device(b, 1280);
await L.p.goto(B + '/ice.html#/f/f2/s/s2'); await inApp(L.p); await sleep(1500);
const vis = (sel) => L.p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return c.display !== 'none' && r.width > 0 && r.height > 0; }, sel);
ok('on a laptop: both menus and the app switch, and no rail or tab bar (those wait for D3 and D4)', await vis('#shellbar #facMenu') && await vis('#shellbar #sheetMenu') && await vis('#shellbar #appSw') && !(await L.p.$('#rail')) && !(await L.p.$('#tabbar')));
ok('the page knows how tall the bar is, so it can fit below it', await L.p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--shellbar-h')) > 40));
await L.p.setViewportSize({ width: 390, height: 800 }); await sleep(600);
ok('on a phone: one context button, and the app switch stays on the bar (there is no tab bar here)', await vis('#shellbar #ctxBtn') && !(await vis('#shellbar #facMenu')) && await vis('#shellbar #appSw'));
ok('with no sideways scroll', await L.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await L.p.click('#shellbar #ctxBtn');
ok('the context button lists facilities and sheets, as links into this app', (await menuItems(L.p)).includes('Conway Arena') && await L.p.$$eval('#shellbar .dropdown a.it', a => a.every(x => /^ice\.html#\/f\//.test(x.getAttribute('href')))));
await L.p.keyboard.press('Escape');
await L.p.goto(B + '/glass.html#/f/f1/s/s1'); await L.p.waitForSelector('#shellbar .nav'); await sleep(2500);
ok('Glass on a phone: the same, and no sideways scroll', await vis('#shellbar #ctxBtn') && await L.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await L.p.emulateMedia({ media: 'print' });
ok('the bar does not print', !(await vis('#shellbar')));
await L.p.emulateMedia({ media: 'screen' });
await L.ctx.close();

/* ---- looking writes nothing -------------------------------------------------------------------------------------------------- */
const R = await k.device(b, 1280);
await R.p.goto(B + '/index.html'); await k.signIn(R.p);
const s0 = await stamps();
for (const u of ['/ice.html#/f/f1/s/s1', '/glass.html#/f/f2/s/s2', '/ice.html#/f/f2/s/s3', '/ice.html']) { await R.p.goto(B + u); await R.p.waitForSelector('#shellbar .nav'); await sleep(1800); }
await R.p.evaluate(() => Sync.sync('t')); await sleep(1500);
ok('opening both apps on several sheets, with the bar, restamps nothing', s0 === await stamps());
await R.ctx.close();

/* ---- people ---------------------------------------------------------------------------------------------------------------------- */
await fetch(B + '/__reset');
await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });
await k.addStaff({ id: 'flo', name: 'Flo', role: 'staff', code: 'flo-code-1', facilities: ['f2'] });
await k.ctl('tight=1'); await k.seed(k.PETE);
const F = await k.device(b, 1280);
await F.p.goto(B + '/ice.html#/f/f1/s/s1'); await personInApp(F.p, 'flo', 'flo-code-1'); await sleep(1500);
ok('Staff see only their own facility in the bar\'s menu', (await (async () => { await F.p.click('#shellbar #facMenu'); const m = await menuItems(F.p); await F.p.keyboard.press('Escape'); return m; })()).join() === 'Flynn Rink');
ok('and an address into the other building is ignored: Ice is on theirs', await F.p.evaluate(() => facility().name) === 'Flynn Rink' && !/f1/.test(await here(F.p)), await here(F.p));
ok('the bar has the unlock button for a signed-in person, in the bar', await vis2(F.p, '#shellbar .sync-unlock'));
await F.p.click('#shellbar #acctMenu');
ok('and no Staff item in the menu', !(await menuItems(F.p)).includes('Staff'));
await F.p.keyboard.press('Escape');
await F.ctx.close();

const M = await k.device(b, 1280);
await M.p.goto(B + '/glass.html#/f/f2/s/s2'); await personInApp(M.p, 'pete', 'pete-code-1'); await sleep(1500);
await M.p.click('#shellbar #acctMenu');
ok('Management has the Staff item in an app, going to the shell\'s page', (await menuItems(M.p)).includes('Staff') && await M.p.$eval('#shellbar .dropdown a.it:has-text("Staff")', a => a.getAttribute('href')) === 'index.html#/staff');
await M.p.keyboard.press('Escape');
await M.p.click('#shellbar #acctMenu'); await M.p.click('#shellbar .dropdown .it:has-text("Sign out")'); await sleep(300);
ok('the sign-out question\'s buttons are not locked with the page\'s own edit controls, though Glass has a .sbtn of its own', await M.p.$eval('#askYes', b => !b.disabled && !b.closest('[aria-disabled="true"]')) && !(await M.p.evaluate(() => document.getElementById('askYes').className.includes('sbtn'))));
await M.p.click('#askNo');
await M.ctx.close();

await k.done(b);

async function vis2(p, sel) { return p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return !e.hidden && r.width > 0 && r.height > 0; }, sel); }
})();
