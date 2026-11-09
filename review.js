"use strict";
/* review.js: Quality review, the laptop's tool for looking back.

   Four pages under #/review/: Changes (what changed, from the server's change log), Current state (a row per sheet),
   Flags (what somebody said looks wrong) and Reports (print or save as PDF). The shell only offers them on a laptop
   and refuses them on a phone or an iPad; Staff reach Flags only, and the server refuses the log to anyone but
   Management whatever a page does. Nothing here writes a reading, a panel or a setting: the one write is a flag's
   status, and only Management's is accepted. */
(function (global) {
  var h, Shell, d;
  var UI = { glassFor: {}, flagsShow: "open", chArea: "all", chFac: "all", chPerson: "all", chDays: "30", chRows: null, chLoading: false, chError: "", chMore: true,
             repSheet: "", repDays: "30", repSec: { summary: 1, latest: 1, trend: 1, glass: 1, flags: 1, changes: 0 }, repChanges: null };
  var AREAS = { all: null, ice: ["session"], glass: ["glass_panel", "glass_layout", "glass_binding"], inventory: ["glass_spare", "glass_widths"],
                settings: ["facility", "sheet"], flags: ["flag"] };
  var AREA_NAMES = { all: "Everything", ice: "Ice", glass: "Glass", inventory: "Inventory", settings: "Settings", flags: "Flags" };
  var BIG = 0.5;                                   // a reading that moves this far, in inches, in one edit, is worth a look

  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function sheetsOf(dd) { var out = []; (dd.facilities || []).forEach(function (f) { (f.sheets || []).forEach(function (s) { out.push({ f: f, s: s }); }); }); return out; }
  function sheetName(dd, id) { var r = sheetsOf(dd).filter(function (x) { return x.s.id === id; })[0]; return r ? r.f.name + " · " + (r.s.name || "Sheet") : null; }
  function dayStr(iso) { var t = new Date(iso); return isNaN(t) ? "" : t.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  function whenStr(iso) { var t = new Date(iso); return isNaN(t) ? "" : t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function isMgmt() { var S = global.Sync; return !S || !S.person() || S.canManage(); }
  function canResolve() { var S = global.Sync; return isMgmt() && (!S || !S.person() || S.isEditing()); }
  function frame(title, sub, kids) {
    var el = h("div", { cls: "screen", id: "pageReview", "data-view": UI.view });
    el.appendChild(h("div", { cls: "crumb", text: "Quality review / " + title }));
    el.appendChild(h("h2", { text: title }));
    if (sub) el.appendChild(h("p", { cls: "sub", text: sub }));
    kids.forEach(function (k) { if (k) el.appendChild(k); });
    return el;
  }
  function readingValue(lab) { return global.Records && global.Records.readingValue ? global.Records.readingValue(lab) : NaN; }

  /* ---------- Flags ---------- */
  function flagRows() {
    var all = global.Flags ? global.Flags.all() : [];
    var live = {}; (d.facilities || []).forEach(function (f) { live[f.id] = true; });
    return all.filter(function (r) { return !r.fac || live[r.fac]; }).sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  }
  function flagsPage() {
    var rows = flagRows(), show = UI.flagsShow;
    var list = rows.filter(function (r) { return show === "all" || r.status === show; });
    var bar = h("div", { cls: "subbar" }, ["Show ", h("span", { cls: "seg", role: "group", "aria-label": "Which flags" }, [["open", "Open"], ["resolved", "Resolved"], ["all", "All"]].map(function (x) {
      return h("button", { type: "button", id: "fl-" + x[0], text: x[1] + (x[0] === "open" ? " (" + rows.filter(function (r) { return r.status === "open"; }).length + ")" : ""), "aria-pressed": String(show === x[0]),
        onclick: function () { UI.flagsShow = x[0]; Shell.repaint(); } });
    }))]);
    var box = h("div", { id: "flagList", cls: "rows" });
    list.forEach(function (r) {
      var gone = r.sheetId && !sheetName(d, r.sheetId);
      var acts = h("div", { cls: "apps" });
      if (isMgmt()) acts.appendChild(h("button", { cls: "btn sm", type: "button", "data-act": r.status === "open" ? "resolve" : "reopen", disabled: !canResolve(),
        title: canResolve() ? "" : "Unlock to edit", text: r.status === "open" ? "Resolve" : "Reopen",
        onclick: function () { global.Flags.setStatus(r.id, r.status === "open" ? "resolved" : "open").then(function () { if (global.Sync) global.Sync.nudge(); Shell.repaint(); }); } }));
      box.appendChild(h("div", { cls: "row flagrow", "data-fid": r.id, "data-status": r.status }, [
        h("div", {}, [h("div", { cls: "name", text: (r.label || r.targetKind) + (gone ? " (this sheet is gone)" : "") }),
          h("div", { cls: "meta", text: (sheetName(d, r.sheetId) || "") + (r.reading ? " · " + r.reading : "") })]),
        h("div", { cls: "stat" }, [h("div", { cls: "chips" }, [h("span", { cls: "chip " + (r.status === "open" ? "bad" : "ok"), text: r.status === "open" ? "Open" : "Resolved" }), h("span", { cls: "chip", text: r.reason })]),
          h("div", { cls: "meta", text: (r.note ? r.note + " · " : "") + (r.changedBy ? r.changedBy + ", " : "") + whenStr(r.updatedAt) })]), acts]));
    });
    if (!list.length) box.appendChild(h("div", { cls: "empty-state", id: "noFlags", text: show === "open" ? "Nothing is flagged. A flag is raised from a reading in Ice or a panel in Glass." : "No flags." }));
    return frame("Flags", isMgmt() ? "Everything somebody flagged. A Manager or Admin resolves and reopens." : "What has been flagged in your facilities. A Manager or Admin resolves them.", [bar, box]);
  }

  /* ---------- Current state ---------- */
  function statePage() {
    var tb = h("tbody");
    sheetsOf(d).forEach(function (x) {
      var st = Shell.status(d, x.f, x.s), g = d.glass[x.s.id];
      var trend = global.Records.trendOf(d.sessions, x.s.id, 1)[0];
      var opens = (d.flags || []).filter(function (f) { return f.sheetId === x.s.id; }).length;
      tb.appendChild(h("tr", { "data-sid": x.s.id }, [h("td", { text: x.f.name }), h("td", { text: x.s.name || "Sheet" }),
        h("td", { cls: "last", text: st.last ? dayStr(st.last.date) : "No rounds" }),
        h("td", { cls: "ice", text: st.over ? "Overdue" : st.last ? "Up to date" : "No rounds yet" }),
        h("td", { cls: "avg", text: trend ? trend.avg.toFixed(2) + "″ over " + plural(trend.n, "reading") : "—" }),
        h("td", { cls: "glass", text: !g || !g.known ? "Glass not loaded" : !g.layout ? "No glass built" : (g.replace ? g.replace + " to replace" : "All good") + (g.plexi ? ", " + g.plexi + " on plexi" : "") }),
        h("td", { cls: "flagcell", text: opens ? String(opens) : "" }),
        h("td", {}, [h("a", { cls: "btn ghost sm", href: "ice.html#/f/" + x.f.id + "/s/" + x.s.id + "/rink", text: "Ice" }), " ",
                     h("a", { cls: "btn ghost sm", href: "glass.html#/f/" + x.f.id + "/s/" + x.s.id, text: "Glass" })])]));
    });
    var table = h("table", { id: "stateTable" }, [h("thead", {}, [h("tr", {}, ["Facility", "Sheet", "Last round", "Ice", "Latest average", "Glass", "Open flags", ""].map(function (t) { return h("th", { text: t }); }))]), tb]);
    return frame("Current state", "The latest Ice round and Glass condition for every sheet, read from the same places as the Facilities cards.", [h("div", { cls: "tablewrap" }, [table])]);
  }

  /* ---------- Changes ---------- */
  function bigMove(r) {
    var ob = (r.old_body && r.old_body.data) || {}, nb = (r.new_body && r.new_body.data) || {}, worst = 0;
    if (r.kind !== "session") return 0;
    Object.keys(nb).forEach(function (k) { if (ob[k] != null) { var a = readingValue(ob[k]), b = readingValue(nb[k]); if (isFinite(a) && isFinite(b)) worst = Math.max(worst, Math.abs(b - a)); } });
    return worst;
  }
  function changeQuery(beforeSeq) {
    var q = { order: "seq.desc", limit: 50 };
    var kinds = AREAS[UI.chArea]; if (kinds) q.kind = "in.(" + kinds.join(",") + ")";
    if (UI.chFac !== "all") q.facility_id = "eq." + UI.chFac;
    if (UI.chPerson !== "all") q.changed_by = "eq." + UI.chPerson;
    if (UI.chDays !== "all") q.at = "gt." + new Date(Date.now() - (+UI.chDays) * 86400000).toISOString();
    if (beforeSeq != null) q.seq = "lt." + beforeSeq;
    return q;
  }
  function loadChanges(more) {
    if (!global.Sync || UI.chLoading) return;
    UI.chLoading = true; UI.chError = "";
    var last = more && UI.chRows && UI.chRows.length ? UI.chRows[UI.chRows.length - 1].seq : null;
    global.Sync.activity(changeQuery(last)).then(function (res) {
      UI.chLoading = false;
      if (!res.ok) { UI.chError = res.error; if (!more) UI.chRows = []; }
      else { UI.chRows = (more && UI.chRows ? UI.chRows : []).concat(res.rows); UI.chMore = res.rows.length >= 50; }
      Shell.repaint();
    });
  }
  function changesPage() {
    if (UI.chRows === null && !UI.chLoading) loadChanges(false);
    var sel = function (id, label, opts, cur) {
      var s = h("select", { id: id, "aria-label": label, onchange: function () { UI[id === "chArea" ? "chArea" : id === "chFac" ? "chFac" : id === "chPerson" ? "chPerson" : "chDays"] = s.value; UI.chRows = null; Shell.repaint(); } },
        opts.map(function (o) { return h("option", { value: o[0], text: o[1], selected: String(o[0]) === String(cur) }); }));
      return h("label", { cls: "fl-f inl" }, [label, s]);
    };
    var facs = [["all", "Every facility"]].concat((d.facilities || []).map(function (f) { return [f.id, f.name]; }));
    var people = [["all", "Everyone"]]; (UI.people || []).forEach(function (p) { people.push(p); });
    var bar = h("div", { cls: "subbar filters" }, [
      sel("chArea", "Area", Object.keys(AREA_NAMES).map(function (k) { return [k, AREA_NAMES[k]]; }), UI.chArea),
      sel("chFac", "Facility", facs, UI.chFac),
      sel("chPerson", "Person", people, UI.chPerson),
      sel("chDays", "Period", [["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All time"]], UI.chDays)]);
    var box = h("div", { cls: "log", id: "changeLog" });
    if (UI.chError) box.appendChild(h("div", { cls: "banner warn", id: "changeError", role: "alert", text: UI.chError }));
    else if (UI.chRows === null || UI.chLoading && !(UI.chRows || []).length) box.appendChild(h("p", { cls: "sub", id: "changeLoading", text: "Loading…" }));
    (UI.chRows || []).forEach(function (r) {
      var big = bigMove(r), HD = global.Home;
      var seen = (UI.people || []).some(function (p) { return p[0] === r.changed_by; });
      if (!seen && r.changed_by) { (UI.people = UI.people || []).push([r.changed_by, r.changed_by_name || r.changed_by]); }
      var flagged = (global.Flags ? global.Flags.all() : []).some(function (f) { return f.targetKind === "record" && f.recordKind === r.kind && f.recordId === r.id && f.status === "open"; });
      var row = h("div", { cls: "e" + (flagged ? " flagged" : ""), "data-kind": r.kind, "data-seq": r.seq }, [
        h("div", { cls: "t", text: HD.when(r.at) || "" }),
        h("div", { cls: "m" }, [h("b", { text: r.changed_by_name || "System" }), " " + HD.describe(r, d), h("small", { text: HD.placeOf(r, d) }),
          big >= BIG ? h("span", { cls: "chip warn big", text: "Large change: " + big.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") + "″" }) : null,
          flagged ? h("span", { cls: "chip bad", text: "Flagged" }) : null,
          h("button", { cls: "btn ghost sm flagit", type: "button", text: "⚑ Flag", onclick: function () { flagChange(r); } })])]);
      box.appendChild(row);
    });
    if (UI.chRows && !UI.chRows.length && !UI.chError) box.appendChild(h("p", { cls: "sub", id: "noChanges", text: "Nothing changed in this period." }));
    if (UI.chRows && UI.chRows.length && UI.chMore) box.appendChild(h("button", { cls: "btn ghost", type: "button", id: "moreChanges", text: "Older changes", onclick: function () { loadChanges(true); } }));
    return frame("Changes", "Everything that changed, newest first, with who and when. Read from the server's change log, so it needs a connection.", [bar, box]);
  }
  function flagChange(r) {
    var HD = global.Home, txt = (r.changed_by_name || "System") + " " + HD.describe(r, d);
    var reason = global.Flags.REASONS[3];                                 // Check reading
    var fac = r.facility_id || null, nb = r.new_body || r.old_body || {};
    global.Flags.raise({ fac: fac, targetKind: "record", recordKind: r.kind, recordId: r.id, sheetId: nb.sheetId || (r.kind === "sheet" ? r.id : null),
      label: txt, reason: reason, note: "Flagged from Changes" }).then(function () { if (global.Sync) global.Sync.nudge(); Shell.toast("Flag raised"); Shell.repaint(); });
  }

  /* ---------- Reports ---------- */
  function ageDays(iso) { return (Date.now() - new Date(iso).getTime()) / 86400000; }
  /* The drawings (report-maps.js). The map is cached by what it is drawn from, so ticking a section on and off does not redraw it. */
  var mapCache = {};
  function mapImage(f, s, z) {
    if (!global.ReportMaps) return "";
    var R = global.Records, size = s.size || R.NHL_SIZE(), set = R.settingsOf(f.settings, d.prefs), key = [s.id, z.id, z.updatedAt, JSON.stringify(size), JSON.stringify(set)].join("|");
    if (!mapCache[key]) {
      try { mapCache = {}; mapCache[key] = global.ReportMaps.iceMap({ size: size, data: z.data, settings: set }).toDataURL("image/png"); } catch (e) { return ""; }
    }
    return '<img class="rp-map" alt="Ice thickness map, latest round" src="' + mapCache[key] + '">';
  }
  function glassImage(s) {
    var gf = UI.glassFor[s.id];
    if (!gf || !gf.layout || !global.ReportMaps) return "";
    var svg = global.ReportMaps.glassPlan(gf), c = global.ReportMaps.glassCounts(gf);
    return svg ? '<div class="rp-planbox">' + svg + "</div>" + (c ? "<p class=\"rp-cap\">" + c.total + " pieces: " + c.ok + " good, " + c.replace + " need replacing, " + c.plexi + " on temporary plexi. Dashed outlines are inferred, not measured.</p>" + "<p class=\"rp-key\">" + [["#e4ecf1", "Good"], ["#c8202f", "Needs replacing"], ["#a85d00", "Temporary plexi"]].map(function (q) { return '<span><i style="background:' + q[0] + '"></i>' + q[1] + "</span>"; }).join("") + "</p>" : "") : "";
  }
  function reportHTML(x, changes) {
    var f = x.f, s = x.s, days = UI.repDays === "all" ? 1e9 : +UI.repDays, R = global.Records, esc = function (t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var p = global.Sync && global.Sync.person && global.Sync.person();
    var st = Shell.status(d, f, s), sec = UI.repSec, out = [];
    out.push('<header class="rp-head"><h1>' + esc(f.name) + " · " + esc(s.name || "Sheet") + "</h1><p>Quality report, " + (UI.repDays === "all" ? "all time" : "last " + UI.repDays + " days") +
      ". Prepared " + esc(dayStr(new Date().toISOString())) + (p ? " by " + esc(p.name) : "") + "</p></header>");
    if (sec.summary) out.push('<section data-sec="summary"><h2>Summary</h2><table><tbody><tr><th>Sheet</th><td>' + esc(f.name) + " / " + esc(s.name || "Sheet") + "</td></tr><tr><th>Last round</th><td>" + (st.last ? esc(dayStr(st.last.date)) : "No rounds yet") +
      "</td></tr><tr><th>Ice status</th><td>" + (st.over ? "Overdue" : st.last ? "Up to date" : "No rounds yet") + "</td></tr><tr><th>Open flags</th><td>" + (d.flags || []).filter(function (q) { return q.sheetId === s.id; }).length + "</td></tr></tbody></table></section>");
    var rounds = (d.sessions || []).filter(function (z) { return z.sheetId === s.id && R.hasReadings(z) && ageDays(z.date) <= days; }).sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    if (sec.latest) {
      var z = rounds[rounds.length - 1], vals = z ? Object.keys(z.data).map(function (k) { return readingValue(z.data[k]); }).filter(isFinite) : [];
      out.push('<section data-sec="latest"><h2>Ice, latest round</h2>' + (z ? "<p>" + esc(dayStr(z.date)) + ", " + plural(vals.length, "reading") + ": thinnest " + Math.min.apply(null, vals).toFixed(3) + "″, thickest " + Math.max.apply(null, vals).toFixed(3) +
        "″, average " + (vals.reduce(function (a, b) { return a + b; }, 0) / vals.length).toFixed(3) + "″.</p>" + mapImage(f, s, z) : "<p>No round with readings in this period.</p>") + "</section>");
    }
    if (sec.trend) out.push('<section data-sec="trend"><h2>Thickness trend</h2>' + (rounds.length ? "<table><thead><tr><th>Date</th><th>Readings</th><th>Average</th></tr></thead><tbody>" + rounds.map(function (z) {
      var v = Object.keys(z.data).map(function (k) { return readingValue(z.data[k]); }).filter(isFinite); return "<tr><td>" + esc(dayStr(z.date)) + "</td><td>" + v.length + "</td><td>" + (v.reduce(function (a, b) { return a + b; }, 0) / v.length).toFixed(3) + "″</td></tr>"; }).join("") + "</tbody></table>" : "<p>No rounds in this period.</p>") + "</section>");
    if (sec.glass) { var g = d.glass[s.id]; out.push('<section data-sec="glass"><h2>Glass condition</h2><p>' + (!g || !g.known ? "Glass has not been opened on this device." : !g.layout ? "No glass has been built for this sheet." :
      g.replace + " panel" + (g.replace === 1 ? "" : "s") + " need replacing, " + g.plexi + " on temporary plexi. The order list is in Glass, Rink view.") + "</p>" + glassImage(s) + "</section>"); }
    if (sec.flags) { var fl = (global.Flags ? global.Flags.all() : []).filter(function (q) { return q.sheetId === s.id && ageDays(q.updatedAt) <= days; });
      out.push('<section data-sec="flags"><h2>Flagged items</h2>' + (fl.length ? "<table><thead><tr><th>What</th><th>Why</th><th>Status</th></tr></thead><tbody>" + fl.map(function (q) { return "<tr><td>" + esc(q.label) + "</td><td>" + esc(q.reason) + (q.note ? ": " + esc(q.note) : "") + "</td><td>" + esc(q.status) + "</td></tr>"; }).join("") + "</tbody></table>" : "<p>Nothing flagged in this period.</p>") + "</section>"); }
    if (sec.changes) out.push('<section data-sec="changes"><h2>Changes in the period</h2>' + (changes == null ? "<p>Loading…</p>" : changes.length ? "<ul>" + changes.slice(0, 60).map(function (r) { return "<li>" + esc(whenStr(r.at)) + ", " + esc(r.changed_by_name || "System") + " " + esc(global.Home.describe(r, d)) + "</li>"; }).join("") + "</ul>" : "<p>No changes recorded.</p>") + "</section>");
    return out.join("");
  }
  function reportsPage() {
    var sheets = sheetsOf(d);
    if (!UI.repSheet || !sheets.some(function (x) { return x.s.id === UI.repSheet; })) UI.repSheet = sheets.length ? sheets[0].s.id : "";
    var x = sheets.filter(function (y) { return y.s.id === UI.repSheet; })[0];
    var sheetSel = h("select", { id: "repSheet", "aria-label": "Sheet", onchange: function () { UI.repSheet = this.value; Shell.repaint(); } }, sheets.map(function (y) { return h("option", { value: y.s.id, text: y.f.name + " · " + (y.s.name || "Sheet"), selected: y.s.id === UI.repSheet }); }));
    var perSel = h("select", { id: "repDays", "aria-label": "Period", onchange: function () { UI.repDays = this.value; UI.repChanges = null; Shell.repaint(); } },
      [["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last year"], ["all", "All time"]].map(function (o) { return h("option", { value: o[0], text: o[1], selected: o[0] === UI.repDays }); }));
    var names = { summary: "Summary", latest: "Ice, latest round", trend: "Thickness trend", glass: "Glass condition", flags: "Flagged items", changes: "Changes in the period" };
    var checks = h("div", { cls: "repsecs" }, Object.keys(names).map(function (k) {
      return h("label", { cls: "chk" }, [h("input", { type: "checkbox", "data-sec": k, checked: !!UI.repSec[k], onchange: function () { UI.repSec[k] = this.checked ? 1 : 0; if (k === "changes" && this.checked) UI.repChanges = null; Shell.repaint(); } }), " " + names[k]]);
    }));
    if (UI.repSec.changes && UI.repChanges === null && global.Sync) {
      UI.repChanges = false;
      global.Sync.activity({ order: "seq.desc", limit: 200, at: "gt." + new Date(Date.now() - (UI.repDays === "all" ? 3650 : +UI.repDays) * 86400000).toISOString() }).then(function (res) { UI.repChanges = res.ok ? res.rows : []; Shell.repaint(); });
    }
    /* Glass's layout and panel conditions are read from the device, once per sheet, then the page is drawn again. */
    if (UI.repSec.glass && x && !(x.s.id in UI.glassFor) && global.Records && global.Records.glassFor) {
      UI.glassFor[x.s.id] = null;
      global.Records.glassFor(x.s.id).then(function (gf) { UI.glassFor[x.s.id] = gf; Shell.repaint(); });
    }
    var paper = h("div", { cls: "paper", id: "reportPaper" }); paper.innerHTML = x ? reportHTML(x, UI.repChanges === false ? null : UI.repChanges) : "<p>No sheets.</p>";
    var print = h("button", { cls: "btn", type: "button", id: "repPrint", text: "Print or save as PDF", onclick: function () {
      var root = document.getElementById("printRoot"); if (!root) { root = document.createElement("div"); root.id = "printRoot"; document.body.appendChild(root); }
      root.innerHTML = paper.innerHTML; document.body.classList.add("printing-report"); global.print(); setTimeout(function () { document.body.classList.remove("printing-report"); }, 500); } });
    return frame("Reports", "Choose a sheet, a period and what goes in. The page below is what prints: black on white, whichever theme is on.", [
      h("div", { cls: "subbar filters" }, [h("label", { cls: "fl-f inl" }, ["Sheet", sheetSel]), h("label", { cls: "fl-f inl" }, ["Period", perSel]), print]), checks, paper]);
  }

  global.Review = {
    render: function (route, dd, shell) {
      h = shell.h; Shell = shell; d = dd; UI.view = route.view;
      if (route.view === "flags") return flagsPage();
      if (route.view === "state") return statePage();
      if (route.view === "reports") return reportsPage();
      return changesPage();
    },
    reportHTML: reportHTML, UI: UI
  };
})(this);
