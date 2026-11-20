/* Work Index v9 — the operations shared by the command line, the connector and the local page.
 * Each lookup loads the index and reads the sources again; nothing is kept between calls. */
'use strict';
var Core = require('../../core/rules.js');
var Store = require('./store.js');
var Readers = require('./readers.js');
var Mac = require('./macos.js');

function macReader() { return Mac.isMac() ? { read: Mac.read } : null; }

function tag(home, desc, tagInput, opts) {
  var index = Store.load(home);
  opts = Object.assign({ now: Readers.localIso(Date.now()) }, opts || {});      /* capture time, in this computer's time zone */
  var r = Core.bind(index, desc, tagInput, opts);
  if (r.ok && r.status !== 'unchanged') Store.save(home, index);
  if (r.ok) r.total = Object.keys(index.objects).length;
  return r;
}
function tagInput(home, input, tagText, opts) {
  var d = Readers.describeInput(input, opts && opts.title);
  if (!d.ok) return { ok: false, error: { code: 'no-object', message: 'Could not tag that: ' + d.reason + '.' } };
  return tag(home, d.desc, tagText, opts);
}
/* find an entry by id, by file path or by link */
function findId(index, ref) {
  if (index.objects[ref]) return ref;
  var d = Readers.describeInput(ref);
  if (d.ok && index.objects[d.desc.id]) return d.desc.id;
  var byPath = Object.keys(index.objects).filter(function (k) { return index.objects[k].locator.value === ref; });
  return byPath.length === 1 ? byPath[0] : null;
}
function untag(home, ref, tagText) {
  var index = Store.load(home), id = findId(index, ref);
  if (!id) return { ok: false, error: { code: 'not-found', message: 'That source is not in the index.' } };
  var r = Core.unbind(index, id, tagText);
  if (r.ok && r.status !== 'unchanged') Store.save(home, index);
  return r;
}
function tags(home) { return Core.tagSummary(Store.load(home)); }

/* index only: which sources carry the tag. Sources are not opened (one cheap "is it still there" check each). */
function lookup(home, text) {
  var q = Core.parseLookup(text), index = Store.load(home);
  if (!q.tags.length) return { ok: false, error: { code: 'no-tag', message: 'Type a tag such as ::Cost.' }, known: Core.tagSummary(index).map(function (t) { return t.name; }) };
  var recs = Core.resolve(index, q.tags.map(function (t) { return t.key; })), av = {};
  recs.forEach(function (r) { av[r.id] = Readers.availability(r); });
  return { ok: true, query: q, records: recs, availability: av, text: Core.renderList(q, recs, av), known: Core.tagSummary(index).map(function (t) { return t.name; }) };
}
/* resolve, then read every linked source as it is saved right now, and lay them out by their own dates */
function context(home, text, opts) {
  opts = opts || {};
  var q = Core.parseLookup(text), index = Store.load(home);
  if (!q.tags.length) return { ok: false, error: { code: 'no-tag', message: 'Type a tag such as ::Cost.' } };
  var recs = Core.resolve(index, q.tags.map(function (t) { return t.key; })), changed = false;
  var entries = recs.map(function (r) {
    var state = Readers.readObject(r, { mac: macReader(), maxCellsPerSheet: opts.maxCellsPerSheet });
    if (state.observed && Core.refresh(index, r.id, state.observed)) changed = true;   /* same entry, now describing the current file */
    return { record: index.objects[r.id], state: state };
  });
  if (changed) { try { Store.save(home, index); } catch (e) { /* a read-only index still answers */ } }
  var out = Core.renderContext(q, entries, { maxCharsPerSource: opts.maxCharsPerSource, maxTotalChars: opts.maxTotalChars, includeQuoted: !!opts.includeQuoted, now: Readers.localIso(Date.now()), known: Core.tagSummary(index).map(function (t) { return t.name; }) });
  return { ok: true, query: q, markdown: out.markdown, data: out.data };
}
/* one source in full (larger limit), by its entry id */
function readOne(home, id, opts) {
  opts = opts || {};
  var index = Store.load(home), rec = index.objects[id];
  if (!rec) return { ok: false, error: { code: 'not-found', message: 'No entry with that id. Only sources in the index can be read.' } };
  var q = { tags: rec.tags.map(function (n) { return { name: n, key: Core.tagKey(n) }; }) };
  var state = Readers.readObject(rec, { mac: macReader(), maxCellsPerSheet: opts.maxCellsPerSheet || 20000 });
  if (state.observed && Core.refresh(index, id, state.observed)) { try { Store.save(home, index); } catch (e) { /* ignore */ } }
  var out = Core.renderContext(q, [{ record: index.objects[id], state: state }], { maxCharsPerSource: opts.maxCharsPerSource || 60000, maxTotalChars: 400000, now: Readers.localIso(Date.now()) });
  return { ok: true, markdown: out.markdown, data: out.data };
}
function list(home) {
  var index = Store.load(home);
  return Object.keys(index.objects).map(function (k) { return index.objects[k]; });
}
module.exports = { tag: tag, tagInput: tagInput, untag: untag, tags: tags, lookup: lookup, context: context, readOne: readOne, list: list, findId: findId };
