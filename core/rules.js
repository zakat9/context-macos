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

  var VERSION = '0.12.0';
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

  function locatorText(loc) {
    if (!loc) return '';
    if (loc.type === 'file') return loc.value;
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
    formatWhen: formatWhen, toLocalIso: toLocalIso, buildTimeline: buildTimeline, renderContext: renderContext, renderList: renderList, locatorText: locatorText,
    scriptForApp: scriptForApp, scriptForRead: scriptForRead, parseActive: parseActive, isotToIso: isotToIso,
    APPLESCRIPT: APPLESCRIPT, SELECTION_APPS: SELECTION_APPS, scriptForSelection: scriptForSelection, scriptForWatch: scriptForWatch, emlMessageId: emlMessageId, fileDesc: fileDesc, MAX_TAG_LENGTH: MAX_TAG_LENGTH
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = WorkIndexCore;
