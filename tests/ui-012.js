#!/usr/bin/env node
/* Context 0.12 — page checks for what is new: Manage tags › Rename everywhere, the tag editor opened by the
 * Tag current item shortcut, Return with an input method that is still composing, and the Settings window.
 * The pages are the ones bundled into the Mac app (popover.html at 352 × 440, settings.html at 360 × 338), driven in a
 * real browser against a pretend Mac.
 *   NODE_PATH=<folder with playwright> CHROME=/usr/bin/google-chrome node tests/ui-012.js [folder for pictures]
 * This is Chrome, not the WebKit view inside the app; the pretend Mac and the pretend macOS stand in for the Swift
 * side; composition is produced through the browser's own input-method interface, not by a real Korean keyboard. */
'use strict';
process.env.TZ = 'Asia/Seoul';
var fs = require('fs'), os = require('os'), path = require('path');
var ROOT = path.join(__dirname, '..'), Mac = require('./lib/mac.js'), Xlsx = require('./lib/xlsx.js'), Standin = require('./lib/settings-standin.js'), Popover = require('../core/popover.js');
var chromium = require('playwright').chromium, results = [], SHOTS = process.argv[2] || '';
function t(id, desc, ok, detail) { results.push({ id: id, desc: desc, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + id + '  ' + desc + (ok ? '' : '\n       → ' + String(detail === undefined ? '' : detail).slice(0, 700))); }
var NOTES = 'com.apple.Notes', MAIL = 'com.apple.mail', FINDER = 'com.apple.finder', N1 = 'x-coredata://FICTIONAL-0012/ICNote/p1', N2 = 'x-coredata://FICTIONAL-0012/ICNote/p2';

(async function () {
  var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'context-ui012-')), mac = Mac.create(TMP), seed = Popover.create(mac.host, { now: function () { return Date.parse('2026-11-20T10:00:00+09:00'); } });
  mac.addNote({ id: N1, title: 'Zz supplier call', text: 'Harborline holds the price until Nov 30.', modified: '2026-11-12T17:20:00', created: '2026-11-12T16:50:00' });
  mac.addNote({ id: N2, title: 'Zz budget meeting', text: 'Travel budget is separate.', modified: '2026-11-13T10:00:00', created: '2026-11-13T09:40:00' });
  mac.addMail({ numericId: '7001', messageId: 'zz1@harborline-tooling.example', subject: 'Zz revised quote', sent: '2026-11-10T09:12:00', account: 'Work', mailbox: 'INBOX', from: 'Dana Okafor <dana.okafor@harborline-tooling.example>', text: 'The revised quote is USD 48,500.' });
  var wb = mac.write('zz-costs.xlsx', Xlsx.write({ modified: '2026-11-16T05:30:00Z', sheets: [{ name: 'Summary', cells: { A1: 'Line', B1: 'Amount', A2: 'Mold maintenance', B2: 820 } }] }), '2026-11-16T14:30:00+09:00');
  async function tag(bid, sel, tags) { mac.select(bid, [sel]); await seed.opened({ bundleId: bid }); await seed.save(tags); await seed.closed(); }
  await tag(NOTES, N1, 'ZzAlpha ZzTravel'); await tag(NOTES, N2, 'ZzAlpha ZzBeta'); await tag(MAIL, '7001', 'ZzAlpha'); await tag(FINDER, wb, 'ZzBeta');
  function tagsOn(id) { return (mac.objects()[id] || { tags: [] }).tags.join(); }

  var br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  var cx = await br.newContext({ viewport: { width: 352, height: 440 } }), pg = await cx.newPage(), errs = [], reqs = [], asked = [];
  pg.on('pageerror', function (e) { errs.push('pageerror: ' + e.message); });
  pg.on('console', function (m) { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  pg.on('request', function (r) { reqs.push(r.url()); });
  await pg.exposeFunction('__workIndexTestCall', function (op, arg) { asked.push(op + (typeof arg === 'string' && arg ? ':' + arg : '')); if (op === 'close' || op === 'quit' || op === 'access' || op === 'settings' || op === 'preferences') return { ok: true }; return mac.call(op, arg); });
  await pg.goto('file://' + path.join(ROOT, 'app', 'Resources', 'popover.html'));
  async function open(info) { await pg.evaluate(function (i) { return window.workIndexOpened(i); }, info); await pg.waitForTimeout(80); }
  async function close() { await pg.evaluate(function () { return window.workIndexClosed(); }); await pg.waitForTimeout(60); }
  function fits() { return pg.evaluate(function () { return document.documentElement.scrollWidth <= 352 && document.documentElement.scrollHeight <= 440; }); }
  async function shot(name, page) { if (SHOTS) await (page || pg).screenshot({ path: path.join(SHOTS, name) }); }
  function focusId() { return pg.evaluate(function () { return document.activeElement ? document.activeElement.id : ''; }); }

  /* ── Manage tags › Rename everywhere ── */
  mac.select(NOTES, [N1]); await open({ bundleId: NOTES, name: 'Notes' });
  await pg.click('#manageBtn'); await pg.waitForTimeout(100);
  var list0 = await pg.$$eval('#manageList .tagrow', function (rows) { return rows.map(function (r) { return r.textContent.replace(/\s+/g, ' ').trim(); }); }), f0 = await focusId(), fit0 = await fits();
  await shot('manage-1-list.png');
  await pg.keyboard.type('zzb'); await pg.waitForTimeout(80);
  var list1 = await pg.$$eval('#manageList .tagrow', function (rows) { return rows.map(function (r) { return r.textContent.replace(/\s+/g, ' ').trim(); }); });
  await pg.fill('#manageSearch', ''); await pg.waitForTimeout(60);
  t('M01', 'Manage tags opens on a searchable list: every tag once with its number of sources, the search field has the keyboard, typing narrows the list, and it fits the 352 × 440 popover', list0.length === 3 && list0.some(function (x) { return /^ZzAlpha\s*3 sources$/.test(x); }) && list0.some(function (x) { return /^ZzBeta\s*2 sources$/.test(x); }) && list0.some(function (x) { return /^ZzTravel\s*1 source$/.test(x); }) && f0 === 'manageSearch' && list1.length === 1 && /^ZzBeta/.test(list1[0]) && fit0, JSON.stringify([list0, f0, list1, fit0]));
  await pg.click('#manageList .tagrow:has-text("ZzAlpha")'); await pg.waitForTimeout(80);
  var f1 = await focusId(); await pg.keyboard.type('ZzGamma'); await pg.waitForTimeout(120);
  var planNew = (await pg.textContent('#renamePlan')).replace(/\s+/g, ' ').trim(), btnNew = (await pg.textContent('#renameBtn')).trim();
  await pg.fill('#renameField', 'zzbeta'); await pg.waitForTimeout(120);
  var planMerge = (await pg.textContent('#renamePlan')).replace(/\s+/g, ' ').trim(), btnMerge = (await pg.textContent('#renameBtn')).trim(), fit1 = await fits(), before = mac.indexText();
  await shot('manage-2-merge-preview.png');
  t('M02', 'choosing a tag puts the keyboard in the new-name field; a new name previews "Rename" with the 3 sources that change; an existing name (typed in another case) previews "Merge" with how many change and how many already have it; nothing is written by previewing', f1 === 'renameField' && /^Rename$/.test(btnNew) && /3 sources/.test(planNew) && /^Merge/.test(btnMerge) && /ZzBeta/.test(planMerge) && /1 of them already has ZzBeta and will keep it once/.test(planMerge) && /3 sources will change from ZzAlpha to ZzBeta/.test(planMerge) && /Afterwards ZzBeta is on 4 sources and ZzAlpha is gone/.test(planMerge) && /3 sources will change from ZzAlpha to ZzGamma/.test(planNew) && mac.indexText() === before && fit1, JSON.stringify([btnNew, planNew, btnMerge, planMerge]));
  await pg.focus('#renameField'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(100);
  var f2 = await focusId(), unwritten = mac.indexText() === before;
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
  var msg = (await pg.textContent('#manageMsg')).trim(), list2 = await pg.$$eval('#manageList .tagrow', function (rows) { return rows.map(function (r) { return r.textContent.replace(/\s+/g, ' ').trim(); }); }), fit2 = await fits();
  await shot('manage-3-merged.png');
  t('M03', 'Return in the name field only moves to the Merge button (nothing is written yet); pressing the button merges, says what happened, and the list shows the result at once: ZzBeta on 4, no ZzAlpha', f2 === 'renameBtn' && unwritten && /Merged ZzAlpha into ZzBeta: 3 sources changed, 1 already had it\./.test(msg) && list2.some(function (x) { return /^ZzBeta\s*4 sources$/.test(x); }) && !list2.some(function (x) { return /ZzAlpha/.test(x); }) && tagsOn('applenotes:' + N2) === 'ZzBeta' && tagsOn('applenotes:' + N1) === 'ZzBeta,ZzTravel' && fit2, JSON.stringify([f2, msg, list2]));
  await pg.click('#manageList .tagrow:has-text("ZzTravel")'); await pg.keyboard.type('Cost!'); await pg.waitForTimeout(120);
  var bad = (await pg.textContent('#renamePlan')).replace(/\s+/g, ' ').trim(), badBtn = await pg.$eval('#renameBtn', function (b) { return b.disabled; }); var text2 = mac.indexText();
  await pg.fill('#renameField', 'ZzTrips'); await pg.waitForTimeout(100); await pg.click('#renameCancel'); await pg.waitForTimeout(100);
  var afterCancel = await pg.$eval('#renameForm', function (f) { return f.hidden || getComputedStyle(f).display === 'none'; });
  await pg.click('#manageDone'); await pg.waitForTimeout(100);
  var chips = await pg.$$eval('#tagTokens .tok, #tagTokens .token, #tagTokens [data-tag]', function (x) { return x.map(function (e) { return e.textContent.replace(/[×✕]/g, '').trim(); }); }), body = await pg.evaluate(function () { return document.body.innerText; });
  t('M04', 'a name that is not allowed shows why and the button is off; Cancel writes nothing and returns to the list; back in the tag view the selected note already shows the merged tag', /letters, digits/.test(bad) && badBtn === true && mac.indexText() === text2 && afterCancel && /ZzBeta/.test(body) && !/ZzAlpha/.test(body), JSON.stringify([bad, badBtn, afterCancel, chips]));
  await close();

  /* ── opened by the Tag current item shortcut ── */
  mac.select(NOTES, [N2]); var captured = mac.now.selection(NOTES); asked.length = 0; mac.counts = {};
  await open({ bundleId: NOTES, name: 'Notes', captured: captured, via: 'shortcut' });
  var s0 = await pg.evaluate(function () { return { title: document.getElementById('itemTitle').textContent, focus: document.activeElement.id, mode: document.body.getAttribute('data-mode'), tokens: document.getElementById('tagTokens').textContent }; }), askedOnOpen = asked.filter(function (a) { return /^selection/.test(a); }).length;
  await shot('shortcut-1-editor.png');
  await pg.keyboard.type('ZzQuick'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  var s1 = tagsOn('applenotes:' + N2), f3 = await focusId();
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(60);
  t('S01', 'opened by the shortcut with the answer captured beforehand: the tag editor shows the note\'s title and its tag, the tag field has the keyboard, and the page asks Notes nothing on opening; typing a name and Return tags that note and keeps the keyboard in the field; Escape asks the app to close (the app then gives the keyboard back to Notes)', s0.title === 'Zz budget meeting' && s0.focus === 'tagField' && s0.mode === 'tag' && /ZzBeta/.test(s0.tokens) && askedOnOpen === 0 && s1 === 'ZzBeta,ZzQuick' && f3 === 'tagField' && asked[asked.length - 1] === 'close', JSON.stringify([s0, askedOnOpen, s1, f3, asked.slice(-3)]));
  await close();
  mac.select(NOTES, [N2]); captured = mac.now.selection(NOTES); await open({ bundleId: NOTES, name: 'Notes', captured: captured, via: 'shortcut' });
  await pg.click('#tagTokens .rm'); await pg.waitForTimeout(150);                                    /* make room: one tag is taken off, on the right note */
  mac.select(NOTES, [N1]); var text3 = mac.indexText();
  await pg.focus('#tagField'); await pg.keyboard.type('ZzWrong'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  var stale = await pg.evaluate(function () { return document.body.innerText; });
  t('S02', 'the selection in Notes changes while the editor opened by the shortcut is on screen: Return writes nothing to either note and the editor says so', mac.indexText() === text3 && /The selection in Notes changed while this was open\. Nothing was tagged\./.test(stale) && JSON.stringify(mac.objects()).indexOf('ZzWrong') < 0, stale.slice(0, 300));
  await close(); asked.length = 0;
  await open({ bundleId: NOTES, name: 'Notes', captured: { ok: false, code: -1744 }, via: 'shortcut' });
  var na = await pg.evaluate(function () { var b = document.getElementById('settingsBtn'); return { text: document.body.innerText, button: b ? b.textContent : '', focus: document.activeElement.id, field: !!document.getElementById('tagField') && document.getElementById('tagField').offsetParent !== null }; });
  await shot('shortcut-2-not-asked.png'); await pg.click('#settingsBtn'); await pg.waitForTimeout(60);
  t('S03', 'macOS has never been asked about Notes: the editor says Context is not allowed to ask Notes yet, shows no tag field, and offers one button, Open App access, which asks the app for that window with Notes in view; Notes itself was asked nothing', /Not allowed to ask Notes/.test(na.text) && /has not been allowed to ask Notes yet/.test(na.text) && na.button === 'Open App access' && na.focus === 'settingsBtn' && !na.field && asked.join() === 'readIndex,access:' + NOTES || (asked.filter(function (a) { return /^selection|^readNote/.test(a); }).length === 0 && asked[asked.length - 1] === 'access:' + NOTES && /has not been allowed to ask Notes yet/.test(na.text) && na.button === 'Open App access' && !na.field), JSON.stringify([na, asked]));
  await close();

  /* ── Return while an input method is still composing ── */
  var cdp = await cx.newCDPSession(pg);
  async function compose(text) { await cdp.send('Input.imeSetComposition', { text: text, selectionStart: text.length, selectionEnd: text.length }); await pg.waitForTimeout(40); }
  mac.select(MAIL, ['7001']); await open({ bundleId: MAIL, name: 'Mail' }); mac.counts = {};
  /* Return reaches the page while the last syllable is still open; then the input method closes it (as a Korean keyboard does on Return) */
  await pg.focus('#tagField'); await cdp.send('Input.insertText', { text: '출장' }); await compose('ㅂ'); await compose('비');
  var mid = await pg.evaluate(function () { return document.getElementById('tagField').value; });
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
  var k1 = tagsOn('mid:zz1@harborline-tooling.example'), w1 = mac.counts.writeIndex || 0;
  await cdp.send('Input.insertText', { text: '비' }); await pg.waitForTimeout(250);                    /* the composition is committed */
  var k1b = tagsOn('mid:zz1@harborline-tooling.example'), w1b = mac.counts.writeIndex || 0, left1b = await pg.evaluate(function () { return document.getElementById('tagField').value; });
  t('K01', 'Korean with the last syllable still open (출장 + 비 through the browser\'s input-method interface), Return, then the syllable is closed: while it is open nothing is tagged; once closed the source gets the one tag 출장비 — whole, once, one write — and no stray syllable stays in the field', mid === '출장비' && k1 === 'ZzBeta' && w1 === 0 && k1b === 'ZzBeta,출장비' && w1b === 1 && left1b === '', JSON.stringify([mid, k1, w1, k1b, w1b, left1b]));
  /* the usual order: the input method closes the syllable first, then Return arrives */
  await pg.click('#tagTokens .rm >> nth=1'); await pg.waitForTimeout(150); mac.counts = {};
  await pg.focus('#tagField'); await cdp.send('Input.insertText', { text: '출' }); await compose('ㅈ'); await compose('장'); await cdp.send('Input.insertText', { text: '장' }); await pg.waitForTimeout(60);
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(250);
  var k1c = tagsOn('mid:zz1@harborline-tooling.example'), w1c = mac.counts.writeIndex || 0, left1c = await pg.evaluate(function () { return document.getElementById('tagField').value; });
  t('K01b', 'the usual order (the syllable is closed, then Return): one tag 출장, one write, an empty field', k1c === 'ZzBeta,출장' && w1c === 1 && left1c === '', JSON.stringify([k1c, w1c, left1c]));
  /* the order some engines use: the form is submitted while the composition is still open, and the composition ends just after */
  await pg.click('#tagTokens .rm >> nth=1').catch(function () {}); await pg.waitForTimeout(150); mac.counts = {};
  var order = await pg.evaluate(function () {
    var f = document.getElementById('tagField'), form = document.getElementById('tagForm');
    f.focus(); f.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    f.value = '여'; f.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));                        /* Return arrives first */
    var early = f.value;
    f.value = '여비'; f.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    f.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '여비' }));
    return early;
  });
  await pg.waitForTimeout(250);
  var k2 = tagsOn('mid:zz1@harborline-tooling.example'), w2 = mac.counts.writeIndex || 0;
  t('K02', 'the other order (Return reaches the form before the composition has ended; synthetic events): nothing is tagged with the half-typed syllable; when the composition ends the whole word is tagged, once', order === '여' && k2 === 'ZzBeta,여비' && w2 === 1 && JSON.stringify(mac.objects()).indexOf('"여"') < 0, JSON.stringify([order, k2, w2]));
  asked.length = 0;
  await pg.evaluate(function () { var f = document.getElementById('lookupField') || document.getElementById('tagField'); f.focus(); f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, isComposing: true, bubbles: true, cancelable: true })); });
  await pg.waitForTimeout(60); var escComposing = asked.indexOf('close') < 0;
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(60);
  t('K03', 'Escape while composing only cancels the syllable (the editor stays open); Escape otherwise asks the app to close', escComposing && asked.indexOf('close') >= 0, asked.join());
  await close();
  /* the same for the new-name field of Rename: Return during composition must not jump to the button with half a name */
  await open({ bundleId: MAIL, name: 'Mail' }); await pg.click('#manageBtn'); await pg.waitForTimeout(80); await pg.click('#manageList .tagrow:has-text("여비")'); await pg.waitForTimeout(80);
  var rn = await pg.evaluate(function () {
    var f = document.getElementById('renameField'), form = document.getElementById('renameForm');
    f.focus(); f.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    f.value = '경'; f.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    var early = document.activeElement.id;
    f.value = '경비'; f.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    f.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '경비' }));
    return early;
  });
  await pg.waitForTimeout(200);
  var rnFocus = await focusId(), rnEarlyText = mac.indexText() === mac.indexText(), rnPlan = (await pg.textContent('#renamePlan')).replace(/\s+/g, ' ').trim(), textK = mac.indexText();
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
  t('K04', 'Rename with a Korean name: Return during composition does nothing until the name is whole; then it moves to the Rename button with the preview for 경비, and the press renames 여비 to 경비', rn === 'renameField' && rnFocus === 'renameBtn' && /경비/.test(rnPlan) && mac.indexText() !== textK && tagsOn('mid:zz1@harborline-tooling.example') === 'ZzBeta,경비', JSON.stringify([rn, rnFocus, rnPlan, tagsOn('mid:zz1@harborline-tooling.example')]));
  await pg.click('#manageDone').catch(function () {}); await close();
  var popReqs = reqs.filter(function (u) { return !/^file:/.test(u); });

  /* ── the footer ── */
  mac.select(NOTES, [N1]); await open({ bundleId: NOTES, name: 'Notes' }); asked.length = 0;
  var footer = await pg.$$eval('footer button, .foot button, #foot button', function (b) { return b.map(function (x) { return x.textContent.trim(); }); });
  await pg.click('#prefsBtn'); await pg.waitForTimeout(40);
  t('F01', 'the popover\'s last line offers App access, Settings, Manage tags and Quit; Settings asks the app for its Settings window and nothing else', footer.join() === 'App access,Settings,Manage tags,Quit' && asked.join() === 'preferences', JSON.stringify([footer, asked]));
  await close();

  /* ── the Settings window ── */
  var osDir = path.join(TMP, 'os'), mos = Standin.create(osDir, { extensionId: 'oendmnmglkecffebbhkecfhobmphjapb' }), sreqs = [], calls = [];
  var ps = await (await br.newContext({ viewport: { width: 360, height: 338 } })).newPage();
  ps.on('pageerror', function (e) { errs.push('settings pageerror: ' + e.message); }); ps.on('console', function (m) { if (m.type() === 'error') errs.push('settings console: ' + m.text()); }); ps.on('request', function (r) { sreqs.push(r.url()); });
  await ps.exposeFunction('__contextSettingsTestCall', function (op, arg) { calls.push(op); return mos.call(op, arg); });
  await ps.goto('file://' + path.join(ROOT, 'app', 'Resources', 'settings.html')); await ps.evaluate(function () { return window.contextSettingsShown(); }); await ps.waitForTimeout(80);
  function sfits() { return ps.evaluate(function () { return document.documentElement.scrollWidth <= 360 && document.documentElement.scrollHeight <= 338; }); }
  function sstate() { return ps.evaluate(function () { function vis(id) { var e = document.getElementById(id); return !!e && !e.hidden; } return { chord: document.getElementById('chord').textContent, set: document.getElementById('setBtn').textContent, suggest: vis('suggestBtn') ? document.getElementById('suggestBtn').textContent : '', clear: vis('clearBtn'), msg: document.getElementById('shortMsg').textContent, focus: document.activeElement.id,
    insert: document.getElementById('insertState').textContent, steps: vis('steps'), chrome: vis('chromeBtn'), off: vis('offBtn'), imsg: document.getElementById('insertMsg').textContent, label: document.getElementById('chord').getAttribute('aria-label') }; }); }
  var v0 = await sstate(), fitS0 = await sfits(); await shot('settings-1-unset.png', ps);
  t('P01', 'Settings opens with nothing set: Tag current item "Not set" with Set… and "Use ⌃⌥T", Insert context "Off" with its two setup buttons; the keyboard is on Set…; it fits 360 × 338', v0.chord === 'Not set' && v0.set === 'Set…' && v0.suggest === 'Use ⌃⌥T' && !v0.clear && v0.insert === 'Off' && v0.chrome && !v0.off && !v0.steps && v0.focus === 'setBtn' && fitS0 && !fs.existsSync(mos.file), JSON.stringify(v0));
  await ps.click('#setBtn'); await ps.waitForTimeout(40); var rec = await sstate();
  await ps.keyboard.press('Meta+KeyT'); await ps.waitForTimeout(80); var cmdOnly = await sstate();
  await ps.click('#setBtn'); await ps.keyboard.press('Control+Alt+KeyT'); await ps.waitForTimeout(100);
  var v1 = await sstate(), fitS1 = await sfits(); await shot('settings-2-shortcut-set.png', ps);
  t('P02', 'Set… waits for keys pressed in this window: Command-T is refused with the reason and nothing is set; Control-Option-T is taken, shown as ⌃⌥T (spoken as Control-Option-T), saved, and the buttons become Change… and Clear', /Press the keys/.test(rec.set) && cmdOnly.chord === 'Not set' && /Use Control or Option/.test(cmdOnly.msg) && v1.chord === '⌃⌥T' && v1.label === 'Shortcut: Control-Option-T' && v1.set === 'Change…' && v1.clear && !v1.suggest && /Tag current item is now ⌃⌥T\./.test(v1.msg) && JSON.stringify(mos.read().tagShortcut) === '{"keyCode":17,"modifiers":["control","option"],"key":"T"}' && fitS1, JSON.stringify([rec.set, cmdOnly, v1]));
  calls.length = 0; await ps.click('#setBtn'); await ps.keyboard.press('Escape'); await ps.waitForTimeout(60); var escRec = await sstate(), closedByEsc = calls.indexOf('close') >= 0;
  await ps.keyboard.press('Escape'); await ps.waitForTimeout(60); var closedNow = calls.indexOf('close') >= 0;
  mos.taken[Standin.id({ keyCode: 16, modifiers: ['control', 'option'], key: 'Y' })] = true;
  await ps.click('#setBtn'); await ps.keyboard.press('Control+Alt+KeyY'); await ps.waitForTimeout(100); var refused = await sstate(), fitS2 = await sfits(); await shot('settings-3-refused.png', ps);
  t('P03', 'Escape while setting cancels the setting only (the window stays, the shortcut is unchanged); Escape otherwise closes the window; a chord macOS does not take is reported with its number and ⌃⌥T stays set', escRec.chord === '⌃⌥T' && escRec.set === 'Change…' && !closedByEsc && closedNow && refused.chord === '⌃⌥T' && /macOS did not accept ⌃⌥Y: it is already in use \(-9878\)\. The shortcut is still ⌃⌥T\./.test(refused.msg) && fitS2, JSON.stringify([escRec, refused]));
  mos.taken = {}; await ps.click('#setBtn'); await ps.keyboard.press('Control+Alt+KeyY'); await ps.waitForTimeout(100); var v2 = await sstate();
  await ps.click('#clearBtn'); await ps.waitForTimeout(100); var v3 = await sstate();
  t('P04', 'Change… to ⌃⌥Y, then Clear: each is shown and saved at once; cleared, the window is back to "Not set" with the suggestion', v2.chord === '⌃⌥Y' && v3.chord === 'Not set' && v3.suggest === 'Use ⌃⌥T' && /No shortcut is set\. ⌃⌥Y is free again\./.test(v3.msg) && mos.read().tagShortcut === null, JSON.stringify([v2, v3]));
  await ps.click('#suggestBtn'); await ps.waitForTimeout(100); var v4 = await sstate();
  await ps.click('#chromeBtn'); await ps.waitForTimeout(120); var v5 = await sstate(), fitS3 = await sfits(), reg = path.join(mos.chromeFolder, 'local.workindex.composer.json'), manifest = fs.existsSync(reg) ? JSON.parse(fs.readFileSync(reg, 'utf8')) : {};
  await shot('settings-4-insert-on.png', ps);
  await ps.click('#folderBtn'); await ps.waitForTimeout(40); var revealed = calls.indexOf('reveal') >= 0;
  await ps.click('#offBtn'); await ps.waitForTimeout(120); var v6 = await sstate();
  t('P05', '"Use ⌃⌥T" sets the suggestion with one press. Set up for Google Chrome registers the helper for the Context extension only, switches Insert context on and shows the three steps (still fitting the window); Show extension asks the app to reveal the folder; Turn off removes the registration and says so', v4.chord === '⌃⌥T' && v5.insert === 'On for Google Chrome' && v5.steps && v5.off && !v5.chrome && fitS3 && manifest.name === 'local.workindex.composer' && manifest.type === 'stdio' && JSON.stringify(manifest.allowed_origins) === '["chrome-extension://oendmnmglkecffebbhkecfhobmphjapb/"]' && revealed &&
    v6.insert === 'Off' && !v6.steps && v6.chrome && !fs.existsSync(reg) && /Insert context is off/.test(v6.imsg) && mos.read().insert.on === false && JSON.stringify(mos.read().tagShortcut) === '{"keyCode":17,"modifiers":["control","option"],"key":"T"}', JSON.stringify([v4.chord, fitS3, revealed, fs.existsSync(reg), v6.imsg, mos.read(), calls]));
  fs.mkdirSync(path.join(TMP, 'os2'), { recursive: true });
  var mos2 = Standin.create(path.join(TMP, 'os2'), { chromeInstalled: false }); mos2.picked = { name: '<img src=x onerror="window.__q=1">Browser', bundleId: 'com.example.browser', folder: path.join(TMP, 'os2') };
  var p2 = await (await br.newContext({ viewport: { width: 360, height: 338 } })).newPage();
  p2.on('pageerror', function (e) { errs.push('settings2 pageerror: ' + e.message); });
  await p2.exposeFunction('__contextSettingsTestCall', function (op, arg) { return mos2.call(op, arg); });
  await p2.goto('file://' + path.join(ROOT, 'app', 'Resources', 'settings.html')); await p2.evaluate(function () { return window.contextSettingsShown(); }); await p2.waitForTimeout(60);
  await p2.click('#chromeBtn'); await p2.waitForTimeout(100); var noChrome = await p2.evaluate(function () { return { state: document.getElementById('insertState').textContent, msg: document.getElementById('insertMsg').textContent }; });
  await p2.click('#otherBtn'); await p2.waitForTimeout(100); var other = await p2.evaluate(function () { return { state: document.getElementById('insertState').textContent, imgs: document.querySelectorAll('img').length, ran: window.__q, w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content }; });
  t('P06', 'Chrome is not on this pretend Mac: setting up for it changes nothing and says the browser\'s folder was not found. A browser chosen through Other… whose name contains markup is shown as text and nothing in it runs; the page allows no network and loads nothing', noChrome.state === 'Off' && /folder for local helpers was not found/.test(noChrome.msg) && /^On for <img src=x onerror=/.test(other.state) && other.imgs === 0 && other.ran === undefined && /default-src 'none'/.test(other.csp) && !/connect-src|https?:/.test(other.csp) &&
    sreqs.filter(function (u) { return !/^file:/.test(u); }).length === 0 && popReqs.length === 0, JSON.stringify([noChrome, other, sreqs.filter(function (u) { return !/^file:/.test(u); }), popReqs]));
  t('Z01', 'no page error and no console error in any of the three pages during all of the above', errs.length === 0, errs.join(' | '));

  await br.close();
  var failed = results.filter(function (r) { return !r.ok; });
  console.log('\n== ' + (results.length - failed.length) + '/' + results.length + ' page checks for 0.12 passed' + (failed.length ? '; FAILED: ' + failed.map(function (r) { return r.id; }).join(', ') : '') + ' (Chrome; pretend Mac) ==');
  try { fs.writeFileSync(path.join(__dirname, 'last-ui-012-results.json'), JSON.stringify(results, null, 1)); } catch (e) { /* read-only checkout */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* leave it */ }
  process.exit(failed.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
