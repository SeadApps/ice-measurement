/* Glass Manager on a phone.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/phonetest.js

   Every other suite drives a 1280x900 window, which is how Glass came to ship
   a layout nobody had seen at phone width: the whole page scrolled sideways by
   121px at 390px and there was no way to notice from a desktop.

   The cause is worth stating, because it is invisible by inspection and the
   fix is one word. The lower grid is

       .grid{grid-template-columns:minmax(0,1fr) 330px}

   and the narrow override used to drop to a bare `1fr`. A bare 1fr means
   minmax(auto,1fr), and that `auto` floors the column at its min-content
   width - so the column refused to shrink and took the document with it. The
   minmax(0,...) that the desktop rule already carried is the entire fix.

   The load-bearing check here is the first one: no page-level horizontal
   overflow. It has to tell a page that genuinely overflows apart from a box
   that scrolls on purpose - the plan and the schedule are both meant to pan
   sideways inside their own borders - so an element is only counted as having
   escaped when no ancestor establishes a scroll container. Without that
   distinction the check would either miss the bug or fire on the rink for ever.
*/
const { chromium, devices } = require('playwright');

const B = 'http://localhost:8200';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };

/* Page-level overflow, and who caused it. Runs in the page. */
const OVERFLOW = () => {
  const d = document.documentElement, vw = d.clientWidth, esc = [];
  const scrolls = el => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
    }
    return false;
  };
  document.querySelectorAll('body *').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.width && !scrolls(el)) {
      esc.push(el.tagName.toLowerCase()
        + (el.id ? '#' + el.id : '')
        + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '')
        + '@' + Math.round(r.width));
    }
  });
  return { vw, over: d.scrollWidth - vw, esc: [...new Set(esc)].slice(0, 4) };
};

const open = async (b, page, opts) => {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => { window.__SYNC_CONFIG__ = { url: 'http://localhost:8200', anon: 'test', email: 'x@y.z' }; });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).split('\n')[0]));
  await p.goto(B + '/' + page);
  await sleep(1600);
  await p.evaluate(() => document.querySelectorAll('.sync-gate').forEach(e => e.remove()));
  await sleep(400);
  return { ctx, p, errs };
};

(async () => {
const b = await chromium.launch();

/* ---------------- nothing scrolls sideways ---------------- */
/* 320 is the narrowest phone still in use; 390 is an iPhone 13. Both apps and
   the launcher, because the switcher puts all three one tap apart - a device
   that overflows on one of them overflows in the middle of a walk-round. */
for (const w of [320, 390]) {
  for (const page of ['index.html', 'ice.html', 'glass.html']) {
    const { ctx, p, errs } = await open(b, page, {
      viewport: { width: w, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true
    });
    const m = await p.evaluate(OVERFLOW);
    ok(page + ' does not scroll sideways at ' + w + 'px', m.over === 0, m.over + 'px over: ' + m.esc.join(' '));
    ok(page + ' throws nothing at ' + w + 'px', errs.length === 0, errs[0]);
    await ctx.close();
  }
}

/* ---------------- the phone rules actually engage ---------------- */
/* If the media query is ever dropped or its breakpoint edited, the overflow
   check above would still pass while the page quietly went back to being a
   desktop layout on a phone. Pin the breakpoint itself. */
{
  const { ctx, p } = await open(b, 'glass.html', { ...devices['iPhone 13'] });
  const s = await p.evaluate(() => {
    const sub = document.querySelector('.brand .sub');
    const tile = document.querySelector('.tile');
    const rail = document.querySelector('.rail');
    const tiles = [...document.querySelectorAll('.tile')];
    // how many distinct rows do the tiles occupy?
    const rows = new Set(tiles.map(t => Math.round(t.getBoundingClientRect().top))).size;
    return {
      subHidden: sub ? getComputedStyle(sub).display === 'none' : null,
      basis: tile ? getComputedStyle(tile).flexBasis : null,
      tiles: tiles.length, rows,
      railH: rail ? Math.round(rail.getBoundingClientRect().height) : null,
      wrapPad: getComputedStyle(document.querySelector('.wrap')).paddingLeft
    };
  });
  ok('the phone block is in force', s.subHidden === true, JSON.stringify(s));
  ok('tiles sit two to a row, not one', s.tiles >= 4 && s.rows <= Math.ceil(s.tiles / 2), s.tiles + ' tiles in ' + s.rows + ' rows');
  ok('the rail is not four rows deep', s.railH !== null && s.railH < 260, s.railH + 'px');
  ok('the wrap gives back its desktop padding', s.wrapPad === '14px', s.wrapPad);
  await ctx.close();
}

/* ---------------- the rink is reachable ---------------- */
/* The plan is what the page is for. It used to start 1116px down on a 390px
   phone - past two screenfuls of chrome - because the header wrapped to four
   rows and the tiles to four. Held loosely: this is a budget, not a design. */
{
  const { ctx, p } = await open(b, 'glass.html', { ...devices['iPhone 13'] });
  const m = await p.evaluate(() => {
    const plan = document.querySelector('.plan');
    const box = plan ? plan.getBoundingClientRect() : null;
    const svg = document.querySelector('svg.rink');
    return {
      planTop: box ? Math.round(box.top + scrollY) : null,
      vh: innerHeight,
      headerH: Math.round(document.querySelector('.wrap > :first-child').getBoundingClientRect().height),
      svgW: svg ? Math.round(svg.getBoundingClientRect().width) : null,
      boxW: box ? Math.round(box.width) : null,
      boxScrolls: plan ? getComputedStyle(plan).overflowX : null
    };
  });
  ok('the plan starts within about one screen', m.planTop !== null && m.planTop < m.vh * 1.25, m.planTop + 'px of ' + m.vh);
  ok('the header is not four rows deep', m.headerH < 200, m.headerH + 'px');
  /* The rink deliberately does not shrink to fit: 200ft across a 390px phone
     would put a 4ft panel under 8px and nothing would be tappable. It pans
     inside its own box instead, which is why it must not escape it. */
  ok('the rink keeps its drawing size', m.svgW >= 760, String(m.svgW));
  ok('the rink pans inside its own box', m.boxScrolls === 'auto' && m.boxW < m.svgW, m.boxW + ' vs ' + m.svgW);
  await ctx.close();
}

/* ---------------- tapping a panel shows you the panel ---------------- */
/* The app's whole job. Below 1040px the grid stacks and the detail card drops
   under a 560px schedule, so on a phone - and on a portrait iPad, which is the
   thing actually carried round the boards - selecting a panel used to update a
   card a screen and a half further down with nothing on screen to show for it.
   reducedMotion makes the scroll instant, so this asserts without a timer and
   covers the reduced-motion branch at the same time. */
for (const [label, opts] of [
  ['phone', { ...devices['iPhone 13'], reducedMotion: 'reduce' }],
  ['portrait tablet', { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' }]
]) {
  const { ctx, p } = await open(b, 'glass.html', opts);
  const stacked = await p.evaluate(() => getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length === 1);
  ok(label + ': the grid is stacked, so the detail is below the fold', stacked);

  /* Driven through the page's own select() - the very call both click
     handlers make - rather than with p.click(). Playwright scrolls an element
     into view before clicking it, which would move the page underneath the
     scroll assertions here and prove nothing about reveal(). The click wiring
     itself is covered separately below. */
  const before = await p.evaluate(() => {
    scrollTo(0, 0);
    const r = document.getElementById('detail').getBoundingClientRect();
    return { shown: Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) };
  });
  ok(label + ': the detail card starts out of sight', before.shown < 80, 'shown ' + Math.round(before.shown) + 'px');

  const after = await p.evaluate(() => {
    select(document.querySelector('tr[data-id]').dataset.id);
    const r = document.getElementById('detail').getBoundingClientRect();
    return {
      shown: Math.min(r.bottom, innerHeight) - Math.max(r.top, 0),
      y: Math.round(scrollY),
      filled: !document.querySelector('#detail .empty')
    };
  });
  ok(label + ': selecting a panel fills the detail card', after.filled);
  ok(label + ': and brings it into view', after.shown >= 80, 'shown ' + Math.round(after.shown) + 'px');

  /* Deselecting must not deliberately scroll. Escape rather than a second
     click, for the same reason as above.

     It can still move, and at 768px it does: the card collapses from ~480px to
     a one-line placeholder, the document gets shorter by exactly that much, and
     anyone near the bottom is clamped to the new end - 1720 to 1484, which is
     the new maximum to the pixel. That is the page shrinking underneath you,
     not the page being moved, and no amount of care in reveal() would change it
     because reveal() returns at its first line when nothing is selected. So:
     unchanged, or pinned to the new bottom. Asserting equality here was wrong
     and went red on the tablet, which is the case that has a tall enough card
     and a short enough document to expose it. */
  await p.keyboard.press('Escape');
  await sleep(300);
  const off = await p.evaluate(() => ({
    y: Math.round(scrollY),
    max: Math.round(document.documentElement.scrollHeight - innerHeight),
    empty: !!document.querySelector('#detail .empty')
  }));
  ok(label + ': deselecting empties the card', off.empty);
  ok(label + ': and does not scroll you anywhere',
     Math.abs(off.y - after.y) < 10 || off.y >= off.max - 2,
     after.y + ' -> ' + off.y + ', new max ' + off.max);

  /* and the real click path still reaches select() */
  const clicked = await p.evaluate(() => {
    const tr = document.querySelector('tr[data-id]');
    tr.click();
    return { id: tr.dataset.id, filled: !document.querySelector('#detail .empty') };
  });
  ok(label + ': clicking a schedule row selects it', clicked.filled, clicked.id);
  await ctx.close();
}

/* ---------------- and the desktop is untouched ---------------- */
/* The whole point of a max-width query is that it stops. layouttest pins what
   Conway renders; this pins that the phone rules are not leaking up into it. */
{
  const { ctx, p } = await open(b, 'glass.html', { viewport: { width: 1280, height: 900 } });
  const d = await p.evaluate(() => {
    const sub = document.querySelector('.brand .sub');
    const plan = document.querySelector('.plan');
    return {
      subShown: sub ? getComputedStyle(sub).display !== 'none' : null,
      wrapPad: getComputedStyle(document.querySelector('.wrap')).paddingLeft,
      basis: getComputedStyle(document.querySelector('.tile')).flexBasis,
      planTop: plan ? Math.round(plan.getBoundingClientRect().top + scrollY) : null,
      panels: document.querySelectorAll('.pnl').length,
      cols: getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length
    };
  });
  ok('desktop keeps the tagline', d.subShown === true);
  ok('desktop keeps its 24px padding', d.wrapPad === '24px', d.wrapPad);
  ok('desktop keeps the 190px tile basis', d.basis === '190px', d.basis);
  ok('desktop keeps the two-column grid', d.cols === 2, String(d.cols));
  ok('desktop still draws 127 panels', d.panels === 127, String(d.panels));
  ok('desktop plan sits where it did', d.planTop > 300 && d.planTop < 440, String(d.planTop));

  /* reveal() is gated on the grid having stacked, so a desktop keeps the
     behaviour it always had - including at the top of the page, where the
     sticky card has not been reached yet and is genuinely off screen. That is
     the case that would have moved had the gate only asked "can you see it?". */
  const sel = await p.evaluate(() => {
    scrollTo(0, 0);
    const y0 = Math.round(scrollY);
    select(document.querySelector('tr[data-id]').dataset.id);
    return { y0, y: Math.round(scrollY), filled: !document.querySelector('#detail .empty') };
  });
  ok('desktop still fills the detail card', sel.filled);
  ok('desktop does not scroll when you select', Math.abs(sel.y - sel.y0) < 10, sel.y0 + ' -> ' + sel.y);
  await ctx.close();
}

await b.close();
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
