/* Quality review: Flags, Current state, Changes and Reports, on a laptop.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/reviewtest.js

   Flags: Staff see the flags of their own facilities and cannot resolve; Management resolves and reopens, and the
   server has the last word. Current state agrees with the Facilities cards and the Fleet table. Changes reads the
   server's log: the right sentence for each kind of edit, filters, paging, a Large change hint at half an inch, and
   an honest message when there is no connection. Reports build only what is ticked, from the same figures the
   screens use, the same in either theme, and print black on white. Looking at any of it writes nothing. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
await k.addStaff({ id: 'dana', name: 'Dana', role: 'staff', code: 'dana-code-1', facilities: ['f1'] });
await k.ctl('tight=1');
const b = await k.chromium.launch();
const errs = [];
const tok = { pete: await k.login('pete' + k.DOM, 'pete-code-1'), dana: await k.login('dana' + k.DOM, 'dana-code-1') };
const unlock = t => fetch(B + '/rest/v1/rpc/unlock_editing', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: k.EDIT }) });
await unlock(tok.pete); await unlock(tok.dana);
const post = (who, recs) => fetch(B + '/rest/v1/records?on_conflict=kind,id', { method: 'POST', headers: { Authorization: 'Bearer ' + tok[who], 'Content-Type': 'application/json' }, body: JSON.stringify(recs) });
const rec = (kind, id, fac, body) => ({ kind, id, deleted: false, body: Object.assign({ id, fac }, body) });

/* a scripted series of edits, so the log has something to say */
const rows0 = await k.rows();
const z1 = rows0.find(r => r.kind === 'session' && r.id === 'z1').body;
await post('pete', [rec('session', 'z1', 'f1', Object.assign({}, z1, { data: { 1: '2"', 2: '1 3/8"' }, updatedAt: new Date().toISOString() }))]);
await post('dana', [rec('glass_panel', '045', 'f1', { status: 'replace', note: 'cracked', at: '2026-11-05', updatedAt: new Date().toISOString() })]);
await post('pete', [rec('glass_spare', 'm1', 'f1', { fac: 'f1', w: 43, h: 75, thk: '1/2"', mat: 'tempered', qty: 3, note: 'received', updatedAt: new Date().toISOString() })]);
const s1 = rows0.find(r => r.kind === 'sheet' && r.id === 's1').body;
await post('pete', [rec('sheet', 's1', 'f1', Object.assign({}, s1, { name: 'Main sheet', updatedAt: new Date().toISOString() }))]);
const f1b = rows0.find(r => r.kind === 'facility' && r.id === 'f1').body;
await post('pete', [rec('facility', 'f1', 'f1', Object.assign({}, f1b, { settings: Object.assign({}, f1b.settings, { target: 1.625 }), updatedAt: new Date().toISOString() }))]);
const many = []; for (let i = 0; i < 60; i++) many.push(rec('glass_spare', 'bulk' + i, 'f1', { fac: 'f1', w: 48, h: 75, thk: '1/2"', mat: 'tempered', qty: 1, note: 'bulk ' + i, updatedAt: new Date(Date.now() + i).toISOString() }));
await post('pete', many);
/* two flags: Dana's, on Conway's sheet; Pete's, on a facility Dana may not see */
await post('dana', [rec('flag', 'fa1', 'f1', { status: 'open', reason: 'Wrong reading', note: 'drain is nearer', targetKind: 'reading', sheetId: 's1', sessionId: 'z2', spot: '1', label: 'Left end', reading: '1 1/2"', updatedAt: new Date().toISOString() })]);
await post('pete', [rec('flag', 'fb1', 'f2', { status: 'open', reason: 'Missing data', note: '', targetKind: 'reading', sheetId: 's3', label: 'Mini rink', updatedAt: new Date().toISOString() })]);
await post('pete', [rec('flag', 'fgone', 'f1', { status: 'open', reason: 'Other', note: 'the sheet was removed', targetKind: 'reading', sheetId: 'no-such-sheet', label: 'An old spot', updatedAt: new Date().toISOString() })]);
await sleep(300);

const open = async (who, code, hash, width) => {
  const ctx = await b.newContext({ viewport: { width: width || 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(who + ': ' + String(e).split('\n')[0]));
  await p.goto(B + '/index.html' + hash);
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="' + who + '"]'); await p.click('.sync-gate .sync-name[data-id="' + who + '"]');
  await p.fill('.sync-gate #sg-personal', code); await p.click('.sync-gate .sync-go');
  await sleep(4500);
  return { ctx, p };
};
const text = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);

/* ---------------- Flags: Staff ---------------- */
const D = await open('dana', 'dana-code-1', '#/review/flags'), dn = D.p;
ok('Staff reach Flags on a laptop', await dn.isVisible('#pageReview[data-view="flags"]'));
const dRows = await dn.$$eval('#flagList .flagrow', r => r.map(x => x.dataset.fid));
ok('they see the flags of their own facility', dRows.includes('fa1'), JSON.stringify(dRows));
ok('and not another facility\'s', !dRows.includes('fb1'));
ok('they have no Resolve or Reopen', (await dn.$$('#flagList [data-act]')).length === 0);
ok('the rail offers Staff the Flags page and nothing else of Quality review', JSON.stringify(await dn.$$eval('#rail a[href^="#/review/"]', a => a.map(x => x.getAttribute('href')))) === '["#/review/flags"]');
ok('a flag on a sheet that has gone still lists, and says so', /gone/.test(await text(dn, '#flagList .flagrow[data-fid="fgone"]')));
await D.ctx.close();

/* ---------------- Flags: Management ---------------- */
const M = await open('pete', 'pete-code-1', '#/review/flags'), m = M.p;
await m.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(1500);
const mRows = await m.$$eval('#flagList .flagrow', r => r.map(x => x.dataset.fid));
ok('Management see every flag', ['fa1', 'fb1', 'fgone'].every(i => mRows.includes(i)), JSON.stringify(mRows));
ok('with Resolve on each open one', (await m.$$('#flagList [data-act="resolve"]')).length === 3);
await m.click('#flagList .flagrow[data-fid="fa1"] [data-act="resolve"]'); await sleep(3500);
ok('Resolve closes it, and the server has it', (await k.rows()).find(r => r.kind === 'flag' && r.id === 'fa1').body.status === 'resolved');
ok('it moves out of the Open list', !(await m.$('#flagList .flagrow[data-fid="fa1"]')));
await m.click('#fl-resolved'); await sleep(300);
ok('and is under Resolved, with Reopen', await m.isVisible('#flagList .flagrow[data-fid="fa1"] [data-act="reopen"]'));
await m.click('#flagList .flagrow[data-fid="fa1"] [data-act="reopen"]'); await sleep(3500);
ok('Reopen opens it again', (await k.rows()).find(r => r.kind === 'flag' && r.id === 'fa1').body.status === 'open');

/* ---------------- Current state ---------------- */
await m.goto(B + '/index.html#/review/state'); await sleep(2500);
const stateRows = await m.$$eval('#stateTable tbody tr', r => r.map(x => ({ sid: x.dataset.sid, ice: x.querySelector('.ice').textContent, flags: x.querySelector('.flagcell').textContent })));
ok('Current state has a row per sheet', stateRows.length === 3, JSON.stringify(stateRows.map(r => r.sid)));
await m.goto(B + '/index.html#/'); await sleep(2500); await m.click('#viewFleet').catch(() => {}); await sleep(500);
const fleet = await m.$$eval('#fleetTable tbody tr', r => r.map(x => ({ sid: x.dataset.sid, ice: x.children[3].textContent, flags: x.children[5].textContent })));
ok('it agrees with the Fleet table on every sheet: ice status and open flags', stateRows.every(s => { const f = fleet.find(x => x.sid === s.sid); return f && (/Overdue/.test(f.ice) === (s.ice === 'Overdue')) && f.flags === s.flags; }), JSON.stringify([stateRows, fleet]));

/* ---------------- Changes ---------------- */
await m.goto(B + '/index.html#/review/changes'); await m.waitForSelector('#changeLog .e', { timeout: 15000 }).catch(() => {}); await sleep(800);
const all = await m.$$eval('#changeLog .e', r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
ok('Changes lists what changed, newest first, 50 at a time', all.length === 50, String(all.length));
ok('and more on request', await m.isVisible('#moreChanges'));
await m.click('#moreChanges'); await sleep(1500);
ok('older changes append', (await m.$$('#changeLog .e')).length > 50);
const sentences = (await m.$$eval('#changeLog .e', r => r.map(x => x.innerText.replace(/\s+/g, ' ')))).join(' | ');
ok('a panel edit reads as a sentence with the person', /Dana Set panel 045 to Needs replacement/.test(sentences));
ok('a movement', /Recorded \+3 tempered 43/.test(sentences));
ok('a sheet rename', /Renamed the sheet Main to Main sheet/.test(sentences));
ok('a facility setting', /Changed the target/.test(sentences));
ok('a round', /Logged readings in a round/.test(sentences));
ok('a flag', /Raised a flag/.test(sentences));
ok('a reading that moved by half an inch carries the Large change hint', (await m.$$('#changeLog .chip.big')).length === 1 && /1\/2|0\.5|½/.test(await m.textContent('#changeLog .chip.big')) || /0\.5/.test(await m.textContent('#changeLog .chip.big')), await m.textContent('#changeLog .chip.big').catch(() => 'none'));
await m.selectOption('#chArea', 'inventory'); await sleep(2500);
const inv = await m.$$eval('#changeLog .e', r => r.map(x => x.dataset.kind));
ok('the Area filter narrows it to Inventory', inv.length > 0 && inv.every(x => x === 'glass_spare' || x === 'glass_widths'), JSON.stringify([...new Set(inv)]));
await m.selectOption('#chArea', 'all'); await m.selectOption('#chPerson', 'dana'); await sleep(2500);
ok('and the Person filter to Dana', (await m.$$eval('#changeLog .e', r => r.map(x => x.innerText))).every(t => /Dana/.test(t)) && (await m.$$('#changeLog .e')).length >= 2);
await m.selectOption('#chPerson', 'all'); await sleep(1500);
await m.click('#changeLog .e .flagit >> nth=0'); await sleep(3000);
ok('a change can be flagged from here', (await k.rows()).some(r => r.kind === 'flag' && r.body.targetKind === 'record' && r.body.recordId));
await m.context().setOffline(true); await m.selectOption('#chArea', 'ice'); await sleep(2000);
ok('with no connection it says so, instead of showing an empty list', /reach the server/i.test(await text(m, '#changeError')) && !(await m.$('#noChanges')), await text(m, '#changeError'));
await m.context().setOffline(false);

/* ---------------- Reports ---------------- */
await m.goto(B + '/index.html#/review/reports'); await sleep(2500);
await m.selectOption('#repSheet', 's1');
const sections = async () => m.$$eval('#reportPaper section', s => s.map(x => x.dataset.sec));
ok('a report has the sections that are ticked, and only those', JSON.stringify(await sections()) === '["summary","latest","trend","glass","flags"]', JSON.stringify(await sections()));
await m.uncheck('[data-sec="trend"]'); await m.uncheck('[data-sec="glass"]'); await sleep(300);
ok('unticking removes them from the page', JSON.stringify(await sections()) === '["summary","latest","flags"]');
await m.check('[data-sec="trend"]'); await sleep(300);
const trendRows = await m.$$eval('#reportPaper [data-sec="trend"] tbody tr', r => r.length);
ok('the trend lists one row per round with readings in the period', trendRows === 2, String(trendRows));
const latestText = await text(m, '#reportPaper [data-sec="latest"]');
ok('the latest round\'s figures are the readings\' own (two readings of 1 1/2)', /2 readings/.test(latestText) && /thinnest 1\.500/.test(latestText) && /thickest 1\.500/.test(latestText) && /average 1\.500/.test(latestText), latestText);
ok('a header with the sheet, the period and who prepared it', /Main/.test(await text(m, '#reportPaper .rp-head')) && /Pete/.test(await text(m, '#reportPaper .rp-head')) && /30 days/.test(await text(m, '#reportPaper .rp-head')));
const lightH = await m.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); return document.getElementById('reportPaper').innerHTML; });
const darkH = await m.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); return document.getElementById('reportPaper').innerHTML; });
ok('the report is the same in either theme', lightH === darkH);
await m.click('#repPrint'); await m.evaluate(() => document.body.classList.add('printing-report'));
await m.emulateMedia({ media: 'print' }); await sleep(300);
const pr = await m.evaluate(() => { const r = document.getElementById('printRoot'), c = getComputedStyle(r), sh = document.getElementById('shell'); return { shown: c.display, fg: c.color, bg: getComputedStyle(document.body).backgroundColor, chrome: sh ? getComputedStyle(sh).display : 'none', text: r.innerText }; });
ok('printed, it is the report alone: no controls, no shell', pr.shown === 'block' && pr.chrome === 'none' && /Summary/.test(pr.text) && !/Print or save/.test(pr.text));
ok('black on white', pr.fg === 'rgb(0, 0, 0)' && /255, 255, 255/.test(pr.bg), pr.fg + ' / ' + pr.bg);
const pdf = await m.pdf({ format: 'Letter' });
ok('and it makes a PDF', pdf.length > 2000 && pdf.slice(0, 4).toString() === '%PDF');
await m.emulateMedia({ media: 'screen' });

/* ---------------- looking writes nothing ---------------- */
const snap = async () => JSON.stringify((await k.rows()).map(r => [r.kind, r.id, r.updated_at]).sort());
const s0 = await snap();
for (const v of ['flags', 'state', 'changes', 'reports']) { await m.goto(B + '/index.html#/review/' + v); await sleep(2500); }
ok('opening every Quality review page restamps nothing', (await snap()) === s0);
ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await M.ctx.close();
await k.done(b);
})();
