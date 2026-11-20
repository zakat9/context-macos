/* contexta — Insert context: what the Mac app answers when its browser extension asks.
 *
 * The extension's picker (in the browser, opened by a shortcut the person set there) asks four things, in order:
 *   open     the tags in use, most recently used first, with the number of sources each is on
 *   lookup   the sources of one tag, each read as it is saved NOW: label, kind, title, own date. No contents.
 *   render   the text for the sources that are still ticked. Before it is given, each of them is read again; if any
 *            differs from what was listed, or the index no longer says what it said, NOTHING is given: the answer
 *            says what changed and carries the list as it is now.
 *   done     the picker is finished; what was held for it is dropped.
 *
 * Nothing here writes: not the index, not a source, not the clipboard. Nothing here can cause a macOS prompt or open
 * an app: the host is asked for a note or a message only through functions that answer "not available now" when the
 * app is closed or not yet allowed. Everything is synchronous: one request, one answer.
 *
 * host   readIndex() → { ok, text | missing }                 readFile(path) → as the popover's (bytes or base64)
 *        readNote(id) / readMail({account, mailbox, numericId}) → { ok, reply } | { ok:false, code, message | reason }
 *        now() → ms (optional)
 *
 * In the Mac app the host is `contextInsertNative`: five functions that take JSON text and give JSON text
 * (readIndex, readFile, readNote, readMail, decodeText). They are wrapped here, so the rules above see plain objects.
 */
var ContextInsert = (function (Core, Read) {
  'use strict';
  var BEGIN = '--- contexta evidence: begin ---', END = '--- contexta evidence: end ---';
  var MAX_TEXT = 200000;          /* characters; at most three bytes each in UTF-8 plus JSON escapes, so the answer stays under the browser's 1 MB */

  function lookupQuery(text) {
    var raw = String(text == null ? '' : text).trim();
    if (raw.indexOf('::') < 0) raw = raw.split(/[\s,]+/).filter(Boolean).map(function (x) { return '::' + x.replace(/^[#＃]/, ''); }).join(' ');
    return Core.parseLookup(raw);
  }

  function create(host, opts) {
    opts = opts || {};
    var held = null, serial = 0;
    function nowMs() { return host.now ? host.now() : Date.now(); }
    function offset() { return -new Date(nowMs()).getTimezoneOffset(); }
    function nowIso() { return Core.toLocalIso(nowMs(), offset()); }
    function ask(name, arg) { try { return host[name](arg) || { ok: false }; } catch (e) { return { ok: false, message: String(e && e.message || e) }; } }
    function index() {
      var r = ask('readIndex');
      if (!r.ok) return { error: 'The index file cannot be opened.' };
      try { return { index: r.missing ? Core.emptyIndex() : Core.loadIndex(String(r.text)) }; }
      catch (e) { return { error: 'The index file is not readable.' }; }
    }
    function tagsOf(idx) { return Core.tagSummary(idx).map(function (t) { return { name: t.name, count: t.count }; }); }

    /* one indexed source, read as it is saved right now (the popover's reading, done at once) */
    function readRecord(rec) {
      var loc = rec.locator || {};
      if (loc.type === 'url') return { status: 'external', reason: 'web link; contexta does not fetch pages' };
      if (loc.type === 'file') {
        var f = ask('readFile', loc.value);
        if (f && f.ok && typeof f.base64 === 'string') { f.bytes = Read.base64Bytes(f.base64); delete f.base64; }
        return Read.readFile(rec, f, { maxCellsPerSheet: opts.maxCellsPerSheet });
      }
      if (loc.type === 'apple-notes' || loc.type === 'apple-mail') {
        if (!Core.scriptForRead(loc)) return { status: 'unavailable', reason: 'the entry does not hold enough to find this object again' };
        var x = loc.extra || {}, r = loc.type === 'apple-notes' ? ask('readNote', loc.value) : ask('readMail', { account: String(x.account), mailbox: String(x.mailbox), numericId: String(x.numericId) });
        return r.ok ? Read.readAppReply(rec, r.reply, offset()) : { status: 'unavailable', reason: r.reason || Read.appReason(r.code, r.message) };
      }
      return { status: 'unavailable', reason: 'unknown kind of locator' };
    }
    function print(entry) { var s = entry.state; return JSON.stringify([entry.record.id, s.status, s.reason || '', s.content || null, s.observed || null]); }
    function binding(rec) { return rec.id + '=' + rec.tagKeys.join(','); }
    function options(extra) {
      var o = { now: nowIso(), maxCharsPerSource: opts.maxCharsPerSource, maxTotalChars: opts.maxTotalChars };
      Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
      return o;
    }
    /* the rows of the picker: no contents, only what identifies a source and says whether it could be read */
    function rows(H) {
      var data = Core.renderContext(H.q, H.entries, options({ labels: H.labels })).data, out = [];
      data.timeline.forEach(function (x) {
        out.push({ id: x.id, label: x.label, group: x.when ? 'timeline' : 'undated', kind: Core.KIND_LABEL[x.kind] || 'File', title: Core.oneLine(x.title), when: x.when || '', dateLabel: x.when ? x.dateLabel : 'date unknown',
          status: x.status === 'ok' ? (x.contents === 'omitted-for-size' ? 'too-long' : 'read') : 'not-read', reason: x.reason || '', changed: !!H.changed[x.id] });
      });
      data.unavailable.forEach(function (x) { out.push({ id: x.id, label: x.label, group: 'unavailable', kind: Core.KIND_LABEL[x.kind] || 'File', title: Core.oneLine(x.title), when: '', dateLabel: '', status: 'unavailable', reason: x.reason || 'not accessible', changed: !!H.changed[x.id] }); });
      return { sources: out, counts: data.counts };
    }

    function open() {
      var l = index();
      if (!l.index) return { ok: false, reason: 'index', message: l.error };
      return { ok: true, app: Core.VERSION, tags: tagsOf(l.index) };
    }
    function lookup(req) {
      held = null;
      var q = lookupQuery(req.tag);
      if (!q.tags.length) return { ok: false, reason: 'no-tag', message: 'Type a tag.' };
      var l = index();
      if (!l.index) return { ok: false, reason: 'index', message: l.error };
      var names = q.tags.map(function (t) { return t.name; }), recs = Core.resolve(l.index, q.tags.map(function (t) { return t.key; }));
      if (!recs.length) return { ok: true, token: '', query: names, sources: [], counts: null, tags: tagsOf(l.index), empty: 'No source has the tag ' + names.join(' and ') + '.' };
      var entries = recs.map(function (rec) { return { record: rec, state: readRecord(rec) }; });
      var first = Core.renderContext(q, entries, options({})).data, labels = {};
      first.timeline.concat(first.unavailable).forEach(function (x) { labels[x.id] = x.label; });
      held = { token: 't' + (++serial) + '-' + nowMs().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36), q: q, names: names, entries: entries, labels: labels, changed: {},
        bindings: recs.map(binding).sort().join(' ') };
      var r = rows(held);
      return { ok: true, token: held.token, query: names, sources: r.sources, counts: r.counts };
    }
    function render(req) {
      var H = held;
      if (!H || !req.token || req.token !== H.token) return { ok: false, reason: 'expired', message: 'This list is no longer current. Choose the tag again.' };
      var l = index();
      if (!l.index) { held = null; return { ok: false, reason: 'index', message: l.error }; }
      /* the tags themselves may have been changed in contexta meanwhile (a rename, a merge, a tag taken off) */
      var recs = Core.resolve(l.index, H.q.tags.map(function (t) { return t.key; }));
      if (recs.map(binding).sort().join(' ') !== H.bindings) {
        held = null;
        return { ok: false, reason: 'index-changed', message: 'Tags were changed in contexta after this list was shown. Choose the tag again.', tags: tagsOf(l.index) };
      }
      var want = {}; (Array.isArray(req.selected) ? req.selected : []).forEach(function (id) { want[String(id)] = true; });
      var pick = H.entries.filter(function (e) { return want[e.record.id]; });
      if (!pick.length) return { ok: false, reason: 'none-selected', message: 'Tick at least one source.' };
      /* read the ticked sources again: what is given must be what is saved at this moment, and what was listed */
      var again = pick.map(function (e) { return { record: e.record, state: readRecord(e.record) }; }), byId = {}, changed = {};
      again.forEach(function (e, i) { byId[e.record.id] = e; if (print(e) !== print(pick[i])) changed[e.record.id] = true; });
      var n = Object.keys(changed).length;
      if (n) {
        H.entries = H.entries.map(function (e) { return byId[e.record.id] || e; }); H.changed = changed;
        var r = rows(H);
        return { ok: false, reason: 'changed', token: H.token, sources: r.sources, counts: r.counts, changed: Object.keys(changed).map(function (id) { return H.labels[id] || 'a source'; }),
          message: Object.keys(changed).map(function (id) { return H.labels[id] || 'a source'; }).join(', ') + ' changed after ' + (n === 1 ? 'it was' : 'they were') + ' listed. Check ' + (n === 1 ? 'it' : 'them') + ', then press again.' };
      }
      H.changed = {};
      var readable0 = pick.filter(function (e) { return e.state.status === 'ok'; }).length;
      if (!readable0) return { ok: false, reason: 'nothing-readable', message: 'None of the ticked sources can be read now, so there is nothing to give.' };
      var body = Core.renderContext(H.q, pick, options({ labels: H.labels, scope: pick.length < H.entries.length ? { selected: pick.length, total: H.entries.length } : null })).markdown;
      var readable = readable0, text = BEGIN + '\n' + body.replace(/\s+$/, '') + '\n' + END;
      /* a browser takes at most 1 MB from a local helper in one answer; a draft that long is no use in a chat either */
      if (text.length > (opts.maxText || MAX_TEXT)) return { ok: false, reason: 'too-large', message: 'These sources are too long to hand over in one piece (' + Math.round(text.length / 1000) + ' thousand characters). Untick some of them.' };
      return { ok: true, text: text, count: pick.length, readable: readable, of: H.entries.length, tag: H.names.join(' and ') };
    }
    function handle(req) {
      req = req || {};
      var out;
      if (req.op === 'open') out = open();
      else if (req.op === 'lookup') out = lookup(req);
      else if (req.op === 'render') out = render(req);
      else if (req.op === 'done') { held = null; out = { ok: true }; }
      else out = { ok: false, reason: 'unknown', message: 'contexta does not know this request.' };
      if (req.id != null) out.id = req.id;
      return out;
    }
    return { handle: handle, holding: function () { return held ? { token: held.token, ids: held.entries.map(function (e) { return e.record.id; }) } : null; } };
  }

  /* the Mac app's five text-in, text-out functions, as the host the rules expect */
  function nativeHost(n) {
    function call(name, arg) { try { var r = JSON.parse(String(n[name](JSON.stringify(arg == null ? null : arg)))); return r && typeof r === 'object' ? r : { ok: false }; } catch (e) { return { ok: false }; } }
    if (typeof n.decodeText === 'function' && Read.setTextDecoder) Read.setTextDecoder(function (bytes, charset) { var r = call('decodeText', { bytes: bytes, charset: charset }); return r.ok && typeof r.text === 'string' ? r.text : null; });
    return { readIndex: function () { return call('readIndex'); }, readFile: function (path) { return call('readFile', { path: String(path) }); },
      readNote: function (id) { return call('readNote', { id: String(id) }); }, readMail: function (m) { return call('readMail', m); } };
  }

  /* for the shell: one engine, requests and answers as JSON text */
  var engine = null;
  function handleJson(text) {
    if (!engine) engine = create(typeof contextInsertNative !== 'undefined' ? nativeHost(contextInsertNative) : typeof contextInsertHost !== 'undefined' ? contextInsertHost : {});
    var req; try { req = JSON.parse(text); } catch (e) { return JSON.stringify({ ok: false, reason: 'unknown', message: 'not JSON' }); }
    return JSON.stringify(engine.handle(req));
  }
  return { create: create, handleJson: handleJson, nativeHost: nativeHost, MAX_TEXT: MAX_TEXT, lookupQuery: lookupQuery, BEGIN: BEGIN, END: END };
})(typeof WorkIndexCore !== 'undefined' ? WorkIndexCore : require('./rules.js'), typeof WorkIndexRead !== 'undefined' ? WorkIndexRead : require('./read.js'));
if (typeof module !== 'undefined' && module.exports) module.exports = ContextInsert;
