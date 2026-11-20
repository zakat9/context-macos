/* Context — the popover's rules.
 *
 * The Mac app is one menu-bar icon and one transient popover. The shell (Swift) owns no rules: when the icon is
 * clicked it notes which app was in front and opens the popover; everything else is decided here.
 *
 *   Tag:   the popover shows the ONE whole object that was selected in that app when the icon was clicked
 *          (a note, a mail message, a saved file). Its tags are 0 to 2 plain names. Saving first asks the same app
 *          again: if the selected object is no longer the one shown, nothing is written.
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
  var NOTHING = 'Select one note, mail message or saved file, then click the icon again.';
  var NOUN = { 'com.apple.Notes': 'note', 'com.apple.mail': 'message', 'com.apple.finder': 'file' };
  var RECENT = 8;

  /* a recent-tag button was pressed: put the tag into the field, or take it out if it is there */
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
    function fresh() { return { app: '', target: { state: 'none', message: NOTHING }, tagText: '', tagMessage: '', recent: [], indexError: '', lookup: null, copyMessage: '' }; }
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

    /* the one object selected (or the one saved document open) in an app, asked now */
    function readSelection(bid) {
      if (!Core.scriptForSelection(bid)) return Promise.resolve({ state: 'none', message: NOTHING });   /* an app the panel does not follow is asked nothing */
      var app = Core.SELECTION_APPS[bid];
      return ask('selection', bid).then(function (r) {
        if (!r.ok) {
          if (r.code === -1743) return { state: 'none', message: 'Allow Context to ask ' + app + ': System Settings › Privacy & Security › Automation.' };
          if (r.code === -1712) return { state: 'none', message: app + ' did not answer. Click the icon again.' };
          return { state: 'none', message: NOUN[bid] ? 'Select one ' + NOUN[bid] + ' in ' + app + ', then click the icon again.' : 'Open one saved document in ' + app + ', then click the icon again.' };
        }
        var a = Core.parseActive(r.reply, offset());
        if (!a.ok) return { state: 'none', message: a.reason };
        if (a.desc) return { state: 'object', desc: a.desc, app: app };
        if (!a.path) return { state: 'none', message: NOTHING };
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(a.path)) return { state: 'none', message: 'This document is open from a web address. Only a saved file can be tagged.' };
        return ask('readFile', a.path).then(function (f) {
          if (f.ok && !f.bytes) return { state: 'object', app: app, desc: Core.fileDesc(f.realPath, f.mtimeMs ? Read.localIso(Math.floor(f.mtimeMs)) : null) };
          var d = Read.describeFile(f, a.path);
          if (!d.ok) return { state: 'none', message: f.reason === 'denied' ? 'macOS is not letting Context read that file. Nothing can be tagged.' : 'Only a saved file can be tagged.' };
          return { state: 'object', desc: d.desc, app: app };
        });
      });
    }

    /* the icon was clicked while `app` was in front: show what is selected there */
    function opened(appInfo) {
      st = fresh(); held = null;
      st.app = appInfo && appInfo.bundleId ? String(appInfo.bundleId) : '';
      return loadIndex().then(function (loaded) {
        st.indexError = loaded.error || '';
        st.recent = loaded.index ? recentOf(loaded.index) : [];
        return readSelection(st.app).then(function (sel) {
          st.target = sel;
          if (sel.state === 'object') {
            var rec = loaded.index ? loaded.index.objects[sel.desc.id] : null;
            st.target.tags = rec ? rec.tags.slice() : [];
            st.tagText = st.target.tags.join(' ');
          }
          return view();
        });
      });
    }

    /* Save was pressed: the field's names become the target's tags, if the target is still the selected object */
    function save(text) {
      st.copyMessage = '';
      if (st.target.state !== 'object') { st.tagMessage = 'Nothing is selected to tag.'; return Promise.resolve(view()); }
      st.tagText = String(text == null ? '' : text);
      var p = Core.parseTagInput(st.tagText);
      if (p.errors.length) {
        st.tagMessage = { 'too-long': 'A tag can be up to ' + Core.MAX_TAG_LENGTH + ' characters.', 'needs-a-letter': 'A tag needs at least one letter.' }[p.errors[0].reason] || 'Use letters, digits, - or _ in a tag.';
        return Promise.resolve(view());
      }
      if (p.tags.length > Core.MAX_TAGS) { st.tagMessage = 'At most ' + Core.MAX_TAGS + ' tags for one source. Remove ' + (p.tags.length - Core.MAX_TAGS) + '.'; return Promise.resolve(view()); }
      var wanted = st.target.desc.id, appName = st.target.app;
      return readSelection(st.app).then(function (now) {
        if (now.state !== 'object' || now.desc.id !== wanted) {
          st.target = { state: 'none', message: 'The selection in ' + appName + ' changed while this was open. Nothing was tagged. Click the icon again to tag what is selected now.' };
          st.tagText = ''; st.tagMessage = '';
          return view();
        }
        return loadIndex().then(function (loaded) {
          if (!loaded.index) { st.tagMessage = loaded.error; return view(); }
          var idx = loaded.index, msg;
          if (!p.tags.length) {
            if (!idx.objects[wanted]) { st.tagMessage = 'No tags to save.'; return view(); }
            delete idx.objects[wanted]; msg = 'Tags removed.';
          } else {
            var b = Core.bind(idx, now.desc, p.tags.map(function (t) { return t.name; }), { replace: true, now: nowIso() });
            if (!b.ok) { held = null; st.tagMessage = b.error.message; return view(); }
            if (b.status === 'unchanged') { st.tagMessage = 'No change.'; return view(); }
            msg = 'Tagged ' + b.record.tags.join(' and ') + '.';
          }
          return saveIndex(idx).then(function (w) {
            if (!w.ok) { st.tagMessage = 'The index could not be saved. Nothing was tagged.'; return view(); }
            st.target = now;
            st.target.tags = idx.objects[wanted] ? idx.objects[wanted].tags.slice() : [];
            st.tagText = st.target.tags.join(' ');
            st.recent = recentOf(idx);
            st.tagMessage = msg;
            return view();
          });
        });
      });
    }

    /* one indexed source, read as it is saved right now */
    function readRecord(rec) {
      var loc = rec.locator || {};
      if (loc.type === 'url') return Promise.resolve({ status: 'external', reason: 'web link; Context does not fetch pages. Open it where you are signed in' });
      if (loc.type === 'file') return ask('readFile', loc.value).then(function (f) { return Read.readFile(rec, f, { maxCellsPerSheet: opts.maxCellsPerSheet }); });
      if (loc.type === 'apple-notes' || loc.type === 'apple-mail') {
        if (!Core.scriptForRead(loc)) return Promise.resolve({ status: 'unavailable', reason: 'the entry does not hold enough to find this object again' });
        var x = loc.extra || {};
        return (loc.type === 'apple-notes' ? ask('readNote', loc.value) : ask('readMail', { account: String(x.account), mailbox: String(x.mailbox), numericId: String(x.numericId) }))
          .then(function (r) { return r.ok ? Read.readAppReply(rec, r.reply, offset()) : { status: 'unavailable', reason: Read.appReason(r.code, r.message) }; });
      }
      return Promise.resolve({ status: 'unavailable', reason: 'unknown kind of locator' });
    }
    function readAll(records) {
      var out = [];
      return records.reduce(function (chain, rec) { return chain.then(function () { return readRecord(rec).then(function (state) { out.push({ record: rec, state: state }); }); }); }, Promise.resolve()).then(function () { return out; });
    }
    function renderOptions(extra) {
      var o = { now: nowIso(), maxCharsPerSource: opts.maxCharsPerSource, maxTotalChars: opts.maxTotalChars };
      Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
      return o;
    }
    function print(entry) { var s = entry.state; return JSON.stringify([entry.record.id, s.status, s.reason || '', s.content || null, s.observed || null]); }

    /* a tag was chosen: read every source linked to it and lay them out for review. Nothing is copied here. */
    function lookup(text) {
      st.copyMessage = '';
      var q = lookupQuery(text);
      if (!q.tags.length) { st.lookup = { query: '', error: 'Choose or type a tag.', entries: [], selected: {}, labels: {}, data: null }; return Promise.resolve(view()); }
      var name = q.tags.map(function (t) { return Core.LOOKUP_PREFIX + t.name; }).join(' ');
      return loadIndex().then(function (loaded) {
        if (!loaded.index) { st.lookup = { query: name, error: loaded.error, entries: [], selected: {}, labels: {}, data: null }; return view(); }
        var idx = loaded.index, recs = Core.resolve(idx, q.tags.map(function (t) { return t.key; }));
        return readAll(recs).then(function (entries) {
          var changed = false;
          entries.forEach(function (e) { if (e.state.observed && Core.refresh(idx, e.record.id, e.state.observed)) changed = true; e.record = idx.objects[e.record.id]; });
          var known = Core.tagSummary(idx).map(function (t) { return t.name; });
          var full = Core.renderContext(q, entries, renderOptions({ includeQuoted: true, known: known }));
          var labels = {}, selected = {};
          full.data.timeline.concat(full.data.unavailable).forEach(function (x) { labels[x.id] = x.label; });
          entries.forEach(function (e) { selected[e.record.id] = true; });
          st.lookup = { q: q, query: name, error: '', entries: entries, selected: selected, labels: labels, data: full.data, empty: entries.length ? '' : full.markdown.split('\n').slice(2).join(' ').trim() };
          return (changed ? saveIndex(idx) : Promise.resolve({ ok: true })).then(function () { return view(); });
        });
      });
    }
    function setSelected(id, on) {
      if (st.lookup && Object.prototype.hasOwnProperty.call(st.lookup.selected, id)) { st.lookup.selected[id] = !!on; st.copyMessage = ''; }
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
      if (!L || !L.entries || !L.entries.length) { st.copyMessage = 'Choose a tag first.'; return Promise.resolve(view()); }
      if (!pick.length) { st.copyMessage = 'Tick at least one source.'; return Promise.resolve(view()); }
      return readAll(pick.map(function (e) { return e.record; })).then(function (again) {
        var differs = false, byId = {};
        again.forEach(function (e, i) { byId[e.record.id] = e; if (print(e) !== print(pick[i])) differs = true; });
        if (differs) {
          L.entries = L.entries.map(function (e) { return byId[e.record.id] || e; });
          L.data = Core.renderContext(L.q, L.entries, renderOptions({ includeQuoted: true, labels: L.labels })).data;
          st.copyMessage = 'A source changed after it was shown here. Nothing was copied. The list now shows what is saved: look again, then copy.';
          return view();
        }
        var text = preview();
        return ask('copyText', text).then(function (c) {
          st.copyMessage = c.ok ? 'Copied ' + pick.length + ' source' + (pick.length === 1 ? '' : 's') + '. Nothing was sent: paste it where you want it.' : 'Could not copy. Nothing left this popover.';
          return view();
        });
      });
    }
    /* the popover closed: nothing is carried over to the next time */
    function closed() { st = fresh(); held = null; return Promise.resolve(view()); }

    function view() {
      var t = st.target, v = {
        target: t.state === 'object' ? { state: 'object', kind: Core.KIND_LABEL[t.desc.kind] || 'File', title: Core.oneLine(t.desc.title), tags: (t.tags || []).slice(), app: t.app || '', message: '' }
          : { state: 'none', kind: '', title: '', tags: [], app: '', message: t.message || NOTHING },
        tagText: st.tagText, tagMessage: st.tagMessage, recent: st.recent.slice(), indexError: st.indexError, maxTags: Core.MAX_TAGS,
        lookup: null, copyMessage: st.copyMessage
      };
      var L = st.lookup;
      if (L) {
        var sources = [];
        if (L.data) {
          L.data.timeline.forEach(function (x) {
            sources.push({ id: x.id, label: x.label, group: x.when ? 'timeline' : 'undated', kind: Core.KIND_LABEL[x.kind] || 'File', title: Core.oneLine(x.title), when: x.when || '', dateLabel: x.when ? x.dateLabel : 'date unknown',
              status: x.status === 'ok' ? (x.contents === 'omitted-for-size' ? 'too-long' : 'read') : 'not-read', reason: x.reason || '', lines: x.quoted || [], selected: !!L.selected[x.id], where: Core.locatorText(x.locator) });
          });
          L.data.unavailable.forEach(function (x) {
            sources.push({ id: x.id, label: x.label, group: 'unavailable', kind: Core.KIND_LABEL[x.kind] || 'File', title: Core.oneLine(x.title), when: '', dateLabel: '', status: 'unavailable', reason: x.reason || 'not accessible', lines: [], selected: !!L.selected[x.id], where: Core.locatorText(x.locator) });
          });
        }
        v.lookup = { query: L.query, error: L.error || '', empty: L.empty || '', counts: L.data ? L.data.counts : null, sources: sources, selectedCount: chosen().length };
      }
      return v;
    }
    /* for the tests: everything held at this moment */
    function holding() { return JSON.stringify({ app: st.app, target: st.target, tagText: st.tagText, tagMessage: st.tagMessage, recent: st.recent, lookup: st.lookup ? { query: st.lookup.query, ids: (st.lookup.entries || []).map(function (e) { return e.record.id; }) } : null, copyMessage: st.copyMessage }); }

    return { opened: opened, save: save, lookup: lookup, setSelected: setSelected, preview: preview, copy: copy, closed: closed, view: view, held: holding };
  }
  return { create: create, toggleTag: toggleTag, lookupQuery: lookupQuery };
})(typeof WorkIndexCore !== 'undefined' ? WorkIndexCore : require('./rules.js'), typeof WorkIndexRead !== 'undefined' ? WorkIndexRead : require('./read.js'));
if (typeof module !== 'undefined' && module.exports) module.exports = WorkIndexPopover;
