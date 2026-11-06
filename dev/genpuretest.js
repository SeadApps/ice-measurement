/* glass-gen.js is pure: it runs with no page and no store.

   The layout code is loaded into a bare context (no document, no window, no storage), and a walk
   goes in and a layout comes out, the same every time. The survey checks against Conway's stored
   figures are gentest's, which needs the page for the embedded survey. */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };

(async () => {
const src = fs.readFileSync(path.join(__dirname, '..', 'glass-gen.js'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(src + '\n;this.api={boardWalk,orientWalk,sectionBreaks,entryAt,generateLayout,layoutFromSpec,tryLayout,STARTS,perimeterOf};', ctx);
const api = ctx.api;

ok('it loads with nothing around it', typeof api.generateLayout === 'function' && typeof api.layoutFromSpec === 'function' && typeof api.tryLayout === 'function');
ok('and names the three places a walk can start', Object.keys(api.STARTS).join() === 'centre,side,end');

const spec = { L: 200, W: 85, R: 27.166666666666668, origin: 20.125, glassHeight: 75, start: 'centre',
  sections: [{ key: 'a', name: 'Side', items: [{ kind: 'glass', width_in: 43 }, { kind: 'glass', width_in: 48 }, { kind: 'door', width_in: 43 }] },
             { key: 'b', name: 'End', items: [{ kind: 'glass', width_in: 43 }, { kind: 'glass', width_in: 43 }] }] };
const a = api.generateLayout(JSON.parse(JSON.stringify(spec))), b = api.generateLayout(JSON.parse(JSON.stringify(spec)));
ok('a walk makes one entry per item, in order', a.panels.length === 5 && a.panels.map(p => p.kind).join() === 'glass,glass,door,glass,glass', a.panels.map(p => p.kind).join());
ok('the same walk gives the same layout every time', JSON.stringify(a) === JSON.stringify(b));
ok('the rink carries its perimeter', Math.abs(a.rink.perimeter_ft - api.perimeterOf(200, 85, 27.166666666666668)) < 1e-3);
ok('each entry sits at a distance along the boards that grows', a.panels.every((p, i) => i === 0 || p.s0 >= a.panels[i - 1].s0 - 1e-9));
const lay = api.layoutFromSpec(JSON.parse(JSON.stringify(spec)));
ok('layoutFromSpec adds the words around it and keeps the spec', /4 pieces/.test(lay.copy.lede) && /walked from the centre/.test(lay.copy.planNote) && lay.spec && lay.spec.L === 200);
ok('tryLayout gives nothing for nothing, and for a spec that cannot be drawn', api.tryLayout(null) === null && api.tryLayout({ sections: 5 }) === null);
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
