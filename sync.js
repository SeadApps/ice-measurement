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
    email: "operations@conwayarena.local",
    staffDomain: "@staff.conwayarena.local",  // a person's login is <id> + this, their own code the password
    idleMs: 3600000,                          // a device signs the person out after this long unused
    idleCheckMs: 15000
  };
  /* Tests point this at a stand-in; the real pages never call it. */
  if (global.__SYNC_CONFIG__) { for (var k in global.__SYNC_CONFIG__) CFG[k] = global.__SYNC_CONFIG__[k]; }

  var K_SESSION = "rink_session";     // the session that reads and writes data: a person's, or the shared account's until people exist
  var K_DEVICE  = "rink_device";      // the shared account's session, kept once a person is signed in: it can only list names
  var K_PERSON  = "rink_person";      // {id, name} of whoever is signed in
  var K_DEPARTED = "rink_departed";   // people who left with changes unsent: their session, kept send-only, and which changes were theirs
  var K_ACTIVE  = "rink_active";      // when this device was last used, so a device left closed still times out
  var K_SCOPE   = "rink_scope";       // the facilities the signed-in person last had, so an offline start keeps the same cursor
  var K_ROLE    = "rink_role";        // admin, manager or staff: what the person last was, so an offline start shows the same pages
  var K_EDIT    = "rink_edit_until";  // when the editing window this person opened ends (ms). The server is the authority; this is only what to show.
  var K_CURSOR  = "rink_sync_cursor"; // newest updated_at we have already seen
  var K_SENT    = "rink_sync_sent";   // "kind id" -> the updatedAt we last successfully sent

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

  var session = null, device = null, person = null, hooks = null, statusCbs = [], state = "offline", detail = "";
  var pushTimer = null, syncing = false;
  var gateTitle = "Arena Management System";  // remembered so a re-gate looks like the first one
  var gatePromise = null;                     // one gate at a time, however many syncs race
  var resyncPending = false;
  var departed = [];                          // see K_DEPARTED
  var lastActive = Date.now(), lastSaved = 0, handing = false;
  var scope = "";                             // what the signed-in person may see, so a change of it re-pulls from the start
  var role = "";                              // "admin", "manager" or "staff" once the server has said; empty until then
  var lockSel = "";                           // the controls a page says change records; see lockControls
  var editUntil = 0, editCbs = [];            // the editing window, as far as this device knows
  var refusal = "";                           // why the last push was turned away: "locked" or "refused"
  var gateNotice = "";                        // what to say on the next gate: why it came back

  var MSG_CODE_CHANGED = "The access code has changed. Ask Pete for the new one.";
  var MSG_SIGNED_OUT   = "You were signed out. Pick your name and sign in again.";

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
  function tokens(j) {
    return { access_token: j.access_token, refresh_token: j.refresh_token,
             expires_at: Date.now() + ((j.expires_in || 3600) - 60) * 1000 };
  }
  function saveSession(j) {
    session = tokens(j);
    return writeJSON(K_SESSION, session).then(function () { return session; });
  }
  function saveDevice(j) {
    device = tokens(j);
    return writeJSON(K_DEVICE, device).then(function () { return device; });
  }

  /* A password grant, for either kind of login. The shared account and a person
     differ only in the email and what the password means. */
  function grant(email, code, save, wrong) {
    return fetch(CFG.url + "/auth/v1/token?grant_type=password", {
      method: "POST", headers: headers(false),
      body: JSON.stringify({ email: email, password: code })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.access_token) return save(j).then(function () { return { ok: true }; });
      var raw = String(j.error_description || j.msg || j.error || "");
      return { ok: false, error: /invalid login/i.test(raw) ? wrong : raw || "Sign-in failed. Try again." };
    }).catch(function () {
      return { ok: false, error: "Can't reach the server. Check the connection and try again." };
    });
  }

  /* Step 1: the shared access code. It signs the device in as an account that
     can do one thing, ask for the list of names. */
  function signIn(code) {
    return grant(CFG.email, code, saveDevice, "That code doesn't match. Check with Pete and try again.");
  }

  /* Step 2: a person, with their own code. Their session replaces the shared
     one as the thing that reads and writes data. */
  function signInPerson(p, code) {
    return grant(p.id + CFG.staffDomain, code, saveSession, "That code doesn't match. Check it and try again.")
      .then(function (res) {
        if (!res.ok) return res;
        person = { id: p.id, name: p.name };
        setEditing(0);
        paintLock();
        /* Back at the device they left: what was waiting for them is theirs to
           send again, in their own session. */
        departed = departed.filter(function (e) { return e.id !== p.id; });
        saveDeparted();
        touch();
        return writeJSON(K_PERSON, person).then(function () { return res; });
      });
  }

  /* Three outcomes, not two. Being offline and having the token rejected both
     fail to produce an access token, but they call for opposite responses:
     offline keeps the session and retries later, rejected clears it and asks
     for the code. Collapsing them into `false` is why rotating the access code
     used to leave every device showing its local copy for good — the pill said
     "enter the code again" and then nothing ever offered anywhere to enter it. */
  function refreshWith(tok, save) {
    if (!tok || !tok.refresh_token) return Promise.resolve("revoked");
    return fetch(CFG.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: headers(false),
      body: JSON.stringify({ refresh_token: tok.refresh_token })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (j.access_token) return save(j).then(function () { return "ok"; });
        /* Only an outright rejection counts as revoked. A paused project, a
           gateway error or a 5xx must not sign anyone out — err toward keeping
           the session, because a false positive throws a code prompt at
           somebody halfway through a round. */
        /* 403 counts: a hosted auth service refuses a banned (removed) person's
           refresh that way, and it is an answer from the server, not a
           network failure. A gateway error or a 5xx is still not one. */
        return (r.status === 400 || r.status === 401 || r.status === 403) ? "revoked" : "offline";
      });
    }).catch(function () { return "offline"; });   // no network: keep the session, try later
  }
  function refresh() { return refreshWith(session, saveSession); }

  /* The data session first. Then, if a person is signed in, the shared session
     that sits behind them: rotating the access code revokes that one, and the
     person's own session would otherwise carry on working for hours. A removed
     person is revoked by the first check. */
  function ensureToken() {
    if (!session) return Promise.resolve("revoked");
    var mine = Date.now() < session.expires_at ? Promise.resolve("ok") : refresh();
    return mine.then(function (res) {
      if (res !== "ok" || !device || Date.now() < device.expires_at) return res;
      return refreshWith(device, saveDevice).then(function (d) {
        if (d !== "revoked") return "ok";            // "offline" is not a reason to lock anyone out
        device = null; gateNotice = MSG_CODE_CHANGED;
        return writeJSON(K_DEVICE, null).then(function () { return "revoked"; });
      });
    });
  }

  /* Everything that says who this device is goes; the cursor and the sent-map
     stay. They describe the local records, and those survive a sign-out —
     clearing them would make the next push treat every record as never-sent,
     restamp the whole set server-side, and leave this device looking newest on
     everything. That is exactly the clobber the record store exists to prevent. */
  function signOut() {
    session = null; device = null; person = null;
    return Promise.all([writeJSON(K_SESSION, null), writeJSON(K_DEVICE, null), writeJSON(K_PERSON, null)]);
  }

  /* --- the editing window ------------------------------------------------
     Changing anything needs the shared editing code on top of being signed in.
     The server enforces it: outside an open window a write is refused, so
     hiding buttons is only the polite half. All this keeps is what to show. */
  function isEditing() { return Date.now() < editUntil; }
  function setEditing(until) {
    var was = isEditing();
    editUntil = until || 0;
    writeJSON(K_EDIT, editUntil);
    paintLock();
    if (was !== isEditing()) editCbs.forEach(function (cb) { try { cb(isEditing(), editUntil); } catch (e) {} });
  }

  /* --- locked controls ----------------------------------------------------
     The server refuses a write outside an editing window, so this is only the
     polite half: while somebody is signed in and has not unlocked, the controls
     that change records are greyed, and tapping one offers the unlock dialog
     instead of doing something that would only be turned away later.

     Each page names its own controls as selectors, so controls it builds on the
     fly are covered without marking up every template. With nobody signed in
     (the shared account, before anyone has their own login) nothing is locked:
     there is no one to unlock for. */
  function paintLock() {
    try { if (document.body) document.body.classList.toggle("sync-locked", !!(person && lockSel && !isEditing())); } catch (e) {}
  }
  function lockHit(e) {
    if (!lockSel || !document.body || !document.body.classList.contains("sync-locked")) return false;
    var t = e.target;
    return !!(t && t.closest && t.closest(lockSel));
  }
  function installLock() {
    if (installLock.done) return; installLock.done = true;
    var stop = function (e) { e.preventDefault(); e.stopImmediatePropagation(); };
    document.addEventListener("click", function (e) { if (lockHit(e)) { stop(e); askEditingCode(); } }, true);
    ["pointerdown", "mousedown"].forEach(function (ev) {
      document.addEventListener(ev, function (e) { if (lockHit(e)) stop(e); }, true);   // also keeps a field from taking focus
    });
    document.addEventListener("focusin", function (e) { if (lockHit(e) && e.target.blur) e.target.blur(); }, true);
    document.addEventListener("keydown", function (e) {
      if (!lockHit(e) || e.key === "Tab" || e.key === "Shift" || e.key === "Escape") return;
      stop(e);
    }, true);
  }
  function lockControls(selectors) {
    lockSel = [].concat(selectors).join(",");
    var css = document.getElementById("sync-lock-css");
    if (!css) { css = document.createElement("style"); css.id = "sync-lock-css"; document.head.appendChild(css); }
    css.textContent = [].concat(selectors).join(",").split(",").map(function (s) { return "body.sync-locked " + s.trim(); })
      .join(",") + "{opacity:.45;cursor:not-allowed}";
    installLock(); paintLock();
  }
  function rpc(name, payload) {
    return fetch(CFG.url + "/rest/v1/rpc/" + name, { method: "POST", headers: headers(true),
                                                    body: JSON.stringify(payload || {}), cache: "no-store" });
  }

  function unlockEditing(code) {
    var offline = { ok: false, error: "Can't reach the server. Check the connection and try again." };
    if (!person || !session) return Promise.resolve({ ok: false, error: "Sign in as yourself first." });
    return ensureToken().then(function (res) {
      if (res !== "ok") return offline;
      return rpc("unlock_editing", { code: code }).then(function (r) {
        if (r.status === 403) {
          /* The server says why: a wrong code, or too many wrong tries. */
          return r.json().catch(function () { return {}; }).then(function (m) {
            return { ok: false, error: (m && typeof m.message === "string" && m.message)
                                       || "That editing code doesn't match. Check with Pete and try again." };
          });
        }
        if (!r.ok) return offline;
        return r.json().then(function (j) {
          setEditing(Date.parse(j.until) || 0);
          refusal = "";
          sync("unlocked");          // whatever was waiting behind the lock goes out now
          return { ok: true, until: editUntil };
        });
      });
    }).catch(function () { return offline; });
  }

  /* Best effort. Closing the window locally comes first: if the server cannot
     be reached it will close it itself within the hour. */
  function lockEditing() {
    setEditing(0);
    if (!person || !session || !navigator.onLine) return Promise.resolve();
    return rpc("lock_editing").catch(function () {}).then(function () {});
  }

  /* Still working? Push the window along. Called after anything that went out
     while unlocked, so an hour means an hour since the last thing done. */
  function extendEditing() {
    if (!isEditing() || !person) return Promise.resolve();
    return rpc("extend_editing").then(function (r) {
      if (r.status === 403) { setEditing(0); return; }
      if (r.ok) return r.json().then(function (j) { editUntil = Date.parse(j.until) || editUntil; writeJSON(K_EDIT, editUntil); });
    }).catch(function () {});
  }

  /* --- transport ---------------------------------------------------------- */

  /* A 401 on a data call means the token is no longer accepted even though our
     own clock still thinks it is good — which is what a rotated code looks like
     until the access token would have expired anyway. Expiring it locally makes
     the next pass refresh, get rejected, and put the gate up. Without this a
     revoked device sits on "can't reach the server" for up to an hour first. */
  function noteAuth(r) {
    if (r && r.status === 401 && session) session.expires_at = 0;
    return r;
  }

  /* One cursor per app, not one per device.

     The pull is filtered to this app's kinds, but the cursor was a single
     shared key — so whichever app synced last carried it forward past rows the
     other had never seen, and because a cursor only ever moves forward those
     rows were skipped for good. A desktop used for ice rounds for weeks has a
     cursor at roughly now; the first time somebody opens Glass Manager on it,
     every panel mark older than that is silently missed. No error, no retry —
     the record just never arrives.

     Keying by the kind set keeps the two independent. Devices upgrading have
     no value under the new key, so they pull their kinds from the beginning
     once, which also repairs anything the old shared cursor had skipped. */
  function cursorKey() {
    var ks = (hooks && hooks.kinds && hooks.kinds.length)
           ? hooks.kinds.slice().sort().join(",") : "all";
    /* A cursor only moves forward, so a record the server hid from this person
       when it passed is never offered again: given a facility later, or handed
       a device somebody else had already synced, they would miss everything
       older than where it stood. Keying it by person and by what they may see
       gives each combination its own, so a change starts one fresh pull. That
       is safe - a pull of what is already held changes nothing. */
    return K_CURSOR + ":" + ks + (person ? ":" + person.id + ":" + scope : "");
  }

  /* What this person may see. An Admin is "*"; a Manager and Staff the facilities they were
     given. Kept if it cannot be fetched, so being offline never re-pulls. */
  function refreshScope() {
    if (!person) return Promise.resolve();
    return rpc("my_facilities").then(function (r) {
      /* The server still honours this person's token but no longer has them: a
         removed person whose sign-in has not been closed yet. Say so, rather
         than carrying on with a session that can read and write nothing. */
      if (r.status === 403) return "revoked";
      return r.ok ? r.json() : null;
    }).then(function (j) {
      if (j === "revoked") return j;
      if (!j) return;
      /* A server not yet moved on still calls its top role "management": that is the Admin. */
      var r = j.role === "management" ? "admin" : j.role;
      var s = r === "admin" ? "*" : (j.facilities || []).slice().sort().join("|");
      scope = s; role = r || ""; return Promise.all([writeJSON(K_SCOPE, s), writeJSON(K_ROLE, role)]);
    }).catch(function () {});
  }

  function pull() {
    return readJSON(cursorKey(), null).then(function (cursor) {
      var q = CFG.url + "/rest/v1/records?select=*&order=updated_at.asc&limit=1000";
      if (hooks && hooks.kinds) q += "&kind=in.(" + hooks.kinds.join(",") + ")";
      if (cursor) q += "&updated_at=gt." + encodeURIComponent(cursor);
      /* cache:"no-store" is belt-and-braces rather than a fix for anything
         observed: whenever the cursor has not moved, two pulls build the very
         same URL, and nothing in the response forbids the browser answering
         the second from cache. sw.js already takes this precaution for pages. */
      return fetch(q, { headers: headers(true), cache: "no-store" }).then(function (r) {
        noteAuth(r);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (rows) {
        if (!rows.length) return 0;
        var byKind = {};
        rows.forEach(function (row) {
          (byKind[row.kind] = byKind[row.kind] || {})[row.id] =
            Object.assign({}, row.body, { id: row.id, updatedAt: row.updated_at, deleted: !!row.deleted,
                                          changedBy: row.changed_by_name || "" });
        });
        var newest = rows[rows.length - 1].updated_at;
        /* The page draws what it was handed inside apply(), and drawing can throw.
           A throw there used to abandon the rest of this pull: the records were
           merged and held, but never marked as sent and the cursor never moved, so
           the next cycle pushed every one of them straight back and the server
           restamped the lot - the clobber the record store exists to prevent,
           set off by a display error. What the device holds is marked either way
           (it only marks records it really has); the cursor moves only if apply
           finished, so a failed apply is retried rather than skipped. */
        var applied = 0, applyOk = true;
        try { applied = hooks.apply(byKind) || 0; }
        catch (e) { applyOk = false; if (global.console) console.error("sync: apply() threw, the records are kept and marked, the pull will be retried", e); }
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
        }).then(function () { return applyOk ? writeJSON(cursorKey(), newest) : null; }).then(function () { return applied; });
      });
    });
  }

  /* Rows are sent in batches; anything that fails is kept for the next go. */
  function sendRows(rows, tok, entry) {
    if (!rows.length) return Promise.resolve(true);
    var batches = [], i;
    for (i = 0; i < rows.length; i += 200) batches.push(rows.slice(i, i + 200));
    return batches.reduce(function (chain, batch) {
      return chain.then(function (okSoFar) {
        if (!okSoFar) return false;
        return fetch(CFG.url + "/rest/v1/records?on_conflict=kind,id", {
          method: "POST",
          headers: Object.assign(headers(true), tok ? { "Authorization": "Bearer " + tok } : {},
                                 { "Prefer": "resolution=merge-duplicates,return=minimal" }),
          body: JSON.stringify(batch)
        }).then(function (r) {
          if ((entry ? r : noteAuth(r)).ok) return true;
          if (r.status !== 403) return false;
          /* Turned away by the rules, not by the network. Say which: a locked
             window is the person's to fix, a refused facility is not. */
          return r.json().catch(function () { return {}; }).then(function (m) {
            refusal = /locked/i.test((m && m.message) || "") ? "locked" : "refused";
            if (refusal === "locked" && !entry) setEditing(0);   // a departed person's window is not this person's
            return false;
          });
        }).catch(function () { return false; });
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
          /* The server's stamp on the last change. Never ours to send, and the
             server would overrule it anyway. */
          delete b.changedBy;
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

  /* Whose is a waiting change? The person who left with it, if somebody did:
     each hand-over records which records, at which timestamp, were the leaver's.
     Matching on the timestamp as well as the record means a record somebody
     else edits afterwards is theirs, not the leaver's. */
  function ownerOf(key, stamp) {
    for (var i = 0; i < departed.length; i++) if (departed[i].stamps[key] === stamp) return departed[i];
    return null;
  }

  function saveDeparted() { return writeJSON(K_DEPARTED, departed); }

  /* A departed person's session, refreshed if it has aged. Offline is "not
     now"; revoked (they were removed) drops the claim, and what was theirs
     then goes out under whoever is signed in rather than being lost. */
  function departedToken(e) {
    if (Date.now() < e.session.expires_at) return Promise.resolve(e.session.access_token);
    return refreshWith(e.session, function (j) { e.session = tokens(j); return saveDeparted(); }).then(function (res) {
      if (res === "ok") return e.session.access_token;
      if (res === "revoked") { departed = departed.filter(function (x) { return x !== e; }); saveDeparted(); }
      return null;
    });
  }

  function sendForDeparted(g) {
    var e = g.owner;
    return departedToken(e).then(function (tok) {
      if (!tok) return false;
      return sendRows(g.rows, tok, e).then(function (ok) {
        if (!ok) return false;
        /* Everything of theirs is out: discard the session, and close the
           editing window that was kept open for the purpose. */
        departed = departed.filter(function (x) { return x !== e; });
        return saveDeparted().then(function () {
          return fetch(CFG.url + "/rest/v1/rpc/lock_editing", { method: "POST", cache: "no-store",
            headers: Object.assign(headers(false), { "Authorization": "Bearer " + tok }), body: "{}" }).catch(function () {});
        }).then(function () { return true; });
      });
    });
  }

  function sendMine(rows) {
    if (!session) return Promise.resolve(false);       // nobody signed in: these wait for whoever is next
    return sendRows(rows).then(function (ok) { if (ok) extendEditing(); return ok; });
  }

  function push() {
    refusal = "";
    return changed().then(function (c) {
      var groups = [], idx = {};
      c.rows.forEach(function (row) {
        var key = row.kind + " " + row.id, o = ownerOf(key, c.stamps[key]);
        var gk = o ? "e" + departed.indexOf(o) : "me";
        if (!(gk in idx)) { idx[gk] = groups.length; groups.push({ owner: o, rows: [] }); }
        groups[idx[gk]].rows.push(row);
      });
      /* A claim with nothing left waiting behind it is finished with. */
      var live = departed.filter(function (e) { return groups.some(function (g) { return g.owner === e; }); });
      var pruned = live.length !== departed.length;
      if (pruned) departed = live;
      var allOk = true;
      return (pruned ? saveDeparted() : Promise.resolve()).then(function () {
        return groups.reduce(function (chain, g) {
          return chain.then(function () {
            return (g.owner ? sendForDeparted(g) : sendMine(g.rows)).then(function (ok) {
              if (!ok) { allOk = false; return; }
              g.rows.forEach(function (row) { var k = row.kind + " " + row.id; c.sent[k] = c.stamps[k]; });
              return writeJSON(K_SENT, c.sent);
            });
          });
        }, Promise.resolve());
      }).then(function () { return allOk; });
    });
  }

  /* --- changing hands ------------------------------------------------------
     Whoever is signed in leaves: Switch user, the idle sign-out, Sign out. Their
     waiting changes are sent first, under their name. If they cannot be - no
     connection, or the server said no - their session stays on the device,
     send-only, and the changes stay theirs until they go. The next person never
     sends them. */
  function handOver(full) {
    var leaving = person && session ? { id: person.id, name: person.name, session: session } : null;
    var send = hooks && navigator.onLine ? push().catch(function () { return false; }) : Promise.resolve(false);
    return send.then(function () {
      if (!leaving || !hooks) return false;
      return changed().then(function (c) {
        var mine = {}, n = 0;
        c.rows.forEach(function (row) {
          var k = row.kind + " " + row.id;
          if (!ownerOf(k, c.stamps[k])) { mine[k] = c.stamps[k]; n++; }
        });
        if (!n) return false;
        departed.push({ id: leaving.id, name: leaving.name, session: Object.assign({}, leaving.session),
                        at: new Date().toISOString(), stamps: mine });
        return saveDeparted().then(function () { return true; });
      });
    }).then(function (kept) {
      /* Their window stays open while their changes are still to go; whoever
         sends the last of them closes it. */
      return (kept ? Promise.resolve(setEditing(0)) : lockEditing());
    }).then(function () {
      session = null; person = null; if (full) device = null;
      paintLock();
      return Promise.all([writeJSON(K_SESSION, null), writeJSON(K_PERSON, null), full ? writeJSON(K_DEVICE, null) : null]);
    }).then(function () {
      /* A reload starts the next person on a clean screen. Offline it would
         not load, so the gate goes up over what is there instead. */
      if (navigator.onLine) { location.reload(); return; }
      setStatus("local", "signed out");
      return showGate(gateTitle).then(function () { return sync("signed in"); });
    });
  }

  /* Anything waiting for a person who has gone, sent with nobody signed in. */
  function flushDeparted() {
    if (!hooks || !departed.length || !navigator.onLine || syncing) return Promise.resolve();
    syncing = true;
    return push().catch(function () {}).then(function () { syncing = false; });
  }

  function touch() {
    var n = Date.now(); lastActive = n;
    if (n - lastSaved > 5000) { lastSaved = n; writeJSON(K_ACTIVE, n); }
  }
  function idleCheck() {
    paintLock();
    if (!person || handing || Date.now() - lastActive <= CFG.idleMs) return;
    handing = true;
    handOver(false).then(function () { handing = false; }, function () { handing = false; });
  }

  function peopleExist() {
    return fetch(CFG.url + "/rest/v1/rpc/staff_names", { method: "POST", headers: headers(true), body: "{}", cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (l) { return !!(l && l.length); })
      .catch(function () { return false; });   // can't tell: carry on as before
  }

  /* --- the loop ----------------------------------------------------------- */
  function sync(reason) {
    if (syncing || !hooks) return Promise.resolve();
    if (!session) {
      setStatus("local", "not signed in");
      return flushDeparted();
    }
    if (!navigator.onLine) {
      return pendingCount().then(function (n) {
        setStatus("offline", n ? n + " change" + (n === 1 ? "" : "s") + " waiting to send" : "saved on this device");
      });
    }
    syncing = true; setStatus("syncing", reason || "");
    return ensureToken().then(function (res) {
      if (res === "revoked") return revoked().then(function () { resyncPending = true; });
      if (res !== "ok") { setStatus("offline", "can't reach the server"); return; }
      /* Until a person is signed in the shared account is doing the data's
         work. The moment management has created people, that stops: the shared
         session steps back to being the device's and the gate asks who this is.
         Asked rather than inferred from a refused write, because a tightened
         read returns nothing instead of an error and an idle device would
         never find out. */
      if (!person) return peopleExist().then(function (yes) {
        if (!yes) return exchange();
        device = session; session = null;
        return Promise.all([writeJSON(K_DEVICE, device), writeJSON(K_SESSION, null)]).then(function () {
          setStatus("local", "signed out");
          return showGate(gateTitle);
        }).then(function () { resyncPending = true; });
      });
      return refreshScope().then(function (r) {
        if (r === "revoked") return revoked().then(function () { resyncPending = true; });
        return exchange();
      });
      function exchange() { return push().then(function (pushed) {
        return pull().then(function (applied) {
          if (pushed) { setStatus("synced", applied ? "brought in " + applied + " change" + (applied === 1 ? "" : "s") : "up to date"); return; }
          return pendingCount().then(function (n) {
            var w = n + " change" + (n === 1 ? "" : "s");
            var names = departed.map(function (e) { return e.name; }).join(" and ");
            setStatus("offline", names ? w + " waiting, some for " + names + " to send"
                               : refusal === "locked" ? w + " waiting. Unlock to edit to send"
                               : refusal === "refused" ? w + " refused by the server"
                               : w + " waiting to send");
          });
        });
      }); }
    }).catch(function (e) {
      setStatus("offline", "can't reach the server");
    }).then(function () {
      syncing = false;
      /* Signing back in has to wait for the guard above to clear, or the
         follow-up sync returns at the first line and the device sits there
         signed in but never pulling. */
      if (resyncPending) { resyncPending = false; return sync("signed in"); }
    });
  }

  /* The code was rotated, or this device's session was invalidated. Put the
     gate back up and leave every local record alone: signing in again restores
     the app exactly as it was, and a false positive here can't destroy work
     that hasn't synced yet. Hiding the data is what a rotated code can do; it
     cannot reach back and erase what a device already holds. */
  function revoked() {
    setStatus("local", "signed out");
    /* The shared session is only dropped if the server has already rejected it
       (ensureToken nulls it first). A removed person leaves it standing, so the
       gate goes straight to "Who are you?" rather than asking for the code. */
    if (person && !gateNotice) gateNotice = MSG_SIGNED_OUT;
    session = null; person = null;
    paintLock();
    return Promise.all([writeJSON(K_SESSION, null), writeJSON(K_PERSON, null)])
      .then(function () { return showGate(gateTitle); });
  }

  function nudge() {                      // called by the apps after any edit
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { sync("saving"); }, 1500);
  }

  /* --- the access gate ---------------------------------------------------- */
  var GATE_CSS = ''
    + '.sync-gate,.sync-gate *{position:static}'
    + '.sync-gate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;'
    + 'padding:24px;background:radial-gradient(1200px 600px at 50% -10%,var(--glow,#16283a) 0%,transparent 60%),var(--bg,#0d1620)}'
    + '.sync-gate .sync-box{width:100%;max-width:360px;display:flex;flex-direction:column;gap:20px}'
    + '.sync-gate .sync-bd{display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center}'
    + '.sync-gate .sync-bd h2{margin:0;font-size:23px;font-weight:800;display:flex;align-items:baseline;gap:9px;'
    + 'color:var(--ink,#eaf3f8)}'
    + '.sync-gate .sync-bd h2 i{font-style:normal;font-family:var(--mono,monospace);color:var(--frost,#6fd6ec);font-size:17px}'
    + '.sync-gate .sync-bd p{margin:0;font-size:12.5px;color:var(--ink-dim,#90a8b8)}'
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
    + '.sync-gate .sync-err{min-height:16px;font-size:12.5px;color:#e5645d}'
    + '.sync-gate .sync-hint{font-size:12px;color:var(--ink-faint,#5d7384);text-align:center;line-height:1.55}'
    + '.sync-gate .sync-note{font-size:12.5px;color:var(--warn,#e8b54a);text-align:center;line-height:1.5}'
    + '.sync-gate .sync-who{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}'
    + '.sync-gate .sync-who button{height:56px;background:var(--panel-2,#1c3142);color:var(--ink,#eaf3f8);'
    + 'border:1px solid var(--line,#273d4f)}'
    + '.sync-gate .sync-who button[aria-pressed="true"]{background:var(--frost,#6fd6ec);color:#06222b;border-color:var(--frost,#6fd6ec)}'
    + '.sync-pill{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono,monospace);font-size:11px;'
    + 'color:var(--ink-dim,#90a8b8);background:var(--panel,#152433);border:1px solid var(--line,#273d4f);'
    + 'border-radius:999px;padding:5px 11px;white-space:nowrap}'
    + '.sync-pill i{width:7px;height:7px;border-radius:50%;background:var(--ink-faint,#5d7384);flex:none}'
    + '.sync-pill.synced i{background:#7fcf9a}.sync-pill.syncing i{background:var(--frost,#6fd6ec)}'
    + '.sync-pill.offline i{background:#e8b54a}.sync-pill.local i{background:var(--ink-faint,#5d7384)}'
    + '.sync-signout{appearance:none;font:inherit;font-family:var(--mono,monospace);font-size:11px;'
    + 'color:var(--ink-dim,#90a8b8);background:var(--panel,#152433);border:1px solid var(--line,#273d4f);'
    + 'border-radius:999px;padding:5px 11px;cursor:pointer;white-space:nowrap}'
    + '.sync-signout:hover{color:var(--ink,#eaf3f8);border-color:var(--ink-faint,#5d7384)}'
    + '.sync-signout:focus-visible{outline:2px solid var(--frost,#6fd6ec);outline-offset:2px}';

  function injectCSS() {
    if (document.getElementById("sync-css")) return;
    var s = document.createElement("style"); s.id = "sync-css"; s.textContent = GATE_CSS;
    document.head.appendChild(s);
  }

  function showGate(title) {
    /* start() and a revoked token can both ask for the gate, and a focus event
       can arrive while one is already up. Hand back the gate that is already
       open rather than stacking a second one over it. */
    if (gatePromise) return gatePromise;
    gatePromise = buildGate(title).then(function (v) { gatePromise = null; return v; });
    return gatePromise;
  }

  /* The gate is a short flow, not one form: the access code if the device has
     none, then "Who are you?". It resolves once the device has a session that
     can read data. */
  function buildGate(title) {
    var notice = gateNotice; gateNotice = "";
    injectCSS();
    var el = document.createElement("div");
    el.className = "sync-gate";
    document.body.appendChild(el);
    var head = '<div class="sync-bd"><h2><i>[ ◊ ]</i> ' + (title || "Arena Management System") + '</h2></div>';
    function show(inner) {
      el.innerHTML = '<div class="sync-box">' + head + (notice ? '<div class="sync-note">' + notice + '</div>' : "") + inner + '</div>';
      notice = "";
    }

    function accessStep() {
      return new Promise(function (resolve) {
        show('<form autocomplete="off"><label for="sg-code">Access code</label>'
           + '<input id="sg-code" type="password" inputmode="text" autocapitalize="none" autocorrect="off" spellcheck="false">'
           + '<button type="submit">Continue</button><div class="sync-err"></div></form>'
           + '<p class="sync-hint">Ask Pete for the code.<br>You only need this once on each phone or tablet.</p>');
        var form = el.querySelector("form"), input = el.querySelector("input"),
            btn = el.querySelector("button"), err = el.querySelector(".sync-err");
        setTimeout(function () { input.focus(); }, 50);
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var code = input.value;
          if (!code) { input.focus(); return; }
          btn.disabled = true; btn.textContent = "Checking…"; err.textContent = "";
          signIn(code).then(function (res) {
            if (res.ok) { resolve(); return; }
            btn.disabled = false; btn.textContent = "Continue";
            err.textContent = res.error; input.select();
          });
        });
      });
    }

    /* The names, fetched with the shared session. Revoked means the access code
       has changed under us; anything else that fails is treated as no
       connection, because a first sign-in cannot be done from what is stored. */
    function listPeople() {
      var go = function () {
        return fetch(CFG.url + "/rest/v1/rpc/staff_names", {
          method: "POST", cache: "no-store",
          headers: Object.assign(headers(false), { "Authorization": "Bearer " + device.access_token }),
          body: "{}"
        }).then(function (r) {
          if (r.status === 401) return { revoked: true };
          if (!r.ok) return { offline: true };
          return r.json().then(function (people) { return { people: people }; });
        }).catch(function () { return { offline: true }; });
      };
      if (Date.now() < device.expires_at) return go();
      return refreshWith(device, saveDevice).then(function (res) {
        return res === "revoked" ? { revoked: true } : res === "ok" ? go() : { offline: true };
      });
    }

    function offlineStep() {
      return new Promise(function (resolve) {
        show('<form><div class="sync-err" style="min-height:0;text-align:center">'
           + 'You need a connection to sign in on this device.</div>'
           + '<button type="submit">Try again</button></form>');
        var again = function () { window.removeEventListener("online", again); resolve(); };
        window.addEventListener("online", again);          // the connection returning is the retry
        el.querySelector("form").addEventListener("submit", function (e) { e.preventDefault(); again(); });
      });
    }

    function personStep(people) {
      return new Promise(function (resolve) {
        var chosen = null;
        show('<form autocomplete="off"><label>Who are you?</label><div class="sync-who">'
           + people.map(function (p) {
               return '<button type="button" class="sync-name" aria-pressed="false" data-id="' + esc(p.id) + '">' + esc(p.name) + '</button>';
             }).join("")
           + '</div><label for="sg-personal">Your code</label>'
           + '<input id="sg-personal" type="password" inputmode="text" autocapitalize="none" autocorrect="off" spellcheck="false">'
           + '<button type="submit" class="sync-go">Continue</button><div class="sync-err"></div></form>'
           + '<p class="sync-hint">Pick your name and enter your own code.</p>');
        var form = el.querySelector("form"), input = el.querySelector("#sg-personal"),
            btn = el.querySelector(".sync-go"), err = el.querySelector(".sync-err");
        el.querySelectorAll(".sync-name").forEach(function (b) {
          b.addEventListener("click", function () {
            chosen = people.filter(function (p) { return p.id === b.getAttribute("data-id"); })[0];
            el.querySelectorAll(".sync-name").forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
            input.focus();
          });
        });
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          if (!chosen) { err.textContent = "Tap your name first."; return; }
          if (!input.value) { input.focus(); return; }
          btn.disabled = true; btn.textContent = "Checking…"; err.textContent = "";
          signInPerson(chosen, input.value).then(function (res) {
            if (res.ok) { resolve(); return; }
            btn.disabled = false; btn.textContent = "Continue";
            err.textContent = res.error; input.select();
          });
        });
      });
    }

    function flow() {
      if (!device) return accessStep().then(flow);
      return listPeople().then(function (res) {
        if (res.revoked) {
          device = null; notice = MSG_CODE_CHANGED;
          return writeJSON(K_DEVICE, null).then(flow);
        }
        if (res.offline) return offlineStep().then(flow);
        if (!res.people.length) {
          /* Nobody has been given their own login yet, which is how the
             rollout begins: the shared account carries the data, as it always
             has, until management adds people and the rules are tightened. */
          session = device; device = null;
          return writeJSON(K_SESSION, session).then(function () { return writeJSON(K_DEVICE, null); });
        }
        return personStep(res.people);
      });
    }
    return flow().then(function () { el.remove(); return true; });
  }

  function askEditingCode() {
    if (document.querySelector(".sync-editask")) return;
    injectCSS();
    var el = document.createElement("div");
    el.className = "sync-gate sync-editask";
    el.innerHTML = '<div class="sync-box"><form autocomplete="off"><label for="sg-edit">Editing code</label>'
      + '<input id="sg-edit" type="password" autocapitalize="none" autocorrect="off" spellcheck="false">'
      + '<button type="submit" class="sync-go">Unlock</button>'
      + '<button type="button" class="sync-cancel" style="background:transparent;color:var(--ink-dim,#90a8b8);border:1px solid var(--line,#273d4f)">Cancel</button>'
      + '<div class="sync-err"></div></form>'
      + '<p class="sync-hint">Unlocks changes for you for an hour.<br>It locks again on its own.</p></div>';
    document.body.appendChild(el);
    var input = el.querySelector("input"), btn = el.querySelector(".sync-go"), err = el.querySelector(".sync-err");
    setTimeout(function () { input.focus(); }, 50);
    el.querySelector(".sync-cancel").addEventListener("click", function () { el.remove(); });
    el.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!input.value) { input.focus(); return; }
      btn.disabled = true; btn.textContent = "Checking…"; err.textContent = "";
      unlockEditing(input.value).then(function (res) {
        if (res.ok) { el.remove(); return; }
        btn.disabled = false; btn.textContent = "Unlock";
        err.textContent = res.error; input.select();
      });
    });
  }

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }

  /* --- public surface ----------------------------------------------------- */
  var Sync = {
    /* Resolves once the device is signed in; shows the gate if it isn't.
       An app that would rather run unsynced can skip start() entirely. */
    start: function (opts) {
      opts = opts || {};
      injectCSS();
      if (opts.title) gateTitle = opts.title;
      return Promise.all([readJSON(K_SESSION, null), readJSON(K_DEVICE, null), readJSON(K_PERSON, null), readJSON(K_EDIT, 0), readJSON(K_SCOPE, ""),
                          readJSON(K_DEPARTED, []), readJSON(K_ACTIVE, 0), readJSON(K_ROLE, "")]).then(function (a) {
        session = a[0]; device = a[1]; person = a[2]; editUntil = a[3] || 0; scope = a[4] || ""; role = a[7] || "";
        departed = a[5] || [];
        lastActive = person && a[6] ? a[6] : Date.now();
        paintLock();
        /* A device left closed past the idle time is signed out on opening:
           the timer cannot run while nothing is. */
        if (person && session && Date.now() - lastActive > CFG.idleMs) {
          return handOver(false).then(function () { return true; });   // reloads, or raises the gate and carries on once somebody signs in
        }
        if (session) { setStatus("local", "checking…"); return true; }
        /* Nobody signed in, but somebody left changes behind: send them now,
           before waiting on whoever is next. */
        return flushDeparted().then(function () { return showGate(gateTitle); });
      }).then(function () {
        ["pointerdown", "keydown", "touchstart", "wheel"].forEach(function (ev) {
          document.addEventListener(ev, touch, { capture: true, passive: true });
        });
        setInterval(idleCheck, CFG.idleCheckMs);
        document.addEventListener("visibilitychange", function () { if (!document.hidden) idleCheck(); });
        window.addEventListener("online",  function () { sync("back online"); });
        window.addEventListener("offline", function () { setStatus("offline", "saved on this device"); });
        document.addEventListener("visibilitychange", function () { if (!document.hidden) sync("checking"); });
        return sync("opening");
      });
    },
    attach: function (h) { hooks = h; },
    /* Check the stored session is still good, without syncing anything.
       For a page that shows a local summary and never reads or writes records
       — the shell's read path — running the full loop would be wrong: a pull whose
       apply() does nothing still advances the cursor, and the apps would then
       never see the rows it skipped. This validates the token, re-gates if it
       has been revoked, and leaves the cursor and the sent-map untouched. */
    verify: function () {
      if (!session) return Promise.resolve(false);
      if (!navigator.onLine) return Promise.resolve(true);   // can't tell; assume good
      return ensureToken().then(function (res) {
        if (res === "revoked") return revoked().then(function () { return !!session; });
        return true;    // "offline" is not a reason to lock anyone out
      });
    },
    nudge: nudge,
    sync: sync,
    signOut: function () { return handOver(true); },
    /* Back to "Who are you?" with the shared session still in place. */
    switchUser: function () { return handOver(false); },
    /* Who changed what, old value and new, for the Changes page and the Staff
       Activity tab. Management only - the server refuses anyone else - and it is
       not a record: it never goes through the sync loop, so reading it cannot
       make anything look edited. q is PostgREST filters, e.g. {id: "eq.s1",
       order: "seq.desc", limit: 50}. */
    activity: function (q) {
      var offline = { ok: false, error: "Can't reach the server. Check the connection and try again." };
      if (!person || !session) return Promise.resolve({ ok: false, error: "Sign in first." });
      var qs = Object.keys(q || {}).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(q[k]); }).join("&");
      return ensureToken().then(function (res) {
        if (res !== "ok") return offline;
        return fetch(CFG.url + "/rest/v1/activity" + (qs ? "?" + qs : ""), { headers: headers(true), cache: "no-store" }).then(function (r) {
          if (r.status === 403) return { ok: false, error: "Only Managers and Admins can read the activity log." };
          if (!r.ok) return offline;
          return r.json().then(function (rows) { return { ok: true, rows: rows }; });
        });
      }).catch(function () { return offline; });
    },
    lockControls: lockControls,
    unlockEditing: unlockEditing,
    lockEditing: lockEditing,
    isEditing: isEditing,
    onEditing: function (cb) { editCbs.push(cb); cb(isEditing(), editUntil); },
    onStatus: function (cb) { statusCbs.push(cb); cb(state, detail); },
    /* Who is signed in: {id, name}, or null while the shared account is still
       doing the work. The server stamps their name on what they change. */
    person: function () { return person; },
    /* Three roles. Before anybody is signed in as a person (rollout step 3) the shared account carries the data and nothing
       is stricter than it was, so every question below says yes. After that a person whose role has not been fetched yet
       is nobody in particular until it is. */
    role: function () { return person ? role : ""; },
    /* An Admin: every facility, the shared codes, backups and restores, adding and removing a facility. */
    isAdmin: function () { return !person || scope === "*"; },
    /* Restoring a backup writes records for whichever facilities are in the file, and a backup holds everything on the device, so both are the Admin's. */
    canRestore: function () { return Sync.isAdmin(); },
    canBackup: function () { return Sync.isAdmin(); },
    /* Settings, sheets and flags: an Admin's anywhere, a Manager's in the facilities they were given. Asked without a
       facility it means "somewhere", which is what a menu or a page link needs. */
    canManage: function (facilityId) {
      if (Sync.isAdmin()) return true;
      if (role !== "manager") return false;
      return facilityId === undefined || Sync.canSee(facilityId);
    },
    /* The one way people and codes are changed: the manage-staff function, called with this
       person's own token. It refuses anyone who is not an active Manager, and its messages are
       fit to show. A code it returns is shown once by whoever asked; nothing here keeps it.
       Resolves {ok, ...answer} or {ok:false, error, status}. */
    manage: function (action, body) {
      var offline = { ok: false, error: "Can't reach the server. Check the connection and try again." };
      if (!person || !session) return Promise.resolve({ ok: false, error: "Sign in first." });
      return ensureToken().then(function (res) {
        if (res !== "ok") return offline;
        return fetch(CFG.url + "/functions/v1/manage-staff", { method: "POST", headers: headers(true), cache: "no-store",
          body: JSON.stringify(Object.assign({}, body || {}, { action: action })) }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            return r.ok ? Object.assign({ ok: true }, j) : { ok: false, status: r.status, error: j.error || "That did not work (" + r.status + ")." };
          });
        });
      }).catch(function () { return offline; });
    },
    /* May this person see this facility? Everyone before people exist and
       an Admin always; a Manager and Staff only what they were given. A person whose scope has
       not been fetched yet sees nothing until it is. This hides, it is not a security
       boundary: the data may already be on the device. */
    canSee: function (facilityId) {
      if (!person || scope === "*") return true;
      return !!scope && scope.split("|").indexOf(facilityId) >= 0;
    },
    restoreMessage: "Only an Admin can restore a backup.",
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
    /* "Unlock to edit": a button that asks for the editing code, then reads
       "Editing until 3:42 PM" and locks again when pressed. Hidden until a
       person is signed in, since the code only ever opens a window for someone. */
    unlockEl: function () {
      injectCSS();
      var el = document.createElement("button");
      el.type = "button";
      el.className = "sync-signout sync-unlock";
      var paint = function (on, until) {
        el.hidden = !person;
        el.textContent = on ? "Editing until " + new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                            : "Unlock to edit";
        el.setAttribute("aria-pressed", on ? "true" : "false");
      };
      Sync.onEditing(paint);
      el.addEventListener("click", function () {
        if (isEditing()) { lockEditing(); return; }
        askEditingCode();
      });
      return el;
    },
    /* A sign-out button the pages can sit next to the pill. Confirms first —
       it lives in a header next to a theme toggle, and signing out by mistake
       means hunting down the code again. */
    signOutEl: function (label) {
      injectCSS();
      var el = document.createElement("button");
      el.type = "button";
      el.className = "sync-signout";
      el.textContent = label || "Sign out";
      el.addEventListener("click", function () {
        if (!window.confirm("Sign out of this device?\n\nYou'll need the access code to get back in. "
                          + "Anything saved on this device stays where it is.")) return;
        Sync.signOut();
      });
      return el;
    },
    _cfg: CFG
  };

  global.Sync = Sync;
})(window);
