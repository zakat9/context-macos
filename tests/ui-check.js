#!/usr/bin/env node
/* Context — page safety checks: the two pages as they are bundled into the Mac app (popover.html at 352 × 440,
 * access.html at 360 × 338), driven in a real browser against a pretend Mac. These carry over the 0.10 page checks
 * that the five cycles do not repeat: markup is never run, the 900 → 820 acceptance test in the page, nothing is
 * kept after closing, and the pages talk to nothing but the app.
 *   NODE_PATH=<folder with playwright> CHROME=/usr/bin/google-chrome node tests/ui-check.js
 * This is Chrome, not the WebKit view inside the app, and the pretend Mac stands in for the Swift side. */
'use strict';
process.env.TZ = 'Asia/Seoul';
var fs = require('fs'), os = require('os'), path = require('path');
var ROOT = path.join(__dirname, '..'), Mac = require('./lib/mac.js'), Prompts = require('./lib/macos-prompts.js');
var chromium = require('playwright').chromium, results = [];
function t(id, desc, ok, detail) { results.push({ id: id, desc: desc, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + id + '  ' + desc + (ok ? '' : '\n       → ' + String(detail === undefined ? '' : detail).slice(0, 500))); }
function fx(n) { return path.join(ROOT, 'tests', 'fixtures', n); }
var NOTES = 'com.apple.Notes', FINDER = 'com.apple.finder', EVIL = '<img src=x onerror="window.__x=1"> Budget notes';

(async function () {
  var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'context-ui-')), mac = Mac.create(TMP);
  mac.addNote({ id: 'x-coredata://FICTIONAL-0001/ICNote/p1', title: EVIL, text: EVIL + '\n<script>window.__y=1</script> line two', modified: '2026-11-13T10:00:00', created: '2026-11-13T09:00:00' });
  var wb = mac.write('maintenance.xlsx', fs.readFileSync(fx('maintenance-900.xlsx')));
  var br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  var pg = await (await br.newContext({ viewport: { width: 352, height: 440 } })).newPage(), errs = [], reqs = [];
  pg.on('pageerror', function (e) { errs.push('pageerror: ' + e.message); });
  pg.on('console', function (m) { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  pg.on('request', function (r) { reqs.push(r.url()); });
  await pg.exposeFunction('__workIndexTestCall', function (op, arg) { if (op === 'close' || op === 'quit' || op === 'access' || op === 'settings') return { ok: true }; return mac.call(op, arg); });
  await pg.goto('file://' + path.join(ROOT, 'app', 'Resources', 'popover.html'));
  async function open(bid) { await pg.evaluate(function (b) { return window.workIndexOpened({ bundleId: b, name: '<b>App</b>' }); }, bid); await pg.waitForTimeout(60); }
  async function listed() { await pg.waitForFunction(function () { return document.getElementById('sources').getAttribute('aria-busy') === 'false' && !/Checking/.test(document.getElementById('copyBtn').textContent); }); await pg.waitForTimeout(60); }

  mac.select(NOTES, ['x-coredata://FICTIONAL-0001/ICNote/p1']); await open(NOTES);
  await pg.fill('#tagField', 'Cost'); await pg.press('#tagField', 'Enter'); await pg.waitForTimeout(80);
  await pg.fill('#lookupField', 'Cost'); await pg.press('#lookupField', 'Enter'); await listed();
  await pg.click('#sources .more'); await pg.waitForTimeout(60);
  var seen = await pg.evaluate(function () { return { title: document.querySelector('#sources .t').textContent, line: document.getElementById('itemLine').textContent, quote: document.querySelector('#sources .quote').textContent, imgs: document.querySelectorAll('img, script:not([src])').length, ran: [window.__x, window.__y] }; });
  await pg.click('#itemLine'); await pg.waitForTimeout(40); var full = await pg.textContent('#itemTitle');
  t('V01', 'markup in a note\'s title and text is shown as text everywhere (selected item, collapsed line, list row, preview) and is never run', seen.title === EVIL && seen.line.indexOf(EVIL) >= 0 && /<script>window\.__y=1<\/script> line two/.test(seen.quote) && full === EVIL && seen.ran[0] === undefined && seen.ran[1] === undefined && (await pg.$$('#item img, #sources img')).length === 0, JSON.stringify(seen));

  mac.select(FINDER, [wb]); await open(FINDER); await pg.fill('#tagField', 'Maintenance'); await pg.press('#tagField', 'Enter'); await pg.waitForTimeout(80);
  await pg.fill('#lookupField', 'Maintenance'); await pg.press('#lookupField', 'Enter'); await listed();
  var first = await pg.textContent('#sources .ex'); mac.clipboard = 'UNTOUCHED';
  fs.writeFileSync(wb, fs.readFileSync(fx('maintenance-820.xlsx')));
  await pg.click('#copyBtn'); await pg.waitForTimeout(200);
  var refused = await pg.textContent('#copyMsg'), relisted = await pg.textContent('#sources'), flag = await pg.$('#sources .flag'), untouched = mac.clipboard === 'UNTOUCHED';
  await pg.click('#copyBtn'); await pg.waitForTimeout(200);
  t('V02', 'ACCEPTANCE in the page: the workbook is overwritten (900 → 820) after it was shown. Copy first refuses, marks the row Changed and shows 820; the next Copy carries one workbook with 820; 900 is nowhere',
    /B2: 900/.test(first) && /^Not copied: W1 changed/.test(refused) && untouched && !!flag && /B2: 820/.test(relisted) && !/\b900\b/.test(relisted) && /B2: 820\b/.test(mac.clipboard) && !/\b900\b/.test(mac.clipboard) && (mac.clipboard.match(/### /g) || []).length === 1, first + ' | ' + refused + ' | ' + (mac.clipboard || '').slice(0, 120));

  await pg.evaluate(function () { return window.workIndexClosed(); }); await pg.waitForTimeout(60);
  var after = await pg.evaluate(function () { var s = { local: 0, session: 0, cookie: document.cookie }; try { s.local = localStorage.length; s.session = sessionStorage.length; } catch (e) { s.blocked = true; } return { body: document.body.innerText, fields: document.getElementById('tagField').value + document.getElementById('lookupField').value, rows: document.querySelectorAll('#sources .src').length, store: s, preview: window.workIndexPreview() }; });
  t('V03', 'when the popover closes, the selected item, the list and the typed text are gone from the page, and the browser stored nothing', !/maintenance|Budget notes|Maintenance|820/.test(after.body) && after.fields === '' && after.rows === 0 && after.preview === '' && !after.store.local && !after.store.session && !after.store.cookie, JSON.stringify(after).slice(0, 300));
  var size = await pg.evaluate(function () { return { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content }; });

  var os2 = Prompts.create(); os2.apps['com.apple.Notes'].running = true; os2.apps['com.apple.Notes'].name = '<img src=x onerror="window.__z=1">Notes';
  var pa = await (await br.newContext({ viewport: { width: 360, height: 338 } })).newPage(), reqsA = [];
  pa.on('pageerror', function (e) { errs.push('access pageerror: ' + e.message); }); pa.on('console', function (m) { if (m.type() === 'error') errs.push('access console: ' + m.text()); }); pa.on('request', function (r) { reqsA.push(r.url()); });
  await pa.exposeFunction('__contextAccessTestCall', function (op, arg) { return os2.call(op, arg); });
  await pa.goto('file://' + path.join(ROOT, 'app', 'Resources', 'access.html')); await pa.evaluate(function () { return window.contextAccessShown({ focus: '"]<img src=x onerror=window.__z=2>' }); }); await pa.waitForTimeout(80);
  var acc = await pa.evaluate(function () { return { name: document.querySelector('#list .name').textContent, imgs: document.querySelectorAll('img').length, ran: window.__z, w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content }; });
  t('V04', 'the App access page shows an app name with markup in it as text and never runs it; a hostile "focus" value does nothing', /^<img src=x onerror=/.test(acc.name) && acc.imgs === 0 && acc.ran === undefined, JSON.stringify(acc));
  var policy = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'";
  t('V05', 'both pages keep to the installed sizes without scrolling sideways or down (352 × 440 and 360 × 338) and carry the same content policy: nothing may be loaded from anywhere', size.w === 352 && size.h === 440 && acc.w === 360 && acc.h === 338 && size.csp === policy && acc.csp === policy, JSON.stringify([size, acc.w, acc.h]));
  t('V06', 'neither page made a request of its own: 1 load each (the page), 0 others; no script errors', reqs.length === 1 && reqsA.length === 1 && errs.length === 0, reqs.length + ' ' + reqsA.length + ' ' + errs.join(' | '));
  await br.close(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* leave it */ }
  var bad = results.filter(function (r) { return !r.ok; });
  console.log('\n== ' + (results.length - bad.length) + '/' + results.length + ' page safety checks passed' + (bad.length ? '; FAILED: ' + bad.map(function (r) { return r.id; }).join(', ') : '') + ' ==');
  process.exit(bad.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
