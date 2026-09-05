/* ============================================================================
   Shared sync for the Arena Management System.

   Both apps keep their own records locally and hand them to this file, which
   is the only thing that talks to Supabase. Local storage stays the primary
   copy — sync is a layer on top — so a paused project, dead wifi or a refused
   sign-in never stops anyone working. It only stops changes crossing devices.

   An app wires itself in with Sync.attach({kinds, collect, apply}) and never
   touches the network itself.
   ========================================================================= */
(function (global) {
  "use strict";

  var CFG = {
    url:   "https://uiocwdacgbhjccodwrcy.supabase.co",
    anon:  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpb2N3ZGFjZ2JoamNjb2R3cmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NTk4MjYsImV4cCI6MjEwNDEzNTgyNn0.Em_cz0Buz3bmjplvwthfWo04EBVz1bHYP4v9YxRt6N4",
    email: "operations@conwayarena.local"
  };
  /* Tests point this at a stand-in; the real pages never call it. */
  if (global.__SYNC_CONFIG__) { for (var k in global.__SYNC_CONFIG__) CFG[k] = global.__SYNC_CONFIG__[k]; }

  var K_SESSION = "rink_session";     // access + refresh token for this device
  var K_CURSOR  = "rink_sync_cursor"; // newest updated_at we have already seen
  var K_SENT    = "rink_sync_sent";   // "kind id" -> the updatedAt we last successfully sent
  var K_WHO     = "rink_who";         // the name stamped on this device's edits

  /* Same storage wrapper the apps use. */
  var Store = {
    get: function (k) {
      try { if (global.storage && global.storage.get) return Promise.resolve(global.storage.get(k)).then(function (r) { return r ? r.value : null; }); } catch (e) {}
      try { return Promise.resolve(localStorage.getItem(k)); } catch (e) { return Promise.resolve(null); }
    },
    set: function (k, v) {
      try { if (global.storage && global.storage.set) return Promise.resolve(global.storage.set(k, v)); } catch (e) {}
      try { localStorage.setItem(k, v); } catch (e) {}
      return Promise.resolve();
    }
  };
  var readJSON  = function (k, d) { return Store.get(k).then(function (r) { try { return r ? JSON.parse(r) : d; } catch (e) { return d; } }); };
  var writeJSON = function (k, v) { return Store.set(k, JSON.stringify(v)); };

  var session = null, hooks = null, statusCbs = [], state = "offline", detail = "";
  var pushTimer = null, syncing = false;

  function setStatus(s, d) {
    if (s === state && d === detail) return;
    state = s; detail = d || "";
    statusCbs.forEach(function (cb) { try { cb(state, detail); } catch (e) {} });
  }

  function headers(auth) {
    var h = { "apikey": CFG.anon, "Content-Type": "application/json" };
    if (auth && session) h["Authorization"] = "Bearer " + session.access_token;
    return h;
  }

  /* --- auth ---------------------------------------------------------------
     Access tokens are short-lived, so a stored session is refreshed rather
     than asking the crew to retype the code every hour. */
  function saveSession(j) {
    session = { access_token: j.access_token, refresh_token: j.refresh_token,
                expires_at: Date.now() + ((j.expires_in || 3600) - 60) * 1000 };
    return writeJSON(K_SESSION, session).then(function () { return session; });
  }

  function signIn(code) {
    return fetch(CFG.url + "/auth/v1/token?grant_type=password", {
      method: "POST", headers: headers(false),
      body: JSON.stringify({ email: CFG.email, password: code })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.access_token) return saveSession(j).then(function () { return { ok: true }; });
      var raw = String(j.error_description || j.msg || j.error || "");
      return { ok: false, error: /invalid login/i.test(raw) ? "That code doesn't match. Check with Pete and try again."
                                : raw || "Sign-in failed. Try again." };
    }).catch(function () {
      return { ok: false, error: "Can't reach the server. Check the connection and try again." };
    });
  }

  function refresh() {
    if (!session || !session.refresh_token) return Promise.resolve(false);
    return fetch(CFG.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: headers(false),
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.access_token) return saveSession(j).then(function () { return true; });
      return false;
    }).catch(function () { return false; });   // offline: keep the session, try later
  }

  function ensureToken() {
    if (!session) return Promise.resolve(false);
    if (Date.now() < session.expires_at) return Promise.resolve(true);
    return refresh();
  }

  function signOut() {
    session = null;
    return Promise.all([writeJSON(K_SESSION, null), writeJSON(K_CURSOR, null), writeJSON(K_SENT, {})]);
  }

  /* --- transport ---------------------------------------------------------- */
  function pull() {
    return readJSON(K_CURSOR, null).then(function (cursor) {
      var q = CFG.url + "/rest/v1/records?select=*&order=updated_at.asc&limit=1000";
      if (hooks && hooks.kinds) q += "&kind=in.(" + hooks.kinds.join(",") + ")";
      if (cursor) q += "&updated_at=gt." + encodeURIComponent(cursor);
      return fetch(q, { headers: headers(true) }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (rows) {
        if (!rows.length) return 0;
        var byKind = {};
        rows.forEach(function (row) {
          (byKind[row.kind] = byKind[row.kind] || {})[row.id] =
            Object.assign({}, row.body, { id: row.id, updatedAt: row.updated_at, deleted: !!row.deleted });
        });
        var newest = rows[rows.length - 1].updated_at;
        var applied = hooks.apply(byKind) || 0;
        /* Anything we just took from the server matches the server, so mark it
           as sent — otherwise the next push would echo it straight back and
           bump its timestamp, making everyone else's copy look stale. */
        return readJSON(K_SENT, {}).then(function (sent) {
          var now = hooks.collect() || {};
          rows.forEach(function (row) {
            var mine = (now[row.kind] || {})[row.id];
            if (mine && mine.updatedAt === row.updated_at) sent[row.kind + " " + row.id] = row.updated_at;
          });
          return writeJSON(K_SENT, sent);
        }).then(function () { return writeJSON(K_CURSOR, newest); }).then(function () { return applied; });
      });
    });
  }

  /* Rows are sent in batches; anything that fails is kept for the next go. */
  function sendRows(rows) {
    if (!rows.length) return Promise.resolve(true);
    var batches = [], i;
    for (i = 0; i < rows.length; i += 200) batches.push(rows.slice(i, i + 200));
    return batches.reduce(function (chain, batch) {
      return chain.then(function (okSoFar) {
        if (!okSoFar) return false;
        return fetch(CFG.url + "/rest/v1/records?on_conflict=kind,id", {
          method: "POST",
          headers: Object.assign(headers(true), { "Prefer": "resolution=merge-duplicates,return=minimal" }),
          body: JSON.stringify(batch)
        }).then(function (r) { return r.ok; }).catch(function () { return false; });
      });
    }, Promise.resolve(true));
  }

  /* Only records whose local timestamp differs from the one we last sent.
     Pushing everything every time would restamp every row on the server, make
     each device look newer than the others, and quietly undo the whole
     conflict-resolution design. */
  function changed() {
    return readJSON(K_SENT, {}).then(function (sent) {
      var collected = hooks.collect() || {}, rows = [], stamps = {};
      Object.keys(collected).forEach(function (kind) {
        var recs = collected[kind] || {};
        Object.keys(recs).forEach(function (id) {
          var r = recs[id], key = kind + " " + id, st = r.updatedAt || "";
          if (sent[key] === st) return;
          var b = Object.assign({}, r);
          delete b.updatedAt; delete b.deleted;
          rows.push({ id: id, kind: kind, body: b, deleted: !!r.deleted });
          stamps[key] = st;
          /* updated_at is deliberately not sent — the server stamps it, so a
             device with a wrong clock can't win every conflict forever. */
        });
      });
      return { rows: rows, stamps: stamps, sent: sent };
    });
  }

  function pendingCount() { return changed().then(function (c) { return c.rows.length; }); }

  function push() {
    return changed().then(function (c) {
      if (!c.rows.length) return true;
      return sendRows(c.rows).then(function (ok) {
        if (!ok) return false;
        Object.keys(c.stamps).forEach(function (k) { c.sent[k] = c.stamps[k]; });
        return writeJSON(K_SENT, c.sent).then(function () { return true; });
      });
    });
  }

  /* --- the loop ----------------------------------------------------------- */
  function sync(reason) {
    if (syncing || !hooks) return Promise.resolve();
    if (!session) { setStatus("local", "not signed in"); return Promise.resolve(); }
    if (!navigator.onLine) {
      return pendingCount().then(function (n) {
        setStatus("offline", n ? n + " change" + (n === 1 ? "" : "s") + " waiting to send" : "saved on this device");
      });
    }
    syncing = true; setStatus("syncing", reason || "");
    return ensureToken().then(function (ok) {
      if (!ok) { setStatus("offline", "signed out — enter the code again"); return; }
      return push().then(function (pushed) {
        return pull().then(function (applied) {
          if (pushed) { setStatus("synced", applied ? "brought in " + applied + " change" + (applied === 1 ? "" : "s") : "up to date"); return; }
          return pendingCount().then(function (n) {
            setStatus("offline", n + " change" + (n === 1 ? "" : "s") + " waiting to send");
          });
        });
      });
    }).catch(function (e) {
      setStatus("offline", "can't reach the server");
    }).then(function () { syncing = false; });
  }

  function nudge() {                      // called by the apps after any edit
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { sync("saving"); }, 1500);
  }

  /* --- the access gate ---------------------------------------------------- */
  var GATE_CSS = ''
    + '.sync-gate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;'
    + 'padding:24px;background:radial-gradient(1200px 600px at 50% -10%,var(--glow,#16283a) 0%,transparent 60%),var(--bg,#0d1620)}'
    + '.sync-gate .box{width:100%;max-width:360px;display:flex;flex-direction:column;gap:20px}'
    + '.sync-gate .bd{display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center}'
    + '.sync-gate .bd h2{margin:0;font-size:23px;font-weight:800;display:flex;align-items:baseline;gap:9px;'
    + 'color:var(--ink,#eaf3f8)}'
    + '.sync-gate .bd h2 i{font-style:normal;font-family:var(--mono,monospace);color:var(--frost,#6fd6ec);font-size:17px}'
    + '.sync-gate .bd p{margin:0;font-size:12.5px;color:var(--ink-dim,#90a8b8)}'
    + '.sync-gate form{background:var(--panel,#152433);border:1px solid var(--line,#273d4f);border-radius:14px;'
    + 'padding:22px 20px;display:flex;flex-direction:column;gap:12px}'
    + '.sync-gate label{font-family:var(--mono,monospace);font-size:10px;letter-spacing:.14em;text-transform:uppercase;'
    + 'color:var(--ink-faint,#5d7384)}'
    + '.sync-gate input{font:inherit;font-size:17px;height:44px;padding:0 14px;border-radius:10px;width:100%;'
    + 'border:1px solid var(--line,#273d4f);background:var(--panel-2,#1c3142);color:var(--ink,#eaf3f8)}'
    + '.sync-gate input:focus{outline:2px solid var(--frost,#6fd6ec);outline-offset:-1px}'
    + '.sync-gate button{appearance:none;font:inherit;font-size:15px;font-weight:700;height:44px;border:0;'
    + 'border-radius:10px;background:var(--frost,#6fd6ec);color:#06222b;cursor:pointer}'
    + '.sync-gate button:disabled{opacity:.55;cursor:default}'
    + '.sync-gate .err{min-height:16px;font-size:12.5px;color:#e5645d}'
    + '.sync-gate .hint{font-size:12px;color:var(--ink-faint,#5d7384);text-align:center;line-height:1.55}'
    + '.sync-pill{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono,monospace);font-size:11px;'
    + 'color:var(--ink-dim,#90a8b8);background:var(--panel,#152433);border:1px solid var(--line,#273d4f);'
    + 'border-radius:999px;padding:5px 11px;white-space:nowrap}'
    + '.sync-pill i{width:7px;height:7px;border-radius:50%;background:var(--ink-faint,#5d7384);flex:none}'
    + '.sync-pill.synced i{background:#7fcf9a}.sync-pill.syncing i{background:var(--frost,#6fd6ec)}'
    + '.sync-pill.offline i{background:#e8b54a}.sync-pill.local i{background:var(--ink-faint,#5d7384)}';

  function injectCSS() {
    if (document.getElementById("sync-css")) return;
    var s = document.createElement("style"); s.id = "sync-css"; s.textContent = GATE_CSS;
    document.head.appendChild(s);
  }

  function showGate(title) {
    return new Promise(function (resolve) {
      injectCSS();
      var el = document.createElement("div");
      el.className = "sync-gate";
      el.innerHTML =
        '<div class="box"><div class="bd"><h2><i>[ ◊ ]</i> ' + (title || "Arena Management System") + '</h2>'
        + '<p>Conway Arena &middot; Nashua, NH</p></div>'
        + '<form autocomplete="off"><label for="sg-code">Access code</label>'
        + '<input id="sg-code" type="password" inputmode="text" autocapitalize="none" autocorrect="off" spellcheck="false">'
        + '<button type="submit">Continue</button><div class="err"></div></form>'
        + '<p class="hint">Ask Pete for the code.<br>You only need this once on each phone or tablet.</p></div>';
      document.body.appendChild(el);
      var form = el.querySelector("form"), input = el.querySelector("input"),
          btn = el.querySelector("button"), err = el.querySelector(".err");
      setTimeout(function () { input.focus(); }, 50);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var code = input.value;
        if (!code) { input.focus(); return; }
        btn.disabled = true; btn.textContent = "Checking…"; err.textContent = "";
        signIn(code).then(function (res) {
          if (res.ok) { el.remove(); resolve(true); return; }
          btn.disabled = false; btn.textContent = "Continue";
          err.textContent = res.error; input.select();
        });
      });
    });
  }

  /* --- public surface ----------------------------------------------------- */
  var Sync = {
    /* Resolves once the device is signed in; shows the gate if it isn't.
       An app that would rather run unsynced can skip start() entirely. */
    start: function (opts) {
      opts = opts || {};
      injectCSS();
      return readJSON(K_SESSION, null).then(function (s) {
        session = s;
        if (session) { setStatus("local", "checking…"); return true; }
        return showGate(opts.title);
      }).then(function () {
        window.addEventListener("online",  function () { sync("back online"); });
        window.addEventListener("offline", function () { setStatus("offline", "saved on this device"); });
        document.addEventListener("visibilitychange", function () { if (!document.hidden) sync("checking"); });
        return sync("opening");
      });
    },
    attach: function (h) { hooks = h; },
    nudge: nudge,
    sync: sync,
    signOut: function () { return signOut().then(function () { location.reload(); }); },
    onStatus: function (cb) { statusCbs.push(cb); cb(state, detail); },
    who: function (name) {
      if (name === undefined) return readJSON(K_WHO, "");
      return writeJSON(K_WHO, name);
    },
    isSignedIn: function () { return !!session; },
    pending: pendingCount,
    /* A pill the pages can drop into a header. */
    statusEl: function () {
      injectCSS();
      var el = document.createElement("span");
      el.className = "sync-pill";
      el.innerHTML = '<i></i><span></span>';
      Sync.onStatus(function (s, d) {
        el.className = "sync-pill " + s;
        el.querySelector("span").textContent =
          s === "synced"  ? (d && d !== "up to date" ? d : "everyone has this")
        : s === "syncing" ? "syncing…"
        : s === "offline" ? (d || "saved on this device")
        : (d || "on this device only");
      });
      return el;
    },
    _cfg: CFG
  };

  global.Sync = Sync;
})(window);
