#!/usr/bin/env node
/* Evidence sheet for 0.12.1: the 0.12.0 popover (fixed 352 × 440) beside the 0.12.1 popover in the same fictional
 * state, then the states measured by tests/ui-0121.js with their sizes.
 *   NODE_PATH=<playwright> CHROME=<browser> node tests/ui-0121.js <shots>
 *   NODE_PATH=<playwright> CHROME=<browser> node tests/visual/evidence-0121.js <0.12.0 popover.html> <shots> <out.png>
 * SIMULATED: Chrome renders of the bundled pages against the pretend Mac, not macOS screenshots of the app. */
'use strict';
process.env.TZ = 'Asia/Seoul';
var fs = require('fs'), os = require('os'), path = require('path');
var ROOT = path.join(__dirname, '..', '..'), Mac = require('../lib/mac.js'), Popover = require('../../core/popover.js'), chromium = require('playwright').chromium;
var OLD = process.argv[2], SHOTS = process.argv[3], OUT = process.argv[4];
if (!OLD || !SHOTS || !OUT) { console.log('usage: node tests/visual/evidence-0121.js <0.12.0 popover.html> <shots folder> <out.png>'); process.exit(2); }
var NOTES = 'com.apple.Notes', N1 = 'x-coredata://FICTIONAL-01201/ICNote/p1';

(async function () {
  var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'context-ev0121-')), mac = Mac.create(TMP), seed = Popover.create(mac.host, { now: function () { return Date.parse('2026-11-20T10:00:00+09:00'); } });
  mac.addNote({ id: N1, title: 'Zz supplier call', text: 'Harborline holds the price until Nov 30.', modified: '2026-11-12T17:20:00', created: '2026-11-12T16:50:00' });
  mac.select(NOTES, [N1]); await seed.opened({ bundleId: NOTES }); await seed.save('ZzAlpha'); await seed.closed();
  var br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  async function render(file, height, name) {
    var cx = await br.newContext({ viewport: { width: 352, height: height }, deviceScaleFactor: 2 }), pg = await cx.newPage();
    await pg.exposeFunction('__workIndexTestCall', function (op, arg) { if (/^(close|quit|access|settings|preferences)$/.test(op)) return { ok: true }; return mac.call(op, arg); });
    var sent = 0; await pg.exposeFunction('__workIndexTestSize', function (w, h) { sent = h; return h; });
    await pg.goto('file://' + file);
    mac.select(NOTES, [N1]); await pg.evaluate(function () { return window.workIndexOpened({ bundleId: 'com.apple.Notes', name: 'Notes', room: 720 }); }); await pg.waitForTimeout(250);
    if (sent && sent !== height) { await pg.setViewportSize({ width: 352, height: sent }); await pg.waitForTimeout(150); }
    var out = path.join(TMP, name); await pg.screenshot({ path: out }); var h = sent || height; await cx.close(); return { file: out, h: h };
  }
  var before = await render(path.resolve(OLD), 440, 'before.png'), after = await render(path.join(ROOT, 'app', 'Resources', 'popover.html'), 440, 'after.png');
  var measured = {}; try { JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'last-ui-0121-chromium-results.json'), 'utf8')).measured.forEach(function (m) { measured[m.label] = m; }); } catch (e) {}
  var gallery = [['L01-0-tags.png', '0 tags in use, untagged note'], ['L03-2-tags-cap.png', '2 tags in use, note at the two-tag cap'], ['L04-many-tags-korean.png', 'many tags in use, 8 recent incl. 3 long Korean names'], ['L05-long-title.png', 'long Korean title'],
    ['L06b-lookup.png', 'lookup ZzAlpha, several sources'], ['L08-large-result-420.png', '48 sources, room 420'], ['L10-manage.png', 'Manage tags, every tag in use'], ['L11-nothing-selected.png', 'nothing selected']];
  function img(f) { return 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'); }
  var cells = gallery.filter(function (g) { return fs.existsSync(path.join(SHOTS, g[0])); }).map(function (g) { var m = measured[g[1]]; return '<figure><img src="' + img(path.join(SHOTS, g[0])) + '"><figcaption>' + g[1] + '<b>' + (m ? m.width + ' × ' + m.height + (m.listScrolls ? ', list scrolls' : '') : '') + '</b></figcaption></figure>'; }).join('');
  var html = '<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:22px;background:#dfe2e5;font:13px -apple-system,Helvetica,Arial,sans-serif;color:#1d1f21;width:1500px}h1{font-size:18px;font-weight:600;margin:0 0 4px}p{margin:0 0 14px;color:#4a4f54}' +
    '.row{display:flex;gap:26px;align-items:flex-start;margin-bottom:22px}.g{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}figure{margin:0}img{display:block;width:176px;border-radius:9px;box-shadow:0 1px 4px rgba(0,0,0,.25)}.big img{width:352px}figcaption{padding:5px 1px;width:176px;font-size:11.5px}.big figcaption{width:352px;font-size:13px}figcaption b{display:block;font-weight:600}</style>' +
    '<h1>contexta popover: 0.12.0 → 0.12.1</h1><p>SIMULATED: Chrome renders of the pages bundled into each app, against the same fictional pretend Mac. Not macOS screenshots: the app\'s WKWebView inside an NSPopover may draw fonts and controls slightly differently. Sizes are CSS pixels (= points).</p>' +
    '<div class="row"><figure class="big"><img src="' + img(before.file) + '"><figcaption>0.12.0, one tag in use<b>fixed 352 × 440, blank list pane, underlined links on the bottom edge</b></figcaption></figure>' +
    '<figure class="big"><img src="' + img(after.file) + '"><figcaption>0.12.1, same state<b>352 × ' + after.h + ', height from content, toolbar along the bottom</b></figcaption></figure></div>' +
    '<p>More 0.12.1 states, as measured by tests/ui-0121.js (shown at half size):</p><div class="g">' + cells + '</div>';
  var cx = await br.newContext({ viewport: { width: 1544, height: 900 }, deviceScaleFactor: 1 }), pg = await cx.newPage();
  await pg.setContent(html); await pg.waitForTimeout(200); await pg.screenshot({ path: OUT, fullPage: true });
  await br.close(); fs.rmSync(TMP, { recursive: true, force: true });
  console.log(OUT + '  (before 352 × 440, after 352 × ' + after.h + ')');
})().catch(function (e) { console.error(e); process.exit(2); });
