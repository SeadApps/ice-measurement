/* glass-gen.js: the pure layout code of Glass Manager.
   boardWalk, orientWalk, sectionBreaks, entryAt, generateLayout, layoutFromSpec and tryLayout, with the constants and the walk-start
   names they need. No page and no store: a spec goes in and a layout comes out. Moved out of glass.html unchanged. A classic
   script, so its names are the same globals the page and the tests already use. */
/* ---------------- layout generator ----------------

   A rink is a rounded rectangle, and every panel occupies a span of arc length
   around its perimeter. That is the entire model: give it the sheet's
   dimensions and a walk around the boards entering widths, and every position
   follows. Verified against Conway — regenerating its 127 panels from their
   widths alone reproduces every stored coordinate to within six thousandths of
   an inch, which is the rounding in the stored figures themselves.

   The drawing conventions are read off Conway's own plan: the glass band runs
   from the ice edge outward 2.9 ft, the panel number sits 4.9 ft out, the tick
   marking a door points 2.6 ft in, and a panel's outline is subdivided every
   1.2 ft so the corner arcs read as curves rather than chords. */
const BAND_FT = 2.9, LABEL_FT = 4.9, INBOARD_FT = 2.6, MID_FT = 1.45, SEG_FT = 1.2;

const perimeterOf = (L, W, R) => 2*(W - 2*R) + 2*(L - 2*R) + 2*Math.PI*R;

/* Walks the boards. s starts at the foot of the left-hand wall and runs up and
   around. Ends own their corner arcs and sides are the straights between —
   which is exactly how Conway's five sections divide, so it is the split the
   builder can offer without anyone having to describe it. */
function boardWalk(L, W, R){
  const hx = L/2, hy = W/2, side = W - 2*R, run = L - 2*R, arc = Math.PI*R/2;
  const segs = [
    { line:1, p:[-hx, -(hy-R)],   d:[0, 1],  n:[-1, 0], len:side },
    {         c:[-(hx-R), hy-R],  a0: Math.PI,          len:arc  },
    { line:1, p:[-(hx-R), hy],    d:[1, 0],  n:[0, 1],  len:run  },
    {         c:[hx-R, hy-R],     a0: Math.PI/2,        len:arc  },
    { line:1, p:[hx, hy-R],       d:[0,-1],  n:[1, 0],  len:side },
    {         c:[hx-R, -(hy-R)],  a0: 0,                len:arc  },
    { line:1, p:[hx-R, -hy],      d:[-1,0],  n:[0,-1],  len:run  },
    {         c:[-(hx-R),-(hy-R)],a0: -Math.PI/2,       len:arc  }
  ];
  const per = perimeterOf(L, W, R);
  const at = function(s){
    s = ((s % per) + per) % per;
    for(let i = 0; i < segs.length; i++){
      const g = segs[i];
      if(s <= g.len || i === segs.length - 1){
        if(g.line) return { x:g.p[0]+g.d[0]*s, y:g.p[1]+g.d[1]*s, nx:g.n[0], ny:g.n[1] };
        const a = g.a0 - s/R;
        return { x:g.c[0]+R*Math.cos(a), y:g.c[1]+R*Math.sin(a), nx:Math.cos(a), ny:Math.sin(a) };
      }
      s -= g.len;
    }
  };
  let acc = 0; const b = [];
  segs.forEach(g => { b.push(acc); acc += g.len; });
  at.perimeter = per;
  at.walls = { topSide:b[2], rightEnd:b[3], bottomSide:b[6], leftEnd:b[7] };
  return at;
}

/* Which way the building faces. Nothing recorded it, so a rink walked back in
   through the builder could come out mirrored against the survey - Conway's
   benches are at the top of the plan, and a rebuilt Conway put them at the
   bottom.

   Applied to the walk rather than to the finished drawing: every coordinate a
   panel carries - its outline, its label anchors, the angle its text sits at -
   comes off walk(), so this is the only place it has to happen. Arc lengths do
   not change, so the sections and the closing error are untouched. */
function orientWalk(walk, spec){
  const turn = !!spec.turn, flip = !!spec.flip;
  if(!turn && !flip) return walk;
  const sx = turn ? -1 : 1, sy = (turn ? -1 : 1) * (flip ? -1 : 1);
  const out = function(s){
    const m = walk(s);
    return { x:m.x*sx, y:m.y*sy, nx:m.nx*sx, ny:m.ny*sy };
  };
  out.perimeter = walk.perimeter;
  out.walls = walk.walls;
  return out;
}

/* Where the sections break, measured from the walk's origin: at each wall, and
   at the origin itself when it sits mid-wall — which is why Conway's Zamboni
   end reads as two sections, one either side of the doors. */
function sectionBreaks(walk, origin){
  const per = walk.perimeter, w = walk.walls;
  return [w.topSide, w.rightEnd, w.bottomSide, w.leftEnd]
    .map(m => ((m - origin) % per + per) % per)
    .filter(m => m > 1e-9)
    .sort((a, b) => a - b)
    .concat([per]);
}

const ftinOf = inches => {
  const f = Math.floor(inches/12), i = Math.round((inches - f*12) * 100)/100;
  return i ? `${f}' ${i}"` : `${f}'`;
};

function entryAt(walk, item, sec, s0, s1, id){
  const len = s1 - s0, n = Math.ceil(len/SEG_FT) + 1, f = v => v.toFixed(3);
  const outer = [], inner = [];
  for(let i = 0; i <= n; i++){
    const q = walk(s0 + len*i/n);
    outer.push([q.x + q.nx*BAND_FT, q.y + q.ny*BAND_FT]);
    inner.push([q.x, q.y]);
  }
  const d = 'M ' + outer.map(p => f(p[0])+','+f(p[1])).join(' L ')
          + ' L ' + inner.reverse().map(p => f(p[0])+','+f(p[1])).join(' L ') + ' Z';
  const m = walk((s0 + s1)/2);
  /* Text follows the boards, and is flipped where it would otherwise read
     upside down along the far side of the rink. */
  let rot = (Math.atan2(m.ny, m.nx) * 180/Math.PI - 90 + 360) % 360;
  if(rot >= 90 - 1e-9 && rot <= 270 + 1e-9) rot -= 180;
  return {
    id: id, kind: item.kind || 'glass', tag: item.tag || null, label: item.label || null,
    section: sec.name, sectionKey: sec.key,
    thickness: item.thickness || null, width_in: item.width_in,
    height_in: item.height_in || null,
    s0: s0, s1: s1, d: d,
    cx: +(m.x + m.nx*MID_FT).toFixed(3),    cy: +(m.y + m.ny*MID_FT).toFixed(3),
    lx: +(m.x + m.nx*LABEL_FT).toFixed(3),  ly: +(m.y + m.ny*LABEL_FT).toFixed(3),
    ix: +(m.x - m.nx*INBOARD_FT).toFixed(3),iy: +(m.y - m.ny*INBOARD_FT).toFixed(3),
    rot: +rot.toFixed(2), ftin: ftinOf(item.width_in), len_ft: +(len).toFixed(3)
  };
}

/* spec: {L, W, R, origin, glassHeight, sections:[{key, name, items:[...]}]}
   Each item is {kind, width_in, tag, label, thickness, height_in}; kind "open"
   is a gap with no glass in it, such as a player bench.

   Returns the layout plus a per-section report: how much board the section has,
   how much of it the entered widths use, and the joint that follows from the
   difference. That report is the builder's live feedback — a negative joint
   means the panels do not fit, an implausibly wide one means somebody has
   missed a panel. */
function generateLayout(spec){
  const L = spec.L, W = spec.W, R = spec.R;
  const walk = orientWalk(boardWalk(L, W, R), spec), per = walk.perimeter, origin = spec.origin || 0;
  const breaks = sectionBreaks(walk, origin);
  const panels = [], report = [];
  let num = 0;

  (spec.sections || []).forEach((sec, si) => {
    const from = si === 0 ? 0 : breaks[si - 1];
    const to = breaks[si] != null ? breaks[si] : per;
    const span = to - from;
    const items = sec.items || [];
    const used = items.reduce((a, it) => a + it.width_in/12, 0);
    const gaps = Math.max(0, items.length - 1);
    const joint = gaps ? (span - used)/gaps : 0;
    report.push({ key:sec.key, name:sec.name, span_ft:+span.toFixed(3),
                  pieces:items.length, glass:items.filter(i => (i.kind||'glass') === 'glass').length,
                  used_ft:+used.toFixed(3), slack_ft:+(span - used).toFixed(3),
                  joint_in:+(joint*12).toFixed(4) });
    let s = from;
    items.forEach(it => {
      const w = it.width_in/12;
      const kind = it.kind || 'glass';
      const id = kind === 'glass' ? String(++num).padStart(3, '0') : null;
      const e = entryAt(walk, it, sec, origin + s, origin + s + w, id);
      /* Geometry is worked in the walk's own coordinates, but s0/s1 are stored
         from the origin, so the run reads 0 to the perimeter the way a tape
         measure would when you start at the doors and come back to them. */
      e.s0 = +s.toFixed(5); e.s1 = +(s + w).toFixed(5);
      panels.push(e);
      s += w + joint;
    });
  });

  return {
    rink: { L:L, W:W, R:R, perimeter_ft:+per.toFixed(5) },
    panels: panels,
    sections: report,
    meta: { joint_in: report.length ? report[0].joint_in : null },
    glassHeight: spec.glassHeight || 75,
    edges: spec.edges || {}, copy: spec.copy || {}
  };
}

/* A built rink is stored and sent as the walk that made it, not as the drawing.
   The generated layout is around 60KB - 127 panels each carrying an SVG path -
   and the spec that produced it is around 2KB. generateLayout() is
   deterministic, so every device redraws the same rink from it, and a layout
   can be redrawn if the drawing conventions ever change. */
function layoutFromSpec(spec){
  const lay = generateLayout(spec);
  const n = lay.panels.filter(x => x.kind === 'glass').length;
  lay.edges = {};                       // stretches are named individually, not by edge
  lay.copy = {
    lede: ' \u00b7 ' + n + ' pieces in running order. Click any panel on the plan or in the'
        + ' schedule to record its condition.',
    planNote: STARTS[spec.start] ? 'walked from ' + STARTS[spec.start].toLowerCase() : '',
    footer: n + ' pieces \u00b7 glass ' + spec.glassHeight + '\u2033 high \u00b7 measurements as recorded'
  };
  lay.spec = spec;                      // kept, so this rink can be sent on
  return lay;
}
/* A spec off the wire or out of storage is not this device's to trust. One
   malformed record must not take the whole pull down with it. */
function tryLayout(spec){
  try { return spec ? layoutFromSpec(spec) : null; } catch(e){ return null; }
}

/* Where the walk begins. The centre red line is the default because every
   rink has one, it is painted on the ice, and "start at the red line" leaves
   nothing to interpret — where "start at a corner" invites the question of
   which corner. Beginning mid-side splits that side in two, so the walk reads
   as five stretches rather than four; Conway's own survey is shaped exactly
   that way, split either side of the Zamboni doors. */
const STARTS = {
  centre: 'The centre red line',
  side:   'A corner, walking onto a side',
  end:    'A corner, walking onto an end'
};
