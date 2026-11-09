/* The Staff page.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/stafftest.js

   Management adds, edits, resets, removes and restores a person, and changes the shared
   codes, through the manage-staff function. A code is shown once and exists nowhere a
   list could read it back. The people it makes can really sign in. Staff cannot reach the
   page, even by address. Nothing here writes a record. */
const k = require('./shellkit');
const { ok, sleep, B, text, rows, stamps, DOM, ACCESS } = k;

const ALPHA = /^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;
const STAFF = '#/staff';
const open = async (p, tab) => { await p.goto(B + '/index.html' + STAFF); await p.waitForSelector('#pageStaff'); await p.waitForSelector('#peopleList, #activityCard', { timeout: 8000 }); await sleep(300); if (tab) { await p.click('#tab' + tab); await sleep(1200); } };
const cardOf = (p, login) => p.$('.pcard[data-login="' + login + '"]');
const names = p => p.$$eval('#peopleList .pname', e => e.map(x => x.firstChild.textContent));
const shown = async p => ({ title: (await text(p, '#revealBanner')).trim(), code: (await p.$('#revealCode')) ? (await text(p, '#revealCode')).trim() : null });
const canSignIn = async (login, code) => !!(await k.login(login + DOM, code));
const loginOf = (p, name) => p.evaluate(n => [...document.querySelectorAll('.pcard')].find(c => c.querySelector('.pname').firstChild.textContent === n).dataset.login, name);

(async () => {
await fetch(B + '/__reset');
await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });
await k.addStaff({ id: 'dana', name: 'Dana', role: 'staff', code: 'dana-code-1', facilities: ['f2'] });
await k.addStaff({ id: 'alex', name: 'Alex', role: 'staff', code: 'alex-code-1', facilities: ['f1'], active: false });
await k.ctl('tight=1');
await k.seed(k.PETE);
const b = await k.chromium.launch();

const M = await k.device(b, 1280);
const p = M.p;
await p.goto(B + '/index.html'); await k.signInAs(p, 'pete', 'pete-code-1');

/* ---- reaching it ----------------------------------------------------------------------- */
await p.click('#acctMenu');
ok('Management finds Staff in the account menu', (await p.$$eval('.dropdown .it', e => e.map(x => x.textContent))).includes('Staff'));
await p.click('.dropdown .it:has-text("Staff")'); await p.waitForSelector('#pageStaff'); await sleep(1200);
ok('and it opens the page', /Staff/.test(await text(p, '#pageStaff h2')) && (await p.evaluate(() => location.hash)) === STAFF);
ok('the rail has it too', !!(await p.$('#rail a[href="#/staff"]')));

/* ---- the list ---------------------------------------------------------------------------- */
await open(p);
ok('people in name order, removed ones included', (await names(p)).join() === 'Alex,Dana,Pete', (await names(p)).join());
const pete = await cardOf(p, 'pete'), dana = await cardOf(p, 'dana'), alex = await cardOf(p, 'alex');
ok('Pete is marked as you, and is an Admin with all facilities', /you/.test(await pete.textContent()) && /Admin/.test(await pete.textContent()) && /All facilities/.test(await pete.textContent()));
ok('Dana is Staff with her facility by name', /Staff/.test(await dana.textContent()) && /Flynn Rink/.test(await dana.textContent()) && !/Conway/.test(await dana.textContent()));
ok('Pete\'s last sign-in is today; Dana has never signed in', /last signed in Today/.test(await pete.textContent()) && /never signed in/.test(await dana.textContent()));
ok('Alex is marked Removed and offers Restore, not Remove', /Removed/.test(await alex.textContent()) && !!(await alex.$('[data-back]')) && !(await alex.$('[data-ask]')));
ok('nobody can remove themselves from here', !(await pete.$('[data-ask]')) && !!(await dana.$('[data-ask]')));
ok('the shared codes say they have not been changed since setup', /Not changed since setup/.test(await text(p, '#accessWhen')) && /Not changed since setup/.test(await text(p, '#editingWhen')));
const s0 = await stamps();

/* ---- add a person ------------------------------------------------------------------------- */
await p.click('#addPerson');
ok('Add staff opens a form in the page, with the facilities to choose from', !!(await p.$('#personForm')) && (await p.$$('#pFacs .pfac')).length === 2 && /Admins cover all/.test(await text(p, '#pFacs legend')));
await p.click('#pSave'); await sleep(300);
ok('no name is refused, in the page', /A name is needed/.test(await text(p, '#staffMsg')) && (await names(p)).length === 3);
await p.click('#addPerson'); await p.fill('#pName', 'Jordan <b id="boom">X</b>');
await p.check('#pFacs .pfac[value="f2"]'); await p.click('#pSave'); await sleep(1500);
const sh = await shown(p);
ok('the new code is shown, once, with what to do with it', /Added Jordan/.test(sh.title) && ALPHA.test(sh.code || '') && /will not be shown again/.test(await text(p, '#revealBanner')), JSON.stringify(sh));
ok('a name that looks like markup is shown as text', !(await p.$('#boom')) && (await names(p)).some(n => n.includes('<b id="boom">')));
const jLogin = await loginOf(p, 'Jordan <b id="boom">X</b>'), jCode = sh.code;
ok('the person is in the list with the facility they were given', /Flynn Rink/.test(await (await cardOf(p, jLogin)).textContent()) && /never signed in/.test(await (await cardOf(p, jLogin)).textContent()));
ok('and the code really signs them in', await canSignIn(jLogin, jCode));
await p.click('#revealDone'); await sleep(300);
ok('Done takes the code off the screen', !(await p.$('#revealBanner')) && !(await p.evaluate(c => document.body.textContent.includes(c), jCode)));
await p.reload(); await p.waitForSelector('#peopleList'); await sleep(500);
const store = await p.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), location.href, document.cookie]));
ok('and it is nowhere on the device: not on the page after a reload, not in storage, not in the address', !(await p.evaluate(c => document.body.textContent.includes(c), jCode)) && !store.includes(jCode));
ok('adding wrote no record', s0 === await stamps());

/* the new person at a real gate */
const J = await k.device(b, 1280);
await J.p.goto(B + '/index.html'); await k.signInAs(J.p, jLogin, jCode);
ok('Jordan signs in at the gate with it and sees only Flynn', /Flynn Rink/.test(await text(J.p, '#page')) && !/Conway/.test(await text(J.p, '#page')));
await J.p.goto(B + '/index.html' + STAFF); await J.p.waitForSelector('#page .screen'); await sleep(600);
ok('and cannot open the Staff page, even by address', /That page is not available/.test(await text(J.p, '#page .notice')) && !(await J.p.$('#pageStaff')));
await J.p.click('#acctMenu');
ok('nor is there a Staff item in their menu', !(await J.p.$$eval('.dropdown .it', e => e.map(x => x.textContent))).includes('Staff'));
await J.ctx.close();
await open(p);
ok('after that, the list says when Jordan last signed in', /last signed in Today/.test(await (await cardOf(p, jLogin)).textContent()));

/* ---- reset a code ---------------------------------------------------------------------------- */
await p.click('[data-reset="dana"]'); await sleep(1500);
const rs = await shown(p);
ok('Reset code shows a new code for that person', /New code for Dana/.test(rs.title) && ALPHA.test(rs.code || ''), JSON.stringify(rs));
ok('their old code no longer works and the new one does', !(await canSignIn('dana', 'dana-code-1')) && await canSignIn('dana', rs.code));
ok('nobody else\'s changed', await canSignIn('pete', 'pete-code-1'));
await p.click('#revealDone');

/* ---- remove, and the confirmation ---------------------------------------------------------------- */
await p.click('[data-ask="dana"]'); await sleep(200);
ok('Remove asks first, in the page, naming the person', /Switch off Dana.s code\?/.test(await text(p, '.pcard[data-login="dana"]')) && !!(await p.$('#rmYes')));
await p.click('#rmNo'); await sleep(300);
ok('Keep changes nothing', /Active/.test(await (await cardOf(p, 'dana')).textContent()) && !!(await p.$('[data-ask="dana"]')));
await p.click('[data-ask="dana"]'); await p.click('#rmYes'); await sleep(1500);
ok('Yes removes her, and says her code stops working', /Removed/.test(await (await cardOf(p, 'dana')).textContent()) && /no longer works/.test(await text(p, '#toast')));
ok('the code stops working at once', !(await canSignIn('dana', rs.code)));
ok('and the name stays on the list for the history', (await names(p)).includes('Dana'));

/* ---- restore ---------------------------------------------------------------------------------------- */
await p.click('[data-back="dana"]'); await sleep(2000);
const rt = await shown(p);
ok('Restore gives a new code, not the old one', /Restored Dana/.test(rt.title) && ALPHA.test(rt.code || '') && rt.code !== rs.code, JSON.stringify(rt));
ok('which works, and she is active again', await canSignIn('dana', rt.code) && /Active/.test(await (await cardOf(p, 'dana')).textContent()));
ok('while the code she had before she was removed does not', !(await canSignIn('dana', rs.code)) && !(await canSignIn('dana', 'dana-code-1')));
await p.click('#revealDone');

/* ---- edit ---------------------------------------------------------------------------------------------- */
await p.click('[data-edit="dana"]'); await sleep(300);
ok('Edit opens the same form, filled in', await p.inputValue('#pName') === 'Dana' && await p.isChecked('#pFacs .pfac[value="f2"]') && !(await p.isChecked('#pFacs .pfac[value="f1"]')) && /Save changes/.test(await text(p, '#pSave')));
await p.fill('#pName', 'Dana R'); await p.check('#pFacs .pfac[value="f1"]'); await p.click('#pSave'); await sleep(1500);
ok('Save changes renames her and gives her Conway too', /Dana R/.test(await text(p, '#peopleList')) && /Conway Arena, Flynn Rink|Flynn Rink, Conway Arena/.test(await (await cardOf(p, 'dana')).textContent()));
ok('with no code shown, since nothing about her sign-in changed', !(await p.$('#revealBanner')));
const D = await k.device(b, 1280);
await D.p.goto(B + '/index.html'); await k.signInAs(D.p, 'dana', rt.code);
ok('and she now sees both facilities when she signs in', /Conway Arena/.test(await text(D.p, '#page')) && /Flynn Rink/.test(await text(D.p, '#page')));
await D.ctx.close();
await open(p);
await p.click('[data-edit="pete"]'); await p.selectOption('#pRole', 'staff'); await p.click('#pSave'); await sleep(1500);
ok('the last Admin cannot be made Staff: the server\'s answer is shown', /no Admin/.test(await text(p, '#staffMsg')), await text(p, '#staffMsg'));
ok('and nothing changed', /Admin/.test(await (await cardOf(p, 'pete')).textContent()));
await p.click('#pCancel').catch(() => {});
const self = await p.evaluate(() => Sync.manage('remove', { login: 'pete' }));
ok('and the server refuses a person removing themselves, whatever the page does', self.ok === false && /cannot remove yourself/.test(self.error), JSON.stringify(self));

/* a second Manager makes the first removable */
await open(p);
await p.click('#addPerson'); await p.fill('#pName', 'Casey'); await p.selectOption('#pRole', 'admin'); await sleep(200);
ok('a Manager needs no facilities: the list is greyed', await p.$eval('#pFacs', f => f.disabled));
await p.click('#pSave'); await sleep(1500);
const cLogin = await loginOf(p, 'Casey'); await p.click('#revealDone');
ok('Casey is an Admin with all facilities', /Admin/.test(await (await cardOf(p, cLogin)).textContent()) && /All facilities/.test(await (await cardOf(p, cLogin)).textContent()));
await p.click('[data-edit="pete"]'); await p.selectOption('#pRole', 'staff'); await p.click('#pSave'); await sleep(1500);
const allStaff = async () => (await (await fetch(B + '/__staff', { method: 'POST', body: JSON.stringify({}) })).json());
ok('with a second Manager, the first can be made Staff', (await allStaff()).find(x => x.id === 'pete').role === 'staff');
ok('and, now Staff, his next request is refused by the server, which the page says', /Only Managers and Admins can do this/.test(await text(p, '#staffMsg')), await text(p, '#staffMsg'));
await p.reload(); await sleep(2500);
ok('and after a reload he is turned away from the page', /That page is not available/.test(await text(p, '#page .notice')) && !(await p.$('#pageStaff')), await text(p, '#page'));
await M.ctx.close();

/* ---- the shared codes ----------------------------------------------------------------------------------------- */
await fetch(B + '/__reset');
await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });
await k.addStaff({ id: 'dana', name: 'Dana', role: 'staff', code: 'dana-code-1', facilities: ['f2'] });
await k.ctl('tight=1'); await k.seed(k.PETE);
const C = await k.device(b, 1280);
await C.p.goto(B + '/index.html'); await k.signInAs(C.p, 'pete', 'pete-code-1');
await open(C.p);
await C.p.click('#chgAccess');
ok('changing the access code asks first, and says what it does', /signed out until they enter the new code/.test(await text(C.p, '#sharedCodes')) && !!(await C.p.$('#accessYes')));
await C.p.click('#accessNo'); await sleep(200);
ok('Keep changes nothing', /Not changed since setup/.test(await text(C.p, '#accessWhen')) && !!(await C.p.$('#chgAccess')) && await (async () => (await (await fetch(B + '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: 'operations@conwayarena.local', password: ACCESS }) })).ok))());
await C.p.click('#chgAccess'); await C.p.click('#accessYes'); await sleep(1500);
const ac = await shown(C.p);
ok('Yes shows a new access code, once', /New access code/.test(ac.title) && ALPHA.test(ac.code || ''), JSON.stringify(ac));
const dev = async pw => (await fetch(B + '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: 'operations@conwayarena.local', password: pw }) })).ok;
ok('the old access code is refused and the new one works', !(await dev(ACCESS)) && await dev(ac.code));
ok('the page says when it was changed', /Last changed Today/.test(await text(C.p, '#accessWhen')), await text(C.p, '#accessWhen'));
ok('and the editing code is untouched', /Not changed since setup/.test(await text(C.p, '#editingWhen')));
await C.p.click('#revealDone');
await C.p.click('#chgEdit');
ok('the editing code asks first as well', /open editing window ends/.test(await text(C.p, '#sharedCodes')));
await C.p.click('#editingYes'); await sleep(1500);
const ec = await shown(C.p);
ok('Yes shows a new editing code', /New editing code/.test(ec.title) && ALPHA.test(ec.code || ''), JSON.stringify(ec));
const unl = c => C.p.evaluate(x => Sync.unlockEditing(x), c);
ok('the old editing code no longer opens a window, and the new one does', !(await unl(k.EDIT)).ok && (await unl(ec.code)).ok);
ok('the editing code is on the page once and nowhere else', !(await C.p.evaluate(() => JSON.stringify([Object.entries(localStorage), location.href]))).includes(ec.code));
await C.p.click('#revealDone'); await C.p.reload(); await C.p.waitForSelector('#peopleList'); await sleep(500);
ok('after a reload both say when they were changed', /Last changed Today/.test(await text(C.p, '#accessWhen')) && /Last changed Today/.test(await text(C.p, '#editingWhen')));

/* ---- codes chosen by hand ------------------------------------------------------------------------------------------ */
await open(C.p);
await C.p.click('[data-setcode="dana"]');
ok('Set code asks for a code, in the page', !!(await C.p.$('#ownCode')) && !!(await C.p.$('#ownYes')) && !!(await C.p.$('#ownNo')));
await C.p.fill('#ownCode', 'short'); await C.p.click('#ownYes'); await sleep(400);
ok('a code that is too short is refused in the page, and nothing changes', /at least 8/.test(await text(C.p, '#staffMsg')) && await canSignIn('dana', 'dana-code-1'));
await C.p.fill('#ownCode', 'blue otter lamp 42'); await C.p.click('#ownYes'); await sleep(1500);
const own = await shown(C.p);
ok('a code of her own choosing is set, and shown once', /New code for Dana/.test(own.title) && own.code === 'blue otter lamp 42', JSON.stringify(own));
ok('it signs her in, and the old one no longer does', await canSignIn('dana', 'blue otter lamp 42') && !(await canSignIn('dana', 'dana-code-1')));
await C.p.click('#revealDone');
await C.p.click('#addPerson'); await C.p.fill('#pName', 'Eli'); await C.p.fill('#pCode', 'abc'); await C.p.check('#pFacs .pfac[value="f2"]'); await C.p.click('#pSave'); await sleep(400);
ok('a person added with a code that is too short is refused inside the form, which keeps what was typed', /at least 8/.test(await text(C.p, '#pNote')) && await C.p.inputValue('#pName') === 'Eli' && await C.p.isChecked('#pFacs .pfac[value="f2"]'));
await C.p.fill('#pCode', 'pine marten ridge'); await C.p.click('#pSave'); await sleep(1500);
const eli = await loginOf(C.p, 'Eli');
ok('and added with one, that code signs them in', /Added Eli/.test((await shown(C.p)).title) && await canSignIn(eli, 'pine marten ridge'));
await C.p.click('#revealDone');
await C.p.click('#chgAccess'); await C.p.fill('#accessOwn', 'a code I made up'); await C.p.click('#accessYes'); await sleep(1500);
ok('the access code can be one you choose', await dev('a code I made up') && !(await dev(ac.code)) && /New access code/.test((await shown(C.p)).title));
await C.p.click('#revealDone');
await C.p.click('#chgEdit'); await C.p.fill('#editingOwn', 'short'); await C.p.click('#editingYes'); await sleep(400);
ok('and the editing code too, but not a short one', /at least 8/.test(await text(C.p, '#staffMsg')) && (await unl(ec.code)).ok);
await C.p.fill('#editingOwn', 'my own editing code'); await C.p.click('#editingYes'); await sleep(1500);
ok('which then opens a window, and the old one does not', !(await unl(ec.code)).ok && (await unl('my own editing code')).ok);
await C.p.click('#revealDone');
await C.p.click('#setEdit'); await C.p.click('#editingYes'); await sleep(400);
ok('Set code… on the editing code needs a code typed and changes nothing without one', /at least 8/.test(await text(C.p, '#staffMsg')) && (await unl('my own editing code')).ok);
await C.p.fill('#editingOwn', 'typed via set code'); await C.p.click('#editingYes'); await sleep(1500);
ok('and with one, it takes effect', !(await unl('my own editing code')).ok && (await unl('typed via set code')).ok);
await C.p.click('#revealDone');
await C.p.click('#setAccess'); await C.p.fill('#accessOwn', 'set access code 77'); await C.p.click('#accessYes'); await sleep(1500);
ok('Set code… on the access code too', await dev('set access code 77') && !(await dev('a code I made up')));
await C.p.click('#revealDone');

/* ---- activity ------------------------------------------------------------------------------------------------------ */
const dTok = await k.login('dana' + DOM, 'blue otter lamp 42');      // the code chosen by hand above
await fetch(B + '/rest/v1/rpc/unlock_editing', { method: 'POST', headers: k.H ? k.H(dTok) : { Authorization: 'Bearer ' + dTok, 'Content-Type': 'application/json', apikey: 'test' }, body: JSON.stringify({ code: 'typed via set code' }) });      // the last one chosen by hand above
const hd = { Authorization: 'Bearer ' + dTok, 'Content-Type': 'application/json', apikey: 'test' };
const w = await fetch(B + '/rest/v1/records?on_conflict=kind,id', { method: 'POST', headers: hd, body: JSON.stringify([{ kind: 'glass_panel', id: 's2:045', deleted: false, body: { fac: 'f2', status: 'replace', note: '' } }]) });
ok('(setup) Dana made a change under her own name', w.ok);
await open(C.p, 'Activity');
const log = await text(C.p, '#actLog');
ok('Activity lists what was done, newest first, with who and where', /Dana/.test(await text(C.p, '#actLog .e')) && /Set panel 045 to Needs replacement/.test(log) && /Flynn Rink \/ Glass/.test(log), log.slice(0, 200));
ok('and the earlier work from Pete: a sheet added, a round logged', /Added a sheet called Main/.test(log) && /Logged a round, moderate, 2 readings/.test(log));
const filters = await C.p.$$eval('[data-fl]', e => e.map(x => x.textContent));
ok('a filter per person who appears, and Everyone', filters.join() === 'Everyone,Dana,Pete', filters.join());
await C.p.click('[data-fl="Dana"]'); await sleep(200);
ok('filtering to Dana shows only hers', (await C.p.$$('#actLog .e')).length === 1 && /Dana/.test(await text(C.p, '#actLog')) && !/Pete/.test(await text(C.p, '#actLog')));
await C.p.click('[data-fl="all"]');
ok('Everyone shows them all again', (await C.p.$$('#actLog .e')).length > 3);
await C.p.click('#tabPeople'); await sleep(1500);
ok('the tabs go back and forth', !!(await C.p.$('#peopleList')));

/* looking, and managing, write no record --------------------------------------------------------------------------------- */
const s1 = await stamps();
await open(C.p); await open(C.p, 'Activity'); await open(C.p);
await C.p.evaluate(() => Sync.sync('t')); await sleep(1500);
ok('opening the page, and its tabs, restamps nothing', s1 === await stamps());
await C.ctx.close();

await k.done(b);
})();
