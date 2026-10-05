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
      h("div", { cls: "apps" }, [open("ice"), open("glass")])]);
  }
  function sheets(route, d) {
    var f = d.facilities.filter(function (x) { return x.id === route.fid; })[0];
    var el = h("div", { cls: "screen", id: "pageSheets" });
    el.appendChild(h("div", { cls: "crumb" }, [h("a", { href: "#/", text: "Facilities" }), " / " + f.name]));
    el.appendChild(h("h2", { text: f.name }));
    el.appendChild(h("p", { cls: "sub", text: "Choose a sheet and open an app for it. The trend is readable here without opening Ice Manager." }));
    el.appendChild(h("div", { cls: "toolbar" }, [
      h("span", { cls: "meta", id: "sheetCount", text: plural((f.sheets || []).length, "sheet") }), addButton("sheet", "+ Add sheet", f)]));
    if (addOpen === "sheet") el.appendChild(addForm("sheet", f));
    el.appendChild(h("div", { cls: "rows", id: "sheetRows" }, (f.sheets || []).map(function (s) { return sheetRow(d, f, s); })));
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
      if (route.page === "settings") return holding("Sheet settings", "Facilities / settings", "Sheet settings arrive with the next step of the shell.");
      if (route.page === "staff") return holding("Staff", "Account / staff", "The Staff page arrives with the next step of the shell.");
      return facilities(d);
    },
    view: function () { return view; }
  };
  global.Home = Home;

  document.addEventListener("DOMContentLoaded", function () { /* mounted by index.html once both scripts are loaded */ });
})(this);
