/* The shell's pages: Facilities, Sheets, and (for now) a holding page for Sheet
   settings and Staff, which arrive with D2b.

   A page is handed the route and the data and returns an element. It reads
   through the data it was given and writes only through the store: a new
   facility or sheet through Repo.addSheet() (a page never assembles that write
   itself, or it is one read() away from restamping every record on the device),
   and the card-or-table choice as a device preference. Nothing here is typed
   into markup: every name is set as text. */
(function (global) {
  "use strict";

  var Repo = Records.Repo, Store = Records.Store;
  var VIEW_KEY = "rink_home_view";
  var view = "cards";
  try { if (global.localStorage.getItem(VIEW_KEY) === "fleet") view = "fleet"; } catch (e) {}
  var addOpen = null;                     // which add form is showing: "fac", "sheet" or null
  var Shell = null;
  var h = null;

  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function ago(d) {
    var days = Math.floor((Date.now() - new Date(d)) / 86400000);
    if (!isFinite(days)) return null;
    return days <= 0 ? "today" : days === 1 ? "yesterday" : days + " days ago";
  }
  function chip(cls, text) { return h("span", { cls: "chip " + cls, text: text }); }

  /* The two facts about a sheet, in the words a person scans for. */
  function iceChip(st) {
    if (!st.last) return chip("", "No rounds yet");
    return st.over ? chip("bad", "Overdue " + plural(st.overBy, "day")) : chip("ok", "Up to date");
  }
  function glassChip(g) {
    if (!g || !g.known) return chip("", "Glass not loaded");
    if (!g.layout) return chip("", "No glass built");
    var flags = g.replace + g.plexi;
    return flags ? chip("warn", plural(flags, "glass flag")) : chip("ok", "Glass OK");
  }
  function sizeText(sheet) {
    var s = Records.shapeOf(sheet);
    return s.L + "′ × " + s.W + "′";
  }

  /* Whole-sheet average thickness over the last rounds. */
  function spark(v) {
    if (!v.length) return h("div", { cls: "trend" }, [h("div", { cls: "empty", text: "No rounds yet" })]);
    var w = 300, ht = 64, pad = 6, min = Math.min.apply(null, v) - 0.04, max = Math.max.apply(null, v) + 0.04;
    var pts = v.map(function (y, i) {
      return [v.length === 1 ? w / 2 : pad + i * (w - 2 * pad) / (v.length - 1), ht - pad - (y - min) / (max - min) * (ht - 2 * pad)];
    });
    var line = pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
    var e = pts[pts.length - 1];
    var wrap = h("div", { cls: "trend" });
    wrap.innerHTML =                       // numbers only: nothing a person typed goes in here
      '<svg viewBox="0 0 ' + w + " " + ht + '" role="img" aria-label="Average thickness over the last ' + v.length +
      " rounds, now " + v[v.length - 1].toFixed(2) + ' inches">' +
      '<line x1="' + pad + '" x2="' + (w - pad) + '" y1="' + (ht - pad) + '" y2="' + (ht - pad) + '" stroke="var(--line)"/>' +
      (v.length > 1 ? '<polyline points="' + line + '" fill="none" stroke="var(--frost)" stroke-width="2" stroke-linejoin="round"/>' : "") +
      '<circle cx="' + e[0] + '" cy="' + e[1] + '" r="4" fill="var(--frost)"/></svg>' +
      '<div class="cap">avg thickness, last ' + v.length + " round" + (v.length === 1 ? "" : "s") +
      " · now " + v[v.length - 1].toFixed(2) + "″</div>";
    return wrap;
  }

  /* ---------- adding ---------- */
  function sizeSelect() {
    var sel = h("select", { id: "addSize" });
    Records.RINK_SIZES.forEach(function (r) { sel.appendChild(h("option", { value: r.id, text: r.name })); });
    sel.value = "nhl";
    return sel;
  }
  function addForm(kind, facility) {
    var form = h("div", { cls: "addform", id: "addForm" });
    var name = h("input", { type: "text", id: "addName", autocomplete: "off",
      placeholder: kind === "fac" ? "Nashua Twin Rinks" : "Main sheet", "aria-label": kind === "fac" ? "Facility name" : "Sheet name" });
    form.appendChild(h("label", { cls: "af" }, [h("span", { text: kind === "fac" ? "Facility name" : "Sheet name" }), name]));
    var sheetName = null;
    if (kind === "fac") {
      sheetName = h("input", { type: "text", id: "addSheetName", autocomplete: "off", placeholder: "Main sheet", "aria-label": "First sheet name" });
      form.appendChild(h("label", { cls: "af" }, [h("span", { text: "First sheet" }), sheetName]));
    }
    var size = sizeSelect();
    form.appendChild(h("label", { cls: "af" }, [h("span", { text: "Ice size" }), size]));
    var note = h("span", { cls: "afnote", id: "addNote" });
    var go = h("button", { cls: "btn", type: "button", id: "addGo", text: kind === "fac" ? "Add facility" : "Add sheet" });
    var cancel = h("button", { cls: "btn ghost", type: "button", id: "addCancel", text: "Cancel",
      onclick: function () { addOpen = null; Shell.refresh(); } });
    go.addEventListener("click", async function () {
      var n = name.value.trim();
      if (kind === "fac" && !n) { note.textContent = "Name the facility first."; note.className = "afnote bad"; name.focus(); return; }
      var sz = Records.RINK_SIZES.filter(function (r) { return r.id === size.value; })[0];
      await Repo.addSheet(kind === "fac"
        ? { facilityId: null, facilityName: n, name: sheetName.value.trim(), size: sz ? Object.assign({}, sz) : null }
        : { facilityId: facility.id, name: n, size: sz ? Object.assign({}, sz) : null });
      addOpen = null;
      await Shell.refresh();
      if (typeof Sync !== "undefined") Sync.nudge();        // it should reach the other devices now
    });
    form.appendChild(h("div", { cls: "afrow" }, [go, cancel, note]));
    return form;
  }
  function addButton(kind, label, facility) {
    if (!Shell.canManage()) return null;
    return h("button", { cls: "btn", type: "button", id: kind === "fac" ? "addFac" : "addSheet", text: label,
      onclick: function () { addOpen = kind; Shell.refresh().then(function () { var n = document.getElementById("addName"); if (n) n.focus(); }); } });
  }

  /* ---------- Facilities ---------- */
  function facilityRow(d, f) {
    var sheets = f.sheets || [], over = 0, flags = 0, withRounds = 0;
    sheets.forEach(function (s) {
      var st = Shell.status(d, f, s);
      if (st.over) over++;
      if (st.last) withRounds++;
      var g = d.glass[s.id]; if (g && g.known && g.layout) flags += g.replace + g.plexi;
    });
    var chips = h("div", { cls: "chips" });
    chips.appendChild(over ? chip("bad", over + " overdue") : withRounds ? chip("ok", "All up to date") : chip("", "No rounds yet"));
    if (flags) chips.appendChild(chip("warn", plural(flags, "glass flag")));
    return h("a", { cls: "row frow", href: "#/f/" + f.id, "data-fid": f.id }, [
      h("div", {}, [h("div", { cls: "name", text: f.name }), h("div", { cls: "meta", text: plural(sheets.length, "sheet") })]),
      chips, h("span", { cls: "go", text: "Open sheets →" })]);
  }
  function fleetTable(d) {
    var tb = h("tbody");
    d.facilities.forEach(function (f) {
      (f.sheets || []).forEach(function (s) {
        var st = Shell.status(d, f, s);
        tb.appendChild(h("tr", { cls: "link", "data-fid": f.id, "data-sid": s.id,
          onclick: function () { Shell.go("#/f/" + f.id + "/s/" + s.id); } }, [
          h("td", { text: f.name }), h("td", { text: s.name || "Sheet" }),
          h("td", { text: st.last ? ago(st.last.date) || "unknown" : "No rounds" }),
          h("td", {}, [iceChip(st)]), h("td", {}, [glassChip(d.glass[s.id])])]));
      });
    });
    var table = h("table", { id: "fleetTable" }, [
      h("thead", {}, [h("tr", {}, ["Facility", "Sheet", "Last round", "Ice", "Glass"].map(function (t) { return h("th", { text: t }); }))]), tb]);
    return h("div", { cls: "tablewrap" }, [table]);
  }
  function facilities(d) {
    var el = h("div", { cls: "screen", id: "pageFacilities" });
    el.appendChild(h("div", { cls: "crumb", text: "Facilities" }));
    el.appendChild(h("h2", { text: "Choose a facility" }));
    el.appendChild(h("p", { cls: "sub", text: "Each facility is a building. Its sheets are the ice surfaces inside it." }));
    var seg = h("div", { cls: "seg", role: "group", "aria-label": "View" }, ["cards", "fleet"].map(function (v) {
      return h("button", { type: "button", id: v === "cards" ? "viewCards" : "viewFleet", text: v === "cards" ? "Cards" : "Fleet table",
        "aria-pressed": String(view === v),
        onclick: function () { view = v; Store.set(VIEW_KEY, v); Shell.refresh(); } });
    }));
    el.appendChild(h("div", { cls: "toolbar" }, [
      h("span", { cls: "meta", id: "facCount", text: plural(d.facilities.length, "facility", "facilities") }),
      h("span", { cls: "chips" }, [d.facilities.length ? seg : null, addButton("fac", "+ Add facility")])]));
    if (addOpen === "fac") el.appendChild(addForm("fac"));
    if (!d.facilities.length) {
      el.appendChild(h("div", { cls: "empty-state", id: "noFacilities",
        text: "No facilities on this device yet. They arrive once this device has synced." }));
      return el;
    }
    if (view === "fleet") el.appendChild(fleetTable(d));
    else el.appendChild(h("div", { cls: "rows", id: "facRows" }, d.facilities.map(function (f) { return facilityRow(d, f); })));
    return el;
  }

  /* ---------- Sheets ---------- */
  function sheetRow(d, f, s) {
    var st = Shell.status(d, f, s);
    var trend = Records.trendOf(d.sessions, s.id, 10).map(function (t) { return t.avg; });
    function open(app) {
      return h("button", { cls: "btn" + (app === "ice" ? "" : " ghost"), type: "button", "data-open": app,
        text: app === "ice" ? "Ice Manager" : "Glass Manager",
        onclick: function () { Shell.setHere(f, s).then(function () { global.location.href = Shell.appHref(app, f, s); }); } });
    }
    return h("div", { cls: "row srow", "data-sid": s.id }, [
      h("div", {}, [h("div", { cls: "name", text: s.name || "Sheet" }),
        h("div", { cls: "meta", text: sizeText(s) + " · last round: " + (st.last ? ago(st.last.date) || "unknown" : "No rounds") })]),
      h("div", { cls: "stat" }, [h("div", { cls: "chips" }, [iceChip(st), glassChip(d.glass[s.id])]), spark(trend)]),
      h("div", { cls: "apps" }, [open("ice"), open("glass"),
        h("a", { cls: "btn ghost sm", href: "#/f/" + f.id + "/s/" + s.id + "/settings", "data-open": "settings", text: "Sheet settings" })])]);
  }
  function sheets(route, d) {
    var f = d.facilities.filter(function (x) { return x.id === route.fid; })[0];
    var el = h("div", { cls: "screen", id: "pageSheets" });
    el.appendChild(h("div", { cls: "crumb" }, [h("a", { href: "#/", text: "Facilities" }), " / " + f.name]));
    el.appendChild(h("h2", { text: f.name }));
    if (removed && removed.fid !== f.id) removed = null;
    if (removed) {
      var gone = removed;
      el.appendChild(h("div", { cls: "banner good", id: "removedBanner", style: "margin-bottom:14px" }, [
        gone.name + " has been hidden. Its readings and glass are kept, and management can bring it back.",
        h("button", { cls: "btn sm", type: "button", id: "undoRemove", text: "Undo, bring it back", onclick: async function () {
          var r = await Repo.restoreSheet(gone.sid); removed = null;
          if (r.changed && typeof Sync !== "undefined") Sync.nudge();
          await Shell.refresh(); } })]));
    }
    el.appendChild(h("p", { cls: "sub", text: "Choose a sheet and open an app for it. The trend is readable here without opening Ice Manager." }));
    el.appendChild(h("div", { cls: "toolbar" }, [
      h("span", { cls: "meta", id: "sheetCount", text: plural((f.sheets || []).length, "sheet") }), addButton("sheet", "+ Add sheet", f)]));
    if (addOpen === "sheet") el.appendChild(addForm("sheet", f));
    el.appendChild(h("div", { cls: "rows", id: "sheetRows" }, (f.sheets || []).map(function (s) { return sheetRow(d, f, s); })));
    /* Management can bring a hidden sheet back, with its readings, from here at any time. */
    var hidden = (d.removed || []).filter(function (r) { return r.facilityId === f.id; });
    if (hidden.length && Shell.canManage()) {
      var box = h("div", { cls: "card", id: "removedList", style: "margin-top:18px" }, [h("div", { cls: "eyebrow", text: "Removed sheets" })]);
      hidden.forEach(function (r) {
        box.appendChild(h("div", { cls: "toolbar", "data-rid": r.id, style: "margin:0 0 8px" }, [
          h("span", {}, [h("b", { text: r.name }), h("span", { cls: "meta", text: "  " + sizeText(r) })]),
          h("button", { cls: "btn ghost sm", type: "button", "data-restore": r.id, disabled: !Shell.canEdit(), text: "Bring back",
            onclick: async function () {
              var res = await Repo.restoreSheet(r.id);
              if (res.changed && typeof Sync !== "undefined") Sync.nudge();
              await Shell.refresh(); } })]));
      });
      el.appendChild(box);
    }
    return el;
  }

  /* ---------- Sheet settings ----------
     One sheet's name and shape, entered once for both apps. The page keeps a DRAFT
     while you step the numbers, and writes nothing until Save, which is a single
     Repo.updateSheet (all of it or none of it). Readings are never touched: changing
     the size only redraws the outline. The glass is not rebuilt either; the page says
     when what it was built against no longer matches. */
  var draft = null, savedMsg = "", removed = null;
  var STEPS = {
    L:   { label: "Length", unit: "ft", step: 0.5, min: 20, max: 300, text: function (v) { return v + "′"; } },
    W:   { label: "Width", unit: "ft", step: 0.5, min: 10, max: 200, text: function (v) { return v + "′"; } },
    Rft: { label: "Corner radius", unit: "ft", step: 1, min: 0, max: 60, text: function (v) { return v + "′"; } },
    Rin: { label: "and", unit: "in", step: 0.5, min: 0, max: 11.5, text: function (v) { return v + "″"; } }
  };
  function presetOf(s) {
    var hit = Records.RINK_SIZES.filter(function (r) {
      var p = Records.shapeFromSize(r); return r.L === s.L && r.W === s.W && p.Rft === s.Rft && p.Rin === s.Rin; })[0];
    return hit ? hit.id : "custom";
  }
  function initDraft(sheet) {
    var s = Records.shapeOf(sheet);
    draft = { sid: sheet.id, name: sheet.name || "", L: s.L, W: s.W, Rft: s.Rft, Rin: s.Rin,
              start: s.start || "zam", turn: !!s.turn, flip: !!s.flip, preset: presetOf(s), confirm: false };
  }
  function draftShape() { return { L: draft.L, W: draft.W, Rft: draft.Rft, Rin: draft.Rin, start: draft.start, turn: draft.turn, flip: draft.flip }; }
  function cornerText(v) { var f = Math.floor(v + 1e-9), i = Math.round((v - f) * 24) / 2; return f + "′ " + i + "″"; }
  function problemText(shape) {
    var p = Records.shapeProblem(shape);
    return /too big/.test(p) ? "The corner is too big for this sheet. Reduce the radius or enlarge the sheet." : p;
  }
  function outline(shape) {
    var r0 = shape.Rft + shape.Rin / 12;
    var w = 560, m = 34, pw = w - 2 * m, ph = Math.max(60, Math.min(220, pw * shape.W / shape.L));
    var r = Math.max(0, Math.min(r0 / shape.L * pw, ph / 2 - 1)), x = m, y = 26;
    var mark = shape.start === "zam" ? [x, y + ph / 2] : [x + pw / 2, y];
    var wrap = h("div", { cls: "outline" });
    wrap.innerHTML =                         // numbers and fixed words only
      '<svg viewBox="0 0 ' + w + " " + (ph + 56) + '" role="img" aria-label="Outline of the sheet, ' + shape.L + " by " + shape.W + ' feet">' +
      '<rect class="o" x="' + x + '" y="' + y + '" width="' + pw + '" height="' + ph + '" rx="' + r + '"/>' +
      '<line x1="' + (x + pw / 2) + '" x2="' + (x + pw / 2) + '" y1="' + y + '" y2="' + (y + ph) + '" stroke="var(--line-2)" stroke-dasharray="6 6"/>' +
      '<circle cx="' + mark[0] + '" cy="' + mark[1] + '" r="6" fill="var(--frost)"/>' +
      '<text x="' + (mark[0] + (shape.start === "zam" ? 10 : -30)) + '" y="' + (mark[1] - 10) + '" style="fill:var(--frost)">walk starts</text>' +
      '<text x="' + (x + pw / 2) + '" y="' + (y + ph + 22) + '" text-anchor="middle">' + shape.L + "′</text>" +
      '<text x="' + (x - 8) + '" y="' + (y + ph / 2) + '" text-anchor="end">' + shape.W + "′</text>" +
      '<text x="' + (x + pw / 2) + '" y="' + (y + ph / 2 + 4) + '" text-anchor="middle">' + (shape.turn ? "turned 180° " : "") + (shape.flip ? "mirrored" : "") + "</text></svg>";
    return wrap;
  }
  function stepper(key, dis) {
    var c = STEPS[key];
    function nudge(dir) {
      var nv = Math.round((draft[key] + dir * c.step) * 1000) / 1000;
      draft[key] = Math.min(c.max, Math.max(c.min, nv)); draft.preset = "custom"; savedMsg = ""; Shell.repaint();
    }
    return h("div", { cls: "field" }, [c.label + " (" + c.unit + ")", h("div", { cls: "stp" }, [
      h("button", { cls: "sb", type: "button", "data-s": key, "data-d": "-1", disabled: dis, "aria-label": "Decrease " + c.label, text: "−", onclick: function () { nudge(-1); } }),
      h("span", { cls: "sv", "data-v": key, "aria-live": "polite", text: c.text(draft[key]) }),
      h("button", { cls: "sb", type: "button", "data-s": key, "data-d": "1", disabled: dis, "aria-label": "Increase " + c.label, text: "+", onclick: function () { nudge(1); } })])]);
  }
  function glassCheck(g, per) {
    var el = h("div", { cls: "card" }, [h("div", { cls: "eyebrow", text: "Glass check" })]);
    var note;
    if (!g || !g.known) note = h("div", { cls: "banner info", id: "glassNote", text: "Glass Manager has not been opened on this device, so the glass cannot be checked here." });
    else if (!g.layout) note = h("div", { cls: "banner info", id: "glassNote", text: "No glass has been built for this sheet yet." });
    else if (g.verified == null) note = h("div", { cls: "banner warn", id: "glassNote", text: "This glass was built before its size was recorded. Run the glass build check so the panels are verified against these dimensions." });
    else if (Math.abs(per - g.verified) > 0.05)
      note = h("div", { cls: "banner warn", id: "glassNote", "data-state": "needed", text: "Glass check needed. The boards now measure " + per.toFixed(1) +
        "′. The glass was last built and checked against " + g.verified.toFixed(1) + "′. Run the glass build check again so the panels are verified against the new size. Readings in Ice Manager are not affected." });
    else note = h("div", { cls: "banner good", id: "glassNote", "data-state": "ok", text: "Glass verified. The glass was built and checked against " + g.verified.toFixed(1) + "′ of boards, which matches these dimensions." });
    el.appendChild(note);
    return el;
  }
  function settings(route, d) {
    var f = d.facilities.filter(function (x) { return x.id === route.fid; })[0];
    var sheet = (f.sheets || []).filter(function (x) { return x.id === route.sid; })[0];
    if (!sheet) return holding("Sheet settings", "Facilities", "That page is not available.");
    if (!draft || draft.sid !== sheet.id) initDraft(sheet);
    var canEdit = Shell.canEdit(), dis = !canEdit;
    var shape = draftShape(), bad = Records.shapeProblem(shape) ? problemText(shape) : "", per = Records.shapePerimeter(shape);
    var R = shape.Rft + shape.Rin / 12;

    var el = h("div", { cls: "screen", id: "pageSettings" });
    el.appendChild(h("div", { cls: "crumb" }, [h("a", { href: "#/", text: "Facilities" }), " / ", h("a", { href: "#/f/" + f.id, text: f.name }), " / " + (sheet.name || "Sheet")]));
    el.appendChild(h("h2", { text: "Sheet settings" }));
    el.appendChild(h("p", { cls: "sub", text: "Set here. Ice Manager and Glass Manager both draw from these values. The glass builder asks again and offers to update them." }));
    var body = h("div", { cls: "stack" });
    if (dis) body.appendChild(h("div", { cls: "banner warn", id: "viewOnly",
      text: Shell.canManage() ? "Viewing only. Unlock to edit to change these settings." : "Viewing only. Only Management can change these settings." }));

    var nameIn = h("input", { type: "text", id: "sname", value: draft.name, placeholder: "e.g. Standard, Mini", disabled: dis, autocomplete: "off",
      oninput: function (e) { draft.name = e.target.value; savedMsg = ""; } });
    var left = h("div", { cls: "stack" }, [h("div", { cls: "card" }, [h("div", { cls: "eyebrow", text: "Name" }), h("label", { cls: "field" }, ["Sheet name", nameIn])])]);

    var tiles = h("div", { cls: "tiles" });
    Records.RINK_SIZES.concat([{ id: "custom", name: "Custom" }]).forEach(function (r) {
      tiles.appendChild(h("button", { cls: "tile", type: "button", "data-pre": r.id, disabled: dis, text: r.name, "aria-pressed": String(draft.preset === r.id),
        onclick: function () {
          draft.preset = r.id;
          if (r.L) { var p = Records.shapeFromSize(r); draft.L = p.L; draft.W = p.W; draft.Rft = p.Rft; draft.Rin = p.Rin; }
          savedMsg = ""; Shell.repaint(); } }));
    });
    var size = h("div", { cls: "card" }, [h("div", { cls: "eyebrow", text: "Size" }), h("div", { cls: "field" }, ["Starting size", tiles]),
      h("div", { cls: "steppers" }, ["L", "W", "Rft", "Rin"].map(function (k) { return stepper(k, dis); })),
      h("div", { cls: "cap", text: "Measure the ice, not the boards." })]);
    if (bad) size.appendChild(h("div", { cls: "banner bad", id: "shapeProblem", style: "margin-top:10px", text: bad }));
    size.appendChild(h("div", { cls: "read" }, [
      h("div", {}, [h("b", { id: "rdPer", text: bad ? "—" : per.toFixed(1) + "′" }), h("span", { text: "Boards to walk" })]),
      h("div", {}, [h("b", { id: "rdCorner", text: cornerText(R) }), h("span", { text: "Corner radius" })]),
      h("div", {}, [h("b", { id: "rdArea", text: bad ? "—" : String(Math.round(shape.L * shape.W - (4 - Math.PI) * R * R)) }), h("span", { text: "Sq ft of ice" })])]));
    left.appendChild(size);

    function pick(opts, current, set) {
      return h("span", { cls: "seg" }, opts.map(function (o) {
        return h("button", { type: "button", disabled: dis, "data-opt": o[0], text: o[1], "aria-pressed": String(current(o[0])),
          onclick: function () { set(o[0]); savedMsg = ""; Shell.repaint(); } });
      }));
    }
    left.appendChild(h("div", { cls: "card" }, [h("div", { cls: "eyebrow", text: "Which way it faces" }), h("div", { cls: "pair" }, [
      h("div", { cls: "field" }, ["Glass walk starts at", pick([["zam", "Zamboni doors"], ["red", "Red line"]], function (v) { return draft.start === v; }, function (v) { draft.start = v; })]),
      h("div", { cls: "field" }, ["Orientation", h("span", { cls: "seg" }, [
        h("button", { type: "button", disabled: dis, "data-opt": "turn", text: "Turn 180°", "aria-pressed": String(draft.turn), onclick: function () { draft.turn = !draft.turn; savedMsg = ""; Shell.repaint(); } }),
        h("button", { type: "button", disabled: dis, "data-opt": "flip", text: "Mirror", "aria-pressed": String(draft.flip), onclick: function () { draft.flip = !draft.flip; savedMsg = ""; Shell.repaint(); } })])])]),
      h("div", { cls: "cap", text: "Hold the drawing up against the room. Turn or mirror it until the benches are on the right side. The same view is used by Ice and Glass." })]));

    var right = h("div", { cls: "stack" }, [
      h("div", { cls: "card" }, [h("div", { cls: "eyebrow" }, [h("span", { text: "Shared outline" }), h("span", { text: "as both apps draw it" })]), bad ? h("div", { cls: "cap", text: "Fix the corner to see the outline." }) : outline(shape)]),
      glassCheck(d.glass[sheet.id], per),
      h("div", { cls: "banner info", text: "Changing the size redraws the Ice map and the Glass plan from the new outline. Existing readings are never touched. Glass panels stay as built until the glass build is checked again." })]);
    body.appendChild(h("div", { cls: "two" }, [left, right]));

    if (Shell.canManage()) {
      var only = (f.sheets || []).length < 2, zone = h("div", { cls: "card danger-zone", id: "removeZone" }, [h("div", { cls: "eyebrow", text: "Remove this sheet" })]);
      if (draft.confirm) {
        zone.appendChild(h("p", { style: "margin:0 0 10px;font-size:14px" }, ["Hide ", h("b", { text: sheet.name || "this sheet" }), "? It disappears from every list. Its readings and glass are kept, and management can bring it back."]));
        zone.appendChild(h("div", { cls: "foot" }, [
          h("button", { cls: "btn danger", type: "button", id: "dyes", disabled: dis, text: "Yes, hide it", onclick: async function () {
            var r = await Repo.removeSheet(sheet.id);
            if (!r.changed) { savedMsg = r.error; draft.confirm = false; Shell.repaint(); return; }
            removed = { sid: sheet.id, fid: f.id, name: sheet.name || "The sheet" };
            if (typeof Sync !== "undefined") Sync.nudge();
            draft = null; Shell.go("#/f/" + f.id); } }),
          h("button", { cls: "btn ghost", type: "button", id: "dno", text: "Keep it", onclick: function () { draft.confirm = false; Shell.repaint(); } })]));
      } else {
        zone.appendChild(h("p", { style: "margin:0 0 10px;font-size:14px;color:var(--ink-dim)", id: "removeNote",
          text: only ? "A facility needs at least one sheet, so this one cannot be removed." : "Hides the sheet from every list without losing anything." }));
        zone.appendChild(h("button", { cls: "btn danger", type: "button", id: "dask", disabled: dis || only, text: "Remove sheet",
          onclick: function () { draft.confirm = true; Shell.repaint(); } }));
      }
      body.appendChild(zone);
    }

    var msg = h("span", { cls: "banner " + (/^Saved/.test(savedMsg) ? "good" : "warn"), id: "saveMsg", style: savedMsg ? "flex:2" : "display:none", text: savedMsg });
    var save = h("button", { cls: "abtn", type: "button", id: "ssave", disabled: dis || !!bad, text: "Save settings", onclick: async function () {
      var r = await Repo.updateSheet(sheet.id, { name: draft.name, shape: draftShape() });
      savedMsg = r.error ? r.error : r.changed ? "Saved. It syncs to the other devices." : "Nothing has changed.";
      if (r.changed && typeof Sync !== "undefined") Sync.nudge();
      if (r.error) { Shell.repaint(); return; }
      draft = null; await Shell.refresh(); } });
    body.appendChild(h("div", { cls: "actionbar" }, [save, msg]));
    el.appendChild(body);
    return el;
  }

  /* ---------- holding pages ---------- */
  function holding(title, crumb, text) {
    var el = h("div", { cls: "screen", id: "pageHolding" });
    el.appendChild(h("div", { cls: "crumb", text: crumb }));
    el.appendChild(h("h2", { text: title }));
    el.appendChild(h("div", { cls: "empty-state", text: text }));
    return el;
  }

  var Home = {
    render: function (route, d, shell) {
      Shell = shell; h = shell.h;
      if (route.page === "sheets") return sheets(route, d);
      if (route.page === "settings") return settings(route, d);
      if (route.page === "staff") return holding("Staff", "Account / staff", "The Staff page arrives with the next step of the shell.");
      return facilities(d);
    },
    view: function () { return view; }
  };
  global.Home = Home;

  document.addEventListener("DOMContentLoaded", function () { /* mounted by index.html once both scripts are loaded */ });
})(this);
