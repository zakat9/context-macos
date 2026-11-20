/* Context v9 — core rules (pure: no file, network or OS access).
 *
 * Model: a local tag points to a WHOLE source object (one email message, one note, one saved file such
 * as an entire workbook). The index is current-state only:
 *   - one entry (binding) per source object, found by a stable identifier, holding at most two tags
 *   - the entry stores a locator, a title, the source's own date and what kind of date that is, and
 *     the time the tag was captured. It never stores source content, excerpts, cell values, hashes,
 *     revisions or snapshots.
 *   - content is read from the source at lookup time and passed straight through; nothing is cached.
 */
var WorkIndexCore = (function () {
  'use strict';

  var VERSION = '0.12.2';
  var MAX_TAGS = 2;
  var LOOKUP_PREFIX = '::';
  var NAME_CHAR = /[\p{L}\p{M}\p{N}_-]/u;
  var NAME_ONLY = /^[\p{L}\p{M}\p{N}_-]+$/u;
  var HAS_LETTER = /\p{L}/u;
  var MAX_TAG_LENGTH = 40;

  /* ───────── tags ───────── */
  function tagKey(name) { return String(name).normalize('NFC').toLowerCase(); }

  /* one tag as typed in the tag field: "Cost", "::Cost" or "#Cost" */
  function cleanTag(raw) {
    var s = String(raw == null ? '' : raw).normalize('NFC').trim();
    if (s.indexOf(LOOKUP_PREFIX) === 0) s = s.slice(LOOKUP_PREFIX.length);
    else if (s.charAt(0) === '#' || s.charAt(0) === '\uFF03') s = s.slice(1);
    if (!s) return { ok: false, reason: 'empty', raw: String(raw) };
    if (s.length > MAX_TAG_LENGTH && Array.from(s).length > MAX_TAG_LENGTH) return { ok: false, reason: 'too-long', raw: String(raw) };
    if (!NAME_ONLY.test(s)) return { ok: false, reason: 'bad-character', raw: String(raw) };
    if (!HAS_LETTER.test(s)) return { ok: false, reason: 'needs-a-letter', raw: String(raw) };
    if (s.charAt(0) === '-') return { ok: false, reason: 'bad-character', raw: String(raw) };
    return { ok: true, name: s, key: tagKey(s) };
  }

  /* the tag field: tags separated by spaces or commas; duplicates collapse */
  function parseTagInput(input) {
    var parts = String(input == null ? '' : input).split(/[\s,\u3001\uFF0C]+/).filter(Boolean);
    var tags = [], errors = [], seen = {};
    parts.forEach(function (p) {
      var t = cleanTag(p);
      if (!t.ok) { errors.push(t); return; }
      if (seen[t.key]) return;
      seen[t.key] = 1; tags.push({ name: t.name, key: t.key });
    });
    return { tags: tags, errors: errors };
  }

  /* a chat message or lookup field: every "::Name" that starts a word.
     "std::vector" or "a::b" are not lookups; "::" alone is not a lookup. */
  function parseLookup(text) {
    var s = String(text == null ? '' : text).normalize('NFC');
    var re = /(^|[\s(\[{"'\u201C\u2018,;])::([\p{L}\p{M}\p{N}_-]+)/gu, m, tags = [], seen = {};
    while ((m = re.exec(s))) {
      var t = cleanTag(m[2]);
      if (t.ok && !seen[t.key]) { seen[t.key] = 1; tags.push({ name: t.name, key: t.key }); }
    }
    return { tags: tags };
  }

  /* ───────── identity ───────── */
  var TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|ref_url|_hsenc|_hsmi|vero_id|yclid)$/i;

  /* A web link becomes a stable identifier: the same message, sheet or page opened through different
     links (labels, tabs within a workbook, tracking parameters) is one object. */
  function describeUrl(input, title) {
    var u;
    try { u = new URL(String(input).trim()); } catch (e) { return { ok: false, reason: 'not-a-link' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'unsupported-link' };
    var host = u.hostname.toLowerCase(), path = u.pathname, m;
    var kind = 'page', id = null, canonical = null;
    if (host === 'docs.google.com' && (m = path.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/))) {
      kind = 'workbook'; id = 'gsheet:' + m[1]; canonical = 'https://docs.google.com/spreadsheets/d/' + m[1];
    } else if (host === 'docs.google.com' && (m = path.match(/^\/(document|presentation)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/))) {
      kind = m[1] === 'document' ? 'note' : 'file'; id = 'gdoc:' + m[2]; canonical = 'https://docs.google.com/' + m[1] + '/d/' + m[2];
    } else if (host === 'mail.google.com') {
      var seg = u.hash.replace(/^#/, '').split('?')[0].split('/').filter(Boolean);
      var token = seg.length > 1 ? seg[seg.length - 1] : '';
      if (!token || token.length < 10) return { ok: false, reason: 'not-one-message' };   /* an inbox or a search, not a message */
      kind = 'email'; id = 'gmail:' + token; canonical = 'https://mail.google.com/mail/u/0/#all/' + token;
    } else {
      var keep = [];
      u.searchParams.forEach(function (v, k) { if (!TRACKING.test(k)) keep.push([k, v]); });
      var q = keep.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&');
      var port = u.port ? ':' + u.port : '';
      canonical = u.protocol + '//' + host + port + (path.replace(/\/+$/, '') || '/') + (q ? '?' + q : '');
      if (/(^|\.)outlook\.(office|live)\.com$|(^|\.)outlook\.office365\.com$/.test(host) && /\/mail\//.test(path)) kind = 'email';
      else if (/(^|\.)notion\.so$|(^|\.)notion\.site$/.test(host)) kind = 'note';
      id = 'url:' + canonical;
    }
    return { ok: true, desc: { id: id, kind: kind, title: cleanTitle(title) || canonical, locator: { type: 'url', value: canonical },
      sourceTime: null, sourceTimeType: 'unknown', sourceCreated: null } };
  }

  var EXT_KIND = { eml: 'email', xlsx: 'workbook', xlsm: 'workbook', xls: 'workbook', csv: 'workbook', tsv: 'workbook', numbers: 'workbook', ods: 'workbook',
    md: 'note', markdown: 'note', txt: 'note', text: 'note' };
  function kindForPath(p) {
    var m = String(p).match(/\.([A-Za-z0-9]+)$/);
    return (m && EXT_KIND[m[1].toLowerCase()]) || 'file';
  }
  function fileId(realPath) { return 'file:' + String(realPath).normalize('NFC'); }
  function messageId(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/^<|>$/g, '').trim();
    return s ? 'mid:' + s : null;
  }
  var TITLE_AS_IS = /^\S(?:[^\s\u0000-\u001F\u007F\u2028\u2029]| (?! ))*$/;
  function cleanTitle(t) { if (typeof t === 'string' && t.length <= 200 && TITLE_AS_IS.test(t) && t.charAt(t.length - 1) !== ' ') return t; return String(t == null ? '' : t).replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }
  function oneLine(t) { return String(t == null ? '' : t).replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ').trim(); }

  /* ───────── index (current state only) ───────── */
  var RECORD_FIELDS = ['id', 'kind', 'title', 'tags', 'tagKeys', 'locator', 'sourceTime', 'sourceTimeType', 'sourceCreated', 'capturedAt', 'updatedAt'];
  var DATE_TYPES = { sent: 1, created: 1, modified: 1, 'modified-only': 1, unknown: 1 };

  function emptyIndex() { return { schema: 1, app: 'work-index', objects: {} }; }

  /* keep only known fields: nothing else can ride along in the index */
  function sanitizeRecord(r, seen) {
    if (!r || typeof r.id !== 'string' || !r.id || !r.locator || typeof r.locator.value !== 'string') return null;
    var list = Array.isArray(r.tags) ? r.tags : [], tags = [], plain = true, i;
    for (i = 0; i < list.length; i++) if (typeof list[i] !== 'string' || /[\s,\u3001\uFF0C]/.test(list[i])) { plain = false; break; }
    if (plain) {                                   /* the usual case: each stored tag is one name; `seen` saves checking the same name again within one load */
      for (i = 0; i < list.length && tags.length < MAX_TAGS; i++) {
        var c = seen ? seen.get(list[i]) : undefined;
        if (!c) { c = cleanTag(list[i]); if (seen) seen.set(list[i], c); }
        if (c.ok && !(tags.length && tags[0].key === c.key)) tags.push({ name: c.name, key: c.key });
      }
    } else tags = parseTagInput(list.join(' ')).tags.slice(0, MAX_TAGS);
    if (!tags.length) return null;
    var loc = { type: String(r.locator.type || 'file'), value: r.locator.value };
    if (r.locator.extra && typeof r.locator.extra === 'object') {
      loc.extra = {};
      ['account', 'mailbox', 'numericId'].forEach(function (k) { if (r.locator.extra[k] != null) loc.extra[k] = String(r.locator.extra[k]); });
    }
    return { id: r.id, kind: String(r.kind || 'file'), title: cleanTitle(r.title) || '(untitled)', tags: tags.map(function (t) { return t.name; }),
      tagKeys: tags.map(function (t) { return t.key; }), locator: loc,
      sourceTime: validIso(r.sourceTime), sourceTimeType: DATE_TYPES[r.sourceTimeType] ? r.sourceTimeType : 'unknown',
      sourceCreated: validIso(r.sourceCreated), capturedAt: validIso(r.capturedAt), updatedAt: validIso(r.updatedAt) };
  }
  var ISO_USUAL = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
  function validIso(s) { return typeof s !== 'string' ? null : (ISO_USUAL.test(s) && (s.slice(8, 10) < '29' || !isNaN(Date.parse(s)))) || !isNaN(Date.parse(s)) ? s : null; }

  function loadIndex(json) {
    var raw = typeof json === 'string' ? JSON.parse(json) : json;
    if (!raw || typeof raw !== 'object' || !raw.objects || typeof raw.objects !== 'object') throw new Error('not a Context file');
    var idx = emptyIndex();
    var seen = new Map(), all = raw.objects;
    for (var k in all) if (Object.prototype.hasOwnProperty.call(all, k)) { var r = sanitizeRecord(all[k], seen); if (r) idx.objects[r.id] = r; }
    return idx;
  }
  function dumpIndex(index) {
    var out = emptyIndex();
    var lines = [];
    Object.keys(index.objects).sort().forEach(function (k) { var r = sanitizeRecord(index.objects[k]); if (r) lines.push(JSON.stringify(k) + ':' + JSON.stringify(r)); });
    return '{"schema":' + out.schema + ',"app":' + JSON.stringify(out.app) + ',"objects":{\n' + lines.join(',\n') + '\n}}\n';     /* one entry per line */
  }

  /* Bind tags to a source object. Same object (same stable id) → same entry, never a second one.
     A third tag is refused, not dropped. */
  function bind(index, desc, tagInput, opts) {
    opts = opts || {};
    var now = opts.now || new Date().toISOString();
    if (!desc || !desc.id) return { ok: false, error: { code: 'no-object', message: 'There is no source object to tag.' } };
    var parsed = Array.isArray(tagInput) ? parseTagInput(tagInput.join(' ')) : parseTagInput(tagInput);
    if (parsed.errors.length) return { ok: false, error: { code: 'bad-tag', message: tagErrorText(parsed.errors[0]), details: parsed.errors } };
    if (!parsed.tags.length) return { ok: false, error: { code: 'no-tag', message: 'Type one or two tags.' } };
    var existing = index.objects[desc.id] || null;
    var next = opts.replace || !existing ? [] : existing.tags.map(function (n) { return { name: n, key: tagKey(n) }; });
    parsed.tags.forEach(function (t) { if (!next.some(function (x) { return x.key === t.key; })) next.push(t); });
    if (next.length > MAX_TAGS) {
      return { ok: false, error: { code: 'too-many-tags', current: existing ? existing.tags.slice() : [], requested: parsed.tags.map(function (t) { return t.name; }),
        message: 'A source can carry at most ' + MAX_TAGS + ' tags. ' + (existing && existing.tags.length ?
          'It already has ' + existing.tags.map(function (t) { return LOOKUP_PREFIX + t; }).join(' ') + '. Remove one first, or replace them.' :
          'You typed ' + parsed.tags.length + '. Nothing was tagged.') } };
    }
    var rec = sanitizeRecord({ id: desc.id, kind: desc.kind, title: desc.title, locator: desc.locator,
      tags: next.map(function (t) { return t.name; }), sourceTime: desc.sourceTime, sourceTimeType: desc.sourceTimeType, sourceCreated: desc.sourceCreated,
      capturedAt: existing ? existing.capturedAt : now, updatedAt: now });
    var status = !existing ? 'created' : (sameBinding(existing, rec) ? 'unchanged' : 'updated');
    if (status === 'unchanged') rec.updatedAt = existing.updatedAt;
    index.objects[rec.id] = rec;
    return { ok: true, status: status, record: rec };
  }
  function sameBinding(a, b) {
    return a.title === b.title && a.kind === b.kind && a.tagKeys.join('\u0001') === b.tagKeys.join('\u0001') && a.locator.value === b.locator.value &&
      a.sourceTime === b.sourceTime && a.sourceTimeType === b.sourceTimeType && a.sourceCreated === b.sourceCreated;
  }
  function tagErrorText(e) {
    var why = { 'too-long': 'is longer than ' + MAX_TAG_LENGTH + ' characters', 'bad-character': 'has a character that cannot be in a tag (use letters, digits, - or _)',
      'needs-a-letter': 'needs at least one letter', empty: 'is empty' }[e.reason] || 'cannot be used';
    return '“' + e.raw + '” ' + why + '. Nothing was tagged.';
  }

  /* remove some tags, or the whole binding; a binding without tags does not exist */
  function unbind(index, id, tagInput) {
    var rec = index.objects[id];
    if (!rec) return { ok: false, error: { code: 'not-found', message: 'That source is not in the index.' } };
    if (tagInput == null || (Array.isArray(tagInput) && !tagInput.length) || tagInput === '') { delete index.objects[id]; return { ok: true, status: 'removed' }; }
    var p = Array.isArray(tagInput) ? parseTagInput(tagInput.join(' ')) : parseTagInput(tagInput);
    var drop = {}; p.tags.forEach(function (t) { drop[t.key] = 1; });
    var left = rec.tags.filter(function (n) { return !drop[tagKey(n)]; });
    if (left.length === rec.tags.length) return { ok: true, status: 'unchanged', record: rec };
    if (!left.length) { delete index.objects[id]; return { ok: true, status: 'removed' }; }
    rec.tags = left; rec.tagKeys = left.map(tagKey); rec.updatedAt = new Date().toISOString();
    return { ok: true, status: 'updated', record: rec };
  }

  /* The source was looked at again: overwrite the entry's title and date with what it is now.
     Same entry; the previous values are gone (no history). */
  function refresh(index, id, observed) {
    var rec = index.objects[id];
    if (!rec || !observed) return false;
    var before = JSON.stringify([rec.title, rec.sourceTime, rec.sourceTimeType, rec.sourceCreated]);
    if (observed.title) rec.title = cleanTitle(observed.title) || rec.title;
    if (observed.sourceTimeType) {
      rec.sourceTime = validIso(observed.sourceTime);
      rec.sourceTimeType = DATE_TYPES[observed.sourceTimeType] ? observed.sourceTimeType : 'unknown';
      rec.sourceCreated = validIso(observed.sourceCreated);
    }
    return before !== JSON.stringify([rec.title, rec.sourceTime, rec.sourceTimeType, rec.sourceCreated]);
  }

  /* all objects carrying every one of the given tags */
  function resolve(index, tagKeys) {
    if (!tagKeys || !tagKeys.length) return [];
    return Object.keys(index.objects).map(function (k) { return index.objects[k]; })
      .filter(function (r) { return tagKeys.every(function (k) { return r.tagKeys.indexOf(k) >= 0; }); });
  }
  function tagSummary(index) {
    var by = {};
    Object.keys(index.objects).forEach(function (k) {
      var r = index.objects[k];
      r.tags.forEach(function (name) { var key = tagKey(name); var t = by[key] = by[key] || { key: key, name: name, count: 0, latest: '' }; t.count++; if ((r.updatedAt || '') > t.latest) t.latest = r.updatedAt || ''; });
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.latest > b.latest ? -1 : a.latest < b.latest ? 1 : (a.key < b.key ? -1 : 1); });
  }

  /* ───────── rename a tag everywhere ─────────
     Only the index changes: in every entry that carries the tag, that one name is replaced. Nothing else of an entry
     is touched (its id, its other tag, its dates, where it points), no entry is added or removed, and no source is
     opened. If the new name is already in use, this is a merge: an entry that carries both keeps one copy.

     planRename describes what would happen and changes nothing. applyRename builds a NEW index from a plan and leaves
     the one it was given as it was, so a failed save leaves nothing half done. */
  function renameErrorText(e) {
    var why = { 'too-long': 'is longer than ' + MAX_TAG_LENGTH + ' characters', 'bad-character': 'has a character that cannot be in a tag (use letters, digits, - or _, and no spaces)',
      'needs-a-letter': 'needs at least one letter', empty: 'is empty' }[e.reason] || 'cannot be used';
    return '“' + e.raw + '” ' + why + '.';
  }
  function planRename(index, fromInput, toInput) {
    var f = cleanTag(fromInput), raw = String(toInput == null ? '' : toInput).normalize('NFC').trim();
    if (!f.ok) return { ok: false, code: 'no-tag', message: 'Choose the tag to rename.' };
    if (!raw) return { ok: false, code: 'empty', message: 'Type the new name.' };
    var t = cleanTag(raw);
    if (!t.ok) return { ok: false, code: 'bad-name', message: renameErrorText(t) };
    var ids = Object.keys(index.objects), carriers = [], destination = [], shown = '', destinationShown = '';
    ids.forEach(function (id) {
      var r = index.objects[id], i = r.tagKeys.indexOf(f.key), j = r.tagKeys.indexOf(t.key);
      if (i >= 0) { carriers.push(r); if (!shown) shown = r.tags[i]; }
      if (j >= 0) { destination.push(r); if (!destinationShown) destinationShown = r.tags[j]; }
    });
    if (!carriers.length) return { ok: false, code: 'unknown-tag', message: 'No source has the tag ' + f.name + '.' };
    var plan = { ok: true, from: { name: shown, key: f.key }, typed: raw };
    if (f.key === t.key) {
      /* the same tag, written differently (capitals): only the spelling shown changes */
      var differ = carriers.filter(function (r) { return r.tags[r.tagKeys.indexOf(f.key)] !== t.name; });
      if (!differ.length) return { ok: false, code: 'no-op', message: 'That is already its name. Nothing to rename.' };
      plan.mode = 'respell'; plan.to = { name: t.name, key: t.key };
      plan.sources = carriers.length; plan.changes = differ.length; plan.alreadyHave = 0; plan.destinationBefore = carriers.length; plan.destinationAfter = carriers.length;
    } else {
      var both = carriers.filter(function (r) { return r.tagKeys.indexOf(t.key) >= 0; });
      plan.mode = destination.length ? 'merge' : 'rename';
      plan.to = { name: destination.length ? destinationShown : t.name, key: t.key };          /* an existing tag keeps the spelling it has */
      plan.sources = carriers.length; plan.changes = carriers.length; plan.alreadyHave = both.length;
      plan.destinationBefore = destination.length; plan.destinationAfter = destination.length + carriers.length - both.length;
    }
    plan.ids = carriers.map(function (r) { return r.id; });
    /* everything the numbers above rest on; if any of it is different at the moment of saving, the plan is void */
    plan.fingerprint = JSON.stringify([plan.mode, f.key, t.key, plan.to.name,
      carriers.map(function (r) { return [r.id, r.tags]; }), destination.map(function (r) { return [r.id, r.tags]; })]);
    return plan;
  }
  function applyRename(index, plan) {
    if (!plan || !plan.ok) return { ok: false, code: 'no-plan', message: 'There is nothing to rename.' };
    var out = emptyIndex(), changed = 0, merged = 0;
    Object.keys(index.objects).forEach(function (id) {
      var r = index.objects[id], i = r.tagKeys.indexOf(plan.from.key);
      if (i < 0) { out.objects[id] = r; return; }
      var names = r.tags.slice(), keys = r.tagKeys.slice(), keptNames = [], keptKeys = [];
      names[i] = plan.to.name; keys[i] = plan.to.key;
      keys.forEach(function (k, n) { if (keptKeys.indexOf(k) < 0) { keptKeys.push(k); keptNames.push(k === plan.to.key ? plan.to.name : names[n]); } });
      if (keptKeys.length < keys.length) merged++;
      if (keptNames.join('\u0001') !== r.tags.join('\u0001')) changed++;
      var copy = {}; Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
      copy.locator = r.locator; copy.tags = keptNames; copy.tagKeys = keptKeys;                 /* id, kind, title, locator and every date stay exactly as they were */
      out.objects[id] = copy;
    });
    return { ok: true, index: out, changed: changed, merged: merged };
  }

  /* ───────── dates ───────── */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* show the date in the offset it was written with (an email keeps the sender's offset) */
  function formatWhen(iso) {
    if (!iso) return 'date unknown';
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
    if (!m) return String(iso);
    var out = MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
    if (m[4] != null) out += ' ' + m[4] + ':' + m[5] + (m[6] ? ' (' + (m[6] === 'Z' ? 'UTC' : m[6].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2')) + ')' : '');
    return out;
  }
  var DATE_LABEL = {
    sent: 'sent',
    created: 'created',
    modified: 'last saved',
    'modified-only': 'last saved (file date only; no original date is known)',
    unknown: 'date unknown'
  };
  function toLocalIso(ms, offsetMinutes) {   /* offsetMinutes = minutes east of UTC */
    var d = new Date(ms + offsetMinutes * 60000), p = function (n, w) { return ('000' + n).slice(-(w || 2)); };
    var sign = offsetMinutes < 0 ? '-' : '+', a = Math.abs(offsetMinutes);
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) +
      sign + p(Math.floor(a / 60)) + ':' + p(a % 60);
  }

  /* ───────── timeline ─────────
     entries: [{record, state}] where state comes from reading the source just now:
       {status:'ok', content, observed} | {status:'unreadable', reason, observed} | {status:'external', reason} | {status:'unavailable', reason}
     One line per distinct source object, ordered by the source's own date. Saves inside a file are not events. */
  var KIND_LABEL = { email: 'Email', note: 'Note', workbook: 'Workbook', file: 'File', page: 'Web page' };
  var KIND_LETTER = { email: 'E', note: 'N', workbook: 'W', file: 'F', page: 'P' };

  function buildTimeline(entries, labels) {
    var present = [], unavailable = [];
    entries.forEach(function (e) {
      var o = (e.state && e.state.observed) || {};
      var item = { record: e.record, state: e.state, kind: e.record.kind, title: o.title || e.record.title,
        sourceTime: e.state.status === 'unavailable' ? null : (o.sourceTimeType ? validIso(o.sourceTime) : e.record.sourceTime),
        sourceTimeType: e.state.status === 'unavailable' ? 'unknown' : (o.sourceTimeType || e.record.sourceTimeType),
        sourceCreated: o.sourceTimeType ? validIso(o.sourceCreated) : e.record.sourceCreated };
      (e.state.status === 'unavailable' ? unavailable : present).push(item);
    });
    var dated = present.filter(function (x) { return x.sourceTime && x.sourceTimeType !== 'unknown'; });
    var undated = present.filter(function (x) { return !(x.sourceTime && x.sourceTimeType !== 'unknown'); });
    function byName(a, b) { return a.title < b.title ? -1 : a.title > b.title ? 1 : (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0); }
    dated.sort(function (a, b) { return (Date.parse(a.sourceTime) - Date.parse(b.sourceTime)) || byName(a, b); });
    undated.sort(byName);
    unavailable.sort(byName);
    var n = {};
    dated.concat(undated).forEach(function (x) { var L = KIND_LETTER[x.kind] || 'F'; n[L] = (n[L] || 0) + 1; x.label = (labels && labels[x.record.id]) || (L + n[L]); });
    unavailable.forEach(function (x, i) { x.label = (labels && labels[x.record.id]) || ('X' + (i + 1)); });
    return { dated: dated, undated: undated, unavailable: unavailable };
  }

  /* ───────── cloud folders ─────────
     Google Drive, Dropbox, OneDrive, Box and iCloud Drive keep their files in folders on this Mac (macOS's File
     Provider: ~/Library/CloudStorage/<Provider>-<account>/, iCloud Drive in ~/Library/Mobile Documents/). Context
     treats them as the saved files they are. Their folder names carry the account (for Google Drive the account's
     email address), so a file there is named by the service and its place inside it, never by that folder.
     → { provider, place, text } or null for a file that is not in a cloud folder. */
  var CLOUD_NAMES = { googledrive: 'Google Drive', dropbox: 'Dropbox', onedrive: 'OneDrive', box: 'Box', icloud: 'iCloud Drive' };
  function cloudPlace(p) {
    var s = String(p == null ? '' : p), m, provider, rest;
    if ((m = /^\/Users\/[^\/]+\/Library\/CloudStorage\/([^\/]+)\/(.*)$/.exec(s))) {
      var folder = m[1], key = folder.replace(/-.*$/, '').replace(/[^A-Za-z]/g, '').toLowerCase();
      provider = CLOUD_NAMES[key] || folder.replace(/-.*$/, '') || 'Cloud storage'; rest = m[2];
    } else if ((m = /^\/Users\/[^\/]+\/Library\/Mobile Documents\/com~apple~CloudDocs\/(.*)$/.exec(s))) { provider = 'iCloud Drive'; rest = m[1]; }
    else if ((m = /^\/Users\/[^\/]+\/Library\/Mobile Documents\/[^\/]+\/(.*)$/.exec(s))) { provider = 'iCloud Drive'; rest = m[1]; }
    else if ((m = /^\/Users\/[^\/]+\/Dropbox(?: \([^\/)]*\))?\/(.*)$/.exec(s))) { provider = 'Dropbox'; rest = m[1]; }
    else return null;
    var place = rest.split('/').filter(Boolean).join(' › ');
    return { provider: provider, place: place, text: provider + ' › ' + place };
  }
  /* Google Docs, Sheets, Slides… files: in a Google Drive folder they are only pointers; their text is online. */
  var GOOGLE_NATIVE = /\.(gdoc|gsheet|gslides|gdraw|gform|gmap|gsite|gjam|gtable|gscript)$/i;
  function isGoogleNative(p) { return GOOGLE_NATIVE.test(String(p == null ? '' : p)); }

  function locatorText(loc) {
    if (!loc) return '';
    if (loc.type === 'file') { var c = cloudPlace(loc.value); return c ? c.text + ' (cloud folder on this Mac)' : loc.value; }
    if (loc.type === 'apple-notes') return 'Apple Notes note ' + loc.value;
    if (loc.type === 'apple-mail') return 'Apple Mail message <' + loc.value + '>';
    return loc.value;
  }

  /* text of one source with citation anchors; truncation is always stated, never silent */
  function renderContent(item, max) {
    var c = item.state.content, lines = [], used = 0, cut = null, label = item.label;
    function push(s) { lines.push(s); used += s.length + 1; }
    if (!c) return { lines: [], cite: [] };
    if (c.type === 'email') {
      var h = c.headers || {};
      push('From: ' + oneLine(h.from || '(not stated)'));
      if (h.to) push('To: ' + oneLine(h.to));
      if (h.cc) push('Cc: ' + oneLine(h.cc));
      push('Subject: ' + oneLine(h.subject || '(no subject)'));
      if (h.messageId) push('Message-ID: <' + oneLine(h.messageId) + '>');
      if (c.attachments && c.attachments.length) push('Attachments (not read): ' + c.attachments.map(oneLine).join(', '));
      push('');
      var body = String(c.text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().split('\n');
      for (var i = 0; i < body.length; i++) { if (used + body[i].length > max) { cut = 'message text cut after ' + i + ' of ' + body.length + ' lines'; break; } push(body[i]); }
    } else if (c.type === 'text') {
      var tl = c.lines || [];
      for (var j = 0; j < tl.length; j++) { var s = 'L' + (j + 1) + ':' + (tl[j] === '' ? '' : ' ' + tl[j]); if (used + s.length > max) { cut = 'text cut after line ' + j + ' of ' + tl.length; break; } push(s); }
    } else if (c.type === 'workbook') {
      var sheets = c.sheets || [], stop = false;
      for (var k = 0; k < sheets.length && !stop; k++) {
        var sh = sheets[k];
        push('Sheet “' + oneLine(sh.name) + '”' + (sh.range ? ' (' + sh.range + ')' : ' (empty)') + (sh.hidden ? ' [hidden sheet]' : ''));
        for (var r = 0; r < sh.rows.length; r++) {
          var row = sh.rows[r].cells.map(function (cell) { return cell.ref + ': ' + oneLine(cell.v) + (cell.f ? ' (formula =' + oneLine(cell.f) + ')' : ''); }).join(' · ');
          var line = '[' + oneLine(sh.name) + '] ' + row;
          if (used + line.length > max) { cut = 'workbook cut at sheet “' + oneLine(sh.name) + '”, row ' + sh.rows[r].r + '; ' + (sheets.length - k - 1) + ' later sheet(s) not shown'; stop = true; break; }
          push(line);
        }
        if (sh.truncated) push('(sheet has more cells than were read: ' + sh.truncated + ')');
      }
    }
    if (cut) push('[' + label + ' truncated: ' + cut + '. Ask to read this source alone for the rest.]');
    return { lines: lines };
  }

  /* the citation example names a sheet and a cell that this workbook really has, not a made-up one */
  function firstCell(sheets) {
    for (var i = 0; i < (sheets || []).length; i++) { var rows = sheets[i].rows || []; if (rows.length && rows[0].cells && rows[0].cells.length) return oneLine(sheets[i].name) + '!' + rows[0].cells[0].ref; }
    return 'Sheet!A1';
  }
  function citationLine(item) {
    var c = item.state.content, base = '[' + item.label + '] ' + (KIND_LABEL[item.kind] || 'File') + ' — “' + oneLine(item.title) + '”';
    var when = item.sourceTime ? '; ' + DATE_LABEL[item.sourceTimeType] + ' ' + formatWhen(item.sourceTime) : '; date unknown';
    var extra = '';
    if (c && c.type === 'email') extra = '; from ' + oneLine((c.headers || {}).from || '?') + ((c.headers || {}).messageId ? '; Message-ID <' + oneLine(c.headers.messageId) + '>' : '') + '. Cite the message as [' + item.label + '].';
    else if (c && c.type === 'workbook') extra = '; sheets: ' + (c.sheets || []).map(function (s) { return oneLine(s.name) + (s.range ? ' ' + s.range : ''); }).join(', ') + '. Cite cells as [' + item.label + ' › ' + firstCell(c.sheets) + '].';
    else if (c && c.type === 'text') extra = '. Cite lines as [' + item.label + ' › L' + Math.max(1, Math.min(3, (c.lines || []).length)) + '].';
    else extra = '.';
    return base + when + extra + ' Where: ' + locatorText(item.record.locator);
  }

  /* The cross-source chronological context for one lookup, as text to show or paste and as data. */
  function renderContext(query, entries, opts) {
    opts = opts || {};
    var max = opts.maxCharsPerSource || 6000;
    var maxTotal = opts.maxTotalChars || 120000, usedTotal = 0, sizeSkipped = 0, sizeNoteAt = -1;   /* one answer stays a size a chat can take */
    var now = opts.now || new Date().toISOString();
    var tags = (query.tags || []).map(function (t) { return LOOKUP_PREFIX + t.name; }).join(' ');
    var tl = buildTimeline(entries, opts.labels), L = [];
    var readN = 0, notReadN = 0;
    tl.dated.concat(tl.undated).forEach(function (x) { if (x.state.status === 'ok') readN++; else notReadN++; });
    var total = tl.dated.length + tl.undated.length + tl.unavailable.length;
    L.push('# Context context for ' + tags);
    L.push('');
    if (!total) {
      L.push('No source is tagged ' + tags + ' in the local index.' + (opts.known && opts.known.length ? ' Tags in use: ' + opts.known.map(function (t) { return LOOKUP_PREFIX + t; }).join(' ') + '.' : ' The index is empty.'));
      return { markdown: L.join('\n') + '\n', data: { query: tags, generatedAt: now, counts: { total: 0, read: 0, notRead: 0, unavailable: 0, listedWithoutContents: 0 }, timeline: [], unavailable: [] } };
    }
    L.push('- ' + total + ' linked source' + (total === 1 ? '' : 's') + ': ' + readN + ' read just now, ' + notReadN + ' linked but not read here, ' + tl.unavailable.length + ' unavailable.');
    if (opts.scope) L.push('- This copy holds ' + opts.scope.selected + ' of the ' + opts.scope.total + ' sources linked to ' + tags + ', as chosen by the person who copied it. The others are not in it.');
    L.push('- Read at ' + formatWhen(now) + ' from this computer. Each source appears once, in its current saved form. Earlier versions are not kept, not shown and not reconstructed.');
    L.push('- Order: by each source\'s own date. “sent” is the date on a message. “last saved” is the date of the current saved version of a note or file, so its content may be newer than its position among earlier messages suggests. “file date only” means no other date is known.');
    L.push('- Lines starting with > are quoted from the source. Everything else is written by Context from dates and locators only.');
    sizeNoteAt = L.length;
    function section(item, idx) {
      var head = (idx != null ? (idx + 1) + '. ' : '') + (item.sourceTime ? formatWhen(item.sourceTime) + ' — ' + DATE_LABEL[item.sourceTimeType] : 'Date unknown') + ' — ' + (KIND_LABEL[item.kind] || 'File') + ' [' + item.label + ']';
      L.push(''); L.push('### ' + head);
      L.push('“' + oneLine(item.title) + '”' + (item.sourceCreated && item.sourceTimeType !== 'created' && item.sourceTimeType !== 'sent' ? ' (created ' + formatWhen(item.sourceCreated) + ')' : ''));
      if (item.state.status === 'ok' && maxTotal - usedTotal < 400) {
        sizeSkipped++; item.quoted = []; item.omitted = true;
        L.push('Contents not quoted here: this answer reached its size limit. The source is readable; read it on its own. Where: ' + locatorText(item.record.locator));
      } else if (item.state.status === 'ok') {
        var rc = renderContent(item, Math.min(max, maxTotal - usedTotal));
        item.quoted = rc.lines;
        rc.lines.forEach(function (s) { usedTotal += s.length + 3; });
        L.push('');
        rc.lines.forEach(function (s) { L.push(s === '' ? '>' : '> ' + s); });
      } else {
        L.push('Not read here: ' + oneLine(item.state.reason || 'no reader for this kind of source') + '. Where: ' + locatorText(item.record.locator));
      }
    }
    if (tl.dated.length) { L.push(''); L.push('## Timeline (one entry per source, by its own date)'); tl.dated.forEach(function (x, i) { section(x, i); }); }
    if (tl.undated.length) { L.push(''); L.push('## Date unknown (not placed in the order)'); tl.undated.forEach(function (x) { section(x, null); }); }
    if (tl.unavailable.length) {
      L.push(''); L.push('## Unavailable (linked, but could not be read now; no earlier content is shown)');
      tl.unavailable.forEach(function (x) {
        L.push('- [' + x.label + '] ' + (KIND_LABEL[x.kind] || 'File') + ' “' + oneLine(x.record.title) + '” — ' + oneLine(x.state.reason || 'not accessible') + '. Tagged ' + formatWhen(x.record.capturedAt) + '. Where it was: ' + locatorText(x.record.locator));
      });
    }
    if (sizeSkipped) L.splice(sizeNoteAt, 0, '- ' + sizeSkipped + ' of the sources read are listed without their contents, because one answer is limited to about ' + maxTotal + ' characters of quoted text. Narrow the lookup with a second tag, or read those sources one at a time.');
    L.push(''); L.push('## Citations');
    tl.dated.concat(tl.undated).forEach(function (x) { L.push('- ' + citationLine(x)); });
    var data = { query: tags, generatedAt: now,
      counts: { total: total, read: readN, notRead: notReadN, unavailable: tl.unavailable.length, listedWithoutContents: sizeSkipped },
      timeline: tl.dated.concat(tl.undated).map(function (x) {
        return { label: x.label, id: x.record.id, kind: x.kind, title: x.title, tags: x.record.tags, sourceTime: x.sourceTime, sourceTimeType: x.sourceTimeType,
          sourceCreated: x.sourceCreated, capturedAt: x.record.capturedAt, locator: x.record.locator, status: x.state.status, reason: x.state.reason || null, contents: x.state.status !== 'ok' ? 'not-read' : x.omitted ? 'omitted-for-size' : 'quoted',
          when: x.sourceTime ? formatWhen(x.sourceTime) : null, dateLabel: DATE_LABEL[x.sourceTimeType], created: x.sourceCreated ? formatWhen(x.sourceCreated) : null,
          quoted: opts.includeQuoted ? (x.quoted || []) : undefined };
      }),
      unavailable: tl.unavailable.map(function (x) { return { label: x.label, id: x.record.id, kind: x.kind, title: x.record.title, tags: x.record.tags, capturedAt: x.record.capturedAt, tagged: formatWhen(x.record.capturedAt), locator: x.record.locator, reason: x.state.reason || null }; }) };
    return { markdown: L.join('\n') + '\n', data: data };
  }

  /* index-only answer: which sources carry the tag(s). No source is opened for this. */
  function renderList(query, records, availability) {
    var tags = (query.tags || []).map(function (t) { return LOOKUP_PREFIX + t.name; }).join(' ');
    var rows = records.slice().sort(function (a, b) {
      var x = a.sourceTime ? Date.parse(a.sourceTime) : Infinity, y = b.sourceTime ? Date.parse(b.sourceTime) : Infinity;
      return x - y || (a.title < b.title ? -1 : 1);
    });
    var L = [tags + ': ' + rows.length + ' linked source' + (rows.length === 1 ? '' : 's') + ' (from the index; sources not opened; dates are as recorded when each source was last read)'];
    rows.forEach(function (r) {
      var av = availability && availability[r.id];
      var gone = /^unavailable/.test(String(av || ''));
      L.push('- ' + (KIND_LABEL[r.kind] || 'File') + ' “' + oneLine(r.title) + '” — ' + (gone ? 'no date shown' : r.sourceTime ? DATE_LABEL[r.sourceTimeType] + ' ' + formatWhen(r.sourceTime) : 'date unknown') +
        ' — tags ' + r.tags.map(function (t) { return LOOKUP_PREFIX + t; }).join(' ') + (av ? ' — ' + av : '') + ' — id ' + r.id);
    });
    return L.join('\n') + '\n';
  }

  /* ───────── macOS: what is the active object? (AppleScript sources; they only read) ─────────
     One small script per app, compiled only when that app is in front. Fields are joined with U+001F.
     These are run by lib/macos.js; they are data here so there is a single place to review them. */
  var SEP = '\u001F';
  var J = '(character id 31)'; // built into AppleScript: no Apple event ("ASCII character" is a scripting addition and sends one)
  var APPLESCRIPT = {
    'com.apple.mail':
      'with timeout of 5 seconds\n tell application id "com.apple.mail"\n  set sel to selection\n  if (count of sel) is not 1 then return "ERR" & ' + J + ' & "Select exactly one message in Mail."\n' +
      '  set m to item 1 of sel\n  set mb to mailbox of m\n' +
      '  return "email" & ' + J + ' & (message id of m) & ' + J + ' & (subject of m) & ' + J + ' & ((date sent of m) as «class isot» as string) & ' + J + ' & (name of account of mb) & ' + J + ' & (name of mb) & ' + J + ' & ((id of m) as string)\n end tell\nend timeout',
    'com.apple.Notes':
      'with timeout of 5 seconds\n tell application id "com.apple.Notes"\n  set sel to selection\n  if (count of sel) is not 1 then return "ERR" & ' + J + ' & "Select exactly one note in Notes."\n' +
      '  set n to item 1 of sel\n  if password protected of n then return "ERR" & ' + J + ' & "Locked notes are not tagged."\n' +
      '  return "note" & ' + J + ' & (id of n) & ' + J + ' & (name of n) & ' + J + ' & ((modification date of n) as «class isot» as string) & ' + J + ' & ((creation date of n) as «class isot» as string)\n end tell\nend timeout',
    'com.apple.finder':
      'with timeout of 5 seconds\n tell application id "com.apple.finder"\n  set sel to selection as alias list\n  if (count of sel) is not 1 then return "ERR" & ' + J + ' & "Select exactly one file in Finder."\n' +
      '  return "path" & ' + J + ' & (POSIX path of (item 1 of sel))\n end tell\nend timeout',
    'com.microsoft.Excel':
      'with timeout of 5 seconds\n tell application id "com.microsoft.Excel"\n  return "path" & ' + J + ' & (full name of active workbook)\n end tell\nend timeout',
    'com.microsoft.Word':
      'with timeout of 5 seconds\n tell application id "com.microsoft.Word"\n  return "path" & ' + J + ' & (full name of active document)\n end tell\nend timeout',
    'com.microsoft.Powerpoint':
      'with timeout of 5 seconds\n tell application id "com.microsoft.Powerpoint"\n  return "path" & ' + J + ' & (full name of active presentation)\n end tell\nend timeout',
    safari:
      'with timeout of 5 seconds\n tell application id "com.apple.Safari"\n  return "url" & ' + J + ' & (URL of front document) & ' + J + ' & (name of front document)\n end tell\nend timeout',
    chromium:
      'with timeout of 5 seconds\n tell application id "__BID__"\n  return "url" & ' + J + ' & (URL of active tab of front window) & ' + J + ' & (title of active tab of front window)\n end tell\nend timeout',
    document:
      'with timeout of 5 seconds\n tell application id "__BID__"\n  set f to file of front document\n  if f is missing value then return "ERR" & ' + J + ' & "Save the document first: only saved files can be tagged."\n  return "path" & ' + J + ' & (POSIX path of (f as alias))\n end tell\nend timeout',
    readNote:
      'with timeout of 8 seconds\n tell application id "com.apple.Notes"\n  set n to note id "__ID__"\n  if password protected of n then return "ERR" & ' + J + ' & "The note is locked."\n' +
      '  return "note" & ' + J + ' & (name of n) & ' + J + ' & ((modification date of n) as «class isot» as string) & ' + J + ' & ((creation date of n) as «class isot» as string) & ' + J + ' & (plaintext of n)\n end tell\nend timeout',
    readMail:
      'with timeout of 8 seconds\n tell application id "com.apple.mail"\n  set m to first message of mailbox "__MAILBOX__" of account "__ACCOUNT__" whose id is __NUMID__\n' +
      '  return "email" & ' + J + ' & (message id of m) & ' + J + ' & (subject of m) & ' + J + ' & ((date sent of m) as «class isot» as string) & ' + J + ' & (sender of m) & ' + J + ' & (content of m)\n end tell\nend timeout'
  };
  var CHROMIUM_BROWSERS = /^(com\.google\.Chrome(\..+)?|com\.microsoft\.edgemac(\..+)?|com\.brave\.Browser(\..+)?|company\.thebrowser\.Browser|com\.vivaldi\.Vivaldi|org\.chromium\.Chromium)$/;
  var DOCUMENT_APPS = /^(com\.apple\.iWork\.(Numbers|Pages|Keynote)|com\.apple\.Preview|com\.apple\.TextEdit|com\.microsoft\.(Word|Powerpoint))$/;

  function asEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' '); }
  function scriptForApp(bundleId, extraChromiumIds) {
    var b = String(bundleId || '');
    if (!/^[A-Za-z0-9.-]+$/.test(b)) return null;
    if ((extraChromiumIds || []).indexOf(b) >= 0) return APPLESCRIPT.chromium.replace('__BID__', b);
    if (APPLESCRIPT[b]) return APPLESCRIPT[b];
    if (b === 'com.apple.Safari') return APPLESCRIPT.safari;
    if (CHROMIUM_BROWSERS.test(b)) return APPLESCRIPT.chromium.replace('__BID__', b);
    if (DOCUMENT_APPS.test(b)) return APPLESCRIPT.document.replace('__BID__', b);
    return null;
  }
  function scriptForRead(locator) {
    if (locator.type === 'apple-notes') {
      if (!/^x-coredata:\/\/[A-Za-z0-9\-\/]+$/.test(locator.value)) return null;
      return APPLESCRIPT.readNote.replace('__ID__', asEscape(locator.value));
    }
    if (locator.type === 'apple-mail') {
      var x = locator.extra || {};
      if (!x.account || !x.mailbox || !/^\d+$/.test(String(x.numericId || ''))) return null;
      return APPLESCRIPT.readMail.replace('__MAILBOX__', asEscape(x.mailbox)).replace('__ACCOUNT__', asEscape(x.account)).replace('__NUMID__', String(x.numericId));
    }
    return null;
  }
  /* AppleScript "as «class isot»" gives local time without an offset; attach the machine's offset */
  function isotToIso(s, offsetMinutes) {
    var m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    if (!m) return null;
    var sign = offsetMinutes < 0 ? '-' : '+', a = Math.abs(offsetMinutes), p = function (n) { return ('0' + n).slice(-2); };
    return m[1] + 'T' + m[2] + sign + p(Math.floor(a / 60)) + ':' + p(a % 60);
  }
  /* turn the script's reply into an object description, or into a path/link for the caller to describe */
  function parseActive(reply, offsetMinutes) {
    var f = String(reply == null ? '' : reply).replace(/[\r\n]+$/, '').split(SEP);
    if (f[0] === 'ERR') return { ok: false, reason: f[1] || 'Nothing to tag.' };
    if (f[0] === 'path' && f[1]) return { ok: true, path: f[1] };
    if (f[0] === 'url' && f[1]) return { ok: true, url: f[1], title: f[2] || '' };
    if (f[0] === 'email' && f[1]) {
      return { ok: true, desc: { id: messageId(f[1]), kind: 'email', title: cleanTitle(f[2]) || '(no subject)',
        locator: { type: 'apple-mail', value: f[1].replace(/^<|>$/g, ''), extra: { account: f[4] || '', mailbox: f[5] || '', numericId: f[6] || '' } },
        sourceTime: isotToIso(f[3], offsetMinutes), sourceTimeType: isotToIso(f[3], offsetMinutes) ? 'sent' : 'unknown', sourceCreated: null } };
    }
    if (f[0] === 'note' && f[1]) {
      return { ok: true, desc: { id: 'applenotes:' + f[1], kind: 'note', title: cleanTitle(f[2]) || '(untitled note)', locator: { type: 'apple-notes', value: f[1] },
        sourceTime: isotToIso(f[3], offsetMinutes), sourceTimeType: isotToIso(f[3], offsetMinutes) ? 'modified' : 'unknown', sourceCreated: isotToIso(f[4], offsetMinutes) } };
    }
    return { ok: false, reason: 'The app in front did not report a single object.' };
  }

  /* ───────── the Mac app: which apps can be asked for their one selected (or open, saved) object ───────── */
  var SELECTION_APPS = { 'com.apple.Notes': 'Notes', 'com.apple.mail': 'Mail', 'com.apple.finder': 'Finder', 'com.microsoft.Excel': 'Excel',
    'com.microsoft.Word': 'Word', 'com.microsoft.Powerpoint': 'PowerPoint', 'com.apple.iWork.Numbers': 'Numbers', 'com.apple.iWork.Pages': 'Pages',
    'com.apple.iWork.Keynote': 'Keynote', 'com.apple.Preview': 'Preview', 'com.apple.TextEdit': 'TextEdit' };
  var SELECTION_NOUN = { 'com.apple.Notes': 'note', 'com.apple.mail': 'message', 'com.apple.finder': 'file' };
  
  /* the script that asks one of the apps above for its single selected (or open, saved) object; null for any other app */
  function scriptForSelection(bundleId) {
    var b = String(bundleId || '');
    if (!Object.prototype.hasOwnProperty.call(SELECTION_APPS, b)) return null;
    var src = scriptForApp(b);
    return src ? src.replace('with timeout of 5 seconds', 'with timeout of 2 seconds') : null;
  }
  /* The menu-bar label asks the same read-only question as the popover but gives up after 1 second instead of 2:
     an app that is stuck must not hold a tag in the menu bar, or Context's own menu item, any longer than that. */
  function scriptForWatch(bundleId) { var t = scriptForSelection(bundleId); return t ? t.replace(/timeout of 2 seconds/, 'timeout of 1 seconds') : null; }

  /* Message-ID from the first bytes of an .eml file, so a message file gets the same identifier everywhere */
  function emlMessageId(head) {
    var h = String(head || '').replace(/\r\n?/g, '\n'), end = h.indexOf('\n\n');
    if (end >= 0) h = h.slice(0, end);
    h = h.replace(/\n[ \t]+/g, ' ');
    var m = h.match(/^message-id:[ \t]*(.*)$/im);
    return m ? messageId(m[1].trim().replace(/^<|>$/g, '')) : null;
  }
  /* one saved file as a source object, from its resolved path and file date alone (the shell reads no contents) */
  function fileDesc(realPath, mtimeIso, emlHead) {
    var p = String(realPath), kind = kindForPath(p), name = p.split('/').pop();
    var id = (kind === 'email' && emlHead ? emlMessageId(emlHead) : null) || fileId(p);
    return { id: id, kind: kind, title: name, locator: { type: 'file', value: p }, sourceTime: mtimeIso || null, sourceTimeType: mtimeIso ? 'modified-only' : 'unknown', sourceCreated: null };
  }

  return {
    VERSION: VERSION, MAX_TAGS: MAX_TAGS, LOOKUP_PREFIX: LOOKUP_PREFIX, RECORD_FIELDS: RECORD_FIELDS, KIND_LABEL: KIND_LABEL, DATE_LABEL: DATE_LABEL, SEP: SEP,
    tagKey: tagKey, cleanTag: cleanTag, parseTagInput: parseTagInput, parseLookup: parseLookup,
    describeUrl: describeUrl, kindForPath: kindForPath, fileId: fileId, messageId: messageId, cleanTitle: cleanTitle, oneLine: oneLine,
    emptyIndex: emptyIndex, loadIndex: loadIndex, dumpIndex: dumpIndex, bind: bind, unbind: unbind, planRename: planRename, applyRename: applyRename, refresh: refresh, resolve: resolve, tagSummary: tagSummary,
    formatWhen: formatWhen, toLocalIso: toLocalIso, buildTimeline: buildTimeline, renderContext: renderContext, renderList: renderList, locatorText: locatorText, cloudPlace: cloudPlace, isGoogleNative: isGoogleNative,
    scriptForApp: scriptForApp, scriptForRead: scriptForRead, parseActive: parseActive, isotToIso: isotToIso,
    APPLESCRIPT: APPLESCRIPT, SELECTION_APPS: SELECTION_APPS, scriptForSelection: scriptForSelection, scriptForWatch: scriptForWatch, emlMessageId: emlMessageId, fileDesc: fileDesc, MAX_TAG_LENGTH: MAX_TAG_LENGTH
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = WorkIndexCore;

/* Context — reading a source's current saved contents.
 * Pure: bytes and text in, structured content out. No file, network or operating-system access, no libraries.
 * The same file runs inside the Mac app's popover and under the tests.
 * Every call works on what it is handed; nothing is kept between calls. */
var WorkIndexRead = (function (Core) {
  'use strict';

  /* ───────── bytes and text ───────── */
  function u16(b, i) { return b[i] | (b[i + 1] << 8); }
  function u32(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0; }
  function latin1(b) {
    var s = '', n = b.length;
    for (var i = 0; i < n; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(n, i + 8192)));
    return s;
  }
  function bytesOfLatin1(str) { var n = str.length, b = new Uint8Array(n); for (var i = 0; i < n; i++) b[i] = str.charCodeAt(i) & 0xFF; return b; }
  function utf8(b) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(b);
    var s = '', i = 0, n = b.length, c, cp;
    while (i < n) {
      c = b[i++];
      if (c < 0x80) cp = c;
      else if (c >= 0xC2 && c < 0xE0 && i < n && (b[i] & 0xC0) === 0x80) cp = ((c & 0x1F) << 6) | (b[i++] & 0x3F);
      else if (c >= 0xE0 && c < 0xF0 && i + 1 < n && (b[i] & 0xC0) === 0x80 && (b[i + 1] & 0xC0) === 0x80) { cp = ((c & 0x0F) << 12) | ((b[i] & 0x3F) << 6) | (b[i + 1] & 0x3F); i += 2; }
      else if (c >= 0xF0 && c < 0xF5 && i + 2 < n && (b[i] & 0xC0) === 0x80 && (b[i + 1] & 0xC0) === 0x80 && (b[i + 2] & 0xC0) === 0x80) { cp = ((c & 0x07) << 18) | ((b[i] & 0x3F) << 12) | ((b[i + 1] & 0x3F) << 6) | (b[i + 2] & 0x3F); i += 3; }
      else cp = 0xFFFD;
      s += String.fromCodePoint(cp);
    }
    return s;
  }
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [], s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return new Uint8Array(out);
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64Bytes(text) {
    var s = String(text).replace(/[^A-Za-z0-9+/]/g, ''), n = Math.floor(s.length * 3 / 4), out = new Uint8Array(n), o = 0, acc = 0, bits = 0;
    if (typeof atob === 'function') {                       /* the quick way, where the host has it */
      try { var bin = atob(s + '==='.slice(0, (4 - s.length % 4) % 4)), quick = new Uint8Array(bin.length); for (var q = 0; q < bin.length; q++) quick[q] = bin.charCodeAt(q); return quick; } catch (e) { /* fall through */ }
    }
    for (var i = 0; i < s.length; i++) {
      acc = (acc << 6) | B64.indexOf(s.charAt(i)); bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xFF; }
    }
    return out.subarray(0, o);
  }
  /* Where the language has no TextDecoder (the Mac app's JavaScriptCore, used for Insert context), the shell gives one:
     a function (the bytes as one character per byte, charset name) → text, or null when it does not know the charset. */
  var hostDecoder = null;
  function setTextDecoder(f) { hostDecoder = typeof f === 'function' ? f : null; }
  function decodeBytes(b, charset) {
    var cs = String(charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
    if (cs === 'utf-8' || cs === 'utf8' || cs === 'us-ascii' || cs === 'ascii') return utf8(b);
    if (cs === 'iso-8859-1' || cs === 'latin1') return latin1(b);
    if (typeof TextDecoder === 'undefined' && hostDecoder) { var t = null; try { t = hostDecoder(latin1(b), cs); } catch (e) { t = null; } if (typeof t === 'string') return t; }
    try { return new TextDecoder(cs).decode(b); } catch (e) { return utf8(b); }
  }

  /* ───────── inflate (RFC 1951), enough for .xlsx ───────── */
  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  function huffman(lengths, from, n) {
    var count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(n), i;
    for (i = 0; i < n; i++) count[lengths[from + i]]++;
    count[0] = 0;
    for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    for (i = 0; i < n; i++) if (lengths[from + i]) symbol[offs[lengths[from + i]]++] = i;
    return { count: count, symbol: symbol };
  }
  var FIXED = null;
  function fixedTables() {
    if (FIXED) return FIXED;
    var l = new Uint8Array(288), d = new Uint8Array(30), i;
    for (i = 0; i < 144; i++) l[i] = 8; for (; i < 256; i++) l[i] = 9; for (; i < 280; i++) l[i] = 7; for (; i < 288; i++) l[i] = 8;
    for (i = 0; i < 30; i++) d[i] = 5;
    FIXED = { len: huffman(l, 0, 288), dist: huffman(d, 0, 30) };
    return FIXED;
  }
  function inflateRaw(input, sizeHint, maxSize) {
    var pos = 0, hold = 0, have = 0, limit = maxSize || 64 * 1024 * 1024;
    var out = new Uint8Array(Math.max(1024, sizeHint || input.length * 4)), op = 0;
    function room(n) {
      if (op + n <= out.length) return;
      if (op + n > limit) throw new Error('part too large');
      var bigger = new Uint8Array(Math.min(limit, Math.max(out.length * 2, op + n))); bigger.set(out.subarray(0, op)); out = bigger;
    }
    function bits(n) {
      while (have < n) { if (pos >= input.length) throw new Error('compressed data ends early'); hold |= input[pos++] << have; have += 8; }
      var v = hold & ((1 << n) - 1); hold >>>= n; have -= n; return v;
    }
    function decode(h) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len <= 15; len++) {
        code |= bits(1);
        var c = h.count[len];
        if (code - c < first) return h.symbol[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw new Error('damaged compressed data');
    }
    function block(lenTable, distTable) {
      for (;;) {
        var sym = decode(lenTable);
        if (sym < 256) { room(1); out[op++] = sym; continue; }
        if (sym === 256) return;
        sym -= 257;
        if (sym >= 29) throw new Error('damaged compressed data');
        var len = LBASE[sym] + bits(LEXT[sym]), ds = decode(distTable);
        if (ds >= 30) throw new Error('damaged compressed data');
        var dist = DBASE[ds] + bits(DEXT[ds]);
        if (dist > op) throw new Error('damaged compressed data');
        room(len);
        for (var k = 0; k < len; k++, op++) out[op] = out[op - dist];
      }
    }
    var last;
    do {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        hold = 0; have = 0;
        if (pos + 4 > input.length) throw new Error('compressed data ends early');
        var n = u16(input, pos), nn = u16(input, pos + 2); pos += 4;
        if ((n ^ 0xFFFF) !== nn) throw new Error('damaged compressed data');
        if (pos + n > input.length) throw new Error('compressed data ends early');
        room(n); out.set(input.subarray(pos, pos + n), op); op += n; pos += n;
      } else if (type === 1) {
        var f = fixedTables(); block(f.len, f.dist);
      } else if (type === 2) {
        var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, lengths = new Uint8Array(320), i;
        if (nlen > 286 || ndist > 30) throw new Error('damaged compressed data');
        for (i = 0; i < ncode; i++) lengths[CLORDER[i]] = bits(3);
        var cl = huffman(lengths, 0, 19);
        lengths = new Uint8Array(320); i = 0;
        while (i < nlen + ndist) {
          var s = decode(cl), rep, val = 0;
          if (s < 16) { lengths[i++] = s; continue; }
          if (s === 16) { if (i === 0) throw new Error('damaged compressed data'); val = lengths[i - 1]; rep = 3 + bits(2); }
          else if (s === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (i + rep > nlen + ndist) throw new Error('damaged compressed data');
          while (rep--) lengths[i++] = val;
        }
        if (lengths[256] === 0) throw new Error('damaged compressed data');
        block(huffman(lengths, 0, nlen), huffman(lengths, nlen, ndist));
      } else throw new Error('damaged compressed data');
    } while (!last);
    return out.subarray(0, op);
  }

  /* ───────── zip (enough for .xlsx) ───────── */
  function unzip(buf) {
    var eocd = -1;
    for (var i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip file');
    var count = u16(buf, eocd + 10), off = u32(buf, eocd + 16);
    if (count === 0xFFFF || off === 0xFFFFFFFF) throw new Error('zip64 files are not supported');
    var entries = {};
    for (var n = 0; n < count; n++) {
      if (off + 46 > buf.length || u32(buf, off) !== 0x02014b50) throw new Error('damaged zip directory');
      var method = u16(buf, off + 10), csize = u32(buf, off + 20), usize = u32(buf, off + 24);
      var nlen = u16(buf, off + 28), elen = u16(buf, off + 30), clen = u16(buf, off + 32), lho = u32(buf, off + 42);
      entries[utf8(buf.subarray(off + 46, off + 46 + nlen))] = { method: method, csize: csize, usize: usize, lho: lho };
      off += 46 + nlen + elen + clen;
    }
    return {
      names: Object.keys(entries),
      read: function (name) {
        var e = entries[name]; if (!e) return null;
        if (e.usize > 64 * 1024 * 1024) throw new Error('part too large: ' + name);
        if (e.lho + 30 > buf.length || u32(buf, e.lho) !== 0x04034b50) throw new Error('damaged zip entry');
        var start = e.lho + 30 + u16(buf, e.lho + 26) + u16(buf, e.lho + 28);
        var data = buf.subarray(start, start + e.csize);
        if (e.method === 0) return data;
        if (e.method === 8) return inflateRaw(data, e.usize);
        throw new Error('unsupported zip compression');
      }
    };
  }

  /* ───────── xml helpers ───────── */
  function xmlText(s) {
    return String(s).replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(+d); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/_x([0-9A-Fa-f]{4})_/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
  }
  function attr(tag, name) { var m = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')); return m ? xmlText(m[1]) : null; }

  /* ───────── workbook (.xlsx / .xlsm) ───────── */
  var BUILTIN_DATE_FMT = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 27: 1, 28: 1, 29: 1, 30: 1, 31: 1, 32: 1, 33: 1, 34: 1, 35: 1, 36: 1, 45: 1, 46: 1, 47: 1, 50: 1, 51: 1, 52: 1, 53: 1, 54: 1, 55: 1, 56: 1, 57: 1, 58: 1 };
  function isDateFormat(code) {
    var c = String(code || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
    return /[dmyhs]/i.test(c) && !/^general$/i.test(c.trim());
  }
  function serialToIso(n, date1904) {
    var ms = Math.round((n - (date1904 ? -1462 : 0) - 25569) * 86400000);   /* Excel serial → Unix ms (1900 system) */
    var d = new Date(ms); if (isNaN(d.getTime())) return String(n);
    var p = function (x) { return ('0' + x).slice(-2); };
    var day = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    return (n % 1 === 0) ? day : day + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }
  /* A number format that shows money (₩, $, USD, KRW, 원 …): the pieces needed to show a value the way the workbook does.
     Returns null for anything else, or for a format this reader does not fully understand, and the number stays as stored. */
  var MONEY = /[$\u20A9\uFFE6\u20AC\u00A3\u00A5]|\b(USD|KRW|EUR|JPY|GBP|CNY|CAD|AUD)\b|\uC6D0|\uB2EC\uB7EC/;
  function moneyFormat(code) {
    var first = String(code || '').split(';')[0], before = '', after = '', pattern = '', i = 0, ch, end;
    function lit(t) { if (pattern) after += t; else before += t; }
    while (i < first.length) {
      ch = first[i];
      if (ch === '"') { end = first.indexOf('"', i + 1); if (end < 0) return null; lit(first.slice(i + 1, end)); i = end + 1; }
      else if (ch === '\\') { lit(first[i + 1] || ''); i += 2; }
      else if (ch === '_' || ch === '*') i += 2;                                   /* spacing and fill: nothing to show */
      else if (ch === '[') {
        end = first.indexOf(']', i); if (end < 0) return null;
        var m = first.slice(i + 1, end).match(/^\$([^-\]]*)(?:-.*)?$/);           /* [$₩-412] → ₩ ; colours and conditions are skipped */
        if (m) lit(m[1]);
        i = end + 1;
      }
      else if (/[0#?.,]/.test(ch)) { if (after) return null; pattern += ch; i++; }
      else if (/[$\u20A9\uFFE6\u20AC\u00A3\u00A5 ()+:\/-]/.test(ch)) { lit(ch); i++; }
      else return null;                                                           /* General, @, %, dates, exponents: not money */
    }
    if (!/[0#?]/.test(pattern) || /,$/.test(pattern.split('.')[0]) || !MONEY.test(before + after)) return null;
    var parts = pattern.split('.');
    if (parts.length > 2) return null;
    var frac = parts[1] || '';
    return { before: before.replace(/[()]/g, ''), after: after.replace(/[()]/g, ''), group: parts[0].indexOf(',') >= 0, places: frac.replace(/[^0#?]/g, '').length, fixed: frac.replace(/[^0]/g, '').length };
  }
  function showMoney(num, f) {
    var neg = num < 0, s = Math.abs(num).toFixed(f.places), whole = s.split('.')[0], frac = s.split('.')[1] || '';
    while (frac.length > f.fixed && frac.charAt(frac.length - 1) === '0') frac = frac.slice(0, -1);
    if (f.group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var shown = (neg ? '-' : '') + (f.before + whole + (frac ? '.' + frac : '') + f.after).replace(/\s+/g, ' ').trim();
    return Number((neg ? '-' : '') + s) === num ? shown : shown + ' (stored ' + String(num) + ')';      /* never hide what rounding left out */
  }
  var BUILTIN_MONEY_FMT = { 5: 1, 6: 1, 7: 1, 8: 1, 42: 1, 44: 1 };                 /* currency of the computer's region: the file does not name it */
  function colNum(ref) { var m = ref.match(/^([A-Z]+)/), n = 0; if (!m) return 0; for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64); return n; }
  function colName(n) { var s = ''; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

  function workbookMeta(zip) {
    var core = zip.read('docProps/core.xml'), out = { created: null, modified: null };
    if (core) {
      var x = utf8(core), m;
      if ((m = x.match(/<dcterms:created[^>]*>([^<]+)</))) out.created = m[1].trim();
      if ((m = x.match(/<dcterms:modified[^>]*>([^<]+)</))) out.modified = m[1].trim();
    }
    return out;
  }
  function readWorkbook(buf, limits) {
    limits = limits || {};
    var maxCells = limits.maxCellsPerSheet || 5000;
    var zip = unzip(buf);
    var wbx = zip.read('xl/workbook.xml'); if (!wbx) throw new Error('not an Excel workbook (no xl/workbook.xml)');
    var wb = utf8(wbx);
    var date1904 = /<(?:\w+:)?workbookPr[^>]*date1904="(1|true)"/.test(wb);
    var rels = {}, relx = zip.read('xl/_rels/workbook.xml.rels');
    if (relx) (utf8(relx).match(/<Relationship\b[^>]*>/g) || []).forEach(function (t) { rels[attr(t, 'Id')] = attr(t, 'Target'); });
    var shared = [], ssx = zip.read('xl/sharedStrings.xml');
    if (ssx) (utf8(ssx).match(/<(?:\w+:)?si\b[\s\S]*?<\/(?:\w+:)?si>/g) || []).forEach(function (si) {
      var clean = si.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
      shared.push((clean.match(/<(?:\w+:)?t\b[^>]*>[\s\S]*?<\/(?:\w+:)?t>/g) || []).map(function (t) { return xmlText(t.replace(/^<[^>]*>/, '').replace(/<\/[^>]*>$/, '')); }).join(''));
    });
    var dateStyle = [], moneyStyle = [], stx = zip.read('xl/styles.xml');
    if (stx) {
      var st = utf8(stx), custom = {};
      (st.match(/<(?:\w+:)?numFmt\b[^>]*>/g) || []).forEach(function (t) { custom[attr(t, 'numFmtId')] = attr(t, 'formatCode'); });
      var xfs = st.match(/<(?:\w+:)?cellXfs\b[\s\S]*?<\/(?:\w+:)?cellXfs>/);
      if (xfs) (xfs[0].match(/<(?:\w+:)?xf\b[^>]*>/g) || []).forEach(function (t) {
        var id = attr(t, 'numFmtId'), isDate = !!(BUILTIN_DATE_FMT[id] || (custom[id] && isDateFormat(custom[id])));
        dateStyle.push(isDate);
        moneyStyle.push(isDate ? null : custom[id] ? moneyFormat(custom[id]) : BUILTIN_MONEY_FMT[id] ? 'unnamed' : null);
      });
    }
    var sheets = [];
    (wb.match(/<(?:\w+:)?sheet\b[^>]*>/g) || []).forEach(function (t) {
      var name = attr(t, 'name'), rid = attr(t, 'r:id'), target = rels[rid];
      if (!target) return;
      var p = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      var sx = zip.read(p); if (!sx) return;
      var xml = utf8(sx), rows = [], total = 0, kept = 0, minC = Infinity, maxC = 0, minR = Infinity, maxR = 0, byRow = {};
      var re = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g, m;
      while ((m = re.exec(xml))) {
        var at = m[1], inner = m[2] || '', ref = attr(at, 'r'), type = attr(at, 't') || 'n', s = attr(at, 's');
        if (!ref) continue;
        var vm = inner.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/), fm = inner.match(/<(?:\w+:)?f\b[^>]*>([\s\S]*?)<\/(?:\w+:)?f>/);
        var raw = vm ? xmlText(vm[1]) : null, v = null;
        if (type === 's') v = raw == null ? null : (shared[+raw] == null ? '' : shared[+raw]);
        else if (type === 'inlineStr') v = (inner.match(/<(?:\w+:)?t\b[^>]*>[\s\S]*?<\/(?:\w+:)?t>/g) || []).map(function (x) { return xmlText(x.replace(/^<[^>]*>/, '').replace(/<\/[^>]*>$/, '')); }).join('');
        else if (type === 'b') v = raw === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'e' || type === 'str') v = raw;
        else if (raw != null) {
          var num = Number(raw), money = s != null ? moneyStyle[+s] : null;
          if (s != null && dateStyle[+s] && isFinite(num)) v = serialToIso(num, date1904);
          else if (!isFinite(num)) v = raw;
          else if (money === 'unnamed') v = String(num) + ' (shown as currency in the workbook; the file does not say which)';
          else v = money ? showMoney(num, money) : String(num);
        }
        if (v == null || v === '') { if (!fm) continue; v = ''; }
        total++;
        if (kept >= maxCells) continue;
        kept++;
        var rn = +ref.replace(/^[A-Z]+/, ''), cn = colNum(ref);
        minC = Math.min(minC, cn); maxC = Math.max(maxC, cn); minR = Math.min(minR, rn); maxR = Math.max(maxR, rn);
        var cell = { ref: ref, v: v }; if (fm) cell.f = xmlText(fm[1]);
        (byRow[rn] = byRow[rn] || []).push(cell);
      }
      Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; }).forEach(function (rn) {
        rows.push({ r: rn, cells: byRow[rn].sort(function (a, b) { return colNum(a.ref) - colNum(b.ref); }) });
      });
      sheets.push({ name: name, hidden: /^(hidden|veryHidden)$/.test(attr(t, 'state') || ''), range: kept ? colName(minC) + minR + ':' + colName(maxC) + maxR : null, rows: rows,
        truncated: total > kept ? (total - kept) + ' more cells' : null });
    });
    return { type: 'workbook', sheets: sheets, meta: workbookMeta(zip) };
  }
  function readCsv(text, sep) {
    var rows = [], row = [], cur = '', q = false, s = String(text).replace(/^﻿/, '');
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    var out = [], maxC = 0;
    rows.forEach(function (r, ri) {
      var cells = []; r.forEach(function (v, ci) { if (v !== '') { cells.push({ ref: colName(ci + 1) + (ri + 1), v: v }); maxC = Math.max(maxC, ci + 1); } });
      if (cells.length) out.push({ r: ri + 1, cells: cells });
    });
    return { type: 'workbook', sheets: [{ name: 'Sheet1', hidden: false, range: out.length ? 'A1:' + colName(maxC) + rows.length : null, rows: out, truncated: null }], meta: { created: null, modified: null } };
  }

  /* ───────── email (.eml, RFC 5322 / MIME) ───────── */
  function decodeQP(s) {
    var bytes = [], t = String(s).replace(/=\r?\n/g, '');
    for (var i = 0; i < t.length; i++) {
      if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.substr(i + 1, 2))) { bytes.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; }
      else { var code = t.charCodeAt(i); if (code < 256) bytes.push(code); else { var b = utf8Bytes(t[i]); for (var k = 0; k < b.length; k++) bytes.push(b[k]); } }
    }
    return new Uint8Array(bytes);
  }
  function decodeWords(s) {   /* RFC 2047 encoded words in headers */
    return String(s).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, function (_, cs, enc, data) {
      try { return decodeBytes(enc.toUpperCase() === 'B' ? base64Bytes(data) : decodeQP(data.replace(/_/g, ' ')), cs); } catch (e) { return data; }
    });
  }
  function splitMessage(text) {
    var i = text.search(/\r?\n\r?\n/);
    var head = i < 0 ? text : text.slice(0, i), body = i < 0 ? '' : text.slice(i).replace(/^\r?\n\r?\n/, '');
    var headers = {};
    head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^([!-9;-~]+):\s*(.*)$/); if (m) { var k = m[1].toLowerCase(); if (headers[k] == null) headers[k] = m[2]; }
    });
    return { headers: headers, body: body };
  }
  function param(value, name) { var m = String(value || '').match(new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i')); return m ? (m[1] != null ? m[1] : m[2]) : null; }
  function partText(part) {
    var ct = part.headers['content-type'] || 'text/plain', enc = String(part.headers['content-transfer-encoding'] || '7bit').toLowerCase().trim();
    var bytes = enc === 'base64' ? base64Bytes(part.body) : enc === 'quoted-printable' ? decodeQP(part.body) : bytesOfLatin1(part.body);
    return decodeBytes(bytes, param(ct, 'charset') || 'utf-8');
  }
  function walkParts(part, acc) {
    var ct = String(part.headers['content-type'] || 'text/plain').toLowerCase(), disp = String(part.headers['content-disposition'] || '').toLowerCase();
    var fname = param(part.headers['content-disposition'], 'filename') || param(part.headers['content-type'], 'name');
    if (/^multipart\//.test(ct)) {
      var b = param(part.headers['content-type'], 'boundary'); if (!b) return;
      var chunks = part.body.split(new RegExp('(?:^|\\r?\\n)--' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?[ \\t]*(?:\\r?\\n|$)'));
      chunks.slice(1).forEach(function (c) { if (c.trim()) walkParts(splitMessage(c), acc); });
      return;
    }
    if (/attachment/.test(disp) || (fname && !/^text\/(plain|html)/.test(ct))) { acc.attachments.push(decodeWords(fname || '(unnamed attachment)')); return; }
    if (/^text\/plain/.test(ct) && acc.plain == null) acc.plain = partText(part);
    else if (/^text\/html/.test(ct) && acc.html == null) acc.html = partText(part);
  }
  function htmlToText(h) {
    return String(h).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function emailHeaders(buf) {
    var msg = splitMessage(latin1(buf)), h = msg.headers, utf = function (s) { return s == null ? null : decodeWords(utf8(bytesOfLatin1(s))); };
    var sent = null;
    if (h.date) { var ms = Date.parse(h.date); if (!isNaN(ms)) { var z = h.date.match(/([+-])(\d{2})(\d{2})\s*(?:\([^)]*\))?\s*$/); var off = z ? (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +z[3]) : 0; sent = Core.toLocalIso(ms, off); } }
    return { msg: msg, from: utf(h.from), to: utf(h.to), cc: utf(h.cc), subject: utf(h.subject), date: h.date || null, sent: sent,
      messageId: h['message-id'] ? h['message-id'].trim().replace(/^<|>$/g, '') : null };
  }
  function readEmail(buf) {
    var e = emailHeaders(buf), acc = { plain: null, html: null, attachments: [] };
    walkParts(e.msg, acc);
    var text = acc.plain != null ? acc.plain : (acc.html != null ? htmlToText(acc.html) : '');
    return { type: 'email', headers: { from: e.from, to: e.to, cc: e.cc, subject: e.subject, date: e.date, messageId: e.messageId }, text: text, attachments: acc.attachments, sent: e.sent };
  }

  /* ───────── one saved file: what it is now, and its contents now ───────── */
  var MAX_FILE = 40 * 1024 * 1024;
  function baseName(p) { return String(p).split('/').pop(); }
  function extName(p) { var m = baseName(p).match(/(\.[^.]+)$/); return m ? m[1] : ''; }
  function localIso(ms) { return Core.toLocalIso(ms, -new Date(ms).getTimezoneOffset()); }
  /* why a file could not be opened, in words. file.reason: missing | folder | not-a-file | denied | link | too-large | error */
  function fileReason(file, p) {
    var r = file && file.reason;
    p = Core.locatorText({ type: 'file', value: p });
    if (r === 'missing') return 'file not found at ' + p + ' (moved, renamed or deleted)';
    if (r === 'denied') return 'no permission to read ' + p;
    if (r === 'folder') return p + ' is a folder now, not a file';
    if (r === 'not-a-file') return p + ' is no longer a file';
    if (r === 'link') return 'the link at ' + p + ' leads nowhere';
    return 'could not be read (' + ((file && file.detail) || 'unknown error') + ')';
  }
  /* title, the file's own date and what kind of date that is */
  function observe(realPath, bytes, mtimeMs) {
    var kind = Core.kindForPath(realPath), title = baseName(realPath), mtime = mtimeMs ? localIso(Math.floor(mtimeMs)) : null;
    var o = { title: title, sourceTime: mtime, sourceTimeType: mtime ? 'modified-only' : 'unknown', sourceCreated: null, kind: kind, messageId: null };
    if (kind === 'email') {
      var e = emailHeaders(bytes);
      o.title = Core.cleanTitle(e.subject) || title; o.messageId = e.messageId;
      if (e.sent) { o.sourceTime = e.sent; o.sourceTimeType = 'sent'; }
    } else if (/\.(xlsx|xlsm)$/i.test(realPath)) {
      try {
        var meta = workbookMeta(unzip(bytes));
        if (meta.modified && !isNaN(Date.parse(meta.modified))) {
          o.sourceTime = localIso(Date.parse(meta.modified)); o.sourceTimeType = 'modified';
          o.sourceCreated = (meta.created && !isNaN(Date.parse(meta.created))) ? localIso(Date.parse(meta.created)) : null;
        }
      } catch (e2) { /* fall back to the file date */ }
    }
    return o;
  }
  /* a saved file as a source object. file: { ok, realPath, bytes, mtimeMs, size } or { ok:false, reason } */
  function describeFile(file, shownPath) {
    if (!file || !file.ok) {
      var r = file && file.reason;
      return { ok: false, reason: r === 'folder' ? 'only a saved file can be tagged; ' + shownPath + ' is a folder' : fileReason(file, shownPath) };
    }
    if (file.size > MAX_FILE) return { ok: false, reason: 'file is larger than 40 MB' };
    /* online only (its contents are still in the cloud) or a Google Docs pointer: named and dated by the file itself;
       nothing inside it is looked at, so tagging never makes the cloud app download it */
    var o = file.online || Core.isGoogleNative(file.realPath) ? { kind: Core.kindForPath(file.realPath), title: baseName(file.realPath), sourceTime: file.mtimeMs ? localIso(Math.floor(file.mtimeMs)) : null, sourceTimeType: file.mtimeMs ? 'modified-only' : 'unknown', sourceCreated: null, messageId: null }
      : observe(file.realPath, file.bytes, file.mtimeMs);
    var id = (o.kind === 'email' && o.messageId) ? Core.messageId(o.messageId) : Core.fileId(file.realPath);
    return { ok: true, desc: { id: id, kind: o.kind, title: o.title, locator: { type: 'file', value: file.realPath }, sourceTime: o.sourceTime, sourceTimeType: o.sourceTimeType, sourceCreated: o.sourceCreated } };
  }
  /* Read one indexed file as it is saved right now.
     → {status:'ok', content, observed} | {status:'unreadable', reason, observed} | {status:'unavailable', reason} */
  function readFile(record, file, opts) {
    opts = opts || {};
    var p = record.locator.value;
    if (!file || !file.ok) return { status: 'unavailable', reason: fileReason(file, p) };
    var cloud = Core.cloudPlace(p), dated = { title: baseName(p), sourceTime: file.mtimeMs ? localIso(Math.floor(file.mtimeMs)) : null, sourceTimeType: 'modified-only', sourceCreated: null };
    if (Core.isGoogleNative(p)) return { status: 'unreadable', reason: 'a Google ' + ({ gdoc: 'Docs', gsheet: 'Sheets', gslides: 'Slides' }[extName(p).slice(1).toLowerCase()] || 'Drive') + ' file: its text is in Google Drive online, not on this Mac. To include it, download a copy (File › Download as .xlsx, .csv or .txt), tag that copy and look it up again', observed: dated };
    if (file.online) return { status: 'unreadable', reason: 'online only' + (cloud ? ' in ' + cloud.provider : '') + ': its contents are not on this Mac, and Context does not download them. In Finder choose "Make Available Offline" or "Download Now", then look it up again', observed: dated };
    if (file.size > MAX_FILE || !file.bytes) return { status: 'unreadable', reason: 'file is larger than 40 MB', observed: { title: baseName(p), sourceTime: file.mtimeMs ? localIso(Math.floor(file.mtimeMs)) : null, sourceTimeType: 'modified-only', sourceCreated: null } };
    var buf = file.bytes, o, observed;
    try { o = observe(p, buf, file.mtimeMs); } catch (e0) { o = { kind: Core.kindForPath(p), title: baseName(p), sourceTime: file.mtimeMs ? localIso(Math.floor(file.mtimeMs)) : null, sourceTimeType: 'modified-only', sourceCreated: null }; }
    observed = { title: o.title, sourceTime: o.sourceTime, sourceTimeType: o.sourceTimeType, sourceCreated: o.sourceCreated };
    try {
      if (o.kind === 'email') {
        var em = readEmail(buf);
        /* the entry points at one specific message; a different message now saved at this path is not it */
        if (/^mid:/.test(record.id) && Core.messageId(em.headers.messageId) !== record.id) return { status: 'unavailable', reason: 'the file at ' + p + ' is now a different message' };
        return { status: 'ok', content: em, observed: observed };
      }
      if (/\.(xlsx|xlsm)$/i.test(p)) return { status: 'ok', content: readWorkbook(buf, opts), observed: observed };
      if (/\.(csv|tsv)$/i.test(p)) return { status: 'ok', content: readCsv(utf8(buf), /\.tsv$/i.test(p) ? '\t' : ','), observed: observed };
      if (o.kind === 'note' || /\.(json|log|xml|html?|ya?ml|ini|conf|rtf)$/i.test(p)) {
        var zero = Array.prototype.indexOf.call(buf.subarray(0, 4096), 0);
        if (zero >= 0) return { status: 'unreadable', reason: 'not a text file', observed: observed };
        return { status: 'ok', content: { type: 'text', lines: utf8(buf).replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n') }, observed: observed };
      }
      return { status: 'unreadable', reason: 'no reader for ' + (extName(p) || 'this kind of') + ' files in this version; the file is there and can be opened where it is', observed: observed };
    } catch (e) {
      return { status: 'unreadable', reason: 'the file is there but could not be parsed (' + e.message + ')', observed: observed };
    }
  }
  /* the reply of the read-only script for one Apple Note or Mail message → the same shape as readFile */
  function readAppReply(record, reply, offsetMinutes) {
    var f = String(reply == null ? '' : reply).replace(/\n$/, '').split(Core.SEP);
    if (f[0] === 'ERR') return { status: 'unavailable', reason: f[1] || 'not accessible' };
    if (f[0] === 'note') {
      var nt = Core.isotToIso(f[2], offsetMinutes);
      return { status: 'ok', content: { type: 'text', lines: String(f.slice(4).join(Core.SEP)).replace(/\r\n?/g, '\n').split('\n') },
        observed: { title: f[1], sourceTime: nt, sourceTimeType: nt ? 'modified' : 'unknown', sourceCreated: Core.isotToIso(f[3], offsetMinutes) } };
    }
    if (f[0] === 'email') {
      if (Core.messageId(f[1]) !== record.id) return { status: 'unavailable', reason: 'a different message is now at that place in Mail' };
      var mt = Core.isotToIso(f[3], offsetMinutes);
      return { status: 'ok', content: { type: 'email', headers: { from: f[4], subject: f[2], messageId: f[1] }, text: f.slice(5).join(Core.SEP), attachments: [] },
        observed: { title: f[2], sourceTime: mt, sourceTimeType: mt ? 'sent' : 'unknown', sourceCreated: null } };
    }
    return { status: 'unavailable', reason: 'the app gave an unexpected answer' };
  }
  /* why an app could not be asked, in words (AppleScript error numbers) */
  function appReason(code, message) {
    if (code === -1743) return 'macOS is not allowing this. Allow it under System Settings › Privacy & Security › Automation';
    if (code === -1712) return 'the app did not answer in time';
    if (code === -1728 || code === -1719) return 'the object could not be found in the app';
    return 'the app could not be asked' + (message ? ' (' + String(message).split('\n').pop().slice(0, 160) + ')' : '');
  }

  return { u16: u16, u32: u32, latin1: latin1, bytesOfLatin1: bytesOfLatin1, utf8: utf8, utf8Bytes: utf8Bytes, base64Bytes: base64Bytes, setTextDecoder: setTextDecoder, decodeBytes: decodeBytes,
    moneyFormat: moneyFormat, showMoney: showMoney, inflateRaw: inflateRaw, unzip: unzip, readWorkbook: readWorkbook, readCsv: readCsv, readEmail: readEmail, emailHeaders: emailHeaders,
    observe: observe, describeFile: describeFile, readFile: readFile, readAppReply: readAppReply, appReason: appReason, fileReason: fileReason, localIso: localIso, MAX_FILE: MAX_FILE };
})(typeof WorkIndexCore !== 'undefined' ? WorkIndexCore : require('./rules.js'));
if (typeof module !== 'undefined' && module.exports) module.exports = WorkIndexRead;

/* Context — Insert context: what the Mac app answers when its browser extension asks.
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
  var BEGIN = '--- Context evidence: begin ---', END = '--- Context evidence: end ---';
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
      if (loc.type === 'url') return { status: 'external', reason: 'web link; Context does not fetch pages' };
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
      /* the tags themselves may have been changed in Context meanwhile (a rename, a merge, a tag taken off) */
      var recs = Core.resolve(l.index, H.q.tags.map(function (t) { return t.key; }));
      if (recs.map(binding).sort().join(' ') !== H.bindings) {
        held = null;
        return { ok: false, reason: 'index-changed', message: 'Tags were changed in Context after this list was shown. Choose the tag again.', tags: tagsOf(l.index) };
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
      else out = { ok: false, reason: 'unknown', message: 'Context does not know this request.' };
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
