#!/usr/bin/env node
/* contexta 0.12.1 — layout checks for the popover whose height follows its content, and for its bottom toolbar.
 * The page bundled into the app (app/Resources/popover.html) runs in a real browser against the pretend Mac. The
 * Swift side is stood in for: when the page sends its height, this test does what AppDelegate.fitPopover does
 * (width 352, height within 160 and the room) and resizes the browser's viewport to it, as the popover would.
 *   NODE_PATH=<folder with playwright> CHROME=<browser> node tests/ui-0121.js [folder for pictures]
 *   ENGINE=webkit uses Playwright's WebKit instead of Chrome (closer to the app's WKWebView, still not the app).
 * SIMULATED: this is a browser, not the app's WKWebView inside an NSPopover on macOS. Measurements are CSS pixels,
 * which are points in the app. All data is fictional. */
'use strict';
process.env.TZ = 'Asia/Seoul';
var fs = require('fs'), os = require('os'), path = require('path');
var ROOT = path.join(__dirname, '..'), Mac = require('./lib/mac.js'), Popover = require('../core/popover.js');
var pw = require('playwright'), ENGINE = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium', results = [], SHOTS = process.argv[2] || '', measured = [];
function t(id, desc, ok, detail) { results.push({ id: id, desc: desc, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + id + '  ' + desc + (ok ? '' : '\n       → ' + String(detail === undefined ? '' : detail).slice(0, 900))); }
var NOTES = 'com.apple.Notes', FINDER = 'com.apple.finder', MIN = 160, WIDTH = 352;
function nid(i) { return 'x-coredata://FICTIONAL-01201/ICNote/p' + i; }

(async function () {
  var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'context-ui0121-')), mac = Mac.create(TMP), clock = 0, seed = Popover.create(mac.host, { now: function () { return Date.parse('2026-11-20T10:00:00+09:00') + 60000 * clock++; } });  /* a minute per call: recent tags are ordered by last use */
  async function tag(bid, sel, tags) { mac.select(bid, [sel]); await seed.opened({ bundleId: bid }); await seed.save(tags); await seed.closed(); }
  function tagsOn(id) { return (mac.objects()[id] || { tags: [] }).tags.join(); }
  /* fictional notes: 1–3 plain, 4 with a long Korean title, 10–69 for a large result */
  mac.addNote({ id: nid(1), title: 'Zz supplier call', text: 'Harborline holds the price until Nov 30.', modified: '2026-11-12T17:20:00', created: '2026-11-12T16:50:00' });
  mac.addNote({ id: nid(2), title: 'Zz budget meeting', text: 'Travel budget is separate.', modified: '2026-11-13T10:00:00', created: '2026-11-13T09:40:00' });
  mac.addNote({ id: nid(3), title: 'Zz untagged note', text: 'Nothing here yet.', modified: '2026-11-14T10:00:00', created: '2026-11-14T09:40:00' });
  var KTITLE = '2026년 하반기 금형 유지보수 계약 갱신 관련 협력사 회의록 및 후속 조치 사항 정리 (가상의 예시 문서, 제목이 아주 길어서 여러 줄로 넘어갑니다)';
  mac.addNote({ id: nid(4), title: KTITLE, text: '가상의 회의 내용입니다.', modified: '2026-11-15T10:00:00', created: '2026-11-15T09:40:00' });
  for (var i = 10; i < 70; i++) mac.addNote({ id: nid(i), title: 'Zz weekly report ' + i, text: 'Fictional weekly report number ' + i + '. Line two of the report.', modified: '2026-10-' + String(1 + (i % 28)).padStart(2, '0') + 'T09:00:00', created: '2026-10-01T09:00:00' });

  var br = await pw[ENGINE].launch(ENGINE === 'chromium' ? { executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] } : (process.env.WEBKIT ? { executablePath: process.env.WEBKIT } : {}));
  var cx = await br.newContext({ viewport: { width: WIDTH, height: 440 }, deviceScaleFactor: 2 }), pg = await cx.newPage(), errs = [], reqs = [], sizes = [], room = 720;
  pg.on('pageerror', function (e) { errs.push('pageerror: ' + e.message); });
  pg.on('console', function (m) { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  pg.on('request', function (r) { if (!/^(file|data|about):/.test(r.url())) reqs.push(r.url()); });
  await pg.exposeFunction('__workIndexTestCall', function (op, arg) { if (op === 'close' || op === 'quit' || op === 'access' || op === 'settings' || op === 'preferences') return { ok: true }; return mac.call(op, arg); });
  /* the stand-in for AppDelegate.fitPopover: the same clamp, then the popover (here the viewport) takes that size */
  await pg.exposeFunction('__workIndexTestSize', async function (w, h) { var applied = Math.min(room, Math.max(MIN, Math.ceil(h))); sizes.push({ w: w, h: h, applied: applied, at: Date.now() }); await pg.setViewportSize({ width: WIDTH, height: applied }); return applied; });
  await pg.goto('file://' + path.join(ROOT, 'app', 'Resources', 'popover.html'));
  async function settle() { await pg.waitForTimeout(140); var n = sizes.length; await pg.waitForTimeout(120); return sizes.length === n; }
  async function open(info) { info.room = room; await pg.evaluate(function (i) { return window.workIndexOpened(i); }, info); await settle(); }
  async function close() { await pg.evaluate(function () { return window.workIndexClosed(); }); await settle(); }
  async function shot(name) { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, name) }); }

  /* one measurement of the page as it is now */
  async function measure(label) {
    var m = await pg.evaluate(function () {
      function r(e) { var b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }
      var footer = document.getElementById('footer'), tools = Array.prototype.slice.call(footer.querySelectorAll('button')), f = r(footer), frame = r(document.getElementById('frame'));
      var wide = Array.prototype.slice.call(document.querySelectorAll('#frame *')).filter(function (e) { var b = e.getBoundingClientRect(); return b.width && b.right > window.innerWidth + 0.5 && !e.closest('#sources,#manageList,.chip,.token'); }).map(function (e) { return e.id || e.className; });
      var list = document.body.getAttribute('data-mode') === 'manage' ? document.getElementById('manageList') : document.getElementById('sources');
      return { vw: window.innerWidth, vh: window.innerHeight, docW: document.documentElement.scrollWidth, frameH: Math.round(frame.h * 10) / 10, sent: +document.body.getAttribute('data-height'), room: +document.body.getAttribute('data-room'),
        footerTop: f.t, footerBottom: f.b, toolsInside: tools.every(function (b) { var x = r(b); return x.l >= f.l + 1 && x.r <= f.r - 1 && x.t >= f.t && x.b <= f.b && x.h >= 24 && x.r <= window.innerWidth - 4; }),
        toolsRow: tools.every(function (b) { return Math.abs(r(b).t - r(tools[0]).t) < 1; }), wide: wide, mode: document.body.getAttribute('data-mode'),
        listScrolls: list.scrollHeight > list.clientHeight + 1, listH: Math.round(list.getBoundingClientRect().height), mainClamped: document.getElementById('main').classList.contains('clamped'),
        titleLines: Math.round(document.getElementById('itemTitle').getBoundingClientRect().height / 18), chipRows: (function () { var tops = {}; document.querySelectorAll('#tagChips .chip').forEach(function (c) { tops[Math.round(c.getBoundingClientRect().top)] = 1; }); return Object.keys(tops).length; })() };
    });
    m.label = label; m.engine = ENGINE; measured.push(m);
    m.ok = m.vw === WIDTH && m.docW === WIDTH && Math.abs(m.vh - Math.max(MIN, m.sent)) <= 0.5 && Math.abs(m.footerBottom - m.vh) <= 1 && m.toolsInside && m.toolsRow && !m.wide.length && m.vh <= room;
    return m;
  }
  function brief(m) { return m.label + ': ' + m.vw + ' × ' + m.vh + (m.listScrolls ? ' (list scrolls, ' + m.listH + ' tall)' : '') + (m.mainClamped ? ' (content scrolls)' : ''); }

  /* ── 0 tags in use: one note selected, nothing tagged anywhere ── */
  mac.select(NOTES, [nid(3)]); await open({ bundleId: NOTES, name: 'Notes' });
  var m0 = await measure('0 tags in use, untagged note'); await shot('L01-0-tags.png');
  t('L01', 'no tag in use: the popover is exactly as tall as its content (no blank list pane), 352 wide, the toolbar sits on the bottom edge with every button whole', m0.ok && m0.vh < 300 && !m0.listScrolls, JSON.stringify(m0));

  /* ── 1 tag ── */
  await close(); await tag(NOTES, nid(1), 'ZzAlpha');
  mac.select(NOTES, [nid(1)]); await open({ bundleId: NOTES, name: 'Notes' });
  var m1 = await measure('1 tag in use, note carries it'); await shot('L02-1-tag.png');
  t('L02', 'one tag in use (on the selected note): height follows the content, 352 wide, toolbar whole on the bottom edge', m1.ok, JSON.stringify(m1));

  /* ── 2 tags: the selected note at the two-tag cap; a third is refused ── */
  await close(); await tag(NOTES, nid(1), 'ZzAlpha ZzBeta');
  mac.select(NOTES, [nid(1)]); await open({ bundleId: NOTES, name: 'Notes' });
  var m2 = await measure('2 tags in use, note at the two-tag cap'); await shot('L03-2-tags-cap.png');
  var before = mac.indexText(); await pg.fill('#tagField', 'ZzGamma'); await pg.press('#tagField', 'Enter'); await settle();
  var capMsg = (await pg.textContent('#tagMsg')).trim(), m2b = await measure('2 tags, third refused');
  t('L03', 'two tags in use, the note carries both: the recent-tag row is gone, a third tag is refused and nothing is written, the popover still fits its content exactly', m2.ok && m2b.ok && mac.indexText() === before && tagsOn('applenotes:' + nid(1)) === 'ZzAlpha,ZzBeta' && /already has 2 tags/.test(capMsg) && m2.chipRows === 0, JSON.stringify([m2, capMsg]));

  /* ── many tags, with long Korean names: the recent row wraps and the popover grows to show it all ── */
  await close();
  var names = ['ZzGamma', '협력사회의록정리', '금형유지보수계약갱신', 'ZzDelta', '하반기예산검토자료', 'ZzEpsilon', '출장경비정산', 'ZzZeta', 'ZzEta', 'ZzTheta', 'ZzIota', 'ZzKappa'];
  for (var j = 0; j < names.length; j++) await tag(NOTES, nid(10 + j), names[j] + (j % 2 ? ' ZzAlpha' : ''));
  /* the three long Korean names on more sources, so that they are among the 8 recent tags */
  var KO = ['협력사회의록정리', '금형유지보수계약갱신', '하반기예산검토자료'];
  for (var q = 0; q < KO.length; q++) for (var u = 0; u < 3; u++) await tag(NOTES, nid(40 + q * 3 + u), KO[q]);
  mac.select(NOTES, [nid(3)]); await open({ bundleId: NOTES, name: 'Notes' });
  var mm = await measure('many tags in use, 8 recent incl. 3 long Korean names'); await shot('L04-many-tags-korean.png');
  var koChips = await pg.$$eval('#tagChips .chip', function (c) { return c.map(function (x) { return x.textContent; }).filter(function (x) { return /[가-힣]/.test(x); }); });
  var chipsCut = await pg.evaluate(function () { var box = document.getElementById('tagChips'), b = box.getBoundingClientRect(); return Array.prototype.slice.call(box.querySelectorAll('.chip')).filter(function (c) { var r = c.getBoundingClientRect(); return r.bottom > b.bottom + 0.5 || r.right > b.right + 0.5; }).length; });
  t('L04', 'many tags in use, long Korean names among the 8 recent ones: the chips wrap onto ' + mm.chipRows + ' rows, none is cut off, and the popover grows by that much (' + m0.vh + ' → ' + mm.vh + ')', mm.ok && mm.chipRows >= 2 && chipsCut === 0 && mm.vh > m0.vh && koChips.length === 3, JSON.stringify([mm, chipsCut, koChips]));

  /* ── a long Korean title: two lines at most, the popover keeps its width ── */
  await close(); mac.select(NOTES, [nid(4)]); await open({ bundleId: NOTES, name: 'Notes' });
  var mt = await measure('long Korean title'); await shot('L05-long-title.png');
  var titleFull = await pg.$eval('#itemTitle', function (e) { return e.title; });
  t('L05', 'a ' + KTITLE.length + '-character Korean title wraps to two lines (the whole title stays in its tooltip and for VoiceOver), nothing widens the popover past 352', mt.ok && mt.titleLines === 2 && titleFull === KTITLE, JSON.stringify(mt));

  /* ── a lookup: the popover grows for the sources, and shrinks back when they are gone ── */
  await close(); mac.select(NOTES, [nid(3)]); await open({ bundleId: NOTES, name: 'Notes' });
  var rest = await measure('before lookup');
  await pg.fill('#lookupField', 'ZzBeta'); await pg.press('#lookupField', 'Enter'); await settle(); await settle();
  var mf = await measure('lookup ZzBeta, 1 source'); await shot('L06-lookup-small.png');
  await pg.fill('#lookupField', 'ZzAlpha'); await pg.press('#lookupField', 'Enter'); await settle(); await settle();
  var mf2 = await measure('lookup ZzAlpha, several sources'); await shot('L06b-lookup.png');
  await close(); mac.select(NOTES, [nid(3)]); await open({ bundleId: NOTES, name: 'Notes' });
  var back = await measure('reopened after lookup');
  t('L06', 'height follows each state both ways: tag view ' + rest.vh + ', a 1-source lookup ' + mf.vh + ' (the item line folds to one row), a several-source lookup ' + mf2.vh + ' (taller, all rows shown without scrolling), opened again ' + back.vh + ' (back to the tag view exactly)', rest.ok && mf.ok && mf2.ok && back.ok && mf.vh !== rest.vh && mf2.vh > mf.vh && back.vh === rest.vh && !mf2.listScrolls, JSON.stringify([rest.vh, mf.vh, mf2.vh, back.vh]));

  /* ── a large result: 60 sources. The popover stops at the room on the screen; only the list scrolls ── */
  await close(); for (var k = 10; k < 70; k++) if (k >= 22) await tag(NOTES, nid(k), 'ZzWeekly');
  mac.select(NOTES, [nid(3)]); await open({ bundleId: NOTES, name: 'Notes' });
  await pg.fill('#lookupField', 'ZzWeekly'); await pg.press('#lookupField', 'Enter'); await settle(); await settle();
  var ml = await measure('48 sources, room 720'); await shot('L07-large-result-720.png');
  var copyVisible = await pg.evaluate(function () { var b = document.getElementById('copyBtn').getBoundingClientRect(); return b.bottom <= document.getElementById('footer').getBoundingClientRect().top + 0.5 && b.top >= 0; });
  t('L07', 'a large result (48 sources) in a 720-point room: the popover is 720 tall, the source list scrolls inside it (' + ml.listH + ' tall), the Copy bar and the toolbar stay in view', ml.ok && ml.vh === 720 && ml.listScrolls && !ml.mainClamped && copyVisible, JSON.stringify([ml, copyVisible]));
  /* a small screen: the app reports less room; the page lays out again for it */
  room = 420; await close(); mac.select(NOTES, [nid(3)]); await open({ bundleId: NOTES, name: 'Notes' });
  await pg.fill('#lookupField', 'ZzWeekly'); await pg.press('#lookupField', 'Enter'); await settle(); await settle();
  var ms = await measure('48 sources, room 420'); await shot('L08-large-result-420.png');
  var copyVisible2 = await pg.evaluate(function () { var b = document.getElementById('copyBtn').getBoundingClientRect(); return b.bottom <= document.getElementById('footer').getBoundingClientRect().top + 0.5 && b.top >= 0; });
  t('L08', 'the same result on a small screen (420-point room): 420 tall, the list scrolls (' + ms.listH + ' tall, at least 96), Copy and the toolbar still in view', ms.ok && ms.vh === 420 && ms.listScrolls && ms.listH >= 96 && copyVisible2, JSON.stringify([ms, copyVisible2]));
  room = 720;

  /* ── no resize loop ── */
  await close(); mac.select(NOTES, [nid(3)]); await open({ bundleId: NOTES, name: 'Notes' });
  await pg.fill('#lookupField', 'ZzWeekly'); await pg.press('#lookupField', 'Enter'); await settle(); await settle();
  var n0 = sizes.length; await pg.waitForTimeout(600); var idle = sizes.length - n0;
  await pg.setViewportSize({ width: WIDTH, height: 333 }); await pg.waitForTimeout(400); var afterForce = sizes.length - n0;
  var stillSent = await pg.evaluate(function () { return +document.body.getAttribute('data-height'); });
  await pg.setViewportSize({ width: WIDTH, height: stillSent });
  var openSends = []; await close(); var c0 = sizes.length; mac.select(NOTES, [nid(1)]); await open({ bundleId: NOTES, name: 'Notes' }); openSends.push(sizes.length - c0);
  t('L09', 'no resize loop: with the popover settled nothing more is sent for 0.6 s; when the window is resized from outside (to 333) the page measures itself, not the window, and sends nothing; one opening sends at most 3 heights (sent: ' + openSends[0] + ')', idle === 0 && afterForce === 0 && stillSent === 720 && openSends[0] <= 3, JSON.stringify([idle, afterForce, stillSent, openSends]));

  /* ── Manage tags: grows for the list, the rename form is its own height, Done shrinks back ── */
  await close(); mac.select(NOTES, [nid(1)]); await open({ bundleId: NOTES, name: 'Notes' });
  var home = await measure('tag view');
  await pg.click('#manageBtn'); await settle();
  var mg = await measure('Manage tags, every tag in use'); await shot('L10-manage.png');
  await pg.click('#manageList .tagrow:has-text("ZzBeta")'); await settle(); await pg.keyboard.type('ZzAlpha'); await settle();
  var mr = await measure('Manage tags, merge preview'); await shot('L10b-manage-merge.png');
  var idx = mac.indexText(); await pg.click('#renameCancel'); await settle(); await pg.click('#manageDone'); await settle();
  var done = await measure('after Done');
  t('L10', 'Manage tags: the popover takes the list\'s height (' + mg.vh + '), the merge preview its own (' + mr.vh + '), Done brings back the tag view at its own height (' + home.vh + ' → ' + done.vh + '); nothing was written', mg.ok && mr.ok && done.ok && mg.mode === 'manage' && done.vh === home.vh && mac.indexText() === idx, JSON.stringify([home.vh, mg, mr.vh, done.vh]));

  /* ── nothing selected ── */
  await close(); mac.select(FINDER, []); await open({ bundleId: FINDER, name: 'Finder' });
  var mn = await measure('nothing selected'); await shot('L11-nothing-selected.png');
  t('L11', 'nothing selected: a short popover, toolbar whole on the bottom edge', mn.ok && mn.vh < home.vh + 80, JSON.stringify(mn));

  /* ── the toolbar: accessible, no underlines, focus ring inside, Quit quiet ── */
  await close(); mac.select(NOTES, [nid(1)]); await open({ bundleId: NOTES, name: 'Notes' });
  var a11y = await pg.evaluate(function () {
    var f = document.getElementById('footer'), tools = Array.prototype.slice.call(f.querySelectorAll('button'));
    function lum(c) { var m = c.match(/[\d.]+/g).map(Number).slice(0, 3).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; }
    function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
    var bg = getComputedStyle(f).backgroundColor;
    return { role: f.getAttribute('role'), label: f.getAttribute('aria-label'), names: tools.map(function (b) { return b.getAttribute('aria-label') || b.textContent.trim(); }), text: tools.map(function (b) { return b.textContent.trim(); }),
      underline: Array.prototype.slice.call(document.querySelectorAll('.tool,.link,#itemLine .go')).filter(function (e) { return getComputedStyle(e).textDecorationLine.indexOf('underline') >= 0; }).length,
      quietColor: getComputedStyle(document.getElementById('quitBtn')).color, mainColor: getComputedStyle(document.getElementById('accessBtn')).color,
      contrast: tools.map(function (b) { return Math.round(ratio(getComputedStyle(b).color, bg) * 100) / 100; }), pressed: document.getElementById('manageBtn').getAttribute('aria-pressed'), svgHidden: Array.prototype.slice.call(f.querySelectorAll('svg')).every(function (s) { return s.getAttribute('aria-hidden') === 'true'; }) };
  });
  await pg.focus('#tagField'); var tabs = [];
  for (var n = 0; n < 12; n++) { await pg.keyboard.press('Tab'); var id = await pg.evaluate(function () { return document.activeElement.id; }); tabs.push(id); if (id === 'quitBtn') break; }
  await pg.focus('#accessBtn'); await pg.keyboard.press('Tab'); await pg.keyboard.press('Shift+Tab');
  var ring = await pg.evaluate(function () { var s = getComputedStyle(document.activeElement); return { id: document.activeElement.id, style: s.outlineStyle, width: s.outlineWidth, offset: s.outlineOffset }; });
  await shot('L12-toolbar-focus.png');
  await pg.keyboard.press('ArrowRight'); var r1 = await pg.evaluate(function () { return document.activeElement.id; });
  await pg.keyboard.press('End'); var r2 = await pg.evaluate(function () { return document.activeElement.id; });
  await pg.keyboard.press('Home'); var r3 = await pg.evaluate(function () { return document.activeElement.id; });
  await pg.keyboard.press('ArrowLeft'); var r4 = await pg.evaluate(function () { return document.activeElement.id; });
  t('L12', 'the toolbar: role toolbar with a name; buttons App access, Settings, Manage tags and Quit (spoken "Quit contexta"), icons hidden from VoiceOver; no underline anywhere at rest; Quit greyer than the rest but still at least 4.5:1; Tab still reaches every button in order; the keyboard focus ring is drawn inside the button (offset ' + ring.offset + '); arrows, Home and End move along the toolbar',
    a11y.role === 'toolbar' && a11y.label === 'contexta' && a11y.text.join() === 'App access,Settings,Manage tags,Quit' && a11y.names[3] === 'Quit contexta' && a11y.svgHidden && a11y.underline === 0 && a11y.quietColor !== a11y.mainColor && a11y.contrast.every(function (c) { return c >= 4.5; }) &&
    tabs.slice(-4).join() === 'accessBtn,prefsBtn,manageBtn,quitBtn' && ring.id === 'accessBtn' && ring.style === 'solid' && ring.width === '2px' && parseFloat(ring.offset) < 0 && r1 === 'prefsBtn' && r2 === 'quitBtn' && r3 === 'accessBtn' && r4 === 'accessBtn',
    JSON.stringify([a11y, tabs, ring, r1, r2, r3, r4]));

  t('L13', 'no page errors and no request to any address the whole time', errs.length === 0 && reqs.length === 0, errs.concat(reqs).join(' | '));

  var w = measured.map(function (m) { return m.vw; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
  t('L14', 'every one of the ' + measured.length + ' measured states is exactly 352 wide (widths seen: ' + w.join(', ') + ') and fits its content with the toolbar on the bottom edge', w.join() === '352' && measured.every(function (m) { return m.ok; }), JSON.stringify(measured.filter(function (m) { return !m.ok; })));

  console.log('\nMeasured (' + ENGINE + ', SIMULATED: a browser standing in for the WKWebView in an NSPopover):');
  measured.forEach(function (m) { console.log('  ' + brief(m)); });
  await br.close();
  var failed = results.filter(function (r) { return !r.ok; });
  fs.writeFileSync(path.join(__dirname, 'last-ui-0121-' + ENGINE + '-results.json'), JSON.stringify({ engine: ENGINE, simulated: true, results: results, measured: measured.map(function (m) { return { label: m.label, width: m.vw, height: m.vh, sent: m.sent, room: m.room, listScrolls: m.listScrolls, listHeight: m.listH, contentScrolls: m.mainClamped, chipRows: m.chipRows, titleLines: m.titleLines }; }) }, null, 1));
  console.log('\n== ' + (results.length - failed.length) + '/' + results.length + ' layout checks for 0.12.1 passed (' + ENGINE + '; pretend Mac; simulated popover)' + (failed.length ? '; FAILED: ' + failed.map(function (r) { return r.id; }).join(', ') : '') + ' ==');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
