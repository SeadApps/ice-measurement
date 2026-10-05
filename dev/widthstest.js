/* The builder's one-tap widths (a record kind per facility), and the Staff rule
   that only Management resolves or reopens a flag.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/widthstest.js

   The widths belong to the facility and are shared by its sheets. A facility that
   never changed its list reads 43 and 48 and has no record at all: sending the
   defaults would stamp every facility on every device for nothing, so the first
   record appears only when somebody really changes the list. */
const { chromium } = require('playwright');

const B = 'http://localhost:8200';
const CFG = { url: B, anon: 'test', email: 'operations@conwayarena.local' };
const CODE = 'test-access-code', EDIT = 'test-editing-code', DOM = '@staff.conwayarena.local';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };
const ctl = q => fetch(B + '/__ctl?' + q);
const addStaff = p => fetch(B + '/__staff', { method: 'POST', body: JSON.stringify(p) });
const rows = async () => (await (await fetch(B + '/__rows')).json());
async function login(email, password) {
  const r = await fetch(B + '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  return (await r.json()).access_token;
}
const H = t => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
const send = (t, list) => fetch(B + '/rest/v1/records?on_conflict=kind,id', { method: 'POST', headers: H(t), body: JSON.stringify(list) });
const rpc = (t, fn, body) => fetch(B + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H(t), body: JSON.stringify(body || {}) });
const rec = (kind, id, fac, extra) => ({ kind, id, deleted: false, body: Object.assign(fac ? { fac } : {}, extra || {}) });

async function device(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, CFG);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  return { ctx, p };
}
async function signIn(p) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', CODE);
  await p.click('.sync-gate button');
  await sleep(4000);
}
const widthRows = async () => (await rows()).filter(r => r.kind === 'glass_widths');

(async () => {
await fetch(B + '/__reset');

/* ---- the server rules, as a modified page would meet them ---------------------- */
await addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
await addStaff({ id: 'flo', name: 'Flo', role: 'staff', code: 'flo-code-1', facilities: ['flynn'] });
await ctl('tight=1');
const pete = await login('pete' + DOM, 'pete-code-1'), flo = await login('flo' + DOM, 'flo-code-1');
await rpc(pete, 'unlock_editing', { code: EDIT }); await rpc(flo, 'unlock_editing', { code: EDIT });

ok('Staff may save their own facility\'s widths', (await send(flo, [rec('glass_widths', 'flynn', 'flynn', { widths: [40, 43, 48] })])).ok);
ok('but not another facility\'s', (await send(flo, [rec('glass_widths', 'conway', 'conway', { widths: [1] })])).status === 403);
ok('and Management may save any', (await send(pete, [rec('glass_widths', 'conway', 'conway', { widths: [43, 48, 60] })])).ok);

await send(pete, [rec('flag', 'fl1', 'flynn', { status: 'open', note: 'check panel 12' })]);
ok('Staff can raise a flag in their facility', (await send(flo, [rec('flag', 'fl2', 'flynn', { status: 'open' })])).ok);
ok('Staff cannot resolve one', (await send(flo, [rec('flag', 'fl2', 'flynn', { status: 'resolved' })])).status === 403);
ok('Management can', (await send(pete, [rec('flag', 'fl2', 'flynn', { status: 'resolved' })])).ok);
const re = await send(flo, [rec('flag', 'fl2', 'flynn', { status: 'open' })]);
ok('Staff cannot reopen a resolved flag', re.status === 403, String(re.status));
ok('which stays resolved', (await rows()).find(x => x.kind === 'flag' && x.id === 'fl2').body.status === 'resolved');
ok('nor edit its note while it is resolved', (await send(flo, [rec('flag', 'fl2', 'flynn', { status: 'resolved', note: 'x' })])).status === 403);
ok('Management can reopen it', (await send(pete, [rec('flag', 'fl2', 'flynn', { status: 'open' })])).ok);
ok('and Staff can edit an open one again', (await send(flo, [rec('flag', 'fl2', 'flynn', { status: 'open', note: 'again' })])).ok);

/* ---- the page ---------------------------------------------------------------- */
await fetch(B + '/__reset');
await ctl('tight=0');
const b = await chromium.launch();
const A = await device(b), C = await device(b);
await A.p.goto(B + '/glass.html'); await signIn(A.p);
await C.p.goto(B + '/glass.html'); await signIn(C.p);
const W = (p, fac) => p.evaluate(f => widthsOf(f), fac);

ok('a facility that never saved a list reads 43 and 48', JSON.stringify(await W(A.p, 'conway')) === '[43,48]');
await A.p.evaluate(() => Sync.sync()); await sleep(800);
ok('and has no record: idle devices send nothing', (await widthRows()).length === 0);

ok('saving the same list again changes nothing', await A.p.evaluate(() => setWidths('conway', [48, 43])) === false);
ok('a list for no facility is refused', await A.p.evaluate(() => setWidths('', [40])) === false);
ok('a changed list is accepted', await A.p.evaluate(() => setWidths('conway', [43, 48, 36.5, 36.5, 'x', -2, 0])) === true);
ok('sorted, with duplicates and rubbish dropped', JSON.stringify(await W(A.p, 'conway')) === '[36.5,43,48]', JSON.stringify(await W(A.p, 'conway')));
ok('another facility is untouched', JSON.stringify(await W(A.p, 'flynn')) === '[43,48]');

await A.p.evaluate(() => { store(); return Sync.sync(); }); await sleep(1500);
const wr = await widthRows();
ok('one record reaches the server, tagged with its facility', wr.length === 1 && wr[0].id === 'conway' && wr[0].body.fac === 'conway'
   && JSON.stringify(wr[0].body.widths) === '[36.5,43,48]', JSON.stringify(wr));

await C.p.evaluate(() => Sync.sync()); await sleep(1500);
ok('the other device receives it', JSON.stringify(await W(C.p, 'conway')) === '[36.5,43,48]', JSON.stringify(await W(C.p, 'conway')));
ok('and still reads the defaults for another facility', JSON.stringify(await W(C.p, 'flynn')) === '[43,48]');

const stamp = (await widthRows())[0].updated_at;
await C.p.evaluate(() => Sync.sync()); await sleep(1200);
ok('receiving it does not make it look edited', (await widthRows())[0].updated_at === stamp);

/* newest wins */
await sleep(20);
await C.p.evaluate(() => { setWidths('conway', [43, 48, 60]); store(); return Sync.sync(); }); await sleep(1500);
await A.p.evaluate(() => Sync.sync()); await sleep(1500);
ok('a later change wins on the first device too', JSON.stringify(await W(A.p, 'conway')) === '[43,48,60]', JSON.stringify(await W(A.p, 'conway')));

/* it survives a reload */
await A.p.reload(); await sleep(2500);
ok('and survives a reload', JSON.stringify(await W(A.p, 'conway')) === '[43,48,60]');

/* back to the defaults is a real change to a record, not a deletion */
await A.p.evaluate(() => { setWidths('conway', [43, 48]); store(); return Sync.sync(); }); await sleep(1500);
ok('going back to the defaults is saved as a list', JSON.stringify((await widthRows())[0].body.widths) === '[43,48]');

await b.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
