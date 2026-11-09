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
    /* A facility is added by an Admin; a sheet by an Admin or by the Manager of its facility. */
    if (kind === "fac" ? !Shell.isAdmin() : !Shell.canManage(facility && facility.id)) return null;
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
    var open = (d.flags || []).filter(function (x) { return x.fac === f.id; }).length;
    if (open) chips.appendChild(chip("bad", plural(open, "open flag")));
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
          h("td", {}, [iceChip(st)]), h("td", {}, [glassChip(d.glass[s.id])]),
          h("td", { cls: "flagcell", text: String((d.flags || []).filter(function (x) { return x.sheetId === s.id; }).length || "") })]));
      });
    });
    var table = h("table", { id: "fleetTable" }, [
      h("thead", {}, [h("tr", {}, ["Facility", "Sheet", "Last round", "Ice", "Glass", "Open flags"].map(function (t) { return h("th", { text: t }); }))]), tb]);
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
    if (removedFac) {
      var gf = removedFac;
      el.appendChild(h("div", { cls: "banner good", id: "removedFacBanner", style: "margin-bottom:14px" }, [
        gf.name + " has been hidden. Its sheets and readings are kept, and an Admin can bring it back.",
        h("button", { cls: "btn sm", type: "button", id: "undoRemoveFac", text: "Undo, bring it back", onclick: async function () {
          var r = await Repo.restoreFacility(gf.fid); removedFac = null;
          if (r.changed && typeof Sync !== "undefined") Sync.nudge();
          await Shell.refresh(); } })]));
    }
    if (view === "fleet") el.appendChild(fleetTable(d));
    else el.appendChild(h("div", { cls: "rows", id: "facRows" }, d.facilities.map(function (f) { return facilityRow(d, f); })));
    if ((d.removedFacs || []).length && Shell.isAdmin()) {
      var box = h("div", { cls: "card", id: "removedFacList", style: "margin-top:18px" }, [h("div", { cls: "eyebrow", text: "Removed facilities" })]);
      d.removedFacs.forEach(function (r) {
        box.appendChild(h("div", { cls: "toolbar", "data-rid": r.id, style: "margin:0 0 8px" }, [
          h("span", {}, [h("b", { text: r.name })]),
          h("button", { cls: "btn ghost sm", type: "button", "data-restore": r.id, disabled: !Shell.canEdit(), text: "Bring back",
            onclick: async function () {
              var res = await Repo.restoreFacility(r.id);
              if (res.changed && typeof Sync !== "undefined") Sync.nudge();
              await Shell.refresh(); } })]));
      });
      el.appendChild(box);
    }
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
      h("div", { cls: "stat" }, [h("div", { cls: "chips" }, [iceChip(st), glassChip(d.glass[s.id])].concat(
        (d.flags || []).filter(function (x) { return x.sheetId === s.id; }).length
          ? [chip("bad", plural((d.flags || []).filter(function (x) { return x.sheetId === s.id; }).length, "open flag"))] : [])), spark(trend)]),
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
        gone.name + " has been hidden. Its readings and glass are kept, and a Manager or Admin can bring it back.",
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
    if (hidden.length && Shell.canManage(f.id)) {
      var box = h("div", { cls: "card", id: "removedList", style: "margin-top:18px" }, [h("div", { cls: "eyebrow", text: "Removed sheets" })]);
      hidden.forEach(function (r) {
        box.appendChild(h("div", { cls: "toolbar", "data-rid": r.id, style: "margin:0 0 8px" }, [
          h("span", {}, [h("b", { text: r.name }), h("span", { cls: "meta", text: "  " + sizeText(r) })]),
          h("button", { cls: "btn ghost sm", type: "button", "data-restore": r.id, disabled: !Shell.canEdit(f.id), text: "Bring back",
            onclick: async function () {
              var res = await Repo.restoreSheet(r.id);
              if (res.changed && typeof Sync !== "undefined") Sync.nudge();
              await Shell.refresh(); } })]));
      });
      el.appendChild(box);
    }
    if (Shell.isAdmin()) {
      var lone = d.facilities.length < 2, fz = h("div", { cls: "card danger-zone", id: "removeFacZone", style: "margin-top:18px" }, [h("div", { cls: "eyebrow", text: "Remove this facility" })]);
      if (facConfirm === f.id) {
        fz.appendChild(h("p", { style: "margin:0 0 10px;font-size:14px" }, ["Hide ", h("b", { text: f.name }), " and its ", plural((f.sheets || []).length, "sheet"), "? They disappear from every list. All readings and glass are kept, and an Admin can bring it back."]));
        fz.appendChild(h("div", { cls: "foot" }, [
          h("button", { cls: "btn danger", type: "button", id: "fyes", disabled: !Shell.canEdit(), text: "Yes, hide it", onclick: async function () {
            var r = await Repo.removeFacility(f.id); facConfirm = null;
            if (!r.changed) { Shell.toast(r.error); await Shell.refresh(); return; }
            removedFac = { fid: f.id, name: f.name };
            if (typeof Sync !== "undefined") Sync.nudge();
            Shell.go("#/"); } }),
          h("button", { cls: "btn ghost", type: "button", id: "fno", text: "Keep it", onclick: function () { facConfirm = null; Shell.refresh(); } })]));
      } else {
        fz.appendChild(h("p", { style: "margin:0 0 10px;font-size:14px;color:var(--ink-dim)", id: "removeFacNote",
          text: lone ? "At least one facility must stay, so this one cannot be removed." : "Hides the facility and its sheets without losing anything." }));
        fz.appendChild(h("button", { cls: "btn danger", type: "button", id: "fask", disabled: !Shell.canEdit() || lone, text: "Remove facility",
          onclick: function () { facConfirm = f.id; Shell.refresh(); } }));
      }
      el.appendChild(fz);
    }
    return el;
  }

  /* ---------- Sheet settings ----------
     One sheet's name and shape, entered once for both apps. The page keeps a DRAFT
     while you step the numbers, and writes nothing until Save, which is a single
     Repo.updateSheet (all of it or none of it). Readings are never touched: changing
     the size only redraws the outline. The glass is not rebuilt either; the page says
     when what it was built against no longer matches. */
  var draft = null, savedMsg = "", removed = null, removedFac = null, facConfirm = null;
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
      h("button", { cls: "stpb", type: "button", "data-s": key, "data-d": "-1", disabled: dis, "aria-label": "Decrease " + c.label, text: "−", onclick: function () { nudge(-1); } }),
      h("span", { cls: "sv", "data-v": key, "aria-live": "polite", text: c.text(draft[key]) }),
      h("button", { cls: "stpb", type: "button", "data-s": key, "data-d": "1", disabled: dis, "aria-label": "Increase " + c.label, text: "+", onclick: function () { nudge(1); } })])]);
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
    var canEdit = Shell.canEdit(f.id), dis = !canEdit;
    var shape = draftShape(), bad = Records.shapeProblem(shape) ? problemText(shape) : "", per = Records.shapePerimeter(shape);
    var R = shape.Rft + shape.Rin / 12;

    var el = h("div", { cls: "screen", id: "pageSettings" });
    el.appendChild(h("div", { cls: "crumb" }, [h("a", { href: "#/", text: "Facilities" }), " / ", h("a", { href: "#/f/" + f.id, text: f.name }), " / " + (sheet.name || "Sheet")]));
    el.appendChild(h("h2", { text: "Sheet settings" }));
    el.appendChild(h("p", { cls: "sub", text: "Set here. Ice Manager and Glass Manager both draw from these values. The glass builder asks again and offers to update them." }));
    var body = h("div", { cls: "stack" });
    if (dis) body.appendChild(h("div", { cls: "banner warn", id: "viewOnly",
      text: Shell.canManage(f.id) ? "Viewing only. Unlock to edit to change these settings." : "Viewing only. Only a Manager or Admin can change these settings." }));

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

    if (Shell.canManage(f.id)) {
      var only = (f.sheets || []).length < 2, zone = h("div", { cls: "card danger-zone", id: "removeZone" }, [h("div", { cls: "eyebrow", text: "Remove this sheet" })]);
      if (draft.confirm) {
        zone.appendChild(h("p", { style: "margin:0 0 10px;font-size:14px" }, ["Hide ", h("b", { text: sheet.name || "this sheet" }), "? It disappears from every list. Its readings and glass are kept, and a Manager or Admin can bring it back."]));
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

  /* ---------- Staff ----------
     The page for the people who can make changes: an Admin sees and changes everyone, a Manager the Staff in their own
     facilities. Everything goes through the
     manage-staff function (Sync.manage), because creating a sign-in or changing a password
     needs a key that must never be in a page. A code it hands back is shown ONCE, here, and
     lives only in this variable: it is not written to storage, not put in the address, and
     gone when the page is left, so there is no list of codes anywhere to leak. */
  var staffTab = "people", staffData = null, staffLoading = false, staffMsg = "", reveal = null;
  var ask = null, formFor = null, actLog = null, actLoading = false, actFilter = "all";
  var CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // nothing easy to misread
  function newCode() {
    var b = new Uint8Array(10); (global.crypto || global.msCrypto).getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return CODE_ALPHABET[x % CODE_ALPHABET.length]; }).join("");
  }
  function when(iso) {
    if (!iso) return null;
    var t = new Date(iso); if (isNaN(t)) return null;
    var hm = ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2), now = new Date(), day = 86400000;
    var sod = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((sod(now) - sod(t)) / day);
    if (diff === 0) return "Today, " + hm;
    if (diff === 1) return "Yesterday, " + hm;
    return t.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][t.getMonth()] + ", " + hm;
  }
  function dateOnly(iso) { var w = when(iso); return w ? w.replace(/^(Today|Yesterday), \d\d:\d\d$/, "$1").replace(/, \d\d:\d\d$/, "") : null; }

  async function loadStaff() {
    if (staffLoading) return;
    staffLoading = true;
    var a = await Sync.manage("list"), c = Shell.isAdmin() ? await Sync.manage("codes") : { ok: false };     // the shared codes are the Admin's
    staffLoading = false;
    if (!a.ok) { staffMsg = a.error; staffData = { people: [], codes: {} }; }
    else staffData = { people: a.people || [], codes: c.ok ? { access: c.access, editing: c.editing } : {} };
    Shell.repaint();
  }
  async function loadActivity() {
    if (actLoading) return;
    actLoading = true;
    var r = await Sync.activity({ order: "seq.desc", limit: 100 });
    actLoading = false;
    actLog = r.ok ? r.rows : []; if (!r.ok) staffMsg = r.error;
    Shell.repaint();
  }
  /* One call, one message: say what the server said, then refresh what is on screen. */
  async function act(action, body, done) {
    staffMsg = "";
    var r = await Sync.manage(action, body);
    if (!r.ok) { staffMsg = r.error; Shell.repaint(); return r; }
    if (done) done(r);
    staffData = null; Shell.repaint();                       // reloads the list
    return r;
  }
  function showCode(title, code, note) { reveal = { title: title, code: code, note: note }; }

  function facName(d, id) {
    var f = (d.facilities || []).filter(function (x) { return x.id === id; })[0];
    return f ? f.name : id;
  }
  var ROLE_NAME = { admin: "Admin", manager: "Manager", staff: "Staff" };
  function personCard(d, p, me) {
    var self = me && me.id === p.login;
    var meta = (p.role === "admin" ? "All facilities" : ((p.facilities || []).map(function (id) { return facName(d, id); }).join(", ") || "No facilities")) +
      " \u00b7 " + (p.last_sign_in ? "last signed in " + when(p.last_sign_in) : "never signed in");
    var acts = h("div", { cls: "acts" });
    if (p.editable === false) {
      /* A Manager sees Staff who are also in a facility that is not theirs, and leaves them to an Admin. */
      acts.appendChild(h("span", { cls: "pmeta", "data-locked": p.login, text: "Also in a facility that is not yours. An Admin changes them." }));
    } else if (ask && ask.kind === "remove" && ask.login === p.login) {
      acts.appendChild(h("span", { style: "font-size:13px", text: "Switch off " + p.name + "\u2019s code?" }));
      acts.appendChild(h("button", { cls: "btn danger sm", type: "button", id: "rmYes", text: "Yes, remove", onclick: function () {
        ask = null; act("remove", { login: p.login }, function () { reveal = null; Shell.toast(p.name + " has been removed. Their code no longer works."); }); } }));
      acts.appendChild(h("button", { cls: "btn ghost sm", type: "button", id: "rmNo", text: "Keep", onclick: function () { ask = null; Shell.repaint(); } }));
    } else if (ask && ask.kind === "setcode" && ask.login === p.login) {
      var ownIn = h("input", { type: "text", id: "ownCode", autocomplete: "off", maxlength: "72", placeholder: "A code, 8 or more characters", "aria-label": "A code for " + p.name });
      acts.appendChild(ownIn);
      acts.appendChild(h("button", { cls: "btn sm", type: "button", id: "ownYes", text: "Set it", onclick: function () {
        if (ownIn.value.length < 8) { staffMsg = "A code needs at least 8 characters."; Shell.repaint(); return; }
        var v = ownIn.value; ask = null;
        act("reset_code", { login: p.login, code: v }, function (r) { showCode("New code for " + p.name + ":", r.code, "Their old code no longer works. It will not be shown again."); }); } }));
      acts.appendChild(h("button", { cls: "btn ghost sm", type: "button", id: "ownNo", text: "Cancel", onclick: function () { ask = null; staffMsg = ""; Shell.repaint(); } }));
    } else if (p.active) {
      acts.appendChild(h("button", { cls: "btn ghost sm", type: "button", "data-edit": p.login, text: "Edit", onclick: function () { formFor = p.login; staffMsg = ""; Shell.repaint(); } }));
      acts.appendChild(h("button", { cls: "btn ghost sm", type: "button", "data-reset": p.login, text: "Reset code", onclick: function () {
        act("reset_code", { login: p.login }, function (r) { showCode("New code for " + p.name + ":", r.code, "Their old code no longer works. It will not be shown again."); }); } }));
      acts.appendChild(h("button", { cls: "btn ghost sm", type: "button", "data-setcode": p.login, text: "Set code\u2026", onclick: function () { ask = { kind: "setcode", login: p.login }; staffMsg = ""; Shell.repaint(); } }));
      if (!self) acts.appendChild(h("button", { cls: "btn danger sm", type: "button", "data-ask": p.login, text: "Remove", onclick: function () { ask = { kind: "remove", login: p.login }; Shell.repaint(); } }));
    } else {
      acts.appendChild(h("button", { cls: "btn ghost sm", type: "button", "data-back": p.login, text: "Restore", onclick: async function () {
        var r = await act("restore", { login: p.login });
        if (!r.ok) return;
        var c = await Sync.manage("reset_code", { login: p.login });     // a removed person's old code may have been shared: always a new one
        if (c.ok) { showCode("Restored " + p.name + ". New code:", c.code, "It will not be shown again."); Shell.repaint(); }
      } }));
    }
    return h("div", { cls: "pcard" + (p.active ? "" : " off"), "data-login": p.login }, [
      h("div", { cls: "pid" }, [h("span", { cls: "av", text: (p.name || "?").charAt(0).toUpperCase() }), h("div", {}, [
        h("div", { cls: "pname" }, [p.name, self ? h("span", { cls: "chip st", text: "you" }) : null]), h("div", { cls: "pmeta", text: meta })])]),
      h("div", { cls: "pst" }, [h("span", { cls: "chip " + (p.role === "staff" ? "st" : "mg"), text: ROLE_NAME[p.role] || "Staff" }),
        h("span", { cls: "chip " + (p.active ? "ok" : "no"), text: p.active ? "Active" : "Removed" })]), acts]);
  }
  function personForm(d, p) {
    var isNew = formFor === "new";
    var name = h("input", { type: "text", id: "pName", placeholder: "e.g. Jordan", autocomplete: "off", value: isNew ? "" : p.name });
    /* Only an Admin chooses a role. A Manager adds and changes Staff, so there is nothing to choose. */
    var admin = Shell.isAdmin();
    var role = h("select", { id: "pRole" }, [h("option", { value: "staff", text: "Staff" }), h("option", { value: "manager", text: "Manager" }), h("option", { value: "admin", text: "Admin" })]);
    role.value = isNew ? "staff" : p.role;
    var box = h("fieldset", { cls: "facset", id: "pFacs" }, [h("legend", { text: admin ? "Facilities (Admins cover all)" : "Facilities" })]);
    (d.facilities || []).forEach(function (f) {
      box.appendChild(h("label", { cls: "bigcheck" }, [h("input", { type: "checkbox", cls: "pfac", value: f.id, checked: !isNew && (p.facilities || []).indexOf(f.id) >= 0 }), f.name]));
    });
    function sync() { var off = admin && role.value === "admin"; box.disabled = off; box.classList.toggle("off", off); }
    role.addEventListener("change", sync); setTimeout(sync, 0);
    /* Their sign-in code is made for them unless the person adding them types one. */
    var codeNote = h("span", { cls: "afnote bad", id: "pNote", role: "alert" });
    var own = isNew ? h("input", { type: "text", id: "pCode", autocomplete: "off", maxlength: "72", placeholder: "Leave empty to make one", "aria-label": "Their code" }) : null;
    var save = h("button", { cls: "btn", type: "button", id: "pSave", text: isNew ? "Add and show code" : "Save changes", onclick: async function () {
      var n = name.value.trim();
      if (!n) { staffMsg = "A name is needed."; Shell.repaint(); return; }
      if (own && own.value && own.value.length < 8) { codeNote.textContent = "A code needs at least 8 characters."; own.focus(); return; }     // in the form, so what was typed stays
      var facs = [].map.call(box.querySelectorAll(".pfac"), function (c) { return c.checked ? c.value : null; }).filter(Boolean);
      var body = { name: n, role: admin ? role.value : "staff", facilities: facs };
      if (own && own.value) body.code = own.value;
      formFor = null;
      if (isNew) await act("add", body, function (r) { showCode("Added " + n + ". Their code is", r.code, "Give it to them now. It will not be shown again."); });
      else await act("update", Object.assign({ login: p.login }, body), function () { Shell.toast("Saved " + n); });
    } });
    return h("div", { cls: "addform", id: "personForm" }, [
      h("label", { cls: "af" }, [h("span", { text: "Name" }), name]), admin ? h("label", { cls: "af" }, [h("span", { text: "Role" }), role]) : null, box,
      own ? h("label", { cls: "af" }, [h("span", { text: "Their code (8 or more characters)" }), own]) : null, own ? codeNote : null,
      h("div", { cls: "afrow" }, [save, h("button", { cls: "btn ghost", type: "button", id: "pCancel", text: "Cancel", onclick: function () { formFor = null; staffMsg = ""; Shell.repaint(); } })])]);
  }
  function sharedCodes(codes) {
    function one(kind, title, blurb, label, btnId) {
      var asking = ask && ask.kind === kind;
      var t = codes[kind], line = h("div", { cls: "subbar" }, [h("span", { id: kind + "When", text: t ? "Last changed " + dateOnly(t) : "Not changed since setup" })]);
      if (asking) {
        line.appendChild(h("span", { style: "font-size:13px", text: kind === "access"
          ? "Everyone is signed out until they enter the new code. Nothing saved on their devices is lost." : "Everyone\u2019s open editing window ends." }));
        var ownIn = h("input", { type: "text", id: kind + "Own", autocomplete: "off", maxlength: "72", placeholder: ask.own ? "Type the new code (8 or more characters)" : "or type your own (8 or more characters)", "aria-label": "Your own " + title.toLowerCase() });
        line.appendChild(ownIn);
        if (ask.own) setTimeout(function () { ownIn.focus(); }, 0);
        line.appendChild(h("button", { cls: "btn danger sm", type: "button", id: kind + "Yes", text: ask.own ? "Set it" : "Yes, change it", onclick: function () {
          if ((ask.own && !ownIn.value) || (ownIn.value && ownIn.value.length < 8)) { staffMsg = "A code needs at least 8 characters."; Shell.repaint(); return; }
          var code = ownIn.value || newCode(); ask = null;
          act(kind === "access" ? "set_access_code" : "set_editing_code", { code: code }, function () {
            showCode("New " + title.toLowerCase() + ":", code, kind === "access" ? "Share it with the team. Everyone is signed out until they enter it. It will not be shown again." : "Share it with the people who edit. It will not be shown again."); }); } }));
        line.appendChild(h("button", { cls: "btn ghost sm", type: "button", id: kind + "No", text: "Keep", onclick: function () { ask = null; Shell.repaint(); } }));
      } else {
        line.appendChild(h("button", { cls: "btn ghost sm", type: "button", id: btnId, text: label, onclick: function () { ask = { kind: kind }; Shell.repaint(); } }));
        line.appendChild(h("button", { cls: "btn ghost sm", type: "button", id: kind === "access" ? "setAccess" : "setEdit", text: "Set code…", onclick: function () { ask = { kind: kind, own: true }; staffMsg = ""; Shell.repaint(); } }));
      }
      return [h("div", { cls: "eyebrow" }, [h("span", { text: title })]), h("p", { style: "margin:0 0 10px;font-size:14px", text: blurb }), line];
    }
    var card = h("div", { cls: "card", id: "sharedCodes" });
    one("access", "Access code", "One shared code that opens the app for viewing. Changing it signs everyone out until they enter the new one. Nothing saved on their devices is lost.", "Change access code", "chgAccess").forEach(function (x) { card.appendChild(x); });
    card.appendChild(h("hr", { style: "border:0;border-top:1px solid var(--line);margin:14px 0" }));
    one("editing", "Editing code", "One shared code that lets a signed-in person add, change or delete. Changing it affects everyone who edits.", "Change editing code", "chgEdit").forEach(function (x) { card.appendChild(x); });
    return card;
  }
  function peopleTab(d) {
    var me = Sync.person(), box = h("div", { cls: "stack" });
    if (reveal && reveal.code) {
      box.appendChild(h("div", { cls: "banner good", id: "revealBanner" }, [
        reveal.title + " ", h("b", { cls: "code", id: "revealCode", text: reveal.code }), " " + reveal.note, " ",
        h("button", { cls: "btn sm", type: "button", id: "revealDone", text: "Done", onclick: function () { reveal = null; Shell.repaint(); } })]));
    }
    if (staffMsg) box.appendChild(h("div", { cls: "banner warn", id: "staffMsg", role: "alert", text: staffMsg }));
    var card = h("div", { cls: "card", id: "peopleCard" }, [h("div", { cls: "eyebrow" }, [h("span", { text: "People" }),
      h("button", { cls: "btn sm", type: "button", id: "addPerson", text: "+ Add staff", onclick: function () { formFor = "new"; staffMsg = ""; Shell.repaint(); } })])]);
    if (formFor) {
      var who = formFor === "new" ? null : (staffData.people || []).filter(function (x) { return x.login === formFor; })[0];
      if (formFor === "new" || who) card.appendChild(personForm(d, who));
    }
    if (!staffData) card.appendChild(h("p", { cls: "sub", id: "staffLoading", text: "Loading\u2026" }));
    else {
      card.appendChild(h("div", { cls: "plist", id: "peopleList" }, staffData.people.map(function (p) { return personCard(d, p, me); })));
      card.appendChild(h("div", { cls: "subbar", style: "margin-top:10px", text: "A removed person\u2019s code stops working at once. Their name stays on the changes they made." }));
    }
    box.appendChild(card);
    if (staffData && Shell.isAdmin()) box.appendChild(sharedCodes(staffData.codes || {}));
    return box;
  }

  /* ---- Activity: who changed what, newest first. The log keeps whole before and after
     bodies; this says in a line what moved. ---- */
  var SPOT = function (n) { return n === 1 ? "1 reading" : n + " readings"; };
  function describe(r, d) {
    var nb = r.new_body || {}, ob = r.old_body || {}, gone = r.deleted && !r.old_deleted, back = !r.deleted && r.old_deleted, fresh = !r.old_body;
    function diff(a, b) { return JSON.stringify(a) !== JSON.stringify(b); }
    switch (r.kind) {
      case "_backfill": return "Ran a data migration";
      case "facility":
        if (gone) return "Removed the facility " + (ob.name || ""); if (fresh) return "Added the facility " + (nb.name || "");
        if (ob.name !== nb.name) return "Renamed the facility " + (ob.name || "") + " to " + (nb.name || "");
        if (diff(ob.settings, nb.settings)) {
          var s0 = ob.settings || {}, s1 = nb.settings || {}, ch = ["target", "edges", "floodBelow", "shaveAbove", "overdueDays", "tieAttention"].filter(function (k) { return diff(s0[k], s1[k]); });
          return "Changed the " + (ch.length ? ch.join(", ") : "settings");
        }
        return "Changed the facility";
      case "sheet":
        if (gone) return "Removed the sheet " + (ob.name || ""); if (back) return "Brought back the sheet " + (nb.name || ""); if (fresh) return "Added a sheet called " + (nb.name || "");
        if (ob.name !== nb.name) return "Renamed the sheet " + (ob.name || "") + " to " + (nb.name || "");
        if (diff(ob.shape, nb.shape) || diff(ob.size, nb.size)) return "Changed the size of " + (nb.name || "a sheet");
        return "Changed the sheet " + (nb.name || "");
      case "session": {
        var n1 = Object.keys(nb.data || {}).length, n0 = Object.keys(ob.data || {}).length;
        if (gone) return "Deleted a round"; if (fresh) return n1 ? "Logged a round, " + (nb.mode || "") + ", " + SPOT(n1) : "Started a round";
        if (n1 !== n0 || diff(ob.data, nb.data)) return "Logged readings in a round (" + SPOT(n1) + ")";
        if (diff(ob.notes, nb.notes)) return "Edited the notes on a round";
        if (ob.date !== nb.date) return "Changed the date of a round";
        return "Changed a round";
      }
      case "glass_panel": {
        var pid = String(r.id).split(":").pop(), st = { replace: "Needs replacement", plexi: "Temporary plexi", ok: "Good" }[nb.status];
        if (ob.status !== nb.status && st) return "Set panel " + pid + " to " + st;
        if ((ob.note || "") !== (nb.note || "")) return nb.note ? "Edited the note on panel " + pid : "Cleared the note on panel " + pid;
        return "Changed panel " + pid;
      }
      case "glass_layout": return gone ? "Removed the glass layout" : fresh ? "Built a glass layout" : "Changed the glass layout";
      case "glass_binding": return "Pointed the glass at a sheet";
      case "glass_widths": return "Changed the one-tap glass widths";
      case "glass_spare": return gone ? "Removed a glass movement" : "Recorded " + (nb.qty > 0 ? "+" : "") + nb.qty + " " + (nb.mat || "") + " " + nb.w + "\u00d7" + nb.h + "\u2033 piece" + (Math.abs(nb.qty) === 1 ? "" : "s");
      case "flag": return gone ? "Removed a flag" : fresh ? "Raised a flag" : nb.status === "resolved" ? "Resolved a flag" : "Changed a flag";
      default: return (gone ? "Removed" : fresh ? "Added" : "Changed") + " a " + String(r.kind).replace(/_/g, " ");
    }
  }
  function placeOf(r, d) {
    var parts = [];
    if (r.facility_id) parts.push(facName(d, r.facility_id));
    var b = r.new_body || r.old_body || {}, sid = b.sheetId || (r.kind === "sheet" ? r.id : null);
    if (sid) (d.facilities || []).forEach(function (f) { (f.sheets || []).forEach(function (s) { if (s.id === sid) parts.push(s.name || "Sheet"); }); });
    parts.push({ session: "Ice", facility: "Ice", sheet: "Ice" }[r.kind] || (/^glass/.test(r.kind) ? "Glass" : ""));
    return parts.filter(Boolean).join(" / ");
  }
  function activityTab(d) {
    var box = h("div", { cls: "card", id: "activityCard" }, [h("div", { cls: "eyebrow" }, [h("span", { text: "Activity" }), h("span", { text: "who changed what" })])]);
    if (staffMsg) box.appendChild(h("div", { cls: "banner warn", id: "staffMsg", role: "alert", text: staffMsg }));
    if (!actLog) { box.appendChild(h("p", { cls: "sub", id: "actLoading", text: "Loading\u2026" })); return box; }
    var names = ["all"], seen = {};
    actLog.forEach(function (r) { var n = r.changed_by_name || "System"; if (!seen[n]) { seen[n] = 1; names.push(n); } });
    box.appendChild(h("div", { cls: "subbar", style: "margin-bottom:8px" }, ["Show ", h("span", { cls: "seg", role: "group", "aria-label": "Filter by person" }, names.map(function (n) {
      return h("button", { type: "button", "data-fl": n, text: n === "all" ? "Everyone" : n, "aria-pressed": String(actFilter === n), onclick: function () { actFilter = n; Shell.repaint(); } });
    }))]));
    var list = actLog.filter(function (r) { return actFilter === "all" || (r.changed_by_name || "System") === actFilter; });
    var log = h("div", { cls: "log", id: "actLog" });
    list.forEach(function (r) {
      log.appendChild(h("div", { cls: "e", "data-kind": r.kind }, [h("div", { cls: "t", text: when(r.at) || "" }),
        h("div", { cls: "m" }, [h("b", { text: r.changed_by_name || "System" }), " " + describe(r, d), h("small", { text: placeOf(r, d) })])]));
    });
    if (!list.length) log.appendChild(h("p", { cls: "sub", text: "Nothing recorded for this person." }));
    box.appendChild(log);
    return box;
  }
  function staff(route, d) {
    var el = h("div", { cls: "screen", id: "pageStaff" });
    el.appendChild(h("div", { cls: "crumb", text: "Account / Staff" }));
    el.appendChild(h("h2", { text: "Staff" }));
    el.appendChild(h("p", { cls: "sub", text: Shell.isAdmin() ? "People who can make changes. Each signs in with their own code." : "Staff in your facilities. Each signs in with their own code." }));
    el.appendChild(h("div", { cls: "tabs", role: "tablist" }, [["people", "People", "tabPeople"], ["activity", "Activity", "tabActivity"]].map(function (t) {
      return h("button", { cls: "tab", type: "button", role: "tab", id: t[2], text: t[1], "aria-selected": String(staffTab === t[0]),
        onclick: function () { staffTab = t[0]; reveal = null; ask = null; formFor = null; staffMsg = ""; if (t[0] === "activity") actLog = null; Shell.repaint(); } });
    })));
    if (staffTab === "people") { if (!staffData) loadStaff(); el.appendChild(peopleTab(d)); }
    else { if (!actLog) loadActivity(); el.appendChild(activityTab(d)); }
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
      if (route.page === "staff") return staff(route, d);
      if (route.page === "review") return global.Review ? global.Review.render(route, d, shell) : facilities(d);
      return facilities(d);
    },
    view: function () { return view; },
    describe: describe, placeOf: placeOf, when: when
  };
  global.Home = Home;

  document.addEventListener("DOMContentLoaded", function () { /* mounted by index.html once both scripts are loaded */ });
})(this);
