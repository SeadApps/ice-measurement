/* Ice Preferences as a window.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/prefstest.js

   Overdue days, target, the four band edges, flood and shave are plus-and-minus steppers in 1/8"
   steps (days for overdue), written to the facility's settings and nothing else. Display, Facilities
   and Sheets are gone from the window (the bar and the D2 pages have them). Staff see the window
   but cannot change it. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
await k.addStaff({ id: 'dana', name: 'Dana', role: 'staff', code: 'dana-code-1', facilities: ['f1'] });
const b = await k.chromium.launch();
const errs = [];
const open = async (who, code) => {
  const D = await k.device(b, 1000), p = D.p;
  p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
  await p.goto(B + '/ice.html#/f/f1/s/s1/rink');
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="' + who + '"]'); await p.click('.sync-gate .sync-name[data-id="' + who + '"]');
  await p.fill('.sync-gate #sg-personal', code); await p.click('.sync-gate .sync-go');
  await p.waitForSelector('#shellbar .nav'); await sleep(2000);
  return D;
};
const D = await open('pete', 'pete-code-1'), p = D.p;
await p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(1500);
const R = fn => p.evaluate(fn);
const val = id => p.inputValue('#' + id).then(Number);
const stp = (id, dir) => p.click('#' + id + ' >> xpath=.. >> button[aria-label=' + (dir > 0 ? 'More' : 'Less') + ']');
const fac = async () => (await k.rows()).find(r => r.kind === 'facility' && r.id === 'f1').body.settings;
await R(() => openSettings()); await sleep(400);
if (await p.isChecked('#tieChk')) await p.click('#tieChk');   // flood and shave only show when attention is set by hand
await sleep(300);

ok('the window has no Display, Facilities or Sheets sections', await R(() => !document.getElementById('facManage') && !document.getElementById('sheetManage') && !document.getElementById('addSheetBtn') && !document.getElementById('thLight2') && !document.getElementById('unitPrefIn')));
ok('and says which facility it is for', /Conway/.test(await p.textContent('#prefFac')));
ok('every setting has a minus and a plus', await R(() => ['overdueIn', 'targetIn', 'floodIn', 'shaveIn'].every(id => document.getElementById(id).parentNode.classList.contains('stp')) && document.querySelectorAll('#edges .stp').length === 4));
ok('and they are at least 44px', await R(() => [...document.querySelectorAll('#scrim .stp button')].every(b => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })));

const stamps0 = JSON.stringify((await k.rows()).filter(r => !(r.kind === 'facility' && r.id === 'f1')).map(r => [r.kind, r.id, r.updated_at]).sort());
const t0 = await val('targetIn');
await stp('targetIn', 1); await sleep(300);
ok('plus moves the target one eighth', await val('targetIn') === t0 + 0.125, String(await val('targetIn')));
await stp('targetIn', -1); await stp('targetIn', -1); await sleep(300);
ok('minus moves it back, and one more', await val('targetIn') === t0 - 0.125);
ok('the map follows (the target is what the facility uses)', await R(() => EF().target) === t0 - 0.125);
const o0 = await val('overdueIn');
await stp('overdueIn', 1); await sleep(300);
ok('overdue days move by a day', await val('overdueIn') === o0 + 1 && await R(() => EF().overdueDays) === o0 + 1);
const e0 = await R(() => [...document.querySelectorAll('#edges input')].map(i => +i.value));
await p.click('#edges .edge:nth-child(2) button[aria-label=More]'); await sleep(300);
const e1 = await R(() => [...document.querySelectorAll('#edges input')].map(i => +i.value));
ok('an edge moves one eighth and the others stay', e1[1] === e0[1] + 0.125 && e1[0] === e0[0] && e1[2] === e0[2] && e1[3] === e0[3], JSON.stringify([e0, e1]));
await stp('floodIn', -1); await stp('shaveIn', 1); await sleep(300);
ok('flood and shave move by eighths', await R(() => EF().floodBelow % 0.125 === 0 && EF().shaveAbove % 0.125 === 0));

/* limits */
for (let i = 0; i < 30; i++) await stp('targetIn', 1);
ok('the target stops at 3"', await val('targetIn') === 3);
for (let i = 0; i < 30; i++) await stp('targetIn', -1);
ok('and at 1/2"', await val('targetIn') === 0.5);
for (let i = 0; i < 100; i++) await stp('overdueIn', 1);
ok('overdue stops at 90 days', await val('overdueIn') === 90);

/* in millimetres the box and the label show millimetres, but the step is still an eighth */
await R(() => { setUnit('mm'); buildSettings(); }); await sleep(300);
const m0 = await val('targetIn');
await stp('targetIn', 1); await sleep(200);
ok('in millimetres a step is still an eighth of an inch', Math.abs((await val('targetIn')) - m0 - 0.125) < 1e-9 && /mm/.test(await p.textContent('#targetFrac')), await p.textContent('#targetFrac'));
await R(() => { setUnit('in'); buildSettings(); });

/* what reaches the server is the facility's settings, and only the facility */
await sleep(3500);
const srv = await fac();
ok('the edits reached the facility\'s settings on the server', srv.overdueDays === 90 && srv.target === 0.625 && srv.settingsVersion === 2, JSON.stringify(srv));
ok('and nothing else was restamped', JSON.stringify((await k.rows()).filter(r => !(r.kind === 'facility' && r.id === 'f1')).map(r => [r.kind, r.id, r.updated_at]).sort()) === stamps0);
await D.ctx.close();

/* Staff see it, read only */
const S = await open('dana', 'dana-code-1'), q = S.p;
await q.evaluate(() => openSettings()); await sleep(500);
ok('Staff can open the window', await q.isVisible('#scrim .modal') && await q.isVisible('#prefRo'));
ok('it says only Management can change it', /only Management/.test(await q.textContent('#prefRo')));
ok('every input and stepper is disabled', await q.evaluate(() => [...document.querySelectorAll('#scrim .modal input:not([type=file]), #scrim .stp button, #resetBands')].every(e => e.disabled)));
const before = await q.inputValue('#targetIn');
await q.click('#targetIn', { force: true, timeout: 1500 }).catch(() => {}); await q.keyboard.type('9');
ok('and the target cannot be typed over', await q.inputValue('#targetIn') === before);
await q.click('#settingsDone'); await sleep(300);
ok('Done closes it', !(await q.isVisible('#scrim .modal')));
ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
