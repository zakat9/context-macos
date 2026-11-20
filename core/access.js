/* contexta — the App access window's rules.
 *
 * contexta may ask an app which item is selected only after macOS has let it, and macOS decides that per app, in its
 * own prompt, once. This file decides what the window lists, what is ticked to begin with, and how several apps are
 * requested with one button: one app after another, each with its own macOS prompt, each answer shown as it comes.
 * It cannot answer a prompt, skip one, or ask again after "Don't Allow": after that only System Settings can change it.
 *
 * host (promises of plain objects):
 *   apps()        → { ok, apps: [{ id, name, installed, running }] }      the apps contexta can follow, nothing else
 *   check(id)     → { ok, code }      0 allowed · -1744 not asked yet · -1743 not allowed. Never shows a prompt.
 *   request(id)   → { ok, code }      opens the app if it is closed (in the background), then lets macOS ask. May show ONE prompt.
 *   settings()    → opens System Settings at Privacy & Security › Automation
 */
var ContextAccess = (function () {
  'use strict';
  var FIRST = ['com.apple.Notes', 'com.apple.mail', 'com.apple.finder', 'com.microsoft.Excel'];
  var TEXT = { allowed: 'Allowed', 'not-asked': 'Not asked yet', closed: 'Not open. Opens when asked.', denied: 'Not allowed', checking: 'Checking…', asking: 'Asking. Answer the macOS prompt.',
    'no-open': 'Did not open', 'no-answer': 'No answer', error: 'Could not ask' };
  function statusOf(code) { return code === 0 ? 'allowed' : code === -1744 ? 'not-asked' : code === -1743 ? 'denied' : code === -600 || code === -10814 ? 'no-open' : code === -1712 ? 'no-answer' : 'error'; }
  function eligible(r) { return r.status === 'not-asked' || r.status === 'closed' || r.status === 'no-open' || r.status === 'no-answer' || r.status === 'error'; }
  function rank(id) { var i = FIRST.indexOf(id); return i < 0 ? FIRST.length : i; }

  function create(host, onChange) {
    var st = { rows: [], missing: [], batch: null, stopping: false, note: '', loaded: false, touched: false, generation: 0 };
    function changed() { if (onChange) onChange(view()); }
    function ask(name, arg) {
      var p; try { p = Promise.resolve(host[name](arg)); } catch (e) { p = Promise.reject(e); }
      return p.then(function (r) { return r || { ok: false }; }, function () { return { ok: false }; });
    }
    function signature() { return st.rows.map(function (r) { return r.id + '=' + r.status; }).join(' '); }
    function find(id) { for (var i = 0; i < st.rows.length; i++) if (st.rows[i].id === id) return st.rows[i]; return null; }

    /* look at every app again. Never prompts and never opens an app: a closed app is simply listed as closed. */
    function refresh() {
      if (st.batch) return Promise.resolve(view());
      var mine = ++st.generation;
      return ask('apps').then(function (a) {
        if (mine !== st.generation || st.batch) return view();
        var apps = (a.ok && a.apps ? a.apps : []).slice().sort(function (x, y) { return rank(x.id) - rank(y.id) || (x.id < y.id ? -1 : 1); });
        var old = {}, was = signature(); st.rows.forEach(function (r) { old[r.id] = r; });
        st.missing = apps.filter(function (x) { return !x.installed; }).map(function (x) { return String(x.name).replace(/^Microsoft /, ''); });
        st.rows = apps.filter(function (x) { return x.installed; }).map(function (x) {
          return { id: x.id, name: x.name, running: !!x.running, status: x.running ? (old[x.id] && old[x.id].status !== 'closed' ? old[x.id].status : 'checking') : 'closed', code: null, ticked: !!(old[x.id] && old[x.id].ticked) };
        });
        changed();
        return st.rows.filter(function (r) { return r.running; }).reduce(function (chain, r) {
          return chain.then(function () { return ask('check', r.id).then(function (c) { if (mine !== st.generation || st.batch) return; r.code = c.ok ? c.code : null; r.status = c.ok ? statusOf(c.code) : 'error'; }); });
        }, Promise.resolve()).then(function () {
          if (mine !== st.generation || st.batch) return view();
          /* to begin with, tick what can be asked without opening anything: apps that are open and not asked yet */
          if (!st.touched) st.rows.forEach(function (r) { r.ticked = r.status === 'not-asked'; });
          st.rows.forEach(function (r) { if (!eligible(r)) r.ticked = false; });
          st.loaded = true;
          /* a summary of the last requests stands only while it is still true */
          if (!st.note || st.noteKind === 'idle' || signature() !== was) idleNote();
          changed();
          return view();
        });
      });
    }
    function idleNote() {
      var n = st.rows.filter(function (r) { return r.ticked; }).length, opens = st.rows.filter(function (r) { return r.ticked && r.status === 'closed'; }).length;
      var allowed = st.rows.filter(function (r) { return r.status === 'allowed'; }).length, denied = st.rows.filter(function (r) { return r.status === 'denied'; }).length;
      st.noteKind = 'idle';
      st.note = n ? 'macOS will ask ' + (n === 1 ? 'once' : n + ' times, one prompt after another') + '.' + (opens ? ' ' + (opens === 1 ? 'One app' : opens + ' apps') + ' will open.' : '')
        : denied ? 'macOS asks only once per app. To change “Not allowed”, use Settings.'
        : allowed && !st.rows.some(eligible) ? 'All set. Click the tag icon in the menu bar.'
        : allowed ? 'Tick an app to let macOS ask about it.' : 'Tick the apps you use, then press Request selected.';
    }
    function toggle(id, on) {
      var r = find(id);
      if (r && !st.batch && eligible(r)) { r.ticked = !!on; st.touched = true; idleNote(); changed(); }
      return view();
    }
    function toggleAll() {
      if (st.batch) return view();
      var can = st.rows.filter(eligible), all = can.length && can.every(function (r) { return r.ticked; });
      can.forEach(function (r) { r.ticked = !all; }); st.touched = true; idleNote(); changed();
      return view();
    }
    /* Request selected: the ticked apps, top to bottom, one at a time. */
    function start() {
      if (st.batch) return Promise.resolve(view());
      var order = st.rows.filter(function (r) { return r.ticked && eligible(r); });
      if (!order.length) return Promise.resolve(view());
      st.generation++; st.stopping = false; st.batch = { order: order.map(function (r) { return r.id; }), done: 0, results: [] };
      function next() {
        if (st.stopping || st.batch.done >= order.length) return finish();
        var r = order[st.batch.done];
        r.status = 'asking'; st.noteKind = 'busy';
        st.note = 'Asking ' + r.name + ' (' + (st.batch.done + 1) + ' of ' + order.length + '). Answer the macOS prompt.';
        changed();
        return ask('request', r.id).then(function (res) {
          r.code = res.ok ? res.code : null; r.status = res.ok ? statusOf(res.code) : 'error'; r.ticked = false; r.running = r.running || r.status === 'allowed' || r.status === 'denied' || r.status === 'not-asked';
          st.batch.results.push({ id: r.id, status: r.status }); st.batch.done++;
          changed();
          return next();
        });
      }
      function finish() {
        var res = st.batch.results, ok = res.filter(function (x) { return x.status === 'allowed'; }).length, no = res.filter(function (x) { return x.status === 'denied'; }).length, other = res.length - ok - no, left = order.length - res.length;
        var parts = [];
        if (ok) parts.push(ok + ' allowed'); if (no) parts.push(no + ' not allowed'); if (other) parts.push(other + ' not answered');
        st.noteKind = 'result';
        st.note = (st.stopping && left ? 'Stopped. ' + left + ' not asked. ' : '') + (parts.length ? parts.join(', ') + '.' : '') +
          (no ? ' macOS asks only once per app: use Settings to change it.' : !left && ok && !other ? ' Click the tag icon in the menu bar to tag an item.' : '');
        st.batch = null; st.stopping = false;
        changed();
        return view();
      }
      changed();
      return next();
    }
    function stop() { if (st.batch) { st.stopping = true; st.note = 'Stopping after this prompt…'; changed(); } return view(); }
    /* at launch the window shows itself only when there is nothing to work with yet: no index and no app allowed */
    function shouldShowAtLaunch(hasIndex) { return refresh().then(function () { return !hasIndex && !st.rows.some(function (r) { return r.status === 'allowed'; }); }); }

    function view() {
      var can = st.rows.filter(eligible), n = st.rows.filter(function (r) { return r.ticked; }).length;
      return {
        rows: st.rows.map(function (r) { return { id: r.id, name: r.name, status: r.status, text: TEXT[r.status] + (r.status === 'error' && r.code != null ? ' (' + r.code + ')' : ''), eligible: eligible(r) && !st.batch, ticked: r.ticked, settings: r.status === 'denied' }; }),
        missing: st.missing.slice(), busy: !!st.batch, stopping: st.stopping, loaded: st.loaded, note: st.note, noteKind: st.noteKind || 'idle',
        progress: st.batch ? { done: st.batch.done, total: st.batch.order.length } : null,
        selectedCount: n, allSelected: can.length > 0 && can.every(function (r) { return r.ticked; }), canSelect: can.length > 0 && !st.batch, canRequest: n > 0 && !st.batch
      };
    }
    return { refresh: refresh, toggle: toggle, toggleAll: toggleAll, start: start, stop: stop, shouldShowAtLaunch: shouldShowAtLaunch, view: view };
  }
  return { create: create, statusOf: statusOf, TEXT: TEXT };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ContextAccess;
