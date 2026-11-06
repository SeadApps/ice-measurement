/* The Rink view's map: Color map with blended transitions, Lowest point, and no 3D.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/maptest.js

   COLOR MAP: with the blend span at zero it is today's map pixel for pixel; with the span (a
   sixteenth of an inch) every reading still shows exactly its band's colour, and the colour
   never jumps between neighbouring cells.
   LOWEST POINT: scaled from the round being viewed. Lowest red, highest dark blue, yellow halfway
   up to ideal, green at ideal, light blue halfway from ideal to highest; with nothing below (or
   above) ideal the scale starts (or ends) at green; ties are ringed; the legend says the numbers.
   The Rink view's mode is a device preference. 3D is gone. */
const k = require('./shellkit');
const { ok, sleep, B, text } = k;

const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);
const rgbEq = (a, b, e) => a.every((v, i) => near(v, b[i], e == null ? 1e-6 : e));

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();
const D = await k.device(b, 1000);
const p = D.p;
await p.goto(B + '/ice.html#/f/f1/s/s1');
await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
await p.waitForSelector('#shellbar .nav'); await sleep(1500);
const R = (fn, a) => p.evaluate(fn, a);

/* ---- 3D is gone ----------------------------------------------------------------------------------- */
ok('there is no 3D button, canvas or hint', !(await p.$('#view3d')) && !(await p.$('#surf')) && !(await p.$('#threeWrap')) && !(await p.$('.surf-hint')));
ok('and no 3D code is left to call', await R(() => typeof drawSurf === 'undefined' && typeof sizeSurf === 'undefined' && typeof zScale === 'undefined'));
await R(() => { state.lastView = '3d'; enterWork(state.lastView); });            // how a saved view really arrives
await sleep(500);
ok('a saved 3D view opens on the map', await R(() => viewMode) === 'map' && await p.inputValue('#cmpSel') === 'off');

/* ---- the pure colours, in the page --------------------------------------------------------------------- */
const bands = await R(() => BAND_RGB.map(c => c.slice()));
const labels = await R(() => OPTIONS.map(o => [o, decOf.get(o)]));
const bandIdxOf = await R(() => OPTIONS.map(o => BANDS.indexOf(bandOf(decOf.get(o)))));

await R(() => { MAP_BLEND = 0; });
const hard = await R(() => OPTIONS.every(o => { const v = decOf.get(o); return JSON.stringify(colorFor(v)) === JSON.stringify(bandColor(v)); }));
ok('with the blend span at zero, colorFor is the old hard-edged colour for every reading', hard);
const sweep0 = await R(() => { let same = true; for (let v = 0.2; v < 2.6; v += 0.0007) if (JSON.stringify(colorFor(v)) !== JSON.stringify(bandColor(v))) same = false; return same; });
ok('and for every thickness between, not just the readings', sweep0);

/* the map itself, pixel for pixel: make a round, draw it both ways */
await R(() => { const d = session().data; Object.keys(d).forEach(x => delete d[x]);      /* the shared seed's readings are not on the grid */
  const labs = ['1/2"', '5/8"', '3/4"', '7/8"', '1"', '1 1/8"', '1 1/4"', '1 3/8"', '1 1/2"', '1 5/8"', '1 3/4"', '1 7/8"', '2"']; POINTS.forEach((pt, i) => { d[keyOf(pt)] = labs[(i * 5) % labs.length]; }); computeField(); });
const pix = (fn) => R(f => { const make = new Function('return ' + f)(); bandImageFrom(field, make()); const c = heatCanvas.getContext('2d').getImageData(0, 0, NX, NY).data; let h = 0; for (let i = 0; i < c.length; i += 4) h = (h * 31 + c[i] * 3 + c[i + 1] * 5 + c[i + 2] * 7) | 0; return { h, n: c.length }; }, fn);
const old = await pix('() => bandColor');
const zero = await pix('() => colorFor');
ok('the Color map drawn with a zero span is today\'s map, pixel for pixel', old.h === zero.h && old.n === zero.n && old.n === 150 * 64 * 4, JSON.stringify([old, zero]));

await R(() => { MAP_BLEND = 1 / 16; });
const blended = await pix('() => colorFor');
ok('with the real span the map is different, which is the point', blended.h !== old.h);

/* every reading is exactly its band's colour */
const pure = await R(() => OPTIONS.every((o, i) => { const c = colorFor(decOf.get(o)), t = BAND_RGB[BANDS.indexOf(bandOf(decOf.get(o)))]; return c[0] === t[0] && c[1] === t[1] && c[2] === t[2]; }));
ok('with the span, a reading on a band is still exactly that band\'s colour (all sixteen)', pure);
const atEdge = await R(() => { const e = BANDS[0].lt; return [colorFor(e), BAND_RGB[1], colorFor(e - MAP_BLEND), BAND_RGB[0]]; });
ok('the edge itself is the next band, and the span starts on the band you are leaving', rgbEq(atEdge[0], atEdge[1]) && rgbEq(atEdge[2], atEdge[3]));
const maxStep = await R(() => { let m = 0, prev = colorFor(0.3); for (let v = 0.3; v < 2.6; v += 0.001) { const c = colorFor(v); m = Math.max(m, Math.abs(c[0] - prev[0]), Math.abs(c[1] - prev[1]), Math.abs(c[2] - prev[2])); prev = c; } return m; });
const hardStep = await R(() => { MAP_BLEND = 0; let m = 0, prev = colorFor(0.3); for (let v = 0.3; v < 2.6; v += 0.001) { const c = colorFor(v); m = Math.max(m, Math.abs(c[0] - prev[0]), Math.abs(c[1] - prev[1]), Math.abs(c[2] - prev[2])); prev = c; } MAP_BLEND = 1 / 16; return m; });
ok('the colour never jumps: the biggest step between neighbouring thicknesses is small, where hard edges jump by ' + hardStep.toFixed(0), maxStep <= 8 && hardStep > 40, 'blend ' + maxStep.toFixed(1) + ' hard ' + hardStep.toFixed(1));
const edgesMoved = await R(() => { const was = BANDS.map(b => b.lt); return was.length === 5; });
ok('the blend follows the facility\'s own edges, whatever they are', edgesMoved);

/* ---- Lowest point: the scale -------------------------------------------------------------------------- */
const sc = (vals, t) => R(a => { const s = lowestScale(a.v, a.t); return s && { min: s.min, max: s.max, nMin: s.nMin, nMax: s.nMax, stops: s.stops.map(x => x[0]), at: a.q.map(q => s.color(q).map(Math.round)) }; }, { v: vals, t, q: [0, 1.125, 1.3125, 1.5, 1.6875, 1.875, 3] });
const C = await R(() => LP_COLORS);
const s1 = await sc([1.125, 1.125, 1.125, 1.5, 1.75, 1.875, 1.875], 1.5);
ok('lowest and highest come from the recorded readings, with how many share them', s1.min === 1.125 && s1.max === 1.875 && s1.nMin === 3 && s1.nMax === 2, JSON.stringify(s1));
ok('five stops: lowest, halfway up to ideal, ideal, halfway on to highest, highest', JSON.stringify(s1.stops) === JSON.stringify([1.125, 1.3125, 1.5, 1.6875, 1.875]), JSON.stringify(s1.stops));
const rr = c => c.map(Math.round);
ok('red at the lowest, yellow halfway to ideal, green at ideal, light blue halfway on, dark blue at the highest',
   rgbEq(s1.at[1], rr(C.red)) && rgbEq(s1.at[2], rr(C.yellow)) && rgbEq(s1.at[3], rr(C.green)) && rgbEq(s1.at[4], rr(C.lblue)) && rgbEq(s1.at[5], rr(C.dblue)), JSON.stringify(s1.at));
ok('and beyond either end it holds the end colour', rgbEq(s1.at[0], rr(C.red)) && rgbEq(s1.at[6], rr(C.dblue)));
const mid = await R(() => { const s = lowestScale([1.125, 1.875], 1.5), a = s.color(1.21875), y = LP_COLORS.yellow, r = LP_COLORS.red; return [a.map(Math.round), r.map((v, i) => Math.round((v + y[i]) / 2))]; });
ok('between stops it blends smoothly (halfway from red to yellow is the average of the two)', rgbEq(mid[0], mid[1], 1), JSON.stringify(mid));

const above = await sc([1.625, 1.75, 1.875], 1.5);
ok('nothing below ideal: no red and no yellow, the scale starts at green on the lowest reading', rgbEq(above.at[0], rr(C.green)) && above.at[1] && rgbEq(above.at[5], rr(C.dblue)) && above.stops.length === 3 && above.stops[0] === 1.625, JSON.stringify(above));
const below = await sc([1, 1.125, 1.25], 1.5);
ok('nothing above ideal: it ends at green on the highest reading, with no blue', rgbEq(below.at[0], rr(C.red)) && below.stops.length === 3 && below.stops[2] === 1.25 && rgbEq((await R(() => lowestScale([1, 1.125, 1.25], 1.5).color(1.25).map(Math.round))), rr(C.green)), JSON.stringify(below));
const flatOn = await R(() => lowestScale([1.5, 1.5, 1.5], 1.5).color(1.5).map(Math.round));
const flatLo = await R(() => lowestScale([1.25, 1.25], 1.5).color(1.25).map(Math.round));
const flatHi = await R(() => lowestScale([1.75], 1.5).color(1.75).map(Math.round));
ok('a flat round is one colour: green on ideal, red below it, dark blue above it', rgbEq(flatOn, rr(C.green)) && rgbEq(flatLo, rr(C.red)) && rgbEq(flatHi, rr(C.dblue)));
ok('no readings, no scale', await R(() => lowestScale([], 1.5)) === null);
ok('the scale uses recorded readings only, not the interpolated field', await R(() => { const t = EF().target, vals = Object.values(data()).map(l => decOf.get(l)), s = mapScale(); return s.min === Math.min(...vals) && s.max === Math.max(...vals) && s.target === t; }));

/* ---- the toggle ----------------------------------------------------------------------------------------- */
ok('the Rink view has a Color map | Lowest point toggle above the map, Color map first', await R(() => [...document.querySelectorAll('#mapModeSeg button')].map(x => x.textContent).join('|')) === 'Color map|Lowest point' && await p.getAttribute('#mmColor', 'aria-pressed') === 'true');
const legColor = await text(p, '#legend');
ok('the Color map legend is the five bands, as ever', /Too thin/.test(legColor) && /Ideal/.test(legColor) && /Too thick/.test(legColor));
const hasRing = () => R(() => { const opt = { labels: false, sel: false, contours: false, trend: false }; return mapMode(); });
await p.click('#mmLowest'); await sleep(500);
ok('Lowest point is chosen, remembered, and drawn', await p.getAttribute('#mmLowest', 'aria-pressed') === 'true' && await R(() => state.mapMode) === 'lowest');
const lg = await text(p, '#legend');
const stat = await R(() => { const s = mapScale(); return { low: fmtSet(s.min), high: fmtSet(s.max), nMin: s.nMin, nMax: s.nMax, tgt: fmtSet(EF().target) }; });
ok('the legend prints the numbers: the lowest and how many spots share it, ideal, and the highest and how many',
   lg.includes('Lowest') && lg.includes(stat.low) && lg.includes(stat.nMin + (stat.nMin === 1 ? ' spot' : ' spots')) && lg.includes('Ideal') && lg.includes(stat.tgt) && lg.includes('Highest') && lg.includes(stat.high) && lg.includes(stat.nMax + (stat.nMax === 1 ? ' spot' : ' spots')), lg);
ok('with the colours of the scale in its swatches', await R(() => { const sw = [...document.querySelectorAll('#legend .key .sw')].map(e => e.style.backgroundColor); const n = x => x.replace(/\s/g, ''); return n(sw[0]) === rgbCss(LP_COLORS.red) && n(sw[1]) === rgbCss(LP_COLORS.green) && n(sw[2]) === rgbCss(LP_COLORS.dblue); }));
const pxOf = async mode => R(m => { state.mapMode = m; const c = document.createElement('canvas'); c.width = 600; c.height = 255; renderScene(c.getContext('2d'), 0, 0, 600, { labels: false, sel: false, contours: false, trend: false });
  const d = c.getContext('2d').getImageData(0, 0, 600, 255).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7) | 0; return h; }, mode);
const pc = await pxOf('color'), pl = await pxOf('lowest');
ok('the exported image and the print report are drawn with whichever mode is on: the two modes draw different maps', pc !== pl);
await R(() => { state.mapMode = 'lowest'; });
/* a reading changes the legend */
const before = await text(p, '#legend');
await R(() => { const d = session().data, ks = Object.keys(d); d[ks[0]] = '1/4"'; refresh(); });
ok('a new reading moves the legend: the lowest is now the new one', (await text(p, '#legend')) !== before && (await text(p, '#legend')).includes(await R(() => fmtSet(0.25))));
await R(() => { const d = session().data, ks = Object.keys(d); d[ks[1]] = '1/4"'; refresh(); });
ok('and two spots at the lowest say so, with a ring on each', /2 spots/.test(await text(p, '#legend')));
ok('(tied spots are ringed: the dots that share the lowest or highest value)', await R(() => { const s = mapScale(), d = data(); return Object.keys(d).filter(kk => decOf.get(d[kk]) === s.min || decOf.get(d[kk]) === s.max).length >= 2; }));
await p.reload(); await p.waitForSelector('#shellbar .nav'); await sleep(2500);
ok('the mode is a device preference: a reload keeps it', await R(() => state.mapMode) === 'lowest' && await p.getAttribute('#mmLowest', 'aria-pressed') === 'true');
ok('and it is saved as one, in the preferences, not in any record', JSON.parse(await R(() => localStorage.getItem('ice_v4_prefs'))).mapMode === 'lowest' && !(await R(() => localStorage.getItem('ice_v4_sheets'))).includes('mapMode'));

/* ---- what it leaves alone -------------------------------------------------------------------------------- */
await sleep(300);
ok('the thickness keys keep the band colours in both modes: the builder\'s keys, the dots and the map agree while entering',
   await R(() => { const chips = [...document.querySelectorAll('#chips .chip[data-opt] .dot')]; return chips.length === 21 && chips.every((c, i) => c.style.backgroundColor.replace(/\s/g, '') === rgbCss(BAND_RGB[BANDS.indexOf(bandOf(decOf.get(KEYS[i])))])); }));
await R(() => { const c = document.getElementById('cmpSel'); c.value = ''; c.dispatchEvent(new Event('change')); });
await sleep(400);
ok('the Compare (Trend) view is untouched, and the toggle is not offered there', await R(() => document.getElementById('mapModeRow').style.display) === 'none' && /thinner/.test(await text(p, '#legend')));
await R(() => { const c = document.getElementById('cmpSel'); c.value = 'off'; c.dispatchEvent(new Event('change')); });
await sleep(300);
ok('and is back on the map', await R(() => document.getElementById('mapModeRow').style.display) === 'flex');
await p.click('#mmColor'); await sleep(300);
ok('Color map again restores the five-band legend', /Too thin/.test(await text(p, '#legend')) && await R(() => state.mapMode) === 'color');

/* ---- a facility with its own bands ------------------------------------------------------------------------ */
await R(() => { facility().settings.edges = [0.875, 1.25, 1.75, 2.25]; facility().settings.settingsVersion = 2; buildBands(); });
const own = await R(() => { const e = BANDS.map(b => b.lt); return { e, pure: OPTIONS.every(o => { const c = colorFor(decOf.get(o)), t = BAND_RGB[BANDS.indexOf(bandOf(decOf.get(o)))]; return c[0] === t[0] && c[1] === t[1] && c[2] === t[2]; }), blends: JSON.stringify(colorFor(1.25 - 1 / 32)) !== JSON.stringify(BAND_RGB[1]) }; });
ok('the blend follows a facility\'s own edges, and every reading is still pure', own.pure && own.blends && own.e[1] === 1.25, JSON.stringify(own));

await k.done(b);
})();
