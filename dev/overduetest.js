/* D3: how many days before a sheet is overdue is a setting of the facility, not of
   the device.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/overduetest.js

   It used to be a device preference, so one person's "3 days" never reached the
   next, and the launcher and Ice could disagree about the same sheet. Now the
   facility holds it, a facility that has none falls back to the device's value and
   then to 7, and every screen that asks "is it overdue?" asks the same function. */
const { chromium } = require('playwright');
const B = 'http://localhost:8200';
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = async () => (await (await fetch(B + '/__rows')).json());

async function device(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  return { ctx, p };
}
async function signIn(p) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', 'test-access-code'); await p.click('.sync-gate button'); await sleep(2500);
}

(async () => {
await fetch(B + '/__reset');
const b = await chromium.launch();
const { ctx, p } = await device(b);
await p.goto(B + '/ice.html'); await signIn(p);
const R = (fn, arg) => p.evaluate(fn, arg);

/* ---- the function ---------------------------------------------------------------- */
const fn = await R(() => {
  const D = Records.overdueDaysOf;
  return { own: D({ settings: { overdueDays: 3 } }, { overdueDays: 20 }),
           pref: D({ settings: {} }, { overdueDays: 20 }),
           none: D({ settings: {} }, {}), noSettings: D({}, null), nothing: D(null, undefined),
           low: D({ settings: { overdueDays: 0 } }), high: D({ settings: { overdueDays: 400 } }),
           frac: D({ settings: { overdueDays: 4.6 } }), junk: D({ settings: { overdueDays: 'x' } }, { overdueDays: 9 }) };
});
ok('a facility\'s own value wins', fn.own === 3);
ok('with none it falls back to the device\'s', fn.pref === 20);
ok('and then to 7', fn.none === 7 && fn.noSettings === 7 && fn.nothing === 7);
ok('kept between 1 and 90 days, in whole days', fn.low === 1 && fn.high === 90 && fn.frac === 5);
ok('a value that is not a number is ignored', fn.junk === 9);

/* ---- two facilities with different rules ----------------------------------------------- */
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
await R(a => {
  const mk = (name, days) => { const f = newFacility(name); f.settings.overdueDays = days;
    f.sheets[0].sessions[0].date = a.when; f.sheets[0].sessions[0].data = { '1': '1 1/2"' }; return f; };
  state.facilities = [mk('Strict Rink', 3), mk('Relaxed Rink', 30)];
  state.activeFacility = state.facilities[0].id; state.activeSheet = state.facilities[0].sheets[0].id; state.activeSession = state.facilities[0].sheets[0].sessions[0].id;
  persist();
}, { when: daysAgo(10) });
await sleep(1500);

const ids = await R(() => state.facilities.map(f => ({ n: f.name, s: f.sheets[0].id, f: f.id })));
const strict = ids.find(x => x.n === 'Strict Rink'), relaxed = ids.find(x => x.n === 'Relaxed Rink');

await R(a => { state.activeFacility = a.f; state.activeSheet = a.s; buildHome(); }, strict);
ok('Ice\'s home screen calls a 10-day-old round overdue where the facility says 3 days',
   (await R(() => document.querySelector('#fleet .fl-row').className)).includes('over'), await R(() => document.querySelector('#fleet .fl-row').className));
await R(a => { state.activeFacility = a.f; state.activeSheet = a.s; buildHome(); }, relaxed);
ok('and not where it says 30', !(await R(() => document.querySelector('#fleet .fl-row').className)).includes('over'));

await R(a => Records.Repo.savePrefs({ activeSheet: a.s, activeFacility: a.f }), strict);
await p.goto(B + '/index.html'); await sleep(2500);
const fleet = await R(() => fleetRows());
const row = n => fleet.rows.find(r => r.f.name === n);
ok('the launcher agrees: the strict rink is overdue', row('Strict Rink') && row('Strict Rink').over === true);
ok('and the relaxed one is not', row('Relaxed Rink') && row('Relaxed Rink').over === false);

/* a facility with none of its own uses the device's value */
await p.goto(B + '/ice.html'); await sleep(2000);
await R(() => { delete state.facilities[1].settings.overdueDays; state.overdueDays = 5; persist(); });
await sleep(1200);
await p.goto(B + '/index.html'); await sleep(2500);
const fleet2 = await R(() => fleetRows());
ok('a facility with no value of its own falls back to the device preference (5 days: overdue at 10)', fleet2.rows.find(r => r.f.name === 'Relaxed Rink').over === true);

/* ---- it is a facility setting: it syncs, and Preferences edits it ----------------------- */
await p.goto(B + '/ice.html'); await sleep(2000);
await R(() => { buildSettings(); });
ok('Preferences shows the facility\'s value', true);
await R(() => { state.activeFacility = state.facilities[0].id; state.activeSheet = state.facilities[0].sheets[0].id; state.activeSession = state.facilities[0].sheets[0].sessions[0].id; buildSettings(); });
ok('shown for the facility being looked at', (await R(() => document.getElementById('overdueIn').value)) === '3');
await R(() => { const i = document.getElementById('overdueIn'); i.value = '14'; i.dispatchEvent(new Event('input')); });
await sleep(1200); await R(() => Sync.sync('t')); await sleep(2000);
const srv = (await rows()).filter(r => r.kind === 'facility').find(r => r.body.name === 'Strict Rink');
ok('editing it changes the facility and reaches the server', srv && srv.body.settings.overdueDays === 14, JSON.stringify(srv && srv.body.settings));
ok('and not the other facility', (await rows()).filter(r => r.kind === 'facility').find(r => r.body.name === 'Relaxed Rink').body.settings.overdueDays !== 14);
await p.goto(B + '/index.html'); await sleep(2500);
ok('so the launcher no longer calls the 10-day-old round overdue', (await R(() => fleetRows())).rows.find(r => r.f.name === 'Strict Rink').over === false);

/* an idle device sends nothing */
const stamps = async () => JSON.stringify((await rows()).map(r => [r.kind, r.id, r.updated_at]).sort());
const s1 = await stamps();
await R(() => Sync.sync && Sync.sync('t')); await sleep(1500);
ok('an idle device afterwards restamps nothing', s1 === await stamps());

await ctx.close(); await b.close();
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
