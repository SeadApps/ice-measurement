/* report-maps.js: the two drawings a Quality report carries, made without Ice or Glass being open.

   tvImage   the same map as a 1920 x 1080 dark picture for a screen, with the date and the three figures.
   iceMap    one round of readings as the colour map Ice draws, with the spots and their readings, and the legend.
   glassPlan one sheet's glass as the plan Glass draws, with each panel coloured by its condition.

   Ice and Glass draw from page globals, so they cannot be called from the front page. These are the same drawings
   written to stand alone: the same geometry from the sheet's size, the same interpolation behind the map, the
   same band edges (from the facility's settings), Conway's compiled-in glass or the walk a built sheet keeps.
   Both always use the light theme's colours, so a report prints black on white whichever theme is on. They read
   nothing from a page and write nothing anywhere. A classic script: ReportMaps is the one global. The monitor
   in the Zamboni room, or any other place that wants the latest map, can use iceMap as it is.

   Keep in step with: ice-core.js (applyGeometry, idw, colorFor, buildBands), ice-rink.js (drawMarkings, drawDots),
   glass.html (icePath, markings, buildPlan, paint) and glass.css for the panel colours. reportmapstest compares
   the colours the map draws with what Ice's own band rule says. */
(function (global) {
  /* The light theme's band colours (--b-* in ice.css), thin to thick. */
  var BANDS = [{ key: "thin", c: "#c4332d", label: "Too thin" }, { key: "low", c: "#d4900f", label: "Thin" }, { key: "ideal", c: "#cfe3ec", label: "Ideal" },
    { key: "high", c: "#5b9ccc", label: "Thick" }, { key: "thick", c: "#2c6aa3", label: "Too thick" }];
  var NX = 150, NY = 64, POW = 2.4, BLEND = 1 / 16;   // Ice's default smoothing ("balanced") and its band blend
  /* The dark theme's band colours (--b-* in ice.css) and the two looks the map can have. The report is always light; a TV is dark. */
  var BANDS_DARK = ["#d6453f", "#e8b54a", "#eef4f6", "#6aa9d6", "#2c6aa3"];
  var LOOK = {
    light: { bg: "#ffffff", rink: "#eaf0f8", edge: "#52627a", ink: "#0b1a33", ink2: "#52627a", orient: "rgba(11,26,51,.45)", red: "rgba(200,32,47,.8)", blue: "rgba(23,71,209,.85)", dot: "#0b1a33", lblBg: "rgba(255,255,255,.85)", swatchEdge: "#52627a" },
    dark: { bg: "#0b0d0f", rink: "#1c2226", edge: "#93a09a", ink: "#eef2ef", ink2: "#93a09a", orient: "rgba(13,22,32,.4)", red: "rgba(255,90,71,.85)", blue: "rgba(55,182,255,.9)", dot: "#0b0d0f", lblBg: "rgba(11,13,15,.85)", swatchEdge: "#3c4a51" }
  };

  function rgb(hex) { hex = hex.replace("#", ""); return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]; }
  /* A thickness in inches as Ice writes a set-point: whole inches and eighths (1 1/2″). */
  function eighths(v) {
    var n = Math.round(v * 8), w = Math.floor(n / 8), r = n - w * 8;
    if (r === 0) return w + "″";
    var g = r % 4 === 0 ? 2 : r % 2 === 0 ? 4 : 8, top = r / (8 / g);
    return (w ? w + " " : "") + top + "/" + g + "″";
  }

  /* The sheet's lines, scaled from the regulation 200 x 85 (ice-core.js applyGeometry). */
  function geometry(size) {
    var sx = size.L / 200, sy = size.W / 85, L = size.L, W = size.W;
    return { L: L, W: W, corner: size.corner, GOAL1: 11 * sx, GOAL2: L - 11 * sx, BLUE1: 75 * sx, BLUE2: L - 75 * sx, CX: L / 2, CY: W / 2,
      FO_L: 40 * sx, FO_R: L - 40 * sx, FO_B: 22 * sy, FO_T: W - 22 * sy };
  }
  function bandsFor(settings, theme) {
    var e = settings.edges, lts = [e[0], e[1], e[2], e[3], Infinity];
    var rng = ["< " + eighths(e[0]), eighths(e[0]) + " – " + eighths(e[1]), "≈ " + eighths(settings.target), eighths(e[2]) + " – " + eighths(e[3]), eighths(e[3]) + " +"];
    return BANDS.map(function (b, i) { var c = theme === "dark" ? BANDS_DARK[i] : b.c; return { label: b.label, color: c, rgb: rgb(c), lt: lts[i], rng: rng[i] }; });
  }
  function colorFor(bands, v) {
    var bi = bands.length - 1;
    for (var b = 0; b < bands.length; b++) { if (v < bands[b].lt) { bi = b; break; } }
    var e = bands[bi].lt, next = bi + 1 < bands.length ? bands[bi + 1].rgb : null, a = bands[bi].rgb;
    if (next && isFinite(e) && v >= e - BLEND) { var t = (v - (e - BLEND)) / BLEND; return [a[0] + (next[0] - a[0]) * t, a[1] + (next[1] - a[1]) * t, a[2] + (next[2] - a[2]) * t]; }
    return a;
  }
  /* Inverse-distance weighting with the sheet's edge held at the target, as Ice's idw/anchors do. */
  function field(g, samples, target) {
    var all = samples.slice(), s = 8, x, y;
    for (x = 0; x <= g.L; x += s) { all.push({ x: x, y: 0, v: target }); all.push({ x: x, y: g.W, v: target }); }
    for (y = s; y < g.W; y += s) { all.push({ x: 0, y: y, v: target }); all.push({ x: g.L, y: y, v: target }); }
    var out = new Float32Array(NX * NY);
    for (var j = 0; j < NY; j++) {
      var fy = (j + 0.5) / NY * g.W;
      for (var i = 0; i < NX; i++) {
        var fx = (i + 0.5) / NX * g.L, num = 0, den = 0, hit = null;
        for (var p = 0; p < all.length; p++) {
          var dx = fx - all[p].x, dy = fy - all[p].y, d2 = dx * dx + dy * dy;
          if (d2 < 0.25) { hit = all[p].v; break; }
          var w = 1 / Math.pow(d2, POW / 2); num += w * all[p].v; den += w;
        }
        out[i + j * NX] = hit != null ? hit : (den ? num / den : target);
      }
    }
    return out;
  }
  function roundRink(c, ox, oy, s, g) {
    var r = g.corner * s, w = g.L * s, h = g.W * s;
    c.beginPath(); c.moveTo(ox + r, oy); c.arcTo(ox + w, oy, ox + w, oy + h, r); c.arcTo(ox + w, oy + h, ox, oy + h, r); c.arcTo(ox, oy + h, ox, oy, r); c.arcTo(ox, oy, ox + w, oy, r); c.closePath();
  }

  /* opts: size {L,W,corner}, data {"x,y": reading label}, settings (Records.settingsOf), width (px, default 1600),
     legend (default true), labels (default true). Returns a canvas. A 1/4" or "2+" reading is drawn like any other. */
  function iceMap(opts) {
    var R = global.Records, g = geometry(opts.size), settings = opts.settings, T = LOOK[opts.theme === "dark" ? "dark" : "light"], bands = bandsFor(settings, opts.theme);
    var RED = T.red, BLUE = T.blue, big = opts.scale || 1;
    var width = opts.width || 1600, pad = 24, s = (width - pad * 2) / g.L, mapH = g.W * s;
    var legendH = opts.legend === false ? 0 : Math.round(70 * big), H = Math.round(mapH + pad * 2 + legendH);
    var cv = document.createElement("canvas"); cv.width = width; cv.height = H;
    var c = cv.getContext("2d"), ox = pad, oy = pad;
    var FX = function (x) { return ox + x * s; }, FY = function (y) { return oy + (g.W - y) * s; };
    c.fillStyle = T.bg; c.fillRect(0, 0, width, H);

    var samples = [], keys = Object.keys(opts.data || {});
    keys.forEach(function (k) { var p = k.split(",").map(Number), v = R.readingValue(opts.data[k]); if (isFinite(p[0]) && isFinite(p[1]) && isFinite(v)) samples.push({ x: p[0], y: p[1], v: v, k: k }); });
    var fld = field(g, samples, settings.target);

    c.save(); roundRink(c, ox, oy, s, g); c.clip(); c.fillStyle = T.rink; c.fillRect(ox, oy, g.L * s, mapH);
    var heat = document.createElement("canvas"); heat.width = NX; heat.height = NY;
    var hc = heat.getContext("2d"), img = hc.createImageData(NX, NY);
    for (var j = 0; j < NY; j++) for (var i = 0; i < NX; i++) {
      var col = colorFor(bands, fld[i + j * NX]), di = ((NY - 1 - j) * NX + i) * 4;
      img.data[di] = col[0]; img.data[di + 1] = col[1]; img.data[di + 2] = col[2]; img.data[di + 3] = 255;
    }
    hc.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"; c.globalAlpha = .9; c.drawImage(heat, ox, oy, g.L * s, mapH); c.globalAlpha = 1;
    var line = function (x1, y1, x2, y2, col, w) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(FX(x1), FY(y1)); c.lineTo(FX(x2), FY(y2)); c.stroke(); };
    var circ = function (x, y, r, col, w, fill) { c.beginPath(); c.arc(FX(x), FY(y), r * s, 0, 7); if (fill) { c.fillStyle = col; c.fill(); } else { c.strokeStyle = col; c.lineWidth = w; c.stroke(); } };
    var lw = Math.max(1.2, s * .35);
    line(g.GOAL1, 0, g.GOAL1, g.W, RED, lw); line(g.GOAL2, 0, g.GOAL2, g.W, RED, lw); line(g.CX, 0, g.CX, g.W, RED, lw);
    line(g.BLUE1, 0, g.BLUE1, g.W, BLUE, lw * 1.6); line(g.BLUE2, 0, g.BLUE2, g.W, BLUE, lw * 1.6); circ(g.CX, g.CY, 15, BLUE, lw);
    [[g.FO_L, g.FO_B], [g.FO_L, g.FO_T], [g.FO_R, g.FO_B], [g.FO_R, g.FO_T]].forEach(function (p) { circ(p[0], p[1], 15, RED, lw); circ(p[0], p[1], 2, RED, 0, true); });
    circ(g.CX, g.CY, 1.6, RED, 0, true);
    c.restore();
    roundRink(c, ox, oy, s, g); c.lineWidth = 3; c.strokeStyle = T.edge; c.stroke();

    /* orientation words, as on the Ice map */
    c.save(); c.fillStyle = T.orient; c.textAlign = "center"; c.textBaseline = "middle"; c.font = "700 " + Math.max(11, 3.2 * s) + "px Arial, sans-serif";
    c.fillText("HOME BENCH", FX(g.L * .3), FY(g.W - 3.4)); c.fillText("AWAY BENCH", FX(g.L * .7), FY(g.W - 3.4)); c.fillText("BLEACHERS", FX(g.L / 2), FY(3.4));
    c.save(); c.translate(FX(3.4), FY(g.W / 2)); c.rotate(-Math.PI / 2); c.fillText("ZAMBONI ROOM", 0, 0); c.restore();
    c.save(); c.translate(FX(g.L - 3.4), FY(g.W / 2)); c.rotate(Math.PI / 2); c.fillText("LOBBY", 0, 0); c.restore(); c.restore();

    /* the spots: a dot in the reading's band, the reading above it */
    var fs = Math.max(11, Math.min(opts.labelMax || 18, s * 2.1));
    samples.forEach(function (p) {
      var px = FX(p.x), py = FY(p.y), col = colorFor(bands, p.v);
      c.beginPath(); c.arc(px, py, Math.max(5, s * .75), 0, 7); c.fillStyle = "rgb(" + Math.round(col[0]) + "," + Math.round(col[1]) + "," + Math.round(col[2]) + ")"; c.fill();
      c.lineWidth = 1.6; c.strokeStyle = T.dot; c.stroke();
      if (opts.labels !== false) {
        var t = String(opts.data[p.k]).replace(/"/g, ""); c.font = "700 " + fs + "px Consolas, monospace"; c.textAlign = "center"; c.textBaseline = "bottom";
        var tw = c.measureText(t).width; c.fillStyle = T.lblBg; c.fillRect(px - tw / 2 - 3, py - Math.max(5, s * .75) - fs - 3, tw + 6, fs + 3);
        c.fillStyle = T.ink; c.fillText(t, px, py - Math.max(5, s * .75) - 2);
      }
    });

    if (opts.legend !== false) {
      var lx = pad, ly = oy + mapH + Math.round(38 * big), f1 = Math.round(15 * big), f2 = Math.round(13 * big), sw = Math.round(18 * big);
      c.textBaseline = "middle"; c.textAlign = "left"; c.font = "600 " + f1 + "px Arial, sans-serif";
      bands.forEach(function (b) {
        c.fillStyle = b.color; c.fillRect(lx, ly - sw / 2, sw, sw); c.strokeStyle = T.swatchEdge; c.lineWidth = 1; c.strokeRect(lx, ly - sw / 2, sw, sw);
        c.fillStyle = T.ink; c.font = "600 " + f1 + "px Arial, sans-serif"; c.fillText(b.label, lx + sw + 8, ly); var w1 = c.measureText(b.label).width;
        c.fillStyle = T.ink2; c.font = f2 + "px Arial, sans-serif"; c.fillText(b.rng, lx + sw + 8 + w1 + 8, ly); var w2 = c.measureText(b.rng).width;
        lx += sw + 8 + w1 + 8 + w2 + Math.round(28 * big);
      });
    }
    return cv;
  }

  /* The picture for the screen in the Zamboni room: 1920 x 1080, dark, one sheet's latest round, written to be read from across
     the room. opts: facility, sheet (names), round {date, data}, size, settings (Records.settingsOf). Returns a canvas. */
  function tvImage(opts) {
    var R = global.Records, W = 1920, H = 1080, pad = 48, T = LOOK.dark, MONO = "Consolas, 'Courier New', monospace";
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var c = cv.getContext("2d"); c.fillStyle = T.bg; c.fillRect(0, 0, W, H);
    var vals = Object.keys(opts.round.data || {}).map(function (k) { return R.readingValue(opts.round.data[k]); }).filter(isFinite);
    var avg = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : 0;
    c.textBaseline = "alphabetic"; c.textAlign = "left";
    c.fillStyle = T.ink; c.font = "800 52px Arial, sans-serif"; c.fillText((opts.facility + " \u00b7 " + opts.sheet).toUpperCase(), pad, pad + 48);
    var d = new Date(opts.round.date);
    var when = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + " \u00b7 " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    c.fillStyle = "#ffb000"; c.font = "600 30px " + MONO; c.fillText("LATEST ROUND  " + when.toUpperCase() + "  \u00b7  " + vals.length + " READINGS", pad, pad + 92);
    /* the three figures, scoreboard style, at the right */
    var stats = vals.length ? [["THINNEST", eighths(Math.min.apply(null, vals))], ["AVERAGE", avg.toFixed(2) + "\u2033"], ["THICKEST", eighths(Math.max.apply(null, vals))]] : [];
    var x = W - pad;
    stats.slice().reverse().forEach(function (q) {
      c.textAlign = "right"; c.fillStyle = "#ffb000"; c.font = "700 64px " + MONO; c.fillText(q[1], x, pad + 62);
      var w = c.measureText(q[1]).width;
      c.fillStyle = T.ink2; c.font = "600 22px Arial, sans-serif"; c.fillText(q[0], x, pad + 96);
      x -= w + 56;
    });
    var map = iceMap({ size: opts.size, data: opts.round.data, settings: opts.settings, width: 1790, theme: "dark", scale: 1.5, labelMax: 26 });
    var top = pad + 126, hh = Math.min(map.height, H - top - 12);
    c.drawImage(map, 0, 0, map.width, hh, Math.round((W - map.width) / 2), top, map.width, hh);
    return cv;
  }

  /* ---------- the glass plan ---------- */
  var K = { ice: "#fbfdfe", line: "#d3dcea", line2: "#b4c2d8", red: "#d6453f", blue: "#2f86c5", okSoft: "#e4ecf1", replace: "#c8202f", plexi: "#a85d00",
    warn: "#a85d00", zam: "#dde6f1", ink2: "#52627a", ink3: "#64748c", accent: "#1747d1", surface2: "#eaf0f8", white: "#ffffff" };
  function esc(t) { return String(t).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }
  function ftin(feet) { var whole = Math.floor(feet), inch = Math.round((feet - whole) * 12); return inch === 12 ? (whole + 1) + "′ – 0″" : whole + "′ – " + inch + "″"; }
  function fmtFt(inches) { var q = Math.round(inches * 4) / 4, f = Math.floor(q / 12), i = +(q - f * 12).toFixed(2); return f + "′" + (i ? " " + i + "″" : ""); }

  /* The layout this sheet's glass is drawn from: what Records.glassFor found, turned into panels. Conway's is the
     compiled-in survey (glass-data.js); a built sheet's is its walk run through glass-gen.js, or the drawing it kept. */
  function layoutOf(gf) {
    if (!gf || !gf.layout) return null;
    if (gf.bound && typeof DATA !== "undefined") {
      return { rink: DATA.rink, panels: DATA.panels, edges: { top: "Bleacher side", bottom: "Bench side", left: "Zamboni end", right: "Lobby end" }, zamDoorLabel: "Zamboni doors · 9′7″" };
    }
    if (gf.spec && global.tryLayout) { var lay = global.tryLayout(gf.spec); if (lay) return lay; }
    return gf.drawn || null;
  }

  /* gf: Records.glassFor's answer. Returns an SVG string (colours written in, no stylesheet needed), or "" when there is no glass to draw. */
  function glassPlan(gf, name) {
    var lay = layoutOf(gf); if (!lay) return "";
    var P = lay.panels, GL = P.filter(function (p) { return p.kind === "glass"; }), L = lay.rink.L, W = lay.rink.W, R = lay.rink.R, st = gf.panels || {};
    var tagOf = function (p) { var r = st[p.id]; return (r && r.tag !== undefined) ? r.tag : (p.tag || ""); };
    var labelOf = function (p) { var r = st[p.id]; return (r && r.label !== undefined) ? r.label : (p.label || ""); };
    var status = function (p) { return (st[p.id] && st[p.id].status) || "ok"; };
    var reg = L === 200 && W === 85;
    var hx = L / 2, hy = W / 2, sx = hx - R, sy = hy - R;
    var icePath = "M " + (-sx) + "," + (-hy) + " H " + sx + " A " + R + " " + R + " 0 0 1 " + hx + "," + (-sy) + " V " + sy + " A " + R + " " + R + " 0 0 1 " + sx + "," + hy + " H " + (-sx) + " A " + R + " " + R + " 0 0 1 " + (-hx) + "," + sy + " V " + (-sy) + " A " + R + " " + R + " 0 0 1 " + (-sx) + "," + (-hy) + " Z";
    var o = [];
    o.push('<defs><clipPath id="rmclip"><path d="' + icePath + '"/></clipPath>' +
      '<pattern id="rmhatch" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.2" height="2.2" fill="' + K.surface2 + '"/><line x1="0" y1="0" x2="0" y2="2.2" stroke="' + K.ink3 + '" stroke-width=".45" opacity=".55"/></pattern>' +
      '<pattern id="rmhatchw" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.2" height="2.2" fill="' + K.surface2 + '"/><line x1="0" y1="0" x2="0" y2="2.2" stroke="' + K.warn + '" stroke-width=".7"/></pattern></defs>');
    o.push('<path d="' + icePath + '" fill="' + K.ice + '" stroke="' + K.line + '" stroke-width=".3"/>');
    /* markings: a centre line always; the rest only on a regulation sheet (glass.html markings()) */
    var g = [], ln = function (x, c, w) { g.push('<line x1="' + x + '" y1="' + (-hy) + '" x2="' + x + '" y2="' + hy + '" stroke="' + c + '" stroke-width="' + w + '"/>'); };
    if (!reg) ln(0, K.red, 1);
    else {
      var gl = L / 2 - 11, bl = 25;
      ln(-gl, K.red, .35); ln(gl, K.red, .35); ln(-bl, K.blue, 1); ln(bl, K.blue, 1); ln(0, K.red, 1);
      var circ = function (x, y, r, c, w) { g.push('<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="none" stroke="' + c + '" stroke-width="' + w + '"/>'); };
      circ(0, 0, 15, K.blue, .35); g.push('<circle cx="0" cy="0" r=".75" fill="' + K.blue + '"/>');
      [[-69, -22], [-69, 22], [69, -22], [69, 22]].forEach(function (p) { circ(p[0], p[1], 15, K.red, .35); g.push('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1" fill="' + K.red + '"/>'); });
    }
    o.push('<g opacity=".5" clip-path="url(#rmclip)">' + g.join("") + "</g>");
    /* openings and the unverified gap */
    P.filter(function (p) { return p.kind !== "glass" && p.kind !== "door"; }).forEach(function (p) {
      var gap = p.kind === "gap";
      o.push('<path d="' + p.d + '" fill="url(#' + (gap ? "rmhatchw" : "rmhatch") + ')" stroke="' + (gap ? K.warn : K.line2) + '" stroke-width=".25"/>');
      var txt = gap ? "Gap " + fmtFt(p.width_in) : p.label;
      o.push('<text x="' + p.ix + '" y="' + p.iy + '" transform="rotate(' + p.rot + " " + p.ix + " " + p.iy + ')" font-family="Arial,sans-serif" font-size="1.95" font-weight="600" fill="' + (gap ? K.warn : K.ink2) + '" text-anchor="middle" dominant-baseline="middle">' + esc(txt || "") + "</text>");
    });
    /* the glass, by condition */
    GL.forEach(function (p) {
      var s = status(p), fill = s === "ok" ? (tagOf(p) === "zamdoor" ? K.zam : K.okSoft) : s === "replace" ? K.replace : K.plexi;
      var dash = tagOf(p) === "assumed" ? ' stroke-dasharray=".7 .5"' : "";
      o.push('<path d="' + p.d + '" fill="' + fill + '" stroke="' + (tagOf(p) === "assumed" ? K.warn : K.white) + '" stroke-width="' + (tagOf(p) === "assumed" ? ".38" : ".16") + '"' + dash + "/>");
    });
    GL.filter(function (p) { return tagOf(p) && tagOf(p) !== "zamdoor"; }).forEach(function (p) {
      var dx = p.ix - p.cx, dy = p.iy - p.cy, m = Math.hypot(dx, dy), x0 = p.cx + dx / m * 1.45, y0 = p.cy + dy / m * 1.45;
      var col = { door: K.accent, feature: K.red, damage: K.replace, assumed: K.warn }[tagOf(p)] || K.ink3;
      o.push('<line x1="' + x0.toFixed(2) + '" y1="' + y0.toFixed(2) + '" x2="' + (x0 + dx / m * 2.1).toFixed(2) + '" y2="' + (y0 + dy / m * 2.1).toFixed(2) + '" stroke="' + col + '" stroke-width=".45" stroke-linecap="round"/>');
    });
    GL.forEach(function (p) {
      if (p.len_ft >= 2.4) o.push('<text x="' + p.lx + '" y="' + p.ly + '" transform="rotate(' + p.rot + " " + p.lx + " " + p.ly + ')" font-family="Consolas,monospace" font-size="1.62" fill="' + (status(p) !== "ok" ? K.white : K.ink3) + '" text-anchor="middle" dominant-baseline="middle">' + String(p.id).replace(/^0+/, "") + "</text>");
    });
    var d1 = GL.filter(function (p) { return tagOf(p) === "zamdoor"; })[0];
    if (d1 && lay.zamDoorLabel) o.push('<text x="' + (d1.ix + 2.2) + '" y="0" transform="rotate(-90 ' + (d1.ix + 2.2) + ' 0)" font-family="Arial,sans-serif" font-size="2.5" font-weight="600" fill="' + K.accent + '" text-anchor="middle" dominant-baseline="middle">' + esc(lay.zamDoorLabel) + "</text>");
    var ed = lay.edges || {}, lbl = function (x, y, t, rot) { o.push('<text x="' + x + '" y="' + y + '"' + (rot ? ' transform="rotate(' + rot + " " + x + " " + y + ')"' : "") + ' font-family="Arial,sans-serif" font-size="3.4" font-weight="600" letter-spacing=".24em" fill="' + K.ink3 + '" text-anchor="middle">' + esc(String(t).toUpperCase()) + "</text>"); };
    if (ed.top) lbl(0, W / 2 + 9.1, ed.top); if (ed.bottom) lbl(0, -(W / 2 + 9.9), ed.bottom);
    if (ed.left) lbl(-(L / 2 + 8.5), 0, ed.left, -90); if (ed.right) lbl(L / 2 + 8.5, 0, ed.right, 90);
    o.push('<text x="0" y="' + (W / 2 + 14.1) + '" font-family="Consolas,monospace" font-size="2.6" fill="' + K.ink3 + '" text-anchor="middle">' + ftin(L) + "</text>");
    o.push('<text x="' + (-(L / 2 + 13.6)) + '" y="0" transform="rotate(-90 ' + (-(L / 2 + 13.6)) + ' 0)" font-family="Consolas,monospace" font-size="2.6" fill="' + K.ink3 + '" text-anchor="middle">' + ftin(W) + "</text>");
    var vx = -(L / 2 + 18), vy = -(W / 2 + 17.5);
    return '<svg xmlns="http://www.w3.org/2000/svg" class="rp-plan" viewBox="' + vx + " " + vy + " " + (L + 36) + " " + (W + 35) + '" role="img" aria-label="Plan view of the glass' + (name ? " at " + esc(name) : "") + '">' + o.join("") + "</svg>";
  }
  /* The count under the plan: how many of each condition. */
  function glassCounts(gf) {
    var lay = layoutOf(gf); if (!lay) return null;
    var out = { total: 0, ok: 0, replace: 0, plexi: 0 }, st = gf.panels || {};
    lay.panels.filter(function (p) { return p.kind === "glass"; }).forEach(function (p) { var s = (st[p.id] && st[p.id].status) || "ok"; out.total++; out[s] = (out[s] || 0) + 1; });
    return out;
  }

  global.ReportMaps = { iceMap: iceMap, tvImage: tvImage, glassPlan: glassPlan, glassCounts: glassCounts, layoutOf: layoutOf, bandsFor: bandsFor, colorFor: colorFor, eighths: eighths, geometry: geometry };
})(this);
