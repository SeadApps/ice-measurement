/* Three roles: Admin, Manager and Staff.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/rolestest.js

   An Admin does everything. A Manager is scoped to the facilities they were given, like Staff, and in them changes
   settings and sheets, resolves flags, reads the change log and looks after their own Staff. Only an Admin adds, hides
   or restores a facility, changes anyone's role, touches the shared codes, or backs up and restores.

   The first half talks to the server the way a modified page would (records, the change log and the manage-staff
   function). The second half signs in as each role and looks at what the pages offer. */
const k = require('./shellkit');
const { ok, sleep, B, DOM, EDIT, text } = k;

const H = t => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
const send = (t, list) => fetch(B + '/rest/v1/records?on_conflict=kind,id', { method: 'POST', headers: H(t), body: JSON.stringify(list) });
const read = async t => (await (await fetch(B + '/rest/v1/records?select=*', { headers: H(t) })).json());
const rpc = (t, fn, body) => fetch(B + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H(t), body: JSON.stringify(body || {}) });
const log = (t, q) => fetch(B + '/rest/v1/activity?select=*' + (q || ''), { headers: H(t) });
const manage = async (t, body) => { const r = await fetch(B + '/functions/v1/manage-staff', { method: 'POST', headers: H(t), body: JSON.stringify(body) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const rec = (kind, id, fac, extra) => ({ kind, id, deleted: false, body: Object.assign({ id }, fac ? { fac } : {}, extra || {}) });
const unlock = t => rpc(t, 'unlock_editing', { code: EDIT });
/* A change made in a page reaches the server a moment later, when the page syncs: wait for it rather than guess. */
const eventually = async (fn, ms) => { const end = Date.now() + (ms || 10000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(300); } };
const msg = async r => (await r.json().catch(() => ({}))).message || '';

(async () => {
await fetch(B + '/__reset');
await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });
await k.addStaff({ id: 'gwen', name: 'Gwen', role: 'manager', code: 'gwen-code-1', facilities: ['f1'] });
await k.addStaff({ id: 'max', name: 'Max', role: 'manager', code: 'max-code-1', facilities: ['f2'] });
await k.addStaff({ id: 'dee', name: 'Dee', role: 'staff', code: 'dee-code-1', facilities: ['f1'] });
await k.addStaff({ id: 'flo', name: 'Flo', role: 'staff', code: 'flo-code-1', facilities: ['f2'] });
await k.addStaff({ id: 'cam', name: 'Cam', role: 'staff', code: 'cam-code-1', facilities: ['f1', 'f2'] });
await k.ctl('tight=1');
await k.seed(k.PETE);
const tok = {};
for (const [id, code] of [['pete', 'pete-code-1'], ['gwen', 'gwen-code-1'], ['max', 'max-code-1'], ['dee', 'dee-code-1'], ['flo', 'flo-code-1'], ['cam', 'cam-code-1']]) { tok[id] = await k.login(id + DOM, code); await unlock(tok[id]); }

/* ---- what each role reads ------------------------------------------------------------------------------------ */
const ids = async t => (await read(t)).map(r => r.kind + ' ' + r.id);
const petes = await ids(tok.pete), gwens = await ids(tok.gwen);
ok('an Admin reads both facilities', petes.includes('facility f1') && petes.includes('facility f2'));
ok('a Manager reads their own facility and its sheets and rounds', ['facility f1', 'sheet s1', 'session z1'].every(i => gwens.includes(i)), gwens.join());
ok('and nothing of another facility', !gwens.some(i => /f2|s2|s3|z3|z4/.test(i)), gwens.join());

/* ---- what a Manager writes ----------------------------------------------------------------------------------- */
ok('a Manager changes their own facility\'s settings', (await send(tok.gwen, [rec('facility', 'f1', 'f1', { name: 'Conway Arena', settings: { target: 1.5 } })])).ok);
const newFac = await send(tok.gwen, [rec('facility', 'f9', 'f1', { name: 'Sneaky' })]);
ok('but cannot make a facility, even tagged as their own', newFac.status === 403 && /Admin/.test(await msg(newFac)));
const otherFac = await send(tok.gwen, [rec('facility', 'f2', 'f2', { name: 'Flynn Rink', settings: { target: 9 } })]);
ok('nor change another facility\'s settings', otherFac.status === 403 && /not your facility/.test(await msg(otherFac)));
const hide = await send(tok.gwen, [Object.assign(rec('facility', 'f1', 'f1', { name: 'Conway Arena' }), { deleted: true })]);
ok('nor hide their own facility', hide.status === 403 && /Admin/.test(await msg(hide)));
ok('an Admin hides a facility', (await send(tok.pete, [Object.assign(rec('facility', 'f1', 'f1', { name: 'Conway Arena' }), { deleted: true })])).ok);
const back = await send(tok.gwen, [rec('facility', 'f1', 'f1', { name: 'Conway Arena' })]);
ok('and a Manager cannot bring it back', back.status === 403 && /Admin/.test(await msg(back)));
ok('an Admin does', (await send(tok.pete, [rec('facility', 'f1', 'f1', { name: 'Conway Arena', settings: { target: 1.5 } })])).ok);

ok('a Manager adds a sheet to their facility', (await send(tok.gwen, [rec('sheet', 's9', 'f1', { facilityId: 'f1', name: 'Practice' })])).ok);
ok('renames it', (await send(tok.gwen, [rec('sheet', 's9', 'f1', { facilityId: 'f1', name: 'Practice 2' })])).ok);
ok('hides it', (await send(tok.gwen, [Object.assign(rec('sheet', 's9', 'f1', { facilityId: 'f1', name: 'Practice 2' }), { deleted: true })])).ok);
ok('and brings it back', (await send(tok.gwen, [rec('sheet', 's9', 'f1', { facilityId: 'f1', name: 'Practice 2' })])).ok);
const intoOther = await send(tok.gwen, [rec('sheet', 's8', 'f2', { facilityId: 'f2', name: 'Elsewhere' })]);
ok('but not a sheet in another facility', intoOther.status === 403);
const retag = await send(tok.gwen, [rec('sheet', 's2', 'f1', { facilityId: 'f1', name: 'Stolen' })]);
ok('nor take another facility\'s sheet by re-tagging it', retag.status === 403, String(retag.status));
const loose = await send(tok.gwen, [rec('note', 'loose', null, { n: 1 })]);
ok('and writes nothing untagged', loose.status === 403 && /Admin only/.test(await msg(loose)));
const staffSheet = await send(tok.dee, [rec('sheet', 's7', 'f1', { facilityId: 'f1', name: 'Nope' })]);
ok('Staff still cannot write a sheet or a facility', staffSheet.status === 403 && /Managers and Admins/.test(await msg(staffSheet)));

/* ---- flags ----------------------------------------------------------------------------------------------------- */
ok('Staff raise a flag', (await send(tok.dee, [rec('flag', 'fl1', 'f1', { status: 'open', sheetId: 's1' })])).ok);
ok('a Manager resolves it', (await send(tok.gwen, [rec('flag', 'fl1', 'f1', { status: 'resolved', sheetId: 's1' })])).ok);
ok('and reopens it', (await send(tok.gwen, [rec('flag', 'fl1', 'f1', { status: 'open', sheetId: 's1' })])).ok);
ok('Staff cannot resolve one', (await send(tok.dee, [rec('flag', 'fl1', 'f1', { status: 'resolved', sheetId: 's1' })])).status === 403);
ok('a Manager cannot resolve another facility\'s flag', (await send(tok.flo, [rec('flag', 'fl2', 'f2', { status: 'open', sheetId: 's2' })])).ok && (await send(tok.gwen, [rec('flag', 'fl2', 'f2', { status: 'resolved', sheetId: 's2' })])).status === 403);

/* ---- the change log -------------------------------------------------------------------------------------------- */
const seenBy = async t => (await (await log(t)).json());
const gl = await log(tok.gwen), gRows = gl.ok ? await gl.json() : [];
ok('a Manager reads the change log', gl.status === 200 && gRows.length > 0);
ok('only for their own facility', gRows.every(r => r.facility_id === 'f1'), JSON.stringify([...new Set(gRows.map(r => r.facility_id))]));
const dl = await log(tok.dee);
ok('Staff do not read it', dl.status === 403);
const pl = await seenBy(tok.pete);
ok('an Admin reads all of it, both facilities', new Set(pl.map(r => r.facility_id)).has('f1') && new Set(pl.map(r => r.facility_id)).has('f2'));

/* ---- people: what an Admin does --------------------------------------------------------------------------------- */
const pList = await manage(tok.pete, { action: 'list' });
ok('an Admin lists everyone, and all of them are theirs to change', pList.status === 200 && pList.people.length === 6 && pList.people.every(p => p.editable));
ok('an Admin has no facilities of their own to list; a Manager has theirs', pList.people.find(p => p.login === 'pete').facilities.length === 0 && pList.people.find(p => p.login === 'gwen').facilities.join() === 'f1');
const addMgr = await manage(tok.pete, { action: 'add', name: 'Ira', role: 'manager', facilities: ['f2'] });
ok('an Admin adds a Manager with a facility', addMgr.status === 200 && !!addMgr.code);
const iraList = (await manage(tok.pete, { action: 'list' })).people.find(p => p.login === addMgr.login);
ok('who is a Manager for that facility', iraList.role === 'manager' && iraList.facilities.join() === 'f2');
const addAdm = await manage(tok.pete, { action: 'add', name: 'Una', role: 'admin', facilities: ['f1'] });
ok('an Admin adds another Admin, who has no facility list (they cover all)', addAdm.status === 200 && (await manage(tok.pete, { action: 'list' })).people.find(p => p.login === addAdm.login).facilities.length === 0);
ok('an Admin changes a Staff person into a Manager', (await manage(tok.pete, { action: 'update', login: 'dee', role: 'manager' })).status === 200 && (await manage(tok.pete, { action: 'list' })).people.find(p => p.login === 'dee').role === 'manager');
ok('and back', (await manage(tok.pete, { action: 'update', login: 'dee', role: 'staff' })).status === 200);
const codes = await manage(tok.pete, { action: 'codes' });
ok('an Admin reads when the shared codes changed', codes.status === 200 && 'access' in codes && 'editing' in codes);
ok('Una (an Admin) can be removed, there being another', (await manage(tok.pete, { action: 'remove', login: addAdm.login })).status === 200);
const lastDemote = await manage(tok.pete, { action: 'update', login: 'pete', role: 'staff' });
ok('but the last Admin cannot be made Staff', lastDemote.status === 409 && /no Admin/.test(lastDemote.error), JSON.stringify(lastDemote));
const lastRemove = await manage(tok.pete, { action: 'remove', login: 'pete' });
ok('or removed', lastRemove.status === 409);

/* ---- people: what a Manager does -------------------------------------------------------------------------------- */
const gList = await manage(tok.gwen, { action: 'list' });
const gNames = (gList.people || []).map(p => p.login).sort().join();
ok('a Manager lists the Staff in their facility, and nobody else (no Admin, no other Manager, nobody only elsewhere)', gList.status === 200 && gNames === 'cam,dee', gNames);
ok('those who are only theirs are theirs to change; one who is also elsewhere is not', gList.people.find(p => p.login === 'dee').editable === true && gList.people.find(p => p.login === 'cam').editable === false);
const gAdd = await manage(tok.gwen, { action: 'add', name: 'Ned', facilities: ['f1'] });
ok('a Manager adds Staff to their facility, and the code is shown once', gAdd.status === 200 && !!gAdd.code && !!(await k.login(gAdd.login + DOM, gAdd.code)));
ok('the new person is Staff, in that facility only', (await manage(tok.pete, { action: 'list' })).people.find(p => p.login === gAdd.login).role === 'staff');
const asMgr = await manage(tok.gwen, { action: 'add', name: 'Pat', role: 'manager', facilities: ['f1'] });
ok('a Manager cannot add a Manager', asMgr.status === 403 && /Admin/.test(asMgr.error));
const asAdm = await manage(tok.gwen, { action: 'add', name: 'Pip', role: 'admin', facilities: ['f1'] });
ok('or an Admin', asAdm.status === 403);
ok('or give someone a facility that is not theirs', (await manage(tok.gwen, { action: 'add', name: 'Quin', facilities: ['f2'] })).status === 403 && (await manage(tok.gwen, { action: 'add', name: 'Quin', facilities: ['f1', 'f2'] })).status === 403);
ok('or add someone with no facility', (await manage(tok.gwen, { action: 'add', name: 'Quin', facilities: [] })).status === 400);
ok('a Manager renames their Staff', (await manage(tok.gwen, { action: 'update', login: 'dee', name: 'Dee Dee' })).status === 200);
ok('but cannot change a role', (await manage(tok.gwen, { action: 'update', login: 'dee', role: 'manager' })).status === 403);
ok('or move them to a facility that is not theirs', (await manage(tok.gwen, { action: 'update', login: 'dee', facilities: ['f2'] })).status === 403);
const camUp = await manage(tok.gwen, { action: 'update', login: 'cam', name: 'Cam X' });
ok('or touch someone who is also in another facility', camUp.status === 403 && /your own facilities/.test(camUp.error), JSON.stringify(camUp));
ok('or see someone who is not in theirs', (await manage(tok.gwen, { action: 'update', login: 'flo', name: 'Flo X' })).status === 404 && (await manage(tok.gwen, { action: 'reset_code', login: 'flo' })).status === 404);
ok('or a Manager, or an Admin, or themselves', (await manage(tok.gwen, { action: 'update', login: 'max', name: 'M' })).status === 404 && (await manage(tok.gwen, { action: 'update', login: 'pete', name: 'P' })).status === 404 && (await manage(tok.gwen, { action: 'update', login: 'gwen', role: 'admin' })).status === 404);
const oldDee = 'dee-code-1', reset = await manage(tok.gwen, { action: 'reset_code', login: 'dee' });
ok('a Manager resets their Staff\'s code, and the old one stops working', reset.status === 200 && !!reset.code && !(await k.login('dee' + DOM, oldDee)) && !!(await k.login('dee' + DOM, reset.code)));
ok('but not someone who is also elsewhere', (await manage(tok.gwen, { action: 'reset_code', login: 'cam' })).status === 403);
ok('a Manager removes their Staff, who is then signed out', (await manage(tok.gwen, { action: 'remove', login: 'dee' })).status === 200 && !(await k.login('dee' + DOM, reset.code)));
ok('and restores them', (await manage(tok.gwen, { action: 'restore', login: 'dee' })).status === 200);
ok('but not someone who is also elsewhere', (await manage(tok.gwen, { action: 'remove', login: 'cam' })).status === 403);
ok('a Manager cannot read or change the shared codes', (await manage(tok.gwen, { action: 'codes' })).status === 403 && (await manage(tok.gwen, { action: 'set_access_code', code: 'new-access-code' })).status === 403 && (await manage(tok.gwen, { action: 'set_editing_code', code: 'new-editing-code' })).status === 403);
const sList = await manage(tok.dee, { action: 'list' });
ok('Staff cannot use the manage-staff function at all', sList.status === 403 && /Managers and Admins/.test(sList.error));

/* ---- the pages ---------------------------------------------------------------------------------------------------- */
const b = await k.chromium.launch();
const as = async (id, code, role, hash, width) => { const D = await k.device(b, width || 1280); await D.p.goto(B + '/index.html' + (hash || '')); await k.signInAs(D.p, id, code); await D.p.waitForFunction(r => Sync.role() === r, role, { timeout: 10000 }); return D; };
const menu = async p => { await p.click('#acctMenu'); await sleep(250); const t = await p.$$eval('.dropdown .it', e => e.map(x => x.textContent)); await p.keyboard.press('Escape'); await sleep(150); return t; };

const G = await as('gwen', 'gwen-code-1', 'manager');
const gp = G.p;
await sleep(800);
const q = await gp.evaluate(() => ({ role: Sync.role(), admin: Sync.isAdmin(), restore: Sync.canRestore(), backup: Sync.canBackup(), f1: Sync.canManage('f1'), f2: Sync.canManage('f2'), any: Sync.canManage(), see2: Sync.canSee('f2') }));
ok('a Manager is a Manager, not an Admin, and manages their facility and no other', q.role === 'manager' && !q.admin && q.f1 && !q.f2 && q.any && !q.see2, JSON.stringify(q));
ok('and may neither back up nor restore', !q.restore && !q.backup);
const gMenu = await menu(gp);
ok('the account menu has Staff, and no backup or restore', gMenu.includes('Staff') && !gMenu.some(t => /Back up|Restore/.test(t)), gMenu.join('|'));
const gPage = await text(gp, '#page');
ok('the Facilities page shows their facility and not another', /Conway Arena/.test(gPage) && !/Flynn Rink/.test(gPage));
ok('and no Add facility button', !(await gp.$('#addFac')));
ok('the rail has all of Quality review and Staff', await gp.evaluate(() => ['changes', 'state', 'flags', 'reports'].every(v => !!document.querySelector('#rail a[href="#/review/' + v + '"]')) && !!document.querySelector('#rail a[href="#/staff"]')));
await gp.evaluate(c => Sync.unlockEditing(c), EDIT); await sleep(1200);

await gp.goto(B + '/index.html#/f/f1'); await gp.waitForSelector('#pageSheets'); await sleep(600);
ok('the Sheets page offers Add sheet', !!(await gp.$('#addSheet')));
ok('and no Remove facility', !(await gp.$('#removeFacZone')));
await gp.click('#addSheet'); await gp.fill('#addName', 'Warm-up'); await gp.click('#addGo'); await sleep(800);
const madeSheet = await eventually(async () => (await k.rows()).find(r => r.kind === 'sheet' && r.body.name === 'Warm-up'));
ok('a Manager adds a sheet through the page, tagged to their facility', !!madeSheet && madeSheet.body.fac === 'f1' && madeSheet.changed_by_name === 'Gwen', JSON.stringify(madeSheet && madeSheet.body));
await gp.goto(B + '/index.html#/f/f1/s/' + (madeSheet ? madeSheet.id : 's1') + '/settings'); await gp.waitForSelector('#pageSettings'); await sleep(600);
ok('its settings page is editable and offers Remove sheet', !(await gp.$('#viewOnly')) && !!(await gp.$('#removeZone')));
await gp.click('#dask'); await gp.click('#dyes'); await sleep(800);
ok('a Manager removes it, and the server accepted that', await eventually(async () => ((await k.rows()).find(r => r.id === (madeSheet && madeSheet.id)) || {}).deleted === true));

await gp.goto(B + '/index.html#/staff'); await gp.waitForSelector('#pageStaff'); await gp.waitForSelector('#peopleList'); await sleep(600);
const gStaffNames = await gp.$$eval('#peopleList .pname', e => e.map(x => x.firstChild.textContent).sort().join());
ok('the Staff page lists the people in their facility only', gStaffNames === 'Cam,Dee Dee,Ned', gStaffNames);
ok('and no shared codes on it', !(await gp.$('#sharedCodes')));
ok('Cam, who is also in another facility, is shown but locked', !!(await gp.$('.pcard[data-login="cam"] [data-locked]')) && !(await gp.$('.pcard[data-login="cam"] [data-edit]')));
ok('Dee can be edited, reset and removed', !!(await gp.$('.pcard[data-login="dee"] [data-edit]')) && !!(await gp.$('.pcard[data-login="dee"] [data-reset]')) && !!(await gp.$('.pcard[data-login="dee"] [data-ask]')));
await gp.click('#addPerson');
ok('the add form has no role to choose, and only their own facilities', !(await gp.$('#pRole')) && (await gp.$$('#pFacs .pfac')).length === 1);
await gp.fill('#pName', 'Rae'); await gp.click('#pSave'); await sleep(300);
ok('with no facility ticked the server says to pick one, in the page', /at least one/.test(await text(gp, '#staffMsg')));
await gp.click('#addPerson'); await gp.fill('#pName', 'Rae'); await gp.check('#pFacs .pfac[value="f1"]'); await gp.click('#pSave'); await sleep(1500);
ok('and with one ticked they are added, and the code is shown once', /Added Rae/.test(await text(gp, '#revealBanner')) && /Rae/.test(await text(gp, '#peopleList')));
await gp.goto(B + '/index.html#/review/changes'); await gp.waitForSelector('#pageReview'); await sleep(2500);
ok('Changes opens for a Manager, with their facility\'s changes', /Changes/.test(await text(gp, '#pageReview h2')) && !/Flynn/.test(await text(gp, '#pageReview')));

/* Ice: the preferences are theirs to change; the backup is not */
await gp.goto(B + '/ice.html#/f/f1/s/s1/prefs'); await gp.waitForSelector('#prefsPage.on'); await sleep(1500);
ok('Preferences are not read only for a Manager of that facility', !(await gp.isDisabled('#targetIn')) && !(await gp.isVisible('#prefRo')));
ok('and there is no backup section', !(await gp.isVisible('#backupSec')));
await G.ctx.close();

/* Staff: unchanged */
const S = await as('dee', reset.code, 'staff');
const sp = S.p;
const sq = await sp.evaluate(() => ({ role: Sync.role(), manage: Sync.canManage(), admin: Sync.isAdmin() }));
ok('Staff are Staff: they manage nothing and are not Admins', sq.role === 'staff' && !sq.manage && !sq.admin, JSON.stringify(sq));
const sMenu = await menu(sp);
ok('their menu has no Staff and no backup', !sMenu.includes('Staff') && !sMenu.some(t => /Back up|Restore/.test(t)), sMenu.join('|'));
await sp.goto(B + '/index.html#/staff'); await sleep(1200);
ok('the Staff page is not available to them, even by address', !(await sp.$('#pageStaff')));
await S.ctx.close();

/* An Admin: everything, and the form has the three roles */
const P = await as('pete', 'pete-code-1', 'admin', '#/staff');
const pp = P.p;
await pp.waitForSelector('#peopleList'); await sleep(500);
const pq = await pp.evaluate(() => ({ role: Sync.role(), admin: Sync.isAdmin(), restore: Sync.canRestore(), f2: Sync.canManage('f2') }));
ok('an Admin is an Admin everywhere', pq.role === 'admin' && pq.admin && pq.restore && pq.f2, JSON.stringify(pq));
ok('and has the shared codes on the Staff page', !!(await pp.$('#sharedCodes')));
const pMenu = await menu(pp);
ok('and the backup and restore in the menu', pMenu.includes('Back up all data'));
await pp.evaluate(c => Sync.unlockEditing(c), EDIT); await sleep(1200);
await pp.click('#addPerson');
ok('the add form offers Staff, Manager and Admin', (await pp.$$eval('#pRole option', o => o.map(x => x.value))).join() === 'staff,manager,admin');
await pp.fill('#pName', 'Vic'); await pp.selectOption('#pRole', 'manager'); await pp.check('#pFacs .pfac[value="f2"]'); await pp.click('#pSave'); await sleep(1500);
const vic = (await manage(tok.pete, { action: 'list' })).people.find(p => p.name === 'Vic');
ok('an Admin makes a Manager through the page', !!vic && vic.role === 'manager' && vic.facilities.join() === 'f2', JSON.stringify(vic));
ok('and the card says Manager, with the facility', /Manager/.test(await (await pp.$('.pcard[data-login="' + (vic && vic.login) + '"]')).textContent()) && /Flynn Rink/.test(await (await pp.$('.pcard[data-login="' + (vic && vic.login) + '"]')).textContent()));
await pp.goto(B + '/index.html'); await pp.waitForSelector('#page'); await sleep(800);
ok('an Admin still sees every facility, and can add one', /Conway Arena/.test(await text(pp, '#page')) && /Flynn Rink/.test(await text(pp, '#page')) && !!(await pp.$('#addFac')));
await P.ctx.close();

await k.done(b);
})();
