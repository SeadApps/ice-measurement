/* The shell: the part of the program a person moves around in.

   It owns three things, and nothing else may:
     - the ADDRESS. Where you are is read from location.hash and from nothing else:
       reload, back and a bookmark all work because no second copy exists.
     - the CHROME: one top bar, a rail on a laptop, a tab bar on a phone, and the
       account menu.
     - WHERE YOU ARE, as a device preference (Repo.savePrefs). It is the only writer
       of the active facility and sheet; Ice and Glass read it.

   Like the old launcher it writes no synced record by accident: it reads through
   Repo.read(), writes preferences through Repo.savePrefs(), and records only
   through Repo.addSheet(). Nothing about the rinks is read or drawn before the
   sign-in gate has been passed, and it never invents a facility.

   Pages live in home.js and are handed a route and the data; they return elements.
   Every name a person typed is set as text, never as markup. */
(function (global) {
  "use strict";

  var Repo = Records.Repo, Store = Records.Store;
  var NOTICE = "That page is not available.";
  var PHONE_MAX = 560, IPAD_MAX = 1100;

  var layoutName = "laptop", layoutCbs = [];
  var root = null, appEl = null, pageEl = null, home = null;
  var data = null, route = { page: "facilities" }, notice = "";
  var statusEl = null, unlockEl = null, busy = false, again = false;
  var openMenu = null, acct = null;
  var barApp = null, barHost = null, globalsOn = false;     // set when the bar is mounted inside Ice or Glass

  /* ---------- small DOM helper ---------- */
  function h(tag, p, kids) {
    var e = document.createElement(tag);
    for (var k in (p || {})) {
      var v = p[k];
      if (k === "text") e.textContent = v;
      else if (k === "cls") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }

  /* ---------- the layout follows the width, not the device ---------- */
  function layoutFor(w) { return w <= PHONE_MAX ? "phone" : w <= IPAD_MAX ? "ipad" : "laptop"; }
  function measure() {
    var n = layoutFor(global.innerWidth), el = appEl || barHost;
    if (n === layoutName && el && el.dataset.layout === n) return;
    layoutName = n;
    if (appEl) appEl.dataset.layout = n;
    [].forEach.call(document.querySelectorAll(".sb[data-layout]"), function (e) { e.dataset.layout = n; });
    fitBar();
    layoutCbs.forEach(function (cb) { try { cb(n); } catch (e) {} });
  }

  /* Inside Ice and Glass the page below the bar needs to know how tall it is. */
  function fitBar() {
    if (!barHost) return;
    global.requestAnimationFrame(function () { document.documentElement.style.setProperty("--shellbar-h", barHost.offsetHeight + "px"); });
  }

  /* ---------- the address ---------- */
  function parse(hash) {
    var m = String(hash || "").replace(/^#/, "");
    if (m === "" || m === "/") return { page: "facilities" };
    var p = m.split("/").filter(Boolean);
    if (p.length === 1 && p[0] === "staff") return { page: "staff" };
    if (p[0] === "f" && p[1]) {
      if (p.length === 2) return { page: "sheets", fid: p[1] };
      if (p[2] === "s" && p[3] && p.length === 4) return { page: "sheets", fid: p[1], sid: p[3] };
      if (p[2] === "s" && p[3] && p[4] === "settings" && p.length === 5) return { page: "settings", fid: p[1], sid: p[3] };
      /* Ice's own pages. The shell's pages never draw these; they are read by Ice (and by
         whereFromAddress), and the sheet they sit under is the sheet you are on. */
      if (p[2] === "s" && p[3] && (p[4] === "rink" || p[4] === "trends" || p[4] === "build" || p[4] === "inventory") && p.length === 5) return { page: "sheets", fid: p[1], sid: p[3], view: p[4] };
    }
    return { page: "unknown" };
  }
  /* A route the person may not have, or that names nothing, lands on Facilities
     with one message: it never says which, so it does not reveal what exists. */
  function resolve(r) {
    if (r.page === "facilities") return r;
    if (r.page === "staff") return isManager() ? r : null;
    if (r.page === "unknown") return null;
    var f = (data.facilities || []).filter(function (x) { return x.id === r.fid; })[0];
    if (!f) return null;
    if (r.sid && !(f.sheets || []).some(function (s) { return s.id === r.sid; })) return null;
    return r;
  }
  function go(path) { global.location.hash = path; }

  /* ---------- who may do what ---------- */
  var SYNC = (typeof Sync !== "undefined") ? Sync : null;
  var canSee = function (fid) { return !SYNC || SYNC.canSee(fid); };
  var canManage = function () { return !SYNC || SYNC.canManage(); };
  var person = function () { return SYNC ? SYNC.person() : null; };
  /* Can this person change things right now? Management (or nobody signed in as a person
     yet), and, once people exist, with the editing window open. A page greys its own
     controls from this; the server enforces it regardless. */
  function canEdit() { return canManage() && (!SYNC || !SYNC.person() || SYNC.isEditing()); }
  /* The Staff page needs people to exist and the person to be Management. */
  function isManager() { return !!(SYNC && SYNC.person() && SYNC.canManage()); }

  /* ---------- data, read-only ---------- */
  async function load() {
    var st = await Repo.read();
    var facs = ((st && st.facilities) || []).filter(function (f) { return canSee(f.id); });
    var glass = {};
    for (var i = 0; i < facs.length; i++) {
      var sheets = facs[i].sheets || [];
      for (var j = 0; j < sheets.length; j++) glass[sheets[j].id] = await Records.glassSummary(sheets[j].id);
    }
    var live = {}; facs.forEach(function (f) { live[f.id] = true; });
    var removed = (await Repo.readRemoved()).filter(function (r) { return live[r.facilityId]; });
    return { prefs: (st && st.prefs) || {}, facilities: facs, sessions: (st && st.sessions) || [], glass: glass, removed: removed };
  }

  /* How a sheet is doing. The overdue rule is the store's, read from the
     facility, so this screen, the rail and Ice cannot disagree. */
  function status(d, f, s) {
    var last = Records.lastRound(d.sessions, s.id);
    var od = Records.overdueDaysOf(f, d.prefs);
    var days = last ? Math.floor((Date.now() - new Date(last.date)) / 86400000) : null;
    var over = Records.isOverdue(last, od);
    return { last: last, days: days, over: over, overBy: over ? days - od : 0, overdueDays: od };
  }

  /* ---------- where you are ---------- */
  function activeSheetOf(f) {
    if (!f) return null;
    var sheets = f.sheets || [];
    if (route.sid) return sheets.filter(function (s) { return s.id === route.sid; })[0] || sheets[0] || null;
    var pref = sheets.filter(function (s) { return s.id === (data.prefs || {}).activeSheet; })[0];
    return pref || sheets[0] || null;
  }
  async function setHere(f, s) {
    var newest = (data.sessions || []).filter(function (x) { return x && !x.deleted && x.sheetId === s.id; })
      .sort(function (a, b) { return new Date(b.date) - new Date(a.date); })[0];
    var patch = { activeFacility: f.id, activeSheet: s.id };
    if (newest) patch.activeSession = newest.id;       // Ice repairs this itself if a sheet has none
    data.prefs = await Repo.savePrefs(patch);
  }
  function appHref(app, f, s) { return app + ".html#/f/" + f.id + "/s/" + s.id; }

  /* ---------- menus ---------- */
  function closeMenu() {
    if (openMenu) { openMenu.drop.remove(); openMenu.btn.setAttribute("aria-expanded", "false"); openMenu = null; }
  }
  function makeMenu(btn, items, right) {
    var wrap = h("span", { cls: "menuwrap" });
    var api = { el: wrap, btn: btn };
    function toggle() {
      if (openMenu && openMenu.btn === btn) { closeMenu(); return; }
      closeMenu();
      var drop = h("div", { cls: "dropdown" + (right ? " right" : ""), role: "menu" });
      items().forEach(function (it) {
        if (it.hd) { drop.appendChild(h("div", { cls: "hd", text: it.hd })); return; }
        if (it.hr) { drop.appendChild(h("hr")); return; }
        var node = it.href
          ? h("a", { cls: "it", role: "menuitem", href: it.href, text: it.label })
          : h("button", { cls: "it", role: "menuitem", type: "button", text: it.label, disabled: !!it.disabled });
        if (it.current) node.setAttribute("aria-current", "true");
        node.addEventListener("click", function (e) { closeMenu(); if (it.onclick) it.onclick(e); });
        drop.appendChild(node);
      });
      wrap.appendChild(drop);
      btn.setAttribute("aria-expanded", "true");
      openMenu = { btn: btn, drop: drop };
    }
    btn.addEventListener("click", function (e) { e.stopPropagation(); toggle(); });
    btn.setAttribute("aria-haspopup", "menu"); btn.setAttribute("aria-expanded", "false");
    wrap.insertBefore(btn, wrap.firstChild);
    api.open = function () { if (!openMenu || openMenu.btn !== btn) toggle(); };
    return api;
  }

  /* ---------- the chrome ---------- */
  function theme(t) {
    document.documentElement.setAttribute("data-theme", t);
    var m = document.querySelector("meta[name=theme-color]");
    if (m) m.setAttribute("content", t === "light" ? "#f4f7fb" : "#0b0d0f");
    Store.set("rink_theme", t);
    global.dispatchEvent(new CustomEvent("shell:prefs", { detail: { theme: t } }));      // an app holds its own copy and must hear it
  }
  function currentTheme() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; }

  /* ---------- backup, restore and units: the account menu's own work ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("toast");
    /* On the body, not in the app: a sync that arrives redraws the app, and would take the message with it. */
    if (!t) { t = h("div", { id: "toast", cls: "toast sb", role: "status" }); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 4500);
  }
  function backupAgo(iso) {
    if (!iso) return "No backup yet";
    var days = Math.floor((Date.now() - new Date(iso)) / 86400000);
    return "Last backup: " + (days <= 0 ? "today" : days === 1 ? "yesterday" : days + " days ago");
  }
  /* Offer the file to the share sheet where there is one (iPad: email, AirDrop), else download it. */
  async function saveFile(content, mime, name) {
    var blob = new Blob([content], { type: mime });
    if (navigator.share && navigator.canShare) {
      var file = new File([blob], name, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return "shared"; }
        catch (err) { if (err && err.name === "AbortError") return "cancelled"; }
      }
    }
    var u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 1500);
    return "downloaded";
  }
  async function backUp() {
    var obj = await Repo.exportAll({ only: canSee });           // only what this person may see
    var name = "ice_sheet_backup_" + new Date().toISOString().slice(0, 10) + ".json";
    var res = await saveFile(JSON.stringify(obj), "application/json", name);
    if (res === "cancelled") return;
    data.prefs = await Repo.savePrefs({ lastBackup: new Date().toISOString() });
    toast(res === "shared" ? "Backup shared" : "Backup saved");
  }
  /* A question asked in the page, not in a browser dialog. */
  function askYesNo(title, body, yesLabel, onYes) {
    var dlg = h("div", { cls: "dlg sb", id: "askDlg", role: "dialog", "aria-modal": "true", "aria-label": title }, [
      h("div", { cls: "dlgbox" }, [h("h3", { text: title }), h("p", { text: body }),
        h("div", { cls: "sbfoot" }, [
          h("button", { cls: "sbx", type: "button", id: "askYes", text: yesLabel, onclick: function () { dlg.remove(); onYes(); } }),
          h("button", { cls: "sbx ghost", type: "button", id: "askNo", text: "Cancel", onclick: function () { dlg.remove(); } })])])]);
    document.body.appendChild(dlg);
    var yes = document.getElementById("askYes"); if (yes) yes.focus();
  }
  var fileIn = null;
  function restore() {
    if (SYNC && !SYNC.canRestore()) { toast(SYNC.restoreMessage); return; }
    if (!canEdit()) { toast("Unlock to edit to restore a backup."); return; }
    if (!fileIn) {
      fileIn = h("input", { type: "file", id: "restoreFile", accept: ".json,application/json", hidden: true });
      fileIn.addEventListener("change", function () {
        var f = fileIn.files[0]; fileIn.value = "";
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () { chooseRestore(rd.result); };
        rd.readAsText(f);
      });
      document.body.appendChild(fileIn);                 // not the shell root: every redraw replaces that
    }
    fileIn.click();
  }
  /* The question is asked in the page, not in a browser dialog: those are unreliable on an
     iPad home-screen app and cannot be tested the way the rest of the page can. */
  function chooseRestore(textContent) {
    var obj = null, pv = null;
    try { obj = JSON.parse(textContent); pv = Repo.previewImport(obj); } catch (e) { pv = { ok: false }; }
    if (!pv.ok) { toast("That doesn't look like a valid backup file."); return; }
    var dlg = h("div", { cls: "dlg sb", id: "restoreDlg", role: "dialog", "aria-modal": "true", "aria-label": "Restore from backup" }, [
      h("div", { cls: "dlgbox" }, [
        h("h3", { text: "Merge this backup into your data?" }),
        h("p", { id: "restoreCount", text: pv.rounds + " round" + (pv.rounds === 1 ? "" : "s") + " in the file. Nothing is deleted: where both copies changed the same round, the newer edit wins and readings from each are kept." }),
        h("div", { cls: "sbfoot" }, [
          h("button", { cls: "sbx", type: "button", id: "restoreYes", text: "Merge", onclick: async function () {
            dlg.remove();
            var res = await Repo.importAll(obj);
            if (!res.ok) { toast("That doesn't look like a valid backup file."); return; }
            await refresh();
            if (res.taken && SYNC) SYNC.nudge();               // it should reach the other devices now
            toast(res.taken ? "Merged " + res.taken + " change" + (res.taken === 1 ? "" : "s") : "Already up to date");
          } }),
          h("button", { cls: "sbx ghost", type: "button", id: "restoreNo", text: "Cancel", onclick: function () { dlg.remove(); } })])])]);
    document.body.appendChild(dlg);
    var yes = document.getElementById("restoreYes"); if (yes) yes.focus();
  }
  async function setUnit(u) {
    data.prefs = await Repo.savePrefs({ unit: u });
    global.dispatchEvent(new CustomEvent("shell:prefs", { detail: { unit: u } }));
  }

  /* Where a menu item goes: on the shell's own pages, an address on the page; inside an app,
     the same address on that app's page, which the app reads. */
  function link(fid, sid) { return (barApp ? barApp + ".html" : "") + "#/f/" + fid + (sid ? "/s/" + sid : ""); }

  function buildNav(f, s) {
    var nav = h("header", { cls: "nav sb" + (barApp ? " sb-app" : ""), "data-layout": layoutName });
    nav.appendChild(h("a", { cls: "logo", href: barApp ? "index.html" : "#/", title: "Facilities", text: "LOGO", id: "logo" }));

    // the facility menu
    var fb = h("button", { cls: "menu", type: "button", id: "facMenu" }, [h("span", { text: f ? f.name : "Facility" })]);
    var fm = makeMenu(fb, function () {
      return (data.facilities || []).map(function (x) {
        return { label: x.name, href: link(x.id), current: !!f && x.id === f.id };
      });
    });
    fm.el.classList.add("mfac");
    nav.appendChild(fm.el);

    // the sheet menu, which has nothing to act on until a facility is chosen
    var sb = h("button", { cls: "menu" + (f ? "" : " off"), type: "button", id: "sheetMenu", disabled: !f },
      [h("span", { text: s ? (s.name || "Sheet") : "Sheet" })]);
    var sm = makeMenu(sb, function () {
      return ((f && f.sheets) || []).map(function (x) {
        return { label: x.name || "Sheet", href: link(f.id, x.id), current: !!s && x.id === s.id };
      });
    });
    sm.el.classList.add("msheet");
    nav.appendChild(sm.el);

    // the app switch
    var sw = h("span", { cls: "appsw" + (s ? "" : " off"), id: "appSw" });
    ["ice", "glass"].forEach(function (a) {
      var here = barApp === a;                                   // the app you are in is marked, and goes nowhere
      sw.appendChild(h("a", { href: s ? appHref(a, f, s) : "#", "data-app": (s && !here) ? a : null, "aria-current": here ? "true" : null,
                              text: a === "ice" ? "Ice" : "Glass" }));
    });
    nav.appendChild(sw);

    // phone: one button that says where you are
    var cb = h("button", { cls: "menu ctx", type: "button", id: "ctxBtn" },
      [h("span", { text: f ? (f.name + (s && (f.sheets || []).length > 1 ? " · " + (s.name || "") : "")) : "Facilities" })]);
    var cm = makeMenu(cb, function () {
      var items = [{ hd: "Facility" }];
      (data.facilities || []).forEach(function (x) { items.push({ label: x.name, href: link(x.id), current: !!f && x.id === f.id }); });
      if (f && (f.sheets || []).length) {
        items.push({ hr: true }, { hd: "Sheet" });
        f.sheets.forEach(function (x) { items.push({ label: x.name || "Sheet", href: link(f.id, x.id), current: !!s && x.id === s.id }); });
      }
      return items;
    });
    nav.appendChild(cm.el);

    nav.appendChild(h("span", { cls: "spacer" }));
    if (statusEl) nav.appendChild(statusEl);
    if (unlockEl) nav.appendChild(unlockEl);

    // the account menu
    var who = person();
    var ab = h("button", { cls: "chipu", type: "button", id: "acctMenu" }, [h("span", { id: "whoName", text: who ? who.name : "Menu" })]);
    acct = makeMenu(ab, function () {
      var it = [];
      if (isManager()) it.push({ hd: "Account" }, { label: "Staff", href: (barApp ? "index.html" : "") + "#/staff", current: route.page === "staff" }, { hr: true });
      it.push({ hd: "Theme" },
        { label: "Light", current: currentTheme() === "light", onclick: function () { theme("light"); acctRefresh(); } },
        { label: "Dark", current: currentTheme() === "dark", onclick: function () { theme("dark"); acctRefresh(); } },
        { hr: true }, { hd: "Units" },
        { label: "Inches", current: ((data.prefs || {}).unit || "in") !== "mm", onclick: function () { setUnit("in"); } },
        { label: "Millimetres", current: (data.prefs || {}).unit === "mm", onclick: function () { setUnit("mm"); } },
        { hr: true }, { hd: "Data" },
        { label: "Back up all data", onclick: function () { backUp(); } },
        { label: "Restore from backup\u2026", onclick: function () { restore(); } },
        { label: backupAgo((data.prefs || {}).lastBackup), disabled: true },
        { hr: true });
      /* Restoring merges records into storage under a page that holds its own copy and would
         save it straight back over them, so inside an app it stays where it is safe: on the shell's
         pages (and Ice's own Preferences, which fixes up its state afterwards). */
      if (barApp) it = it.filter(function (x) { return !/^Restore from backup/.test(x.label || ""); });
      if (SYNC) {
        if (person()) it.push({ label: "Switch user", onclick: function () { SYNC.switchUser(); } });
        it.push({ label: "Sign out", onclick: function () {
          askYesNo("Sign out of this device?", "You\u2019ll need the access code to get back in. Anything saved on this device stays where it is.", "Sign out",
            function () { SYNC.signOut(); }); } });
      }
      return it;
    }, true);
    nav.appendChild(acct.el);
    return nav;
  }
  function acctRefresh() { /* the theme is a stylesheet variable, so there is nothing to redraw */ }

  function buildRail(f) {
    var rail = h("aside", { cls: "rail", id: "rail", "aria-label": "Facilities" });
    rail.appendChild(h("a", { href: "#/", text: "Facilities", "aria-current": route.page === "facilities" ? "true" : null }));
    (data.facilities || []).forEach(function (x) {
      rail.appendChild(h("h3", { text: x.name }));
      (x.sheets || []).forEach(function (s) {
        var st = status(data, x, s);
        rail.appendChild(h("a", { cls: "subl", href: "#/f/" + x.id + "/s/" + s.id,
          "aria-current": f && x.id === f.id && route.sid === s.id ? "true" : null }, [
            st.over ? h("i", { cls: "dot", title: "overdue" }) : null, h("span", { text: s.name || "Sheet" })]));
      });
    });
    if (isManager()) {
      rail.appendChild(h("h3", { text: "Account" }));
      rail.appendChild(h("a", { href: "#/staff", text: "Staff", "aria-current": route.page === "staff" ? "true" : null }));
    }
    return rail;
  }

  function buildTabs(f, s) {
    var t = h("nav", { cls: "tabbar", id: "tabbar", "aria-label": "Main" });
    t.appendChild(h("a", { href: "#/", text: "Facilities", "aria-current": route.page === "facilities" ? "true" : null }));
    ["ice", "glass"].forEach(function (a) {
      t.appendChild(h("a", { cls: s ? "" : "off", href: s ? appHref(a, f, s) : "#", "data-app": s ? a : null, text: a === "ice" ? "Ice" : "Glass" }));
    });
    var m = h("button", { type: "button", text: "Menu", onclick: function (e) { e.stopPropagation(); if (acct) acct.open(); } });
    t.appendChild(m);
    return t;
  }

  /* ---------- drawing ---------- */
  function draw() {
    var f = route.fid ? (data.facilities || []).filter(function (x) { return x.id === route.fid; })[0] : null;
    var s = activeSheetOf(f);
    closeMenu();
    appEl = h("div", { cls: "app", "data-layout": layoutName });
    appEl.appendChild(buildNav(f, s));
    var body = h("div", { cls: "body" });
    body.appendChild(buildRail(f));
    pageEl = h("main", { id: "page" });
    body.appendChild(pageEl);
    appEl.appendChild(body);
    appEl.appendChild(buildTabs(f, s));
    root.replaceChildren(appEl);

    if (notice) { pageEl.appendChild(h("div", { cls: "notice", role: "status", text: notice })); notice = ""; }
    pageEl.appendChild(home.render(route, data, Shell));
  }

  /* Redraw the page and leave the chrome alone: for a page whose own state changed. */
  function repaint() {
    if (!pageEl || !data) return;
    /* The data can have moved on since this route was resolved (a sheet was removed here or
       on another device), so check it still names something before drawing it. */
    if (!resolve(route)) { refresh(); return; }
    pageEl.replaceChildren();
    pageEl.appendChild(home.render(route, data, Shell));
  }

  async function refresh() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      do {
        again = false;
        data = await load();
        var r = resolve(parse(global.location.hash));
        if (!r) {
          notice = NOTICE;
          global.history.replaceState(null, "", global.location.pathname + global.location.search + "#/");
          r = { page: "facilities" };
        }
        route = r;
        /* A facility or sheet address is where you are. */
        if (route.fid) {
          var f = data.facilities.filter(function (x) { return x.id === route.fid; })[0], s = activeSheetOf(f);
          if (f && s && ((data.prefs || {}).activeSheet !== s.id || (data.prefs || {}).activeFacility !== f.id)) await setHere(f, s);
        }
        draw();
      } while (again);
    } finally { busy = false; }
  }

  /* The listeners both the shell's pages and the bar inside an app need, once. */
  function installGlobals() {
    if (globalsOn) return; globalsOn = true;
    global.addEventListener("resize", measure);
    document.addEventListener("click", function (e) {
      if (openMenu && !openMenu.drop.contains(e.target)) closeMenu();
      var a = e.target.closest && e.target.closest("[data-app]");
      if (a) {                                    // open an app on the sheet shown, which is where you are
        e.preventDefault();
        var f = data.facilities.filter(function (x) { return x.id === route.fid; })[0], s = activeSheetOf(f);
        if (f && s) setHere(f, s).then(function () { global.location.href = a.getAttribute("href"); });
      }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });
  }

  /* ---------- the bar inside Ice and Glass ----------
     An app hands over an element and the bar is drawn there; the app's own page is untouched
     below it. The app reads where you are from the address (whereFromAddress), keeps the address
     in step when it changes sheet itself (setAddress), and hears a change of sheet from the bar's
     menus as an ordinary hashchange. A theme or unit chosen in the bar reaches it as "shell:prefs",
     because the app holds its own copy and would otherwise save the old one back. */
  async function barData() {
    var st = await Repo.read();
    return { prefs: (st && st.prefs) || {}, facilities: ((st && st.facilities) || []).filter(function (f) { return canSee(f.id); }),
             sessions: (st && st.sessions) || [], glass: {}, removed: [] };
  }
  /* The facility and sheet the address names, if this person may have them: {fid, sid}, else null.
     A facility with no sheet named means the sheet you were last on there, or its first. */
  async function whereFromAddress() {
    var r = parse(global.location.hash);
    if (r.page !== "sheets" || !r.fid) return null;
    var d = await barData(), f = d.facilities.filter(function (x) { return x.id === r.fid; })[0];
    if (!f) return null;
    var sheets = f.sheets || [], s = r.sid ? sheets.filter(function (x) { return x.id === r.sid; })[0]
      : (sheets.filter(function (x) { return x.id === (d.prefs || {}).activeSheet; })[0] || sheets[0]);
    return s ? { fid: f.id, sid: s.id, view: r.sid ? r.view || null : null } : null;
  }
  async function paintBar() {
    if (!barHost) return;
    data = await barData();
    var r = parse(global.location.hash), f = null, s = null;
    if (r.fid) f = data.facilities.filter(function (x) { return x.id === r.fid; })[0] || null;
    if (!f) f = data.facilities.filter(function (x) { return x.id === data.prefs.activeFacility; })[0] || data.facilities[0] || null;
    if (f && r.sid) s = (f.sheets || []).filter(function (x) { return x.id === r.sid; })[0] || null;
    if (f && !s) s = (f.sheets || []).filter(function (x) { return x.id === data.prefs.activeSheet; })[0] || (f.sheets || [])[0] || null;
    route = { page: "sheets", fid: f ? f.id : null, sid: s ? s.id : null };
    closeMenu();
    barHost.replaceChildren(buildNav(f, s));
    fitBar();
  }
  /* The app changed sheet itself (a row on its own home screen): put that in the address, and
     in where-you-are, without a navigation. Called on every save, so it is cheap when nothing moved. */
  function setAddress(fid, sid, view) {
    if (!barHost || !fid || !sid) return;
    /* A call that does not name a page keeps the page the address already has, on the same sheet. */
    var cur = parse(global.location.hash);
    if (view === undefined && cur.fid === fid && cur.sid === sid) view = cur.view;
    var want = "#/f/" + fid + "/s/" + sid + (view ? "/" + view : "");
    if (global.location.hash === want) return;
    global.history.replaceState(null, "", global.location.pathname + global.location.search + want);
    paintBar();
  }
  async function mountBar(host, opts) {
    barHost = host; barApp = (opts && opts.app) || null;
    host.dataset.layout = layoutName;
    if (SYNC) { statusEl = SYNC.statusEl(); unlockEl = SYNC.unlockEl ? SYNC.unlockEl() : null; }
    installGlobals(); measure();
    global.addEventListener("hashchange", paintBar);
    await paintBar();
  }

  /* ---------- starting ---------- */
  async function mount(rootEl, homeApp) {
    root = rootEl; home = homeApp;
    root.appendChild(h("div", { cls: "boot", text: "Arena Management System" }));
    measure();
    installGlobals();
    global.addEventListener("hashchange", refresh);

    if (SYNC) {
      await Repo.load();                          // hydrate the snapshot, so collect() can report it
      SYNC.attach({
        kinds: ["facility", "sheet", "session"],
        collect: function () { var m = Repo.outgoing(); return { facility: m.fac, sheet: m.sh, session: m.se }; },
        apply: function (incoming) {
          var res = Repo.merge({ facilities: incoming.facility || {}, sheets: incoming.sheet || {}, sessions: incoming.session || {} });
          if (!res.taken) return 0;
          Repo.persistMaps();
          if (data) refresh();
          return res.taken;
        }
      });
      await SYNC.start({ title: "Arena Management System" });
      await SYNC.verify();                         // catches a rotated code even when nothing needed syncing
      statusEl = SYNC.statusEl();
      unlockEl = SYNC.unlockEl ? SYNC.unlockEl() : null;
      SYNC.lockControls(["#addFac", "#addSheet", "#addGo"]);
      SYNC.onEditing(function () { repaint(); });          // the window opened or closed: controls that grey themselves redraw
    }
    await refresh();
  }

  var Shell = {
    mount: mount, mountBar: mountBar, whereFromAddress: whereFromAddress, setAddress: setAddress, refresh: refresh, repaint: repaint, toast: toast, backUp: backUp, canEdit: canEdit, go: go, h: h, status: status, setHere: setHere, appHref: appHref,
    layout: function () { return layoutName; },
    onLayout: function (cb) { layoutCbs.push(cb); cb(layoutName); },
    route: function () { return route; }, data: function () { return data; },
    activeSheetOf: activeSheetOf, canManage: canManage, isManager: isManager, notice: NOTICE,
    parse: parse,
    /* the width at which each layout starts, for the tests and for D3/D4 to ask */
    breakpoints: { phoneMax: PHONE_MAX, ipadMax: IPAD_MAX }
  };
  global.Shell = Shell;
})(this);
