/* G3a: the layout generator, checked against the one rink we have real data for.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/gentest.js

   Conway's 129 entries are generated output — computed positions, SVG paths and
   label anchors — from a survey whose script is long gone. Rebuilding that
   script is what lets a second rink exist at all, and it happens to come with
   its own acceptance test: feed the generator nothing but Conway's widths, in
   order, and it should reproduce the drawing already in the file.

   If it does, the arc-length model is right, and a walk around any other set of
   boards will place panels just as faithfully.
*/
const { chromium } = require('playwright');

const B = 'http://localhost:8200';
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { window.__SYNC_CONFIG__ = { url: 'http://localhost:8200', anon: 'test', email: 'x@y.z' }; });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e).split('\n')[0]));
await p.goto(B + '/glass.html'); await sleep(1500);
await p.evaluate(() => document.querySelectorAll('.sync-gate').forEach(e => e.remove()));

const res = await p.evaluate(() => {
  const D = LAYOUTS.legacy.panels.slice().sort((a, b) => a.s0 - b.s0);
  const rink = LAYOUTS.legacy.rink;

  /* Rebuild the walk from the survey: widths in order, grouped into the same
     five sections, with nothing else carried over. Conway's run starts at the
     Zamboni doors, 20.125 ft along the boards from the foot of the left wall. */
  const secs = [];
  D.forEach(x => {
    let s = secs[secs.length - 1];
    if (!s || s.key !== x.sectionKey) { s = { key: x.sectionKey, name: x.section, items: [] }; secs.push(s); }
    s.items.push({ kind: x.kind, width_in: x.width_in, tag: x.tag, label: x.label, thickness: x.thickness });
  });

  const gen = generateLayout({ L: rink.L, W: rink.W, R: rink.R, origin: 20.125,
                               glassHeight: 75, sections: secs });
  const G = gen.panels;

  const worst = { s: 0, anchor: 0, rot: 0, len: 0, id: null };
  let idMismatch = 0, pathPts = 0;
  for (let i = 0; i < D.length; i++) {
    const a = D[i], g = G[i];
    const ds = Math.max(Math.abs(a.s0 - g.s0), Math.abs(a.s1 - g.s1));
    const da = Math.max(Math.abs(a.cx - g.cx), Math.abs(a.cy - g.cy),
                        Math.abs(a.lx - g.lx), Math.abs(a.ly - g.ly),
                        Math.abs(a.ix - g.ix), Math.abs(a.iy - g.iy));
    let dr = Math.abs(((a.rot - g.rot) % 360 + 540) % 360 - 180);
    dr = Math.min(dr, Math.abs(180 - dr) === 180 ? dr : Math.abs(((a.rot - g.rot) % 360 + 360) % 360));
    if (ds > worst.s) { worst.s = ds; worst.id = a.id; }
    if (da > worst.anchor) worst.anchor = da;
    if (dr > worst.rot) worst.rot = dr;
    if (Math.abs(a.len_ft - g.len_ft) > worst.len) worst.len = Math.abs(a.len_ft - g.len_ft);
    if ((a.id || null) !== (g.id || null)) idMismatch++;
    const cnt = s => (s.match(/,/g) || []).length;
    if (cnt(a.d) !== cnt(g.d)) pathPts++;
  }
  return {
    count: G.length, orig: D.length, worst, idMismatch, pathPts,
    perimeter: gen.rink.perimeter_ft, storedPerimeter: rink.perimeter_ft,
    sections: gen.sections.map(s => ({ key: s.key, span: s.span_ft, joint: s.joint_in, glass: s.glass }))
  };
});

ok('generates the same number of entries', res.count === res.orig, res.count + ' vs ' + res.orig);
ok('perimeter matches the stored figure', Math.abs(res.perimeter - res.storedPerimeter) < 0.001,
   res.perimeter + ' vs ' + res.storedPerimeter);
ok('panel numbering matches', res.idMismatch === 0, res.idMismatch + ' differ');
ok('arc positions match to a thousandth of a foot', res.worst.s < 0.001, 'worst ' + res.worst.s.toFixed(5));
ok('label anchors match to a hundredth of a foot', res.worst.anchor < 0.01, 'worst ' + res.worst.anchor.toFixed(4));
ok('text rotations match', res.worst.rot < 0.02, 'worst ' + res.worst.rot.toFixed(3) + ' deg');
ok('panel lengths match', res.worst.len < 0.001, 'worst ' + res.worst.len.toFixed(5));
ok('outlines are subdivided the same', res.pathPts === 0, res.pathPts + ' differ');

/* The section report is what the builder shows while somebody is still at the
   boards, so the figures in it have to be the real ones. */
const bySec = {}; res.sections.forEach(s => bySec[s.key] = s);
ok('bleacher side spans the straight', Math.abs(bySec.BLEACHER.span - 145.667) < 0.01, String(bySec.BLEACHER.span));
ok('the lobby end carries its corners', Math.abs(bySec.LOBBY.span - 116.015) < 0.01, String(bySec.LOBBY.span));
ok('the Zamboni end splits at the doors',
   Math.abs(bySec.ZAM_A.span - 53.216) < 0.01 && Math.abs(bySec.ZAM_B.span - 62.795) < 0.01,
   bySec.ZAM_A.span + ' / ' + bySec.ZAM_B.span);
ok('recovers the surveyed joint widths',
   Math.abs(bySec.BLEACHER.joint - 0.8611) < 0.002 && Math.abs(bySec.LOBBY.joint - 0.8438) < 0.002,
   bySec.BLEACHER.joint + ' / ' + bySec.LOBBY.joint);
/* The two Zamboni-end sections bracket the 0.79-0.86in band the other three
   agree on. That is the fingerprint of the panel 111 question, and the number
   the next walk-round can settle. */
ok('and shows the Zamboni end as the odd one out',
   bySec.ZAM_A.joint < 0.5 && bySec.ZAM_B.joint > 1.2,
   bySec.ZAM_A.joint + ' / ' + bySec.ZAM_B.joint);

ok('nothing threw', errs.length === 0, JSON.stringify(errs.slice(0, 2)));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();
