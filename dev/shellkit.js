/* Shared setup for the shell's suites (routetest, shelltest, facilitiestest):
   a server holding Conway (one sheet, up to date) and Flynn (two sheets, one
   overdue under Flynn's own 3-day rule), and devices that sign in. */
const { chromium } = require('playwright');
const B = 'http://localhost:8200';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ACCESS = 'test-access-code', EDIT = 'test-editing-code', DOM = '@staff.conwayarena.local';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };
const done = async b => { await b.close(); console.log('\n  ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); };

const ctl = q => fetch(B + '/__ctl?' + q);
const rows = async () => (await (await fetch(B + '/__rows')).json());
const addStaff = p => fetch(B + '/__staff', { method: 'POST', body: JSON.stringify(p) });
const H = t => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
const ago = n => new Date(Date.now() - n * 86400000).toISOString();

async function login(email, password) {
  const r = await fetch(B + '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  return (await r.json()).access_token;
}
/* Conway f1/s1 (rounds 20 and 2 days ago), Flynn f2 with s2 Standard (9 days ago, overdue at 3) and s3 Mini (no rounds). */
async function seed(who) {
  /* who: {email, password, unlock} to write as a person (tight mode refuses the shared account) */
  const tok = await login(who ? who.email : 'operations@conwayarena.local', who ? who.password : ACCESS);
  if (who && who.unlock) await fetch(B + '/rest/v1/rpc/unlock_editing', { method: 'POST', headers: H(tok), body: JSON.stringify({ code: EDIT }) });
  const rec = (kind, id, fac, body) => ({ kind, id, deleted: false, body: Object.assign({ id, fac }, body) });
  const set = days => ({ target: 1.5, edges: [0.75, 1.5, 1.625, 2], tieAttention: true, floodBelow: 1.25, shaveAbove: 1.625, overdueDays: days, settingsVersion: 2 });
  const sz = { L: 200, W: 85, corner: 28 };
  const res = await fetch(B + '/rest/v1/records?on_conflict=kind,id', { method: 'POST', headers: H(tok), body: JSON.stringify([
    rec('facility', 'f1', 'f1', { name: 'Conway Arena', ord: 0, settings: set(7), updatedAt: ago(30) }),
    rec('sheet', 's1', 'f1', { facilityId: 'f1', name: 'Main', ord: 0, size: sz, updatedAt: ago(30) }),
    rec('session', 'z1', 'f1', { sheetId: 's1', ord: 0, date: ago(20), mode: 'moderate', data: { 1: '1 1/2"', 2: '1 3/8"' }, notes: {}, updatedAt: ago(20) }),
    rec('session', 'z2', 'f1', { sheetId: 's1', ord: 1, date: ago(2), mode: 'moderate', data: { 1: '1 1/2"', 2: '1 1/2"' }, notes: {}, updatedAt: ago(2) }),
    rec('facility', 'f2', 'f2', { name: 'Flynn Rink', ord: 1, settings: set(3), updatedAt: ago(30) }),
    rec('sheet', 's2', 'f2', { facilityId: 'f2', name: 'Standard', ord: 0, size: sz, updatedAt: ago(30) }),
    rec('sheet', 's3', 'f2', { facilityId: 'f2', name: 'Mini', ord: 1, size: { L: 120, W: 60, corner: 20 }, updatedAt: ago(30) }),
    /* every real sheet is made with an empty round, and Ice reaches straight for it */
    rec('session', 'z4', 'f2', { sheetId: 's3', ord: 0, date: ago(1), mode: 'moderate', data: {}, notes: {}, updatedAt: ago(1) }),
    rec('session', 'z3', 'f2', { sheetId: 's2', ord: 0, date: ago(9), mode: 'moderate', data: { 1: '1 1/4"' }, notes: {}, updatedAt: ago(9) })]) });
  return res.ok;
}

async function device(browser, width) {
  const ctx = await browser.newContext({ viewport: { width: width || 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e.stack || e).split('\n').slice(0, 4).join(' | ')));
  p.on('dialog', d => d.accept());
  return { ctx, p };
}
/* The access code alone, while nobody is signed in as a person. */
async function signIn(p) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('#page', { timeout: 10000 }); await sleep(600);
}
/* Access code, then a person. */
async function signInAs(p, id, code) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="' + id + '"]', { timeout: 8000 });
  await p.click('.sync-gate .sync-name[data-id="' + id + '"]');
  await p.fill('.sync-gate #sg-personal', code); await p.click('.sync-gate .sync-go');
  await p.waitForSelector('#page', { timeout: 10000 }); await sleep(800);
}
const text = (p, sel) => p.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
const stamps = async () => JSON.stringify((await rows()).map(r => [r.kind, r.id, r.updated_at]).sort());

const PETE = { email: 'pete' + DOM, password: 'pete-code-1', unlock: true };
module.exports = { PETE, chromium, B, sleep, ACCESS, EDIT, DOM, ok, done, ctl, rows, addStaff, login, seed, device, signIn, signInAs, text, stamps, ago };
