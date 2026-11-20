#!/usr/bin/env node
/* Work Index — regression suite. Plain Node, no dependencies:  node tests/run.js
 * Everything used here is fictional and is created in a temporary folder. */
'use strict';
process.env.TZ = 'Asia/Seoul';
var fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), http = require('http');
var ROOT = path.join(__dirname, '..');
var Core = require('../core/rules.js'), Read = require('../core/read.js'), Popover = require('../core/popover.js'), Readers = require('../dev/lib/readers.js'), Store = require('../dev/lib/store.js'), Ops = require('../dev/lib/ops.js'), Mcp = require('../experimental/connector/mcp.js');

var results = [];
function t(id, desc, ok, detail) {
  results.push({ id: id, desc: desc, ok: !!ok, detail: ok ? '' : String(detail === undefined ? '' : detail).slice(0, 400) });
  console.log((ok ? 'PASS ' : 'FAIL ') + id + '  ' + desc + (ok ? '' : '\n       → ' + String(detail === undefined ? '' : detail).slice(0, 400)));
}
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'workindex-test-'));
function fresh(name) { var d = path.join(TMP, name); fs.mkdirSync(path.join(d, 'src'), { recursive: true }); return { dir: d, src: path.join(d, 'src'), home: path.join(d, 'home') }; }
function fx(name) { return path.join(ROOT, 'tests', 'fixtures', name); }
function demoFx(name) { return path.join(ROOT, 'demo', 'fixtures', name); }
function cli(args, opts) {
  var r = cp.spawnSync(process.execPath, [path.join(ROOT, 'dev', 'workindex.js')].concat(args), Object.assign({ encoding: 'utf8', env: Object.assign({}, process.env, { TZ: 'Asia/Seoul' }) }, opts || {}));
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function touch(p, iso) { var d = new Date(iso); fs.utimesSync(p, d, d); }
function count(hay, needle) { return hay.split(needle).length - 1; }

/* ───────── A. rules ───────── */
(function () {
  var p = Core.parseTagInput('::Cost, #tooling cost  금형');
  t('A01', 'tag field accepts Cost, ::Cost and #Cost, and folds upper/lower case into one tag', p.tags.map(function (x) { return x.name; }).join() === 'Cost,tooling,금형' && !p.errors.length, JSON.stringify(p));
  var bad = ['Cost!', '2026', '-x', 'a'.repeat(41), 'R&D'].map(function (s) { return Core.cleanTag(s).ok; });
  t('A02', 'tag field refuses punctuation, digits only, a leading hyphen and names over 40 characters', bad.every(function (x) { return x === false; }), bad);
  var nfd = '투자유치', nfc = '투자유치';
  t('A03', 'Unicode: Korean, Japanese and accented tags work; decomposed and composed forms are the same tag', Core.cleanTag(nfd).key === Core.cleanTag(nfc).key && Core.cleanTag('資金調達').ok && Core.cleanTag('Café').key === Core.cleanTag('Café').key);
  var l = Core.parseLookup('What did we agree on ::Cost? Compare (::금형) and "::PineRidge". Not std::vector, a::b, :: or ::123.');
  t('A04', 'a ::Tag is found inside a sentence; std::vector, a::b, a bare :: and ::123 are not lookups', l.tags.map(function (x) { return x.name; }).join() === 'Cost,금형,PineRidge', JSON.stringify(l));
  var idx = Core.emptyIndex(), d = { id: 'file:/x/a.xlsx', kind: 'workbook', title: 'a.xlsx', locator: { type: 'file', value: '/x/a.xlsx' }, sourceTime: '2026-11-18T16:40:00+09:00', sourceTimeType: 'modified', sourceCreated: null };
  var b1 = Core.bind(idx, d, '::Cost', { now: '2026-11-19T09:00:00+09:00' }), b2 = Core.bind(idx, d, 'cost PineRidge', { now: '2026-11-19T10:00:00+09:00' }), b3 = Core.bind(idx, d, 'Budget');
  t('A05', 'same source tagged again keeps one entry; a tag differing only in case is not added twice', b1.status === 'created' && b2.status === 'updated' && Object.keys(idx.objects).length === 1 && idx.objects[d.id].tags.join() === 'Cost,PineRidge', JSON.stringify(idx.objects[d.id]));
  t('A06', 'a third tag is refused with the current tags named, and nothing changes', !b3.ok && b3.error.code === 'too-many-tags' && /already has ::Cost ::PineRidge/.test(b3.error.message) && idx.objects[d.id].tags.join() === 'Cost,PineRidge', JSON.stringify(b3));
  var b4 = Core.bind(idx, d, 'Budget', { replace: true });
  t('A07', 'replacing tags is explicit and still one entry; capture time stays, update time moves', b4.ok && idx.objects[d.id].tags.join() === 'Budget' && idx.objects[d.id].capturedAt === '2026-11-19T09:00:00+09:00' && Object.keys(idx.objects).length === 1);
  var three = Core.bind(Core.emptyIndex(), d, 'a b c');
  t('A08', 'three tags typed at once are refused, not cut down to two', !three.ok && three.error.code === 'too-many-tags', JSON.stringify(three));
  var u1 = Core.describeUrl('https://docs.google.com/spreadsheets/d/1AbC_def-9/edit?usp=sharing#gid=3').desc, u2 = Core.describeUrl('https://docs.google.com/spreadsheets/u/1/d/1AbC_def-9/edit#gid=0').desc;
  var g1 = Core.describeUrl('https://mail.google.com/mail/u/0/#inbox/FMfcgzQfictionalThread01').desc, g2 = Core.describeUrl('https://mail.google.com/mail/u/1/#search/quote/FMfcgzQfictionalThread01').desc;
  var w1 = Core.describeUrl('https://Example.test/notes/42/?utm_source=x&id=7#top').desc, w2 = Core.describeUrl('https://example.test/notes/42?id=7&fbclid=abc').desc;
  t('A09', 'links: one sheet opened on different tabs, one message under different labels and one page with tracking codes are each one object', u1.id === u2.id && u1.kind === 'workbook' && g1.id === g2.id && g1.kind === 'email' && w1.id === w2.id, [u1.id, u2.id, g1.id, g2.id, w1.id, w2.id].join(' | '));
  t('A10', 'a mailbox or search link is refused as "not one message"', Core.describeUrl('https://mail.google.com/mail/u/0/#inbox').ok === false);
  var rec = idx.objects[d.id], keys = Object.keys(rec).sort().join();
  t('A11', 'an entry holds only: id, kind, title, tags, locator, source date and date type, capture and update time', keys === Core.RECORD_FIELDS.slice().sort().join(), keys);
  var dirty = { schema: 1, objects: { 'file:/x/a.xlsx': Object.assign({}, rec, { content: 'B2: 900', snapshot: ['900', '820'], history: [{ v: 900 }], tags: ['a', 'b', 'c', 'd'], sourceTime: 'yesterday' }) } };
  var clean = Core.loadIndex(JSON.stringify(dirty)), dumped = Core.dumpIndex(clean);
  t('A12', 'loading an index drops anything else (content, snapshots, history), keeps at most two tags and blanks impossible dates', !/900|820|snapshot|history|content/.test(dumped) && clean.objects['file:/x/a.xlsx'].tags.length === 2 && clean.objects['file:/x/a.xlsx'].sourceTime === null, dumped);
})();

/* ───────── B. reading sources ───────── */
(function () {
  var w = Readers.readWorkbook(fs.readFileSync(demoFx('tooling-cost-model.xlsx')));
  var cell = function (sheet, ref) { var s = w.sheets.filter(function (x) { return x.name === sheet; })[0], hit = null; s.rows.forEach(function (r) { r.cells.forEach(function (c) { if (c.ref === ref) hit = c; }); }); return hit; };
  t('B01', 'workbook: every sheet with its range; text, numbers, a date cell and formula results with the formula text', w.sheets.map(function (s) { return s.name + ' ' + s.range; }).join() === 'Quotes A1:E4,Summary A1:B3' && cell('Quotes', 'C2').v === '48500' && cell('Quotes', 'D4').v === '2026-11-06' && cell('Summary', 'B3').v === '1500' && cell('Summary', 'B3').f === 'B1-B2', JSON.stringify(w.sheets[1]));
  var d = Readers.describePath(demoFx('tooling-cost-model.xlsx')).desc;
  t('B02', 'workbook date comes from the document itself: last saved Nov 18 16:40 (+09:00), created Nov 3', d.sourceTime === '2026-11-18T16:40:00+09:00' && d.sourceTimeType === 'modified' && d.sourceCreated === '2026-11-03T11:00:00+09:00', JSON.stringify(d));
  var e = Readers.readEmail(fs.readFileSync(demoFx('Revised tooling quote - Pine Ridge housing.eml')));
  t('B03', 'email: encoded subject and quoted-printable UTF-8 body are decoded; sent date keeps the sender\'s offset', e.headers.subject === 'Revised tooling quote — Pine Ridge housing' && /mold — it replaces/.test(e.text) && e.sent === '2026-11-10T09:12:00+09:00' && e.headers.messageId === '20261110.0912.rq2@harborline-tooling.example', JSON.stringify(e).slice(0, 300));
  var e2 = Readers.readEmail(fs.readFileSync(demoFx('Tooling budget cap for Pine Ridge.eml')));
  t('B04', 'email: multipart with base64 text is read; the attachment is named but not read', /approved cap for Pine Ridge tooling is USD 50,000/.test(e2.text) && e2.attachments.join() === 'cap-memo.pdf' && !/PDF/.test(e2.text), JSON.stringify(e2));
  var s = fresh('readers');
  var note = path.join(s.src, 'note.md'); fs.writeFileSync(note, 'Line one\n\nLine three\n'); touch(note, '2026-11-12T17:20:00+09:00');
  var dn = Readers.describePath(note).desc;
  t('B05', 'a plain note has no date of its own: its date is marked "modified-only" (file date)', dn.kind === 'note' && dn.sourceTimeType === 'modified-only' && dn.sourceTime === '2026-11-12T17:20:00+09:00', JSON.stringify(dn));
  var rn = Readers.readObject({ id: dn.id, locator: dn.locator });
  t('B06', 'note text is read as numbered lines', rn.status === 'ok' && rn.content.lines.join('|') === 'Line one||Line three');
  var csv = path.join(s.src, 'list.csv'); fs.writeFileSync(csv, 'Vendor,"Note, quoted"\nHarborline,"says ""ok"""\n');
  var rc = Readers.readObject({ id: 'file:' + csv, locator: { type: 'file', value: csv } });
  t('B07', 'CSV is read as cells, including quoted commas and quotes', rc.status === 'ok' && rc.content.sheets[0].rows[1].cells[1].v === 'says "ok"' && rc.content.sheets[0].rows[0].cells[1].ref === 'B1', JSON.stringify(rc.content));
  var pdf = path.join(s.src, 'scan.pdf'); fs.copyFileSync(demoFx('first-quote-scan.pdf'), pdf);
  var rp = Readers.readObject({ id: 'file:' + pdf, locator: { type: 'file', value: pdf } });
  t('B08', 'a file with no reader (PDF) is reported as present but not read; nothing is invented', rp.status === 'unreadable' && /no reader for \.pdf/.test(rp.reason) && !rp.content, JSON.stringify(rp));
  var gone = Readers.readObject({ id: 'file:/nope', locator: { type: 'file', value: path.join(s.src, 'nope.xlsx') } });
  var dirp = path.join(s.src, 'folder.xlsx'); fs.mkdirSync(dirp);
  var asDir = Readers.readObject({ id: 'file:' + dirp, locator: { type: 'file', value: dirp } });
  var link = path.join(s.src, 'dangling.md'); fs.symlinkSync(path.join(s.src, 'missing-target.md'), link);
  var dang = Readers.readObject({ id: 'file:' + link, locator: { type: 'file', value: link } });
  var broken = path.join(s.src, 'broken.xlsx'); fs.writeFileSync(broken, 'this is not a workbook');
  var br = Readers.readObject({ id: 'file:' + broken, locator: { type: 'file', value: broken } });
  t('B09', 'missing file, a folder in its place and a dangling link are each "unavailable" with the reason', gone.status === 'unavailable' && /not found/.test(gone.reason) && asDir.status === 'unavailable' && dang.status === 'unavailable', [gone.reason, asDir.reason, dang.reason].join(' | '));
  t('B10', 'a damaged workbook is reported as present but not parsed', br.status === 'unreadable' && /could not be parsed/.test(br.reason), JSON.stringify(br));
  var em = path.join(s.src, 'm.eml'); fs.copyFileSync(demoFx('Revised tooling quote - Pine Ridge housing.eml'), em);
  var de = Readers.describePath(em).desc; fs.copyFileSync(demoFx('Tooling budget cap for Pine Ridge.eml'), em);
  var swapped = Readers.readObject({ id: de.id, locator: de.locator });
  t('B11', 'an entry for one message is "unavailable" if a different message now sits at that path (never shown as the tagged one)', swapped.status === 'unavailable' && /different message/.test(swapped.reason), JSON.stringify(swapped));
  var web = Readers.readObject({ id: 'gmail:x', locator: { type: 'url', value: 'https://mail.google.com/mail/u/0/#all/x' } });
  t('B12', 'a web link is never fetched: it is listed as linked but not read here', web.status === 'external' && /does not fetch/.test(web.reason));
  var notes = Readers.readObject({ id: 'applenotes:x', locator: { type: 'apple-notes', value: 'x-coredata://A/ICNote/p1' } });
  t('B13', 'an Apple Notes or Mail entry opened on a computer that cannot ask those apps is "unavailable"', notes.status === 'unavailable', JSON.stringify(notes));
})();

/* ───────── C. current state only (acceptance) ───────── */
(function () {
  var s = fresh('current'), wbPath = path.join(s.src, 'maintenance.xlsx');
  fs.copyFileSync(fx('maintenance-900.xlsx'), wbPath);
  var r1 = Ops.tagInput(s.home, wbPath, '::Cost');
  var c1 = Ops.context(s.home, '::Cost');
  t('C01', 'tagged workbook saved with 900: lookup shows 900', r1.ok && /B2: 900\b/.test(c1.markdown) && c1.data.counts.total === 1, c1.markdown.slice(0, 300));
  fs.writeFileSync(wbPath, fs.readFileSync(fx('maintenance-820.xlsx')));                 /* overwritten in place */
  var c2 = Ops.context(s.home, '::Cost'), idxText = fs.readFileSync(Store.indexPath(s.home), 'utf8'), idx = JSON.parse(idxText);
  t('C02', 'ACCEPTANCE: after overwriting with 820 the lookup returns one workbook', c2.data.counts.total === 1 && c2.data.timeline.length === 1 && c2.data.timeline[0].kind === 'workbook' && count(c2.markdown, '### ') === 1, JSON.stringify(c2.data.counts));
  t('C03', 'ACCEPTANCE: …with only 820; 900 appears nowhere in the answer', /B2: 820\b/.test(c2.markdown) && !/\b900\b/.test(c2.markdown) && !/\b900\b/.test(JSON.stringify(c2.data)), (c2.markdown.match(/.{0,40}900.{0,40}/) || [''])[0]);
  t('C04', 'ACCEPTANCE: …and no change event: nothing like "changed", "was", "previously", "from 900" or "→"', !/chang(e|ed) from|previous(ly)?|was \d|→|earlier value|revision \d/i.test(c2.markdown.replace(/Earlier versions are not kept, not shown and not reconstructed\./, '')), c2.markdown);
  t('C05', 'the index still has exactly one entry for that workbook, and holds neither 900 nor 820', Object.keys(idx.objects).length === 1 && !/\b900\b|\b820\b/.test(idxText), idxText);
  t('C06', 'the entry now describes the current file: its date moved to the new save (same entry, no history)', idx.objects[Object.keys(idx.objects)[0]].sourceTime === '2026-11-16T14:30:00+09:00' && c1.data.timeline[0].sourceTime === '2026-11-09T12:00:00+09:00' && !/2026-11-09/.test(idxText), idxText);
  var tmp = wbPath + '.tmp'; fs.copyFileSync(fx('maintenance-900.xlsx'), tmp); fs.renameSync(tmp, wbPath);          /* "safe save": a new file replaces the old one */
  var c3 = Ops.context(s.home, '::Cost');
  fs.copyFileSync(fx('maintenance-820.xlsx'), tmp); fs.renameSync(tmp, wbPath);
  var c4 = Ops.context(s.home, '::Cost'), r2 = Ops.tagInput(s.home, wbPath, '::Cost');
  t('C07', 'a save that replaces the file (new file, same path) is still the same single entry, read fresh each time', c3.data.counts.total === 1 && /B2: 900\b/.test(c3.markdown) && !/\b820\b/.test(c3.markdown) && c4.data.counts.total === 1 && /B2: 820\b/.test(c4.markdown) && !/\b900\b/.test(c4.markdown));
  t('C08', 'tagging the re-saved workbook again does not add an entry', r2.ok && r2.status === 'unchanged' && r2.total === 1, JSON.stringify(r2));
  var note = path.join(s.src, 'call.md'); fs.writeFileSync(note, 'Maintenance vendor asked for a yearly contract.\n'); touch(note, '2026-11-08T10:00:00+09:00');
  Ops.tagInput(s.home, note, '::Cost');
  fs.writeFileSync(note, 'Maintenance vendor accepts a monthly contract.\n'); touch(note, '2026-11-17T09:00:00+09:00');
  var c5 = Ops.context(s.home, '::Cost');
  t('C09', 'a re-saved note is one entry with only its current text', c5.data.counts.total === 2 && /monthly contract/.test(c5.markdown) && !/yearly contract/.test(c5.markdown) && count(c5.markdown, 'call.md”') === 2, c5.markdown.slice(0, 200));
  t('C10', 'sources are ordered by their own dates, one entry each: workbook (Nov 16) before note (Nov 17)', c5.data.timeline.map(function (x) { return x.kind + ':' + x.sourceTime.slice(0, 10); }).join() === 'workbook:2026-11-16,note:2026-11-17', JSON.stringify(c5.data.timeline.map(function (x) { return x.kind + ':' + x.sourceTime; })));
  fs.rmSync(wbPath);
  var c6 = Ops.context(s.home, '::Cost');
  t('C11', 'deleted source: shown as unavailable with the reason, outside the timeline', c6.data.unavailable.length === 1 && /file not found/.test(c6.data.unavailable[0].reason) && c6.data.timeline.length === 1 && /## Unavailable/.test(c6.markdown));
  t('C12', 'deleted source: no stale content, values or dates from earlier reads are shown', !/\b900\b|\b820\b|Mold maintenance|B2:|Nov 16|Nov 9/.test(c6.markdown), (c6.markdown.match(/.{0,50}(900|820|Mold maintenance|B2:|Nov 16|Nov 9).{0,30}/) || [''])[0]);
  var files = fs.readdirSync(s.home).sort().join();
  t('C13', 'the index folder holds index.json and nothing else: no archive, snapshots, cache or temp files', files === 'index.json', files);
  var all = fs.readFileSync(Store.indexPath(s.home), 'utf8');
  t('C14', 'nothing read from any source is stored: no cell values or note text in the index folder', !/monthly contract|yearly contract|Mold maintenance|Checked by/.test(all));
  /* mixed sources: order, date types, undated, unavailable */
  var m = fresh('mixed');
  ['Revised tooling quote - Pine Ridge housing.eml', 'Tooling budget cap for Pine Ridge.eml', 'Supplier call notes - Harborline.md', 'tooling-cost-model.xlsx'].forEach(function (f) { fs.copyFileSync(demoFx(f), path.join(m.src, f)); });
  touch(path.join(m.src, 'Supplier call notes - Harborline.md'), '2026-11-12T17:20:00+09:00');
  fs.readdirSync(m.src).forEach(function (f) { Ops.tagInput(m.home, path.join(m.src, f), '::Cost'); });
  Ops.tagInput(m.home, 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQfictionalThread01', '::Cost', { title: 'web mail link' });
  var cm = Ops.context(m.home, '::Cost'), order = cm.data.timeline.map(function (x) { return x.label + ':' + x.sourceTimeType; }).join();
  t('C15', 'email + note + workbook together: one chronological list by source date, each with its date type; the undated link is last and separate', order === 'E1:sent,N1:modified-only,E2:sent,W1:modified,E3:unknown' && /## Date unknown \(not placed in the order\)/.test(cm.markdown), order);
  t('C16', 'citations name the message, the note lines and the workbook cells', /Cite the message as \[E1\]/.test(cm.markdown) && /Cite lines as \[N1 › L3\]/.test(cm.markdown) && /Cite cells as \[W1 › Quotes!A1\]/.test(cm.markdown) && /\[Summary\] A3: Headroom \(USD\) · B3: 1500 \(formula =B1-B2\)/.test(cm.markdown));
  var both = Ops.context(m.home, '::Cost ::PineRidge');
  Ops.tagInput(m.home, path.join(m.src, 'tooling-cost-model.xlsx'), '::PineRidge');
  var both2 = Ops.context(m.home, '::Cost ::PineRidge'), none = Ops.context(m.home, '::Nope');
  t('C17', 'two tags in one lookup narrow to sources carrying both; an unknown tag says so and lists the tags in use', both.data.counts.total === 0 && both2.data.counts.total === 1 && none.data.counts.total === 0 && /No source is tagged ::Nope/.test(none.markdown) && /Tags in use: .*::Cost/.test(none.markdown), none.markdown);
  var big = path.join(m.src, 'big.md'); fs.writeFileSync(big, Array.from({ length: 400 }, function (_, i) { return 'row ' + (i + 1) + ' of the long fictional note'; }).join('\n')); Ops.tagInput(m.home, big, '::Long');
  var cb = Ops.context(m.home, '::Long', { maxCharsPerSource: 1500 }), full = Ops.readOne(m.home, Readers.describePath(big).desc.id);
  t('C18', 'long sources are cut openly ("truncated … of 400 lines"), and reading that source alone gives all of it', /\[N1 truncated: text cut after line \d+ of 400/.test(cb.markdown) && /L400: row 400/.test(full.markdown) && !/truncated/.test(full.markdown), (cb.markdown.match(/\[N1 truncated[^\]]*\]/) || [''])[0]);
  var many = fresh('many');
  for (var i = 1; i <= 40; i++) { var f = path.join(many.src, 'note-' + ('0' + i).slice(-2) + '.md'); fs.writeFileSync(f, Array.from({ length: 60 }, function (_, k) { return 'fictional line ' + (k + 1) + ' of note ' + i + ' with some filler text to give it length'; }).join('\n')); touch(f, '2026-11-' + ('0' + (1 + (i % 18))).slice(-2) + 'T10:00:00+09:00'); Ops.tagInput(many.home, f, '::Bulk'); }
  var cm2 = Ops.context(many.home, '::Bulk', { maxTotalChars: 20000 }), quotedN = cm2.data.timeline.filter(function (x) { return x.contents === 'quoted'; }).length, omittedN = cm2.data.timeline.filter(function (x) { return x.contents === 'omitted-for-size'; }).length;
  t('C19', 'a tag with many sources keeps one answer to a stated size: every source is still listed in order, the ones past the limit say their contents are not quoted', cm2.data.timeline.length === 40 && quotedN >= 4 && omittedN === 40 - quotedN && omittedN > 20 && cm2.data.counts.listedWithoutContents === omittedN && new RegExp('- ' + omittedN + ' of the sources read are listed without their contents').test(cm2.markdown) && cm2.markdown.length < 60000 && count(cm2.markdown, '### ') === 40, JSON.stringify({ q: quotedN, o: omittedN, len: cm2.markdown.length }));
})();

/* ───────── D. command line ───────── */
(function () {
  var d = path.join(TMP, 'cli-demo'), demo = cli(['demo', '--dir', d]), home = path.join(d, 'home');
  t('D01', 'demo sets up fictional sources and tags; the third tag on the workbook is refused', demo.code === 0 && /refused: ::Budget/.test(demo.out) && /created: ::Cost ::PineRidge/.test(demo.out), demo.out + demo.err);
  var c = cli(['--home', home, 'context', '::Cost']);
  t('D02', 'context ::Cost prints 7 linked sources: 4 read, 2 not read here, 1 unavailable', c.code === 0 && /7 linked sources: 4 read just now, 2 linked but not read here, 1 unavailable/.test(c.out), c.out.slice(0, 300) + c.err);
  var heads = (c.out.match(/^### .*$/gm) || []).map(function (h) { return h.replace(/^### /, '').split(' — ')[0].replace(/, 2026.*$/, ''); });
  t('D03', 'its timeline runs Nov 4 → Nov 10 → Nov 12 → Nov 17 → Nov 18, then the undated link', heads.join('|') === '1. Nov 4|2. Nov 10|3. Nov 12|4. Nov 17|5. Nov 18|Date unknown', heads.join('|'));
  var l = cli(['--home', home, 'lookup', '::Cost']);
  t('D04', 'lookup lists the 7 sources from the index without opening them; the deleted one is flagged and shows no date', l.code === 0 && /::Cost: 7 linked sources \(from the index; sources not opened/.test(l.out) && /vendor-shortlist\.csv” — no date shown — .*unavailable: file not found/.test(l.out) && !/48500|USD 50,000|Nov 5/.test(l.out), l.out);
  var third = cli(['--home', home, 'tag', path.join(d, 'sources', 'tooling-cost-model.xlsx'), '::Budget']);
  t('D05', 'a third tag from the command line fails with a non-zero exit and an explanation', third.code !== 0 && /at most 2 tags/.test(third.err), third.err);
  var un = cli(['--home', home, 'untag', path.join(d, 'sources', 'tooling-cost-model.xlsx'), '::PineRidge']), un2 = cli(['--home', home, 'untag', path.join(d, 'sources', 'first-quote-scan.pdf')]);
  var after = cli(['--home', home, 'tags']);
  t('D06', 'untag removes one tag or the whole entry', un.code === 0 && /Now tagged ::Cost\./.test(un.out) && /Removed from the index/.test(un2.out) && /::Cost\s+6/.test(after.out), un.out + un2.out + after.out);
  var j = cli(['--home', home, 'context', '::Cost', '--json']), parsed = null; try { parsed = JSON.parse(j.out); } catch (e) { /* reported below */ }
  t('D07', '--json gives the same result as data', !!parsed && parsed.counts.total === 6 && parsed.timeline.length === 5 && parsed.unavailable.length === 1, j.out.slice(0, 200));
  var badHome = path.join(TMP, 'bad-home'); fs.mkdirSync(badHome); fs.writeFileSync(path.join(badHome, 'index.json'), '{not json');
  var bad = cli(['--home', badHome, 'tag', path.join(d, 'sources', 'tooling-cost-model.xlsx'), '::Cost']);
  t('D08', 'an unreadable index stops with a clear message and is left untouched', bad.code !== 0 && /not readable as a Work Index file/.test(bad.err) && fs.readFileSync(path.join(badHome, 'index.json'), 'utf8') === '{not json', bad.err);
  var noTag = cli(['--home', home, 'context', 'cost']), noFile = cli(['--home', home, 'tag', path.join(d, 'sources', 'missing.xlsx'), '::Cost']);
  t('D09', 'a lookup without ::, and tagging a file that is not there, both explain what to do', noTag.code !== 0 && /Type a tag such as ::Cost/.test(noTag.err) && noFile.code !== 0 && /file not found/.test(noFile.err), noTag.err + noFile.err);
})();

/* ───────── G. static checks ───────── */
(function () {
  function src(rel) { return { f: rel, s: fs.readFileSync(path.join(ROOT, rel), 'utf8') }; }
  var core = ['core/rules.js', 'core/read.js', 'core/popover.js'].map(src);
  var dev = ['dev/workindex.js', 'dev/lib/readers.js', 'dev/lib/store.js', 'dev/lib/ops.js', 'dev/lib/macos.js', 'experimental/connector/mcp.js'].map(src);
  var libs = core.concat(dev), net = [];
  libs.forEach(function (x) {
    (x.s.match(/require\(['"](https?|http2|net|tls|dgram|dns|undici|node:https?|node:net|node:tls|node:dgram|node:dns)['"]\)|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|\.listen\s*\(|createServer/g) || []).forEach(function (m) { net.push(x.f + ': ' + m); });
  });
  t('G01', 'no code opens a network connection or listens on a port: no http, https, net, tls, dns, fetch, sockets or servers anywhere', net.length === 0, net.join(' | '));
  var hostApi = core.map(function (x) { return (x.s.replace(/require\('\.\/(rules|read)\.js'\)/g, '').replace(/typeof module !== 'undefined' && module\.exports\) module\.exports/g, '').match(/\brequire\(|\bprocess\.|\bBuffer\b|\bfs\.|__dirname|localStorage|sessionStorage|indexedDB|document\.cookie/g) || []).map(function (m) { return x.f + ': ' + m; }); }).reduce(function (a, b) { return a.concat(b); }, []);
  t('G02', 'the rules, the readers and the popover rules use no file, process or storage API: they only work on what they are handed', hostApi.length === 0, hostApi.join(' | '));
  var child = libs.filter(function (x) { return /child_process/.test(x.s); }).map(function (x) { return x.f; }).join();
  var mac = dev.filter(function (x) { return x.f === 'dev/lib/macos.js'; })[0].s;
  t('G03', 'in the development harness, other programs are started only by its macOS helper, and only osascript, lsappinfo and pbcopy', child === 'dev/lib/macos.js' && (mac.match(/execFileSync\('([^']+)'/g) || []).every(function (m) { return /\/usr\/bin\/(osascript|lsappinfo|pbcopy)/.test(m); }), child);
  var rules = core[0].s, scripts = (rules.match(/'with timeout[\s\S]*?end timeout'/g) || []).join('\n');
  var commands = scripts.replace(/"[^"\n]*"/g, '""');                    /* drop the quoted messages; what is left is what the scripts do */
  var writes = commands.match(/\b(make|delete|move|duplicate|save|send|open|close|quit|activate|keystroke|click|do shell script|do script|clipboard|every|notes of|messages of(?! mailbox)|set (?!sel to|m to|n to|mb to|f to)[^\n]*)\b/gi) || [];
  t('G05', 'the AppleScript sources only read one selected or identified object: no make, delete, move, send, no property changes, no "every note/message"', scripts.length > 500 && (rules.match(/'with timeout/g) || []).length === 13 && writes.length === 0, writes.join(' | '));
  var page = fs.readFileSync(path.join(ROOT, 'core', 'popover.html'), 'utf8'), built = fs.readFileSync(path.join(ROOT, 'app', 'Resources', 'popover.html'), 'utf8');
  var pageBad = page.match(/localStorage|sessionStorage|indexedDB|document\.cookie|https?:\/\/|<script[^>]+src=|<link\b|@import|<img\b|<iframe\b|innerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|fetch\(|XMLHttpRequest|WebSocket|navigator\.clipboard|window\.open|location\.(href|assign|replace)/gi) || [];
  t('G06', 'the popover page loads nothing, links to nothing, stores nothing, never builds markup from text, and reaches the clipboard only through the app', pageBad.length === 0 && /default-src 'none'/.test(page), pageBad.join(' | '));
  var want = page.split('/*__RULES__*/').join(core[0].s).split('/*__READ__*/').join(core[1].s).split('/*__POPOVER__*/').join(core[2].s);
  t('G07', 'the page inside the app is exactly the page, the rules, the readers and the popover rules of this build (nothing older, nothing extra)', built.replace(/<\\\/script/g, '</script') === want.replace(/<\\\/script/g, '</script') && built.indexOf('/*__') < 0, built.length + ' vs ' + want.length);
  var keep = [];
  libs.forEach(function (x) { (x.s.match(/writeFileSync\([^)]*\)|appendFile\w*\(|createWriteStream\(/g) || []).forEach(function (m) { keep.push(x.f + ': ' + m); }); });
  t('G08', 'the harness writes one file, the index; no cache, snapshot, archive, history or revision store is named anywhere in the code', keep.length === 1 && /^dev\/lib\/store\.js: writeFileSync\(tmp,/.test(keep[0]) && libs.every(function (x) { return !/\b(cache|memo|snapshot|archive|history|revision)\w*\s*[=:\[]/i.test(x.s); }), keep.join(' | '));
})();

/* ───────── I. macOS helper: the parts that can run anywhere ───────── */
(function () {
  var S = Core.SEP, off = 540;
  var em = Core.parseActive(['email', '20261110.0912.rq2@harborline-tooling.example', 'Revised tooling quote', '2026-11-10T09:12:00', 'Work', 'INBOX', '4821'].join(S) + '\n', off);
  var nt = Core.parseActive(['note', 'x-coredata://6F1C/ICNote/p42', 'Supplier call notes', '2026-11-12T17:20:00', '2026-11-12T16:50:00'].join(S), off);
  t('I01', 'a Mail reply becomes an email entry keyed by Message-ID (the same id an .eml copy gets), with the sent date', em.ok && em.desc.id === 'mid:20261110.0912.rq2@harborline-tooling.example' && em.desc.sourceTime === '2026-11-10T09:12:00+09:00' && em.desc.sourceTimeType === 'sent' && em.desc.locator.extra.mailbox === 'INBOX', JSON.stringify(em));
  t('I02', 'a Notes reply becomes a note entry keyed by the note\'s own identifier, with last-saved and created dates', nt.ok && nt.desc.id === 'applenotes:x-coredata://6F1C/ICNote/p42' && nt.desc.sourceTimeType === 'modified' && nt.desc.sourceCreated === '2026-11-12T16:50:00+09:00', JSON.stringify(nt));
  var er = Core.parseActive('ERR' + S + 'Select exactly one message in Mail.', off), p = Core.parseActive('path' + S + '/Users/x/costs.xlsx', off), u = Core.parseActive('url' + S + 'https://example.test/a' + S + 'A page', off);
  t('I03', 'several objects selected, a file path and a browser tab are each handled', !er.ok && /exactly one message/.test(er.reason) && p.path === '/Users/x/costs.xlsx' && u.url === 'https://example.test/a' && u.title === 'A page');
  var inj = Core.scriptForApp('com.apple.mail" & (do shell script "x") & "'), unknown = Core.scriptForApp('com.example.unknown'), chrome = Core.scriptForApp('com.google.Chrome');
  var extra = Core.scriptForApp('com.example.somebrowser', ['com.example.somebrowser']), extraBad = Core.scriptForApp('x" & "y', ['x" & "y']);
  t('I05', 'a Chromium-family browser that is not built in can be added by its identifier; nothing is guessed', /tell application id "com\.example\.somebrowser"/.test(extra || '') && extraBad === null && Core.scriptForApp('com.aside.browser') === null);
  var badNote = Core.scriptForRead({ type: 'apple-notes', value: 'x-coredata://A/ICNote/p1" & (do shell script "x") & "' }), okNote = Core.scriptForRead({ type: 'apple-notes', value: 'x-coredata://6F1C-22/ICNote/p42' });
  var mailRead = Core.scriptForRead({ type: 'apple-mail', value: 'm', extra: { account: 'Work "A"', mailbox: 'INBOX', numericId: '4821' } }), mailBad = Core.scriptForRead({ type: 'apple-mail', value: 'm', extra: { account: 'Work', mailbox: 'INBOX', numericId: '1 or true' } });
  t('I04', 'script text cannot be bent by a crafted app id, note id or mailbox name', inj === null && unknown === null && /tell application id "com\.google\.Chrome"/.test(chrome) && badNote === null && /note id "x-coredata:\/\/6F1C-22\/ICNote\/p42"/.test(okNote) && /account "Work \\"A\\""/.test(mailRead) && mailBad === null);
})();

require('./groups-sync.js')({ t: t, ROOT: ROOT, Core: Core, Read: Read });
require('./groups-brand.js')({ t: t, ROOT: ROOT });

/* ───────── X. experimental connector (MCP over stdio), H. speed — asynchronous ───────── */
function mcpSession(home, messages, cb) {
  var child = cp.spawn(process.execPath, [path.join(ROOT, 'dev', 'workindex.js'), '--home', home, 'mcp'], { env: Object.assign({}, process.env, { TZ: 'Asia/Seoul' }) });
  var out = '', replies = [], i = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', function (c) {
    out += c; var k;
    while ((k = out.indexOf('\n')) >= 0) { var line = out.slice(0, k); out = out.slice(k + 1); if (line.trim()) { replies.push(JSON.parse(line)); next(); } }
  });
  function next() {
    while (i < messages.length) {
      var m = messages[i++];
      if (typeof m === 'function') { m(replies); continue; }
      child.stdin.write((typeof m === 'string' ? m : JSON.stringify(m)) + '\n');
      if (typeof m === 'string' || m.id !== undefined) return;            /* wait for the reply */
    }
    child.stdin.end();
  }
  child.on('close', function () { cb(replies); });
  next();
}
(function connectorTests() {
  var s = fresh('mcp'), wb = path.join(s.src, 'maintenance.xlsx');
  fs.copyFileSync(fx('maintenance-900.xlsx'), wb);
  fs.copyFileSync(demoFx('Revised tooling quote - Pine Ridge housing.eml'), path.join(s.src, 'quote.eml'));
  Ops.tagInput(s.home, wb, '::Cost'); Ops.tagInput(s.home, path.join(s.src, 'quote.eml'), '::Cost');
  var wbId = Readers.describePath(wb).desc.id;
  mcpSession(s.home, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'workindex_context', arguments: { query: 'what do we know about ::Cost so far?' } } },
    function () { fs.writeFileSync(wb, fs.readFileSync(fx('maintenance-820.xlsx'))); },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'workindex_context', arguments: { query: '::Cost' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'workindex_lookup', arguments: { query: '::Cost' } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'workindex_read', arguments: { id: wbId } } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'workindex_read', arguments: { id: 'file:/etc/passwd' } } },
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'workindex_read', arguments: { id: '../../etc/passwd' } } },
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'workindex_tags', arguments: {} } },
    { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'workindex_delete_everything', arguments: {} } },
    { jsonrpc: '2.0', id: 11, method: 'resources/read', params: { uri: 'file:///etc/passwd' } },
    '{ this is not json',
    { jsonrpc: '2.0', id: 12, method: 'ping' }
  ], function (r) {
    var by = {}; r.forEach(function (x) { by[x.id === null ? 'null' : x.id] = x; });
    var txt = function (id) { return by[id] && by[id].result && by[id].result.content ? by[id].result.content[0].text : ''; };
    t('X01', 'connector answers initialize with the client\'s protocol version, its name and instructions about ::Name', by[1] && by[1].result.protocolVersion === '2025-06-18' && by[1].result.serverInfo.name === 'work-index' && /::Name/.test(by[1].result.instructions) && !!by[1].result.capabilities.tools, JSON.stringify(by[1]).slice(0, 200));
    var tools = by[2] ? by[2].result.tools : [];
    t('X02', 'it offers four tools, all marked read-only; there is no tool that tags, writes or deletes', tools.map(function (x) { return x.name; }).join() === 'workindex_context,workindex_lookup,workindex_read,workindex_tags' && tools.every(function (x) { return x.annotations.readOnlyHint === true && x.inputSchema.type === 'object'; }), tools.map(function (x) { return x.name; }).join());
    t('X03', 'a chat message containing ::Cost resolves both sources and quotes their current contents with citation labels', /2 linked sources: 2 read just now/.test(txt(3)) && /B2: 900\b/.test(txt(3)) && /\[E1\]/.test(txt(3)) && /\[W1 › Summary!A1\]/.test(txt(3)) && by[3].result.structuredContent.counts.read === 2 && by[3].result.isError === false, txt(3).slice(0, 200));
    t('X04', 'same session, workbook overwritten between two calls: the second answer has only 820 (nothing cached)', /B2: 820\b/.test(txt(4)) && !/\b900\b/.test(txt(4)) && by[4].result.structuredContent.counts.total === 2, (txt(4).match(/.{0,30}\b900\b.{0,30}/) || [''])[0]);
    t('X05', 'lookup lists the sources from the index without their contents', /::Cost: 2 linked sources/.test(txt(5)) && !/B2:|USD 48,500/.test(txt(5)) && by[5].result.structuredContent.sources.length === 2, txt(5));
    t('X06', 'read returns one source in full by its id', /B2: 820\b/.test(txt(6)) && /1 linked source: 1 read just now/.test(txt(6)), txt(6).slice(0, 160));
    t('X07', 'read refuses anything that is not an indexed entry (a system file path, a path with ../)', by[7].result.isError === true && by[8].result.isError === true && !/root:/.test(txt(7) + txt(8)) && /Only sources in the index can be read/.test(txt(7)), txt(7) + ' | ' + txt(8));
    t('X08', 'tags lists the tags in use', /::Cost \(2\)/.test(txt(9)), txt(9));
    t('X09', 'unknown tool, unknown method and malformed input get proper errors and the session carries on', by[10].error && by[10].error.code === -32602 && by[11].error && by[11].error.code === -32601 && by['null'] && by['null'].error.code === -32700 && by[12] && JSON.stringify(by[12].result) === '{}', JSON.stringify([by[10], by[11], by['null'], by[12]]).slice(0, 300));
    t('X10', 'the notification got no reply: 13 replies to 13 requests', r.length === 13, r.length);
    require('./groups-popover.js')({ t: t, fresh: fresh, fx: fx, demoFx: demoFx, Core: Core, Popover: Popover }).then(null, function (e) { t('PO00', 'the popover group ran to the end', false, e && e.stack); })
      .then(function () { return require('./groups-012.js')({ t: t, fresh: fresh, ROOT: ROOT, Core: Core, Popover: Popover }); }).then(null, function (e) { t('N1200', 'the 0.12 groups ran to the end', false, e && e.stack); })
      .then(function () { return require('./groups-cloud.js')({ t: t, fresh: fresh, ROOT: ROOT, Core: Core, Popover: Popover }); }).then(null, function (e) { t('CL00', 'the cloud-folder group ran to the end', false, e && e.stack); }).then(speedTests);
  });
})();

function speedTests() {
  var s = fresh('speed'), idx = Core.emptyIndex(), N = 10000;
  for (var i = 0; i < N; i++) {
    var id = 'file:/fictional/archive/doc-' + i + '.xlsx';
    idx.objects[id] = { id: id, kind: 'workbook', title: 'doc-' + i + '.xlsx', tags: i % 50 === 0 ? ['Cost', 'Tooling'] : ['T' + (i % 300)], tagKeys: i % 50 === 0 ? ['cost', 'tooling'] : ['t' + (i % 300)],
      locator: { type: 'file', value: '/fictional/archive/doc-' + i + '.xlsx' }, sourceTime: '2026-11-18T16:40:00+09:00', sourceTimeType: 'modified', sourceCreated: null, capturedAt: '2026-11-19T09:00:00+09:00', updatedAt: '2026-11-19T09:00:00+09:00' };
  }
  Store.save(s.home, idx);
  var times = [], n = 0;
  for (var k = 0; k < 15; k++) { var t0 = process.hrtime.bigint(); var r = Ops.lookup(s.home, '::Cost'); n = r.records.length; times.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  times.sort(function (a, b) { return a - b; });
  var median = times[7], worst = times[14], size = fs.statSync(Store.indexPath(s.home)).size;
  t('H01', 'resolving ::Cost in a 10,000-entry index (file read, parse, match, 200 existence checks): median ' + median.toFixed(0) + ' ms, slowest ' + worst.toFixed(0) + ' ms on this machine; target under 500 ms', n === 200 && median < 500, 'median ' + median + ' worst ' + worst);
  results.push({ id: 'H01-measure', desc: 'measurement', ok: true, detail: JSON.stringify({ entries: N, matches: n, medianMs: +median.toFixed(1), slowestMs: +worst.toFixed(1), indexBytes: size, bytesPerEntry: Math.round(size / N) }) });
  finish();
}

function finish() {
  var failed = results.filter(function (r) { return !r.ok; });
  console.log('\n== ' + (results.length - failed.length - 1) + '/' + (results.length - 1) + ' checks passed' + (failed.length ? '; FAILED: ' + failed.map(function (r) { return r.id; }).join(', ') : '') + ' ==');
  console.log(results.filter(function (r) { return r.id === 'H01-measure'; })[0].detail);
  try { fs.writeFileSync(path.join(__dirname, 'last-results.json'), JSON.stringify(results, null, 1)); } catch (e) { /* read-only checkout */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* leave it */ }
  process.exit(failed.length ? 1 : 0);
}
