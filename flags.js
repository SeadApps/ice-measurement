"use strict";
/* flags.js: flags, the "this looks wrong" record that Quality review reads.

   A flag points at one thing (a reading on a spot of a round, a glass panel, or any record) with a reason from a
   short fixed list and a free note. It is a record of its own kind, `flag`, kept on this device under one key and
   synced by whichever app is open (Ice and Glass add the kind to what they attach). The server stamps who last
   changed it like every other record, tags it with its facility, and refuses anyone but Management who tries to
   resolve or reopen one: the page hides those controls for Staff, but the server is the rule.

   Nothing here knows about a page. It holds a map of flags, raises one, changes a status, and merges what
   arrives newest-wins (a status change is a newer `updatedAt`, so two devices agree without a clock to trust). */
(function (global) {
  var KEY = "rink_flags_v1", FL = {}, loaded = null, listeners = [];
  var REASONS = ["Wrong reading", "Missing data", "Glass does not match the building", "Check reading", "Other"];
  var Store = function () { return global.Records && global.Records.Store; };
  var now = function () { return new Date().toISOString(); };
  var uid = function () { return "fl" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  var load = function () {
    if (loaded) return loaded;
    loaded = Promise.resolve(Store() ? Store().get(KEY) : null).then(function (raw) {
      try { FL = JSON.parse(raw || "{}") || {}; } catch (e) { FL = {}; }
      return FL;
    });
    return loaded;
  };
  function save() { return Promise.resolve(Store() ? Store().set(KEY, JSON.stringify(FL)) : null); }
  function notify() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }
  function all() { return Object.keys(FL).map(function (k) { return FL[k]; }).filter(function (r) { return r && !r.deleted; }); }

  /* o: {fac, targetKind:'reading'|'panel'|'record', sheetId, sessionId?, spot?, panelId?, label, reading?, reason, note} */
  function raise(o) {
    return load().then(function () {
      var id = uid();
      var r = { id: id, fac: o.fac || null, status: "open", reason: o.reason || "Other", note: o.note || "",
                targetKind: o.targetKind || "record", sheetId: o.sheetId || null, sessionId: o.sessionId || null,
                spot: o.spot || null, panelId: o.panelId || null, label: o.label || "", reading: o.reading == null ? null : o.reading,
                recordKind: o.recordKind || null, recordId: o.recordId || null,
                updatedAt: now() };
      FL[id] = r;
      return save().then(function () { notify(); return r; });
    });
  }
  function setStatus(id, status) {
    return load().then(function () {
      var r = FL[id]; if (!r) return null;
      FL[id] = Object.assign({}, r, { status: status, updatedAt: now() });
      return save().then(function () { notify(); return FL[id]; });
    });
  }
  /* what sync sends: every flag, with its own updatedAt (sync sends only the ones whose stamp it has not sent) */
  function collect() { var o = {}; Object.keys(FL).forEach(function (k) { o[k] = Object.assign({}, FL[k], { id: k }); }); return o; }
  /* what sync brings: newest wins per flag. Returns how many it took, now; it is written to storage after. A pull
     that lands before the stored flags have been read is held and applied the moment they are. */
  var ready = false, held = [];
  function take(incoming) {
    var inc = (incoming && incoming.flag) || {}, taken = 0;
    Object.keys(inc).forEach(function (id) {
      var b = inc[id]; if (!b) return;
      var a = FL[id];
      if (!a || (b.updatedAt || "") > (a.updatedAt || "")) { FL[id] = Object.assign({}, b, { id: id }); taken++; }
    });
    if (taken) { save().then(notify); }
    return taken;
  }
  function applyIncoming(incoming) {
    if (!ready) { held.push(incoming); return 0; }
    return take(incoming);
  }
  var baseLoad = load;
  load = function () { return baseLoad().then(function (fl) { if (!ready) { ready = true; held.splice(0).forEach(take); } return fl; }); };
  /* open flags for a sheet (or all of them), and the spots / panels they mark */
  function openFor(sheetId) { return all().filter(function (r) { return r.status === "open" && (!sheetId || r.sheetId === sheetId); }); }
  function openCount(match) {
    return all().filter(function (r) { return r.status === "open" && (!match || (!match.sheetId || r.sheetId === match.sheetId) && (!match.fac || r.fac === match.fac)); }).length;
  }
  global.Flags = { REASONS: REASONS, load: load, all: all, raise: raise, setStatus: setStatus, collect: collect,
                   applyIncoming: applyIncoming, openFor: openFor, openCount: openCount,
                   onChange: function (f) { listeners.push(f); } };
})(this);
