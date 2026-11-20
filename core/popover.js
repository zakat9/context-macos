/* contexta — the popover's rules.
 *
 * The Mac app is one menu-bar icon and one transient popover. The shell (Swift) owns no rules: when the icon is
 * clicked it notes which app was in front and opens the popover; everything else is decided here.
 *
 *   Manage: a tag can be renamed everywhere, or merged into another: only the index changes, in one save, after the
 *          numbers shown have been checked again against the index file as it is at that moment.
 *   Tag:   the popover shows the ONE whole object that was selected in that app when the icon was clicked
 *          (a note, a mail message, a saved file). Its tags are 0 to 2 plain names. A tag is added or taken off one
 *          at a time and written at once; every write first asks the same app again: if the selected object is no
 *          longer the one shown, nothing is written.
 *   Copy:  choosing a tag reads every linked source as it is saved now and lists them by their own dates. The person
 *          reviews the list, unticks what should stay out, and presses Copy. Only then is anything put on the
 *          clipboard, and only the ticked sources. Before copying, the ticked sources are read once more: if one
 *          changed after it was shown, nothing is copied and the list is refreshed for another look.
 *
 * Nothing is sent anywhere. Nothing is kept: closing the popover drops the target and the list. "Recent tags" are
 * read from the index (the tags of the entries updated last), not from a history.
 *
 * host (all return promises of plain objects). The page never hands the shell a script: it names what to ask.
 *   selection(bundleId) → { ok, reply } | { ok:false, code, message }      the shell runs its own copy of the read-only
 *   readNote(id)        → same                                              scripts in rules.js (APPLESCRIPT) and
 *   readMail({account, mailbox, numericId}) → same                          checks every value it is given
 *   readFile(path)    → { ok, realPath, bytes, mtimeMs, size } | { ok:false, reason }
 *   readIndex()       → { ok, missing:true } | { ok, text } | { ok:false }
 *   indexStamp()      → { ok, stamp }                                      changes whenever the index file changes
 *   writeIndex(text)  → { ok } | { ok:false }
 *   copyText(text)    → { ok }                                             called only by copy()
 */
var WorkIndexPopover = (function (Core, Read) {
  'use strict';
  var NOTHING = 'Select one note, mail message or saved file in its app, then click the contexta icon.';
  var NOUN = { 'com.apple.Notes': 'note', 'com.apple.mail': 'message', 'com.apple.finder': 'file' };
  var RECENT = 8;

  /* a recent-tag button was pressed: put the tag into the field, or take it out if it is there */
  /* the folder of a saved file, as shown under its title: a cloud folder by its service and place, never by the
     account folder on disk (which for Google Drive carries the email address) */
  function folderText(p) {
    var c = Core.cloudPlace(p);
    if (c) { var parts = c.place.split(' › '); parts.pop(); return c.provider + (parts.length ? ' › ' + parts.join(' › ') : ''); }
    return String(p).replace(/\/[^\/]*$/, '') || '/';
  }
  function toggleTag(fieldText, name) {
    var p = Core.parseTagInput(fieldText), key = Core.tagKey(name);
    var names = p.tags.map(function (t) { return t.name; });
    var at = p.tags.map(function (t) { return t.key; }).indexOf(key);
    if (at >= 0) names.splice(at, 1); else names.push(name);
    return names.join(' ');
  }
  /* a lookup field accepts plain names as well as ::names */
  function lookupQuery(text) {
    var raw = String(text == null ? '' : text).trim();
    if (raw.indexOf('::') < 0) raw = raw.split(/[\s,]+/).filter(Boolean).map(function (x) { return '::' + x.replace(/^[#＃]/, ''); }).join(' ');
    return Core.parseLookup(raw);
  }

  function create(host, opts) {
    opts = opts || {};
    var st = fresh(), held = null;      /* held: the index as read for this opening of the popover, with the file's stamp */
    function fresh() { return { app: '', target: { state: 'none', reason: 'other-app', message: NOTHING }, tagText: '', tagMessage: '', tagState: '', recent: [], counts: {}, indexError: '', lookup: null, copyMessage: '', copyState: '', manage: null }; }
    function nowMs() { return opts.now ? opts.now() : Date.now(); }
    function offset() { return -new Date(nowMs()).getTimezoneOffset(); }
    function nowIso() { return Core.toLocalIso(nowMs(), offset()); }
    function ask(name, arg) {
      var p;
      try { p = Promise.resolve(host[name](arg)); } catch (e) { p = Promise.reject(e); }
      return p.then(function (r) { return r || { ok: false }; }, function (e) { return { ok: false, message: String((e && e.message) || e) }; });
    }
    /* The index is read once when the popover opens. After that it is read again only if the file's stamp has changed. */
    function loadIndex() {
      return ask('indexStamp').then(function (s1) {
        if (held && s1.ok && s1.stamp === held.stamp) return { index: held.index };
        held = null;
        return ask('readIndex').then(function (r) {
          if (!r.ok) return { error: 'The index file cannot be opened.' };
          var idx;
          try { idx = r.missing ? Core.emptyIndex() : Core.loadIndex(String(r.text)); }
          catch (e) { return { error: 'The index file is not readable. Nothing can be tagged or looked up until it is moved aside.' }; }
          return ask('indexStamp').then(function (s2) { if (s1.ok && s2.ok && s1.stamp === s2.stamp) held = { index: idx, stamp: s2.stamp }; return { index: idx }; });
        });
      });
    }
    function saveIndex(idx) {
      return ask('writeIndex', Core.dumpIndex(idx)).then(function (w) {
        if (!w.ok) { held = null; return w; }
        return ask('indexStamp').then(function (s) { held = s.ok ? { index: idx, stamp: s.stamp } : null; return w; });
      });
    }
    function recentOf(index) { return Core.tagSummary(index).slice(0, RECENT).map(function (t) { return t.name; }); }
    function countsOf(index) { var c = {}; Core.tagSummary(index).forEach(function (t) { c[t.name] = t.count; }); return c; }

    /* the one object selected (or the one saved document open) in an app, asked now */
    /* `captured` is the app's answer when the shell has already asked it (the Tag current item shortcut asks before
       contexta comes to the front); otherwise the app is asked now */
    function readSelection(bid, captured) {
      if (!Core.scriptForSelection(bid)) return Promise.resolve({ state: 'none', reason: 'other-app', message: NOTHING });   /* an app contexta does not follow is asked nothing */
      var app = Core.SELECTION_APPS[bid];
      return (captured && typeof captured === 'object' ? Promise.resolve(captured) : ask('selection', bid)).then(function (r) {
        if (!r.ok) {
          if (r.code === -1744) return { state: 'none', reason: 'not-asked', app: app, message: 'contexta has not been allowed to ask ' + app + ' yet.' };
          if (r.code === -1743) return { state: 'none', reason: 'denied', app: app, message: 'contexta is not allowed to ask ' + app + ' which item is selected.' };
          if (r.code === -1712) return { state: 'none', reason: 'no-answer', app: app, message: app + ' did not answer.' };
          var again = st.via === 'shortcut' ? ', then press the shortcut again.' : ', then click the contexta icon again.';
          return { state: 'none', reason: 'no-item', app: app, message: (NOUN[bid] ? 'Select one ' + NOUN[bid] + ' in ' + app : 'Open one saved document in ' + app) + again };
        }
        var a = Core.parseActive(r.reply, offset());
        if (!a.ok) return { state: 'none', reason: 'no-item', app: app, message: a.reason };
        if (a.desc) return { state: 'object', desc: a.desc, app: app };
        if (!a.path) return { state: 'none', reason: 'no-item', app: app, message: NOTHING };
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(a.path)) return { state: 'none', reason: 'not-a-file', app: app, message: 'This document is open from a web address. Only a saved file can be tagged.' };
        return ask('readFile', a.path).then(function (f) {
          if (f.ok && !f.bytes) return { state: 'object', app: app, desc: Core.fileDesc(f.realPath, f.mtimeMs ? Read.localIso(Math.floor(f.mtimeMs)) : null) };
          var d = Read.describeFile(f, a.path);
          if (!d.ok) return { state: 'none', reason: f.reason === 'denied' ? 'file-denied' : 'not-a-file', app: app, message: f.reason === 'denied' ? 'macOS is not letting contexta read that file. Nothing can be tagged.' : 'Only a saved file can be tagged.' };
          return { state: 'object', desc: d.desc, app: app };
        });
      });
    }

    /* the icon was clicked while `app` was in front: show what is selected there */
    function opened(appInfo) {
      st = fresh(); held = null;
      st.app = appInfo && appInfo.bundleId ? String(appInfo.bundleId) : '';
      st.via = appInfo && appInfo.via === 'shortcut' ? 'shortcut' : '';
      return loadIndex().then(function (loaded) {
        st.indexError = loaded.error || '';
        st.recent = loaded.index ? recentOf(loaded.index) : []; st.counts = loaded.index ? countsOf(loaded.index) : {};
        return readSelection(st.app, appInfo && appInfo.captured).then(function (sel) {
          st.target = sel;
          if (sel.state === 'object') {
            var rec = loaded.index ? loaded.index.objects[sel.desc.id] : null;
            st.target.tags = rec ? rec.tags.slice() : [];
            st.tagText = '';
          }
          return view();
        });
      });
    }

    /* One more tag for the shown item (typed, or a recent tag pressed). The item keeps the tags it has. */
    function addTag(text) {
      st.tagState = '';
      if (st.target.state !== 'object') { st.tagMessage = 'Nothing is selected to tag.'; return Promise.resolve(view()); }
      var p = Core.parseTagInput(String(text == null ? '' : text)), have = (st.target.tags || []).slice(), keys = have.map(Core.tagKey);
      if (p.errors.length) return save(have.concat([String(text)]).join(' '), text);          /* save() words the refusal */
      var fresh = p.tags.filter(function (t) { return keys.indexOf(t.key) < 0; });
      if (!p.tags.length) { st.tagMessage = ''; return Promise.resolve(view()); }
      if (!fresh.length) { st.tagText = ''; st.tagMessage = 'Already tagged ' + p.tags.map(function (t) { return t.name; }).join(' and ') + '.'; return Promise.resolve(view()); }
      if (have.length + fresh.length > Core.MAX_TAGS) {
        st.tagText = String(text);
        st.tagMessage = have.length >= Core.MAX_TAGS ? 'This item already has ' + Core.MAX_TAGS + ' tags. Remove one to add ' + fresh[0].name + '.' : 'An item can have ' + Core.MAX_TAGS + ' tags. There is room for ' + (Core.MAX_TAGS - have.length) + ' more.';
        return Promise.resolve(view());
      }
      return save(have.concat(fresh.map(function (t) { return t.name; })).join(' '), text);
    }
    /* take one tag off the shown item */
    function removeTag(name) {
      st.tagState = '';
      if (st.target.state !== 'object') return Promise.resolve(view());
      var key = Core.tagKey(name);
      return save((st.target.tags || []).filter(function (n) { return Core.tagKey(n) !== key; }).join(' '));
    }

    /* Save was pressed: the field's names become the target's tags, if the target is still the selected object */
    function save(text, typed) {
      st.copyMessage = ''; st.tagState = '';
      if (st.target.state !== 'object') { st.tagMessage = 'Nothing is selected to tag.'; return Promise.resolve(view()); }
      st.tagText = typed == null ? '' : String(typed);
      var p = Core.parseTagInput(String(text == null ? '' : text));
      if (p.errors.length) {
        st.tagMessage = { 'too-long': 'A tag can be up to ' + Core.MAX_TAG_LENGTH + ' characters.', 'needs-a-letter': 'A tag needs at least one letter.' }[p.errors[0].reason] || 'Use letters, digits, - or _ in a tag.';
        return Promise.resolve(view());
      }
      if (p.tags.length > Core.MAX_TAGS) { st.tagMessage = 'At most ' + Core.MAX_TAGS + ' tags for one source. Remove ' + (p.tags.length - Core.MAX_TAGS) + '.'; return Promise.resolve(view()); }
      var wanted = st.target.desc.id, appName = st.target.app;
      return readSelection(st.app).then(function (now) {
        if (now.state !== 'object' || now.desc.id !== wanted) {
          st.target = { state: 'none', reason: 'changed', app: appName, message: 'The selection in ' + appName + ' changed while this was open. Nothing was tagged.' };
          st.tagText = ''; st.tagMessage = '';
          return view();
        }
        return loadIndex().then(function (loaded) {
          if (!loaded.index) { st.tagMessage = loaded.error; return view(); }
          var idx = loaded.index, msg, had = idx.objects[wanted] ? idx.objects[wanted].tagKeys.slice() : [], hadNames = idx.objects[wanted] ? idx.objects[wanted].tags.slice() : [];
          if (!p.tags.length) {
            if (!idx.objects[wanted]) { st.tagMessage = 'No tags to save.'; return view(); }
            delete idx.objects[wanted]; msg = 'Removed ' + hadNames.join(' and ') + '.';
          } else {
            var b = Core.bind(idx, now.desc, p.tags.map(function (t) { return t.name; }), { replace: true, now: nowIso() });
            if (!b.ok) { held = null; st.tagMessage = b.error.message; return view(); }
            if (b.status === 'unchanged') { st.target = now; st.target.tags = b.record.tags.slice(); st.tagText = ''; st.tagMessage = 'No change.'; return view(); }
            var added = b.record.tags.filter(function (n, i) { return had.indexOf(b.record.tagKeys[i]) < 0; }), gone = hadNames.filter(function (n, i) { return b.record.tagKeys.indexOf(had[i]) < 0; });
            msg = added.length && gone.length ? 'Tags are now ' + b.record.tags.join(' and ') + '.' : gone.length ? 'Removed ' + gone.join(' and ') + '.' : added.length ? 'Tagged ' + added.join(' and ') + '.' : 'No change.';
          }
          return saveIndex(idx).then(function (w) {
            if (!w.ok) { st.tagMessage = 'The index could not be saved. Nothing was tagged.'; return view(); }
            st.target = now;
            st.target.tags = idx.objects[wanted] ? idx.objects[wanted].tags.slice() : [];
            st.tagText = '';
            st.recent = recentOf(idx); st.counts = countsOf(idx);
            st.tagMessage = msg; st.tagState = 'saved';
            return view();
          });
        });
      });
    }

    /* one indexed source, read as it is saved right now */
    function readRecord(rec) {
      var loc = rec.locator || {};
      if (loc.type === 'url') return Promise.resolve({ status: 'external', reason: 'web link; contexta does not fetch pages. Open it where you are signed in' });
      if (loc.type === 'file') return ask('readFile', loc.value).then(function (f) { return Read.readFile(rec, f, { maxCellsPerSheet: opts.maxCellsPerSheet }); });
      if (loc.type === 'apple-notes' || loc.type === 'apple-mail') {
        if (!Core.scriptForRead(loc)) return Promise.resolve({ status: 'unavailable', reason: 'the entry does not hold enough to find this object again' });
        var x = loc.extra || {};
        return (loc.type === 'apple-notes' ? ask('readNote', loc.value) : ask('readMail', { account: String(x.account), mailbox: String(x.mailbox), numericId: String(x.numericId) }))
          .then(function (r) { return r.ok ? Read.readAppReply(rec, r.reply, offset()) : { status: 'unavailable', reason: Read.appReason(r.code, r.message) }; });
      }
      return Promise.resolve({ status: 'unavailable', reason: 'unknown kind of locator' });
    }
    function readAll(records, onProgress) {
      var out = [];
      if (onProgress) onProgress(0, records.length);
      return records.reduce(function (chain, rec) { return chain.then(function () { return readRecord(rec).then(function (state) { out.push({ record: rec, state: state }); if (onProgress) onProgress(out.length, records.length); }); }); }, Promise.resolve()).then(function () { return out; });
    }
    function renderOptions(extra) {
      var o = { now: nowIso(), maxCharsPerSource: opts.maxCharsPerSource, maxTotalChars: opts.maxTotalChars };
      Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
      return o;
    }
    function print(entry) { var s = entry.state; return JSON.stringify([entry.record.id, s.status, s.reason || '', s.content || null, s.observed || null]); }

    /* a tag was chosen: read every source linked to it and lay them out for review. Nothing is copied here. */
    function lookup(text, onProgress) {
      st.copyMessage = '';
      var q = lookupQuery(text);
      if (!q.tags.length) { st.lookup = { query: '', error: 'Type a tag, or choose one below.', entries: [], selected: {}, labels: {}, data: null, changed: {} }; return Promise.resolve(view()); }
      var name = q.tags.map(function (t) { return Core.LOOKUP_PREFIX + t.name; }).join(' ');
      return loadIndex().then(function (loaded) {
        if (!loaded.index) { st.lookup = { query: name, error: loaded.error, entries: [], selected: {}, labels: {}, data: null, changed: {} }; return view(); }
        var idx = loaded.index, recs = Core.resolve(idx, q.tags.map(function (t) { return t.key; }));
        return readAll(recs, onProgress).then(function (entries) {
          var changed = false;
          entries.forEach(function (e) { if (e.state.observed && Core.refresh(idx, e.record.id, e.state.observed)) changed = true; e.record = idx.objects[e.record.id]; });
          var known = Core.tagSummary(idx).map(function (t) { return t.name; });
          var full = Core.renderContext(q, entries, renderOptions({ includeQuoted: true, known: known }));
          var labels = {}, selected = {};
          full.data.timeline.concat(full.data.unavailable).forEach(function (x) { labels[x.id] = x.label; });
          entries.forEach(function (e) { selected[e.record.id] = true; });
          st.lookup = { q: q, query: name, error: '', entries: entries, selected: selected, labels: labels, data: full.data, changed: {}, known: known, empty: entries.length ? '' : 'No source has the tag ' + q.tags.map(function (t) { return t.name; }).join(' and ') + '.' };
          return (changed ? saveIndex(idx) : Promise.resolve({ ok: true })).then(function () { return view(); });
        });
      });
    }
    function setSelected(id, on) {
      if (st.lookup && Object.prototype.hasOwnProperty.call(st.lookup.selected, id)) { st.lookup.selected[id] = !!on; st.copyMessage = ''; }
      return Promise.resolve(view());
    }
    function setAllSelected(on) {
      if (st.lookup) { Object.keys(st.lookup.selected).forEach(function (id) { st.lookup.selected[id] = !!on; }); st.copyMessage = ''; }
      return Promise.resolve(view());
    }
    function chosen() { var L = st.lookup; return L && L.entries ? L.entries.filter(function (e) { return L.selected[e.record.id]; }) : []; }
    /* exactly what Copy would put on the clipboard for the ticked sources ('' when none is ticked) */
    function preview() {
      var L = st.lookup, pick = chosen();
      if (!pick.length) return '';
      return Core.renderContext(L.q, pick, renderOptions({ labels: L.labels, scope: pick.length < L.entries.length ? { selected: pick.length, total: L.entries.length } : null })).markdown;
    }
    /* Copy was pressed. The only place the clipboard is written. */
    function copy() {
      var L = st.lookup, pick = chosen();
      st.copyState = '';
      if (!L || !L.entries || !L.entries.length) { st.copyMessage = 'Look up a tag first.'; st.copyState = 'error'; return Promise.resolve(view()); }
      if (!pick.length) { st.copyMessage = 'Tick at least one source.'; st.copyState = 'error'; return Promise.resolve(view()); }
      return readAll(pick.map(function (e) { return e.record; })).then(function (again) {
        var differs = false, byId = {};
        L.changed = {};
        again.forEach(function (e, i) { byId[e.record.id] = e; if (print(e) !== print(pick[i])) { differs = true; L.changed[e.record.id] = true; } });
        if (differs) {
          var n = Object.keys(L.changed).length;
          L.entries = L.entries.map(function (e) { return byId[e.record.id] || e; });
          L.data = Core.renderContext(L.q, L.entries, renderOptions({ includeQuoted: true, labels: L.labels })).data;
          st.copyMessage = 'Not copied: ' + Object.keys(L.changed).map(function (id) { return L.labels[id] || 'a source'; }).join(', ') + ' changed after ' + (n === 1 ? 'it was' : 'they were') + ' shown. Check ' + (n === 1 ? 'it' : 'them') + ', then copy again.';
          st.copyState = 'stale';
          return view();
        }
        var text = preview();
        return ask('copyText', text).then(function (c) {
          st.copyMessage = c.ok ? 'Copied ' + pick.length + ' source' + (pick.length === 1 ? '' : 's') + '. Paste it into your AI chat. Nothing was sent.' : 'Could not copy. Nothing left this window.';
          st.copyState = c.ok ? 'copied' : 'error';
          return view();
        });
      });
    }
    /* the popover closed: nothing is carried over to the next time */
    /* ── Manage tags: rename a tag everywhere, or merge it into another ── */
    function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
    function allTags(index) { return Core.tagSummary(index).map(function (t) { return { name: t.name, key: t.key, count: t.count }; }).sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; }); }
    function manageOpen() {
      st.manage = { query: '', from: '', to: '', plan: null, message: '', state: '', tags: [] };
      return loadIndex().then(function (l) {
        if (!l.index) { st.manage.message = l.error; st.manage.state = 'error'; } else st.manage.tags = allTags(l.index);
        return view();
      });
    }
    function manageClose() { st.manage = null; return Promise.resolve(view()); }
    function manageSearch(text) { if (st.manage) st.manage.query = String(text == null ? '' : text); return Promise.resolve(view()); }
    function renameChoose(name) {
      var M = st.manage; if (!M) return Promise.resolve(view());
      M.from = String(name || ''); M.to = ''; M.plan = null; M.message = ''; M.state = '';
      return Promise.resolve(view());
    }
    /* what would happen, from the index as it is now; shown while the new name is typed; changes nothing */
    function renamePreview(toText) {
      var M = st.manage; if (!M || !M.from) return Promise.resolve(view());
      M.to = String(toText == null ? '' : toText); M.message = ''; M.state = '';
      return loadIndex().then(function (l) {
        if (!l.index) { M.plan = null; M.message = l.error; M.state = 'error'; return view(); }
        M.tags = allTags(l.index);
        M.plan = M.to.trim() ? Core.planRename(l.index, M.from, M.to) : null;
        return view();
      });
    }
    function renameCancel() {
      var M = st.manage; if (!M) return Promise.resolve(view());
      M.from = ''; M.to = ''; M.plan = null; M.message = ''; M.state = '';
      return Promise.resolve(view());
    }
    /* Rename or Merge was pressed. The index file is read again; the plan made from it now must be the one that was
       shown. Then one save writes every changed entry, or none. */
    function renameCommit(mode) {
      var M = st.manage, shown = M && M.plan;
      if (!M || !shown || !shown.ok) return Promise.resolve(view());
      if ((mode === 'merge') !== (shown.mode === 'merge')) {
        M.message = shown.mode === 'merge' ? shown.to.name + ' is already a tag. Press Merge to join the two.' : 'Press Rename.'; M.state = 'error';
        return Promise.resolve(view());
      }
      held = null;
      return loadIndex().then(function (l) {
        if (!l.index) { M.message = l.error + ' Nothing was renamed.'; M.state = 'error'; return view(); }
        var now = Core.planRename(l.index, M.from, M.to);
        M.tags = allTags(l.index);
        if (!now.ok || now.fingerprint !== shown.fingerprint) {
          /* the numbers on screen are not the numbers of this rename: either the index changed, or the name was typed on after they were shown */
          var retyped = String(shown.typed) !== String(M.to);
          M.plan = now; M.state = 'stale';
          M.message = (retyped ? 'The name was changed after these numbers were shown.' : 'The index changed after these numbers were shown.') + ' Nothing was renamed.' + (now.ok ? ' Check the new numbers, then press ' + (now.mode === 'merge' ? 'Merge' : 'Rename') + ' again.' : '');
          return view();
        }
        var next = Core.applyRename(l.index, now);
        return saveIndex(next.index).then(function (w) {
          if (!w.ok) { M.message = 'The index could not be saved. Nothing was renamed.'; M.state = 'error'; return view(); }
          /* everything in the popover that showed the old name is brought up to date; a lookup made before is dropped */
          st.recent = recentOf(next.index); st.counts = countsOf(next.index);
          if (st.target.state === 'object') st.target.tags = next.index.objects[st.target.desc.id] ? next.index.objects[st.target.desc.id].tags.slice() : [];
          st.lookup = null; st.copyMessage = ''; st.tagMessage = ''; st.tagText = '';
          M.tags = allTags(next.index);
          M.message = now.mode === 'merge' ? 'Merged ' + now.from.name + ' into ' + now.to.name + ': ' + plural(next.changed, 'source') + ' changed' + (next.merged ? ', ' + next.merged + ' already had it' : '') + '.'
            : now.mode === 'respell' ? 'Now written ' + now.to.name + ' on ' + plural(next.changed, 'source') + '.' : 'Renamed ' + now.from.name + ' to ' + now.to.name + ' on ' + plural(next.changed, 'source') + '.';
          M.state = 'done'; M.from = ''; M.to = ''; M.plan = null; M.query = '';
          return view();
        });
      });
    }
    function planLines(p) {
      if (p.mode === 'rename') return [plural(p.changes, 'source') + ' will change from ' + p.from.name + ' to ' + p.to.name + '.'];
      if (p.mode === 'respell') return [p.changes + ' of ' + plural(p.sources, 'source') + ' will show it as ' + p.to.name + '.'];
      return [p.to.name + ' is already a tag, on ' + plural(p.destinationBefore, 'source') + '.',
        plural(p.changes, 'source') + ' will change from ' + p.from.name + ' to ' + p.to.name + (p.alreadyHave ? '; ' + p.alreadyHave + ' of them already ' + (p.alreadyHave === 1 ? 'has' : 'have') + ' ' + p.to.name + ' and will keep it once' : '') + '.',
        'Afterwards ' + p.to.name + ' is on ' + plural(p.destinationAfter, 'source') + ' and ' + p.from.name + ' is gone.'];
    }

    function closed() { st = fresh(); held = null; return Promise.resolve(view()); }

    function view() {
      var t = st.target, v = {
        target: t.state === 'object' ? { state: 'object', kind: Core.KIND_LABEL[t.desc.kind] || 'File', title: Core.oneLine(t.desc.title), tags: (t.tags || []).slice(), app: t.app || '', appId: st.app, reason: '', message: '',
            when: t.desc.sourceTime ? Core.formatWhen(t.desc.sourceTime) : '', dateLabel: t.desc.sourceTime ? (Core.DATE_LABEL[t.desc.sourceTimeType] || '') : '',
            folder: t.desc.locator && t.desc.locator.type === 'file' ? folderText(t.desc.locator.value) : '' }
          : { state: 'none', kind: '', title: '', tags: [], app: t.app || '', appId: st.app, reason: t.reason || 'other-app', message: t.message || NOTHING },
        tagText: st.tagText, tagMessage: st.tagMessage, tagState: st.tagMessage ? (st.tagState || '') : '', recent: st.recent.slice(),
        tags: st.recent.map(function (n) { return { name: n, count: st.counts[n] || 0 }; }), indexError: st.indexError, maxTags: Core.MAX_TAGS,
        lookup: null, copyMessage: st.copyMessage, copyState: st.copyMessage ? (st.copyState || '') : '', manage: null, via: st.via || ''
      };
      var M = st.manage;
      if (M) {
        var q = Core.tagKey(String(M.query || '').trim().replace(/^(::|#)/, '')), P = M.plan;
        v.manage = { query: M.query, total: M.tags.length, tags: M.tags.filter(function (t) { return !q || t.key.indexOf(q) >= 0; }).map(function (t) { return { name: t.name, count: t.count }; }),
          from: M.from, fromCount: (M.tags.filter(function (t) { return t.key === Core.tagKey(M.from); })[0] || {}).count || 0, to: M.to, message: M.message, state: M.message ? M.state : '',
          plan: !P ? null : P.ok ? { ok: true, mode: P.mode, action: P.mode === 'merge' ? 'merge' : 'rename', from: P.from.name, to: P.to.name, sources: P.sources, changes: P.changes, alreadyHave: P.alreadyHave,
            destinationBefore: P.destinationBefore, destinationAfter: P.destinationAfter, lines: planLines(P) } : { ok: false, code: P.code, message: P.message } };
      }
      var L = st.lookup;
      if (L) {
        var sources = [];
        if (L.data) {
          L.data.timeline.forEach(function (x) {
            sources.push({ id: x.id, label: x.label, group: x.when ? 'timeline' : 'undated', kind: Core.KIND_LABEL[x.kind] || 'File', title: Core.oneLine(x.title), when: x.when || '', dateLabel: x.when ? x.dateLabel : 'date unknown',
              status: x.status === 'ok' ? (x.contents === 'omitted-for-size' ? 'too-long' : 'read') : 'not-read', reason: x.reason || '', lines: x.quoted || [], selected: !!L.selected[x.id], changed: !!(L.changed && L.changed[x.id]), where: Core.locatorText(x.locator) });
          });
          L.data.unavailable.forEach(function (x) {
            sources.push({ id: x.id, label: x.label, group: 'unavailable', kind: Core.KIND_LABEL[x.kind] || 'File', title: Core.oneLine(x.title), when: '', dateLabel: '', status: 'unavailable', reason: x.reason || 'not accessible', lines: [], selected: !!L.selected[x.id], changed: !!(L.changed && L.changed[x.id]), where: Core.locatorText(x.locator) });
          });
        }
        v.lookup = { query: L.query, error: L.error || '', empty: L.empty || '', counts: L.data ? L.data.counts : null, sources: sources, selectedCount: chosen().length, known: (L.known || []).slice(0, RECENT) };
      }
      return v;
    }
    /* for the tests: everything held at this moment */
    function holding() { return JSON.stringify({ app: st.app, target: st.target, tagText: st.tagText, tagMessage: st.tagMessage, recent: st.recent, lookup: st.lookup ? { query: st.lookup.query, ids: (st.lookup.entries || []).map(function (e) { return e.record.id; }) } : null, copyMessage: st.copyMessage }); }

    return { opened: opened, save: save, addTag: addTag, removeTag: removeTag, manageOpen: manageOpen, manageClose: manageClose, manageSearch: manageSearch, renameChoose: renameChoose, renamePreview: renamePreview, renameCancel: renameCancel, renameCommit: renameCommit, lookup: lookup, setSelected: setSelected, setAllSelected: setAllSelected, preview: preview, copy: copy, closed: closed, view: view, held: holding };
  }
  return { create: create, toggleTag: toggleTag, lookupQuery: lookupQuery, NOTHING: NOTHING };
})(typeof WorkIndexCore !== 'undefined' ? WorkIndexCore : require('./rules.js'), typeof WorkIndexRead !== 'undefined' ? WorkIndexRead : require('./read.js'));
if (typeof module !== 'undefined' && module.exports) module.exports = WorkIndexPopover;
