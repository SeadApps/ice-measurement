/* Ice asks "are you sure?" in the page, never with a browser dialog.
   Delete a round (and refuse the last one), clear a round, switch to a smaller grid. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
const b = await k.chromium.launch();
const D = await k.device(b, 1000), p = D.p;
let native = 0; p.on('dialog', d => { native++; d.dismiss(); });
await p.goto(B + '/ice.html#/f/f1/s/s1/build');
await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
await p.waitForSelector('.sync-gate .sync-name[data-id="pete"]'); await p.click('.sync-gate .sync-name[data-id="pete"]');
await p.fill('.sync-gate #sg-personal', 'pete-code-1'); await p.click('.sync-gate .sync-go');
await p.waitForSelector('#shellbar .nav'); await sleep(2000);
await p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(1500);
const R = fn => p.evaluate(fn);
await R(() => showPage('build')); await sleep(700);
const rounds = () => R(() => sheet().sessions.length);
const up = () => p.isVisible('#sureScrim.on');

/* clear round */
await R(() => { const d = data(); d['0,0'] = 1.5; d['1,0'] = 1.625; afterChange(); }); await sleep(300);
await p.click('#clearBtn'); await sleep(300);
ok('Clear round asks in the page', await up() && /Clear all readings/.test(await p.textContent('#sureTitle')));
await p.click('#sureNo'); await sleep(300);
ok('Cancel keeps the readings', !(await up()) && await R(() => Object.keys(data()).length) === 4, String(await R(() => Object.keys(data()).length)));
await p.click('#clearBtn'); await sleep(300); await p.click('#sureYes'); await sleep(400);
ok('OK clears them', await R(() => Object.keys(data()).length) === 0);

/* delete rounds from Preferences */
await R(() => openSettings()); await sleep(400);
let n = await rounds();
ok('there is more than one round to start with', n > 1, String(n));
await p.click('#roundManage .del >> nth=0'); await sleep(300);
ok('Delete asks in the page', await up() && /Delete the/.test(await p.textContent('#sureTitle')));
await p.click('#sureNo'); await sleep(300);
ok('Cancel keeps the round', await rounds() === n && !(await up()));
await p.click('#roundManage .del >> nth=0'); await sleep(300); await p.click('#sureYes'); await sleep(500);
ok('OK deletes it', await rounds() === n - 1, n + ' -> ' + await rounds());
while (await rounds() > 1) { await p.click('#roundManage .del >> nth=0'); await sleep(300); await p.click('#sureYes'); await sleep(400); }
await p.click('#roundManage .del >> nth=0'); await sleep(300);
ok('the last round is refused with a notice, not a question', await up() && /at least one/.test(await p.textContent('#sureTitle')) && !(await p.isVisible('#sureNo')));
await p.click('#sureYes'); await sleep(300);
ok('and it is still there', await rounds() === 1 && !(await up()));

ok('no browser dialog appeared at any point', native === 0, String(native));
await k.done(b);
})();
