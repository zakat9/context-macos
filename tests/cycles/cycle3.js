/* Cycle 3 — tagging by keyboard and by mouse, recent tags, the two-tag cap, wrong-target rejection.
 * The popover page of this build runs in Chrome at 352 × 440 against the pretend Mac; the same tasks are then done
 * on the 0.10.3 page for the before numbers. Every click and key press goes through a counter. */
'use strict';
var fs = require('fs'), path = require('path');

module.exports = async function (S, C) {
  var L = C.L, NOTES = L.NOTES, MAIL = L.MAIL, FINDER = 'com.apple.finder';
  var P11 = 'x-coredata://FICTIONAL-0002/ICNote/p11', P12 = 'x-coredata://FICTIONAL-0002/ICNote/p12', P13 = 'x-coredata://FICTIONAL-0002/ICNote/p13', LUNCH = 'applenotes:' + P12;
  var br = await C.browser(), shots = process.env.CONTEXT_SHOTS ? path.join(process.env.CONTEXT_SHOTS, 'cycle3') : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  function luminance(hex) { var c = hex.replace('#', ''); if (c.length === 3) c = c.split('').map(function (x) { return x + x; }).join(''); var v = [0, 2, 4].map(function (i) { var x = parseInt(c.substr(i, 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
  function contrast(a, b) { var x = luminance(a), y = luminance(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; }
  try {
    var sc = await C.Scene.build(C.Popover), mac = sc.mac, closes = 0;
    var pg = await C.popoverPage(br, C.ROOT, mac, { close: function () { closes++; } }), H = C.hands(pg);
    async function text(sel) { return (await pg.textContent(sel)) || ''; }
    async function focused() { return pg.evaluate(function () { var a = document.activeElement; return a ? (a.getAttribute('data-key') || a.id || a.tagName) : ''; }); }
    async function tokens() { return pg.$$eval('#tagTokens .token .name', function (x) { return x.map(function (e) { return e.textContent; }); }); }
    async function chips(id) { return pg.$$eval('#' + id + ' .chip', function (x) { return x.map(function (e) { return e.textContent; }); }); }
    function tagsOf(id) { var o = mac.objects()[id]; return o ? o.tags.join(',') : '(no entry)'; }
    async function snap(name) { if (shots) await pg.screenshot({ path: path.join(shots, name + '.png') }); }

    /* ── keyboard ── */
    mac.select(NOTES, [P12]); await pg.open(NOTES, 'Notes');
    var f0 = await focused(), hint = await text('#tagMsg'), cap = await text('#itemCap');
    await H.type('Lunch'); await H.key('Enter');
    var k1 = H.total(), msg1 = await text('#tagMsg'), tok1 = await tokens(), f1 = await focused(), field1 = await pg.inputValue('#tagField');
    await H.key('Escape');
    S.check('C3.01', 'keyboard: the popover opens with the keyboard in the tag field; typing a name and Return tags the note at once (no Save step); the field empties and keeps the keyboard; Escape closes',
      f0 === 'tagField' && /No tags yet/.test(hint) && cap === 'Note in Notes, last saved Nov 13, 2026 12:00' && msg1 === '✓ Tagged Lunch.' && tok1.join() === 'Lunch' && f1 === 'tagField' && field1 === '' && tagsOf(LUNCH) === 'Lunch' && closes === 1, [f0, cap, msg1, tok1.join(), f1, tagsOf(LUNCH), closes].join(' | '));
    S.measure('task A, tag an untagged note with a new name, keyboard: actions after (typed characters + keys)', k1 + ' (5 typed + Return)');

    /* ── remove and replace by keyboard ── */
    await pg.open(NOTES, 'Notes'); var open2 = await tokens();
    H = C.hands(pg); await H.key('Backspace'); var f2 = await focused(), still = tagsOf(LUNCH); await H.key('Backspace'); var msg2 = await text('#tagMsg'), f3 = await focused(), gone = tagsOf(LUNCH);
    await H.type('Cost'); await H.key('Enter');
    S.check('C3.02', 'keyboard: Backspace in the empty field moves to the last tag\'s remove button (nothing removed yet); Backspace again removes it and returns to the field; typing the replacement and Return tags it',
      open2.join() === 'Lunch' && f2 === 'rm:Lunch' && still === 'Lunch' && msg2 === '✓ Removed Lunch.' && f3 === 'tagField' && gone === '(no entry)' && tagsOf(LUNCH) === 'Cost', [f2, still, msg2, f3, gone, tagsOf(LUNCH)].join(' | '));
    S.measure('task B, replace a note\'s only tag, keyboard: actions after', H.total() + ' (Backspace, Backspace, 4 typed, Return)');

    /* ── mouse: recent tags, remove ── */
    mac.select(MAIL, ['6001']); await pg.open(MAIL, 'Mail');
    var recent = await chips('tagChips'); H = C.hands(pg); await H.click('[data-key="chip:tag:PineRidge"]');
    var m1 = await text('#tagMsg'), t1 = await tokens(), recentAfter = await chips('tagChips'), clicksAdd = H.clicks;
    await snap('01-tagged-with-one-click');
    await H.click('[data-key="chip:tag:Cost"]'); var order = await chips('lookupChips'); var t2 = await tokens(), recent2 = await pg.$$('#tagChips .chip'), ph = await pg.getAttribute('#tagField', 'placeholder'), m2 = await text('#tagMsg');
    await snap('02-two-of-two-tags');
    await pg.open(MAIL, 'Mail');                                           /* opened again on the same message: no confirmation is standing, so the standing hint shows */
    var look2 = await pg.evaluate(function () {
      var f = document.getElementById('tagField'), cs = getComputedStyle(f), cv = document.createElement('canvas').getContext('2d'); cv.font = cs.fontSize + ' ' + cs.fontFamily;
      var room = f.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), band = document.getElementById('summaryRow');
      return { placeholderFits: cv.measureText(f.placeholder).width <= room, msg: document.getElementById('tagMsg').textContent, leads: [document.querySelector('#lookupChips .lead').textContent], bandHidden: band.hidden || band.getBoundingClientRect().height === 0 };
    });
    await pg.click('[data-key="rm:Cost"]'); await pg.waitForTimeout(60); look2.leads.unshift(await pg.textContent('#tagChips .lead')); await pg.click('[data-key="chip:tag:Cost"]'); await pg.waitForTimeout(60);
    S.check('C3.18', 'with two tags the field\'s own hint is readable in full (not cut off) and the line under it says what to do; the two rows of tag buttons say what pressing does ("Tag as", "Look up"); no empty band is left where a lookup summary would go',
      look2.placeholderFits && look2.msg === 'Remove a tag to add another.' && look2.leads.join() === 'Tag as,Look up' && look2.bandHidden, JSON.stringify(look2));
    H = C.hands(pg); await H.click('[data-key="rm:PineRidge"]'); var t3 = await tokens(), m3 = await text('#tagMsg'), f4 = await focused();
    S.check('C3.03', 'mouse: pressing a recent tag tags the selected message at once (one click); the tag leaves the recent row because the item now has it; with two tags the recent row is gone and the field says a tag must be removed first; pressing × removes one tag (one click) and puts the keyboard back in the field',
      recent.join() === 'Cost,Lunch,PineRidge,Travel'.split(',').filter(function (n) { return recent.indexOf(n) >= 0; }).sort(function (a, b) { return recent.indexOf(a) - recent.indexOf(b); }).join() && recent.indexOf('PineRidge') >= 0 && m1 === '✓ Tagged PineRidge.' && t1.join() === 'PineRidge' && recentAfter.indexOf('PineRidge') < 0 && clicksAdd === 1 &&
      t2.join() === 'PineRidge,Cost' && recent2.length === 0 && ph === '2 of 2 tags' && m2 === '✓ Tagged Cost.' && t3.join() === 'Cost' && m3 === '✓ Removed PineRidge.' && f4 === 'tagField' && H.clicks === 1, [recent.join(), m1, t1.join(), recentAfter.join(), t2.join(), recent2.length, ph, t3.join(), m3, f4].join(' | '));
    var later = await chips('lookupChips');
    S.check('C3.04', 'recent tags are the tags of the entries changed last, newest first, read from the index: the two just put on the message lead the row; once one of them is taken off again it falls back to where its other entries put it (no separate history of use is kept)',
      order.slice(0, 2).join() === 'Cost,PineRidge' && later[0] === 'Cost' && later.indexOf('PineRidge') > 0 && later.length === order.length, order.join() + ' → ' + later.join());

    /* ── the two-tag cap ── */
    await H.click('[data-key="chip:tag:PineRidge"]'); var before = mac.indexText();
    await pg.focus('#tagField'); await pg.keyboard.type('Budget'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(60);
    var capMsg = await text('#tagMsg'), kept = await pg.inputValue('#tagField'), capTokens = await tokens(); await snap('03-third-tag-refused');
    await pg.fill('#tagField', ''); await pg.click('[data-key="rm:Cost"]'); await pg.waitForTimeout(60); await pg.fill('#tagField', 'Budget Travel'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(60);
    var roomMsg = await text('#tagMsg'), afterRoom = (await tokens()).join();
    S.check('C3.05', 'two-tag cap: a third tag is refused with the reason and the way out, nothing is written, and what was typed stays in the field; two names typed when there is room for one are refused the same way',
      capMsg === 'This item already has 2 tags. Remove one to add Budget.' && kept === 'Budget' && capTokens.length === 2 && roomMsg === 'An item can have 2 tags. There is room for 1 more.' && afterRoom === 'PineRidge' && mac.objects()['mid:20261119.0905.kr@harborline-tooling.example'].tags.join() === 'PineRidge', [capMsg, kept, roomMsg, afterRoom].join(' | '));
    await pg.fill('#tagField', 'bad!tag'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(60); var badMsg = await text('#tagMsg'), badKept = await pg.inputValue('#tagField');
    await pg.fill('#tagField', 'x'.repeat(41)); await pg.keyboard.press('Enter'); await pg.waitForTimeout(60); var longMsg = await text('#tagMsg');
    await pg.fill('#tagField', 'pineridge'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(60); var dupMsg = await text('#tagMsg');
    await pg.fill('#tagField', '금형'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(60); var krTokens = (await tokens()).join();
    S.check('C3.06', 'names: punctuation and a 41-character name are refused with the reason and stay in the field for correction; the same name in other capitals is recognised as already there; a Korean name is accepted',
      badMsg === 'Use letters, digits, - or _ in a tag.' && badKept === 'bad!tag' && longMsg === 'A tag can be up to 40 characters.' && dupMsg === 'Already tagged pineridge.' && krTokens === 'PineRidge,금형', [badMsg, longMsg, dupMsg, krTokens].join(' | '));
    await pg.fill('#tagField', ''); await pg.click('[data-key="rm:금형"]'); await pg.waitForTimeout(60);
    await pg.fill('#tagField', 'QuarterlyBudgetReviewForPineRidgeTooling'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(60);
    var fullName = await pg.evaluate(function () { var n = document.querySelectorAll('#tagTokens .token .name')[1]; return { text: n.textContent, cut: n.scrollWidth > n.clientWidth + 1, title: n.title }; });
    S.check('C3.07', 'a 40-character tag, which the menu bar shortens, is shown in full in the popover', fullName.text === 'QuarterlyBudgetReviewForPineRidgeTooling' && !fullName.cut && fullName.title === fullName.text, JSON.stringify(fullName));
    await snap('04-long-tag-in-full');
    await pg.click('[data-key="rm:QuarterlyBudgetReviewForPineRidgeTooling"]'); await pg.waitForTimeout(60);

    /* ── wrong target ── */
    mac.select(NOTES, [P13]); await pg.open(NOTES, 'Notes'); before = mac.indexText();
    mac.select(NOTES, [P12]);                                              /* the person clicks another note while the popover is open */
    await pg.click('[data-key="chip:tag:Cost"]'); await pg.waitForTimeout(80);
    var wrongMsg = await text('#noneMsg'), unchanged = mac.indexText() === before, hasRetry = !!(await pg.$('#retryBtn')), f5 = await focused(); await snap('05-selection-changed-nothing-tagged');
    H = C.hands(pg); await H.click('#retryBtn'); await pg.waitForTimeout(80); var nowTitle = await text('#itemTitle'), retryClicks = H.clicks;
    S.check('C3.08', 'the selection in Notes changes while the popover is open, then a recent tag is pressed: nothing is written to either note, the popover says so, and one button shows what is selected now',
      wrongMsg === 'The selection in Notes changed while this was open. Nothing was tagged.' && unchanged && hasRetry && nowTitle === 'Lunch order' && retryClicks === 1, [wrongMsg, unchanged, hasRetry, nowTitle].join(' | '));
    mac.select(NOTES, [P13]); before = mac.indexText(); await pg.click('[data-key="rm:Cost"]'); await pg.waitForTimeout(80);
    var wrong2 = await text('#noneMsg'); mac.select(NOTES, [P12, P13]); await pg.click('#retryBtn'); await pg.waitForTimeout(80); var two = await text('#noneMsg');
    S.check('C3.09', 'the same protection when removing: × pressed after the selection changed removes nothing; with two notes selected there is nothing to tag and the popover says what to do', wrong2 === 'The selection in Notes changed while this was open. Nothing was tagged.' && mac.indexText() === before && two === 'Select exactly one note in Notes.', wrong2 + ' | ' + two);
    mac.select(NOTES, [P12]); await pg.open(NOTES, 'Notes');
    var w0 = mac.counts.writeIndex || 0; await pg.focus('#tagField'); await pg.keyboard.type('Lunch');
    await pg.evaluate(function () { var f = document.getElementById('tagForm'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); }); await pg.waitForTimeout(120);
    S.check('C3.10', 'Return pressed three times in a row writes the tag once', (mac.counts.writeIndex || 0) - w0 === 1 && tagsOf(LUNCH) === 'Cost,Lunch', 'writes: ' + ((mac.counts.writeIndex || 0) - w0) + ' ' + tagsOf(LUNCH));

    /* ── identity, long Korean title, a file ── */
    mac.select(MAIL, ['6001']); await pg.open(MAIL, 'Mail');
    var id = await pg.evaluate(function () { var t = document.getElementById('itemTitle'), s = getComputedStyle(t); return { cap: document.getElementById('itemCap').textContent, lines: Math.round(t.getBoundingClientRect().height / parseFloat(s.lineHeight)), full: t.title, cut: t.scrollHeight > t.clientHeight + 1, itemHeight: Math.round(document.getElementById('item').getBoundingClientRect().height) }; });
    S.check('C3.11', 'a mail message with a 78-character Korean subject: the popover says what it is, which app it is in and its sent date; the title takes two lines at most and its full text is one hover (and one VoiceOver stop) away',
      id.cap === 'Email in Mail, sent Nov 19, 2026 09:05' && id.lines === 2 && id.cut && id.full === C.Scene.LONG, JSON.stringify(id));
    var wbPath = path.join(mac.files, 'tooling-budget.xlsx'); mac.select(FINDER, [wbPath]); await pg.open(FINDER, 'Finder');
    var fileId = await pg.evaluate(function () { return { cap: document.getElementById('itemCap').textContent, title: document.getElementById('itemTitle').textContent, path: document.getElementById('itemPath').textContent, full: document.getElementById('itemPath').title }; });
    S.check('C3.12', 'a saved workbook selected in Finder: kind, app and last-saved date, the file name, and the folder it is in (so two files with one name can be told apart)', /^Workbook in Finder, last saved Nov 1[18], 2026/.test(fileId.cap) && fileId.title === 'tooling-budget.xlsx' && fileId.full === mac.files && /files$/.test(fileId.path), JSON.stringify(fileId));
    await snap('06-workbook-identity');

    /* ── where the keyboard starts; names for every control; sizes; contrast ── */
    mac.automationDenied[NOTES] = true; await pg.open(NOTES, 'Notes'); var fDenied = await focused(); mac.automationDenied = {};
    await pg.open('com.google.Chrome', 'Google Chrome'); var fNone = await focused();
    mac.select(NOTES, [P11]); await pg.open(NOTES, 'Notes');
    var tabs = []; for (var i = 0; i < 9; i++) { tabs.push(await focused()); await pg.keyboard.press('Tab'); }
    S.check('C3.13', 'the keyboard starts where the next step is: the tag field when an item is selected, the Open Automation settings button when the app is not allowed, the lookup field when there is nothing to tag; Tab then goes field → recent tags (one stop) → lookup field → Find → tags in use (one stop) → App access → Settings → Manage tags → Quit (the two in the middle are new in 0.12)',
      fDenied === 'settingsBtn' && fNone === 'lookupField' && /^tagField chip:tag:\S+ lookupField findBtn chip:find:\S+ accessBtn prefsBtn manageBtn quitBtn$/.test(tabs.join(' ')), [fDenied, fNone, tabs.join(' ')].join(' | '));
    await pg.focus('#tagField'); await pg.keyboard.press('ArrowDown'); var a1 = await focused(); await pg.keyboard.press('ArrowRight'); var a2 = await focused(); await pg.keyboard.press('ArrowUp'); var a3 = await focused();
    S.check('C3.14', 'arrow keys: Down from the tag field goes to the recent tags, Left and Right move along them, Up goes back to the field', /^chip:tag:/.test(a1) && /^chip:tag:/.test(a2) && a2 !== a1 && a3 === 'tagField', [a1, a2, a3].join(' '));
    var audit = await pg.evaluate(function () {
      var unnamed = [], small = [];
      Array.prototype.forEach.call(document.querySelectorAll('button, input, [role=status], [role=group], [role=list]'), function (e) {
        if (e.offsetParent === null && e.getClientRects().length === 0) return;
        var name = (e.getAttribute('aria-label') || '') + (e.getAttribute('aria-labelledby') ? document.getElementById(e.getAttribute('aria-labelledby')).textContent : '') + ((e.tagName === 'BUTTON' || e.getAttribute('role') === 'status') ? e.textContent : '');
        if (!name.trim() && e.getAttribute('role') !== 'status') unnamed.push(e.id || e.className);
        if (e.tagName === 'BUTTON' || e.tagName === 'INPUT') { var b = e.getBoundingClientRect(); if (b.width && (b.height < 20 || b.width < 20)) small.push((e.id || e.className) + ' ' + Math.round(b.width) + '×' + Math.round(b.height)); }
      });
      var s = getComputedStyle(document.documentElement), v = function (n) { return s.getPropertyValue(n).trim(); };
      return { unnamed: unnamed, small: small, colors: { paper: v('--paper'), sheet: v('--sheet'), ink: v('--ink'), soft: v('--soft'), accent: v('--accent'), tint: v('--tint'), field: v('--field') }, body: getComputedStyle(document.body).fontSize + ' ' + getComputedStyle(document.body).fontWeight,
        weights: Array.prototype.filter.call(document.querySelectorAll('body *'), function (e) { return e.textContent.trim() && +getComputedStyle(e).fontWeight > 400; }).length, minFont: Math.min.apply(null, Array.prototype.map.call(document.querySelectorAll('body *'), function (e) { return e.childElementCount === 0 && e.textContent.trim() ? parseFloat(getComputedStyle(e).fontSize) : 99; })),
        size: document.documentElement.scrollWidth + '×' + document.documentElement.scrollHeight };
    });
    var c = audit.colors, ratios = { 'text on background': contrast(c.ink, c.paper), 'secondary text on background': contrast(c.soft, c.paper), 'tag text on its tint': contrast(c.accent, c.tint), 'white on the Copy button': contrast('#ffffff', c.accent), 'secondary text on white': contrast(c.soft, c.sheet), 'field border on background': contrast(c.field, c.paper) };
    var lowText = Object.keys(ratios).filter(function (k) { return k !== 'field border on background' && ratios[k] < 4.5; });
    S.check('C3.15', 'accessibility, measured on the page: every control has a name for VoiceOver; every button and field is at least 20 × 20 points; text contrast is at least 4.5:1 everywhere and field borders at least 3:1; type is regular weight throughout, 13 px body, nothing under 11 px; the page is exactly 352 × 440',
      audit.unnamed.length === 0 && audit.small.length === 0 && lowText.length === 0 && ratios['field border on background'] >= 3 && audit.weights === 0 && audit.body === '13px 400' && audit.minFont >= 11 && audit.size === '352×440', JSON.stringify({ unnamed: audit.unnamed, small: audit.small, ratios: ratios, weights: audit.weights, body: audit.body, minFont: audit.minFont, size: audit.size }));
    S.measure('contrast ratios (WCAG formula, from the page\'s own colours)', Object.keys(ratios).map(function (k) { return k + ' ' + ratios[k] + ':1'; }).join('; '));
    S.check('C3.16', 'no page errors during the whole cycle, and the page asked the Mac for nothing but its twelve named requests', pg.errors.length === 0 && pg.asked.every(function (op) { return 'selection readNote readMail readFile readIndex indexStamp writeIndex copyText close quit access settings'.split(' ').indexOf(op) >= 0; }), pg.errors.join(' | '));

    /* ── the same tasks on 0.10.3, for the before numbers ── */
    var base = C.baseline();
    if (base) {
      var sb = await C.Scene.build(require(path.join(base, 'core', 'popover.js'))), mb = sb.mac, pb = await C.popoverPage(br, base, mb), HB;
      mb.select(MAIL, ['6001']); await pb.open(MAIL, 'Mail');
      HB = C.hands(pb); await HB.click('#tagChips .chip:has-text("PineRidge")'); var midB = mb.objects()['mid:20261119.0905.kr@harborline-tooling.example']; await HB.click('#saveBtn');
      var okB = mb.objects()['mid:20261119.0905.kr@harborline-tooling.example'].tags.join() === 'PineRidge' && !midB; var addB = HB.clicks;
      await pb.click('#tagChips .chip:has-text("Cost")'); await pb.click('#saveBtn'); await pb.waitForTimeout(60);
      HB = C.hands(pb); await HB.click('#tagChips .chip:has-text("PineRidge")'); await HB.click('#saveBtn'); var rmB = HB.clicks, okRm = mb.objects()['mid:20261119.0905.kr@harborline-tooling.example'].tags.join() === 'Cost';
      await pb.fill('#tagField', 'Cost PineRidge'); await pb.click('#saveBtn'); await pb.waitForTimeout(60); await pb.fill('#tagField', 'Cost PineRidge Budget'); var warnedBefore = (await pb.textContent('#tagMsg')); await pb.click('#saveBtn'); await pb.waitForTimeout(60); var warnedAfter = await pb.textContent('#tagMsg');
      mb.select(NOTES, [P13]); await pb.open(NOTES, 'Notes'); mb.select(NOTES, [P12]); await pb.fill('#tagField', 'Cost Budget'); await pb.click('#saveBtn'); await pb.waitForTimeout(60);
      var refusedB = await pb.textContent('#object'), retryB = await pb.$('#retryBtn, button:has-text("selected now")');
      mb.select(NOTES, [P12]); await pb.open(NOTES, 'Notes'); HB = C.hands(pb); await HB.type('Lunch'); await HB.key('Enter'); var kbB = HB.total();
      var idB = await (async function () { mb.select(MAIL, ['6001']); await pb.open(MAIL, 'Mail'); return pb.evaluate(function () { var o = document.getElementById('object'); return { text: o.textContent.slice(0, 12), height: Math.round(o.getBoundingClientRect().height), sectionHeight: Math.round(document.getElementById('tag').getBoundingClientRect().height) }; }); })();
      S.check('C3.17', 'the before numbers were taken from the 0.10.3 page doing the same tasks with the same results', okB && okRm && /At most 2 tags/.test(warnedAfter) && /selection in Notes changed/.test(refusedB), [okB, okRm, warnedAfter, refusedB.slice(0, 60)].join(' | '));
      S.measure('task A, tag with a new name, keyboard: before → after (typed + keys)', kbB + ' → ' + k1);
      S.measure('task C, tag with a recent tag, mouse: clicks before → after', addB + ' (tag, Save) → ' + clicksAdd);
      S.measure('task D, remove one of two tags, mouse: clicks before → after', rmB + ' (un-press the tag, Save) → 1 (×)');
      S.measure('task E, selection changed and nothing was tagged → see what is selected now: before → after', (retryB ? '1' : '2 (close, click the icon again)') + ' → ' + retryClicks + ' (button in the popover)');
      S.measure('third tag: when the person learns it will not fit, before → after', (/At most/.test(warnedBefore) ? 'before saving' : 'only after pressing Save') + ' → before typing (the field says so and the recent tags are withdrawn)');
      S.measure('selected item with a 78-character Korean title: height of the tagging block (px) before → after', idB.sectionHeight + ' → ' + id.itemHeight);
      S.measure('what identifies the selected item, before → after', 'kind + title → kind + app + its date and kind of date + title (2 lines at most) + folder for files');
      sb.cleanup();
    } else S.blocked('C3.17', 'before numbers from the 0.10.3 page', 'the 0.10.3 build was not found (set CONTEXT_BASELINE)');
    sc.cleanup();
  } finally { await br.close(); }
  S.blocked('C3.N1', 'on a real Mac: typing a Korean tag with the Korean input method, where Return first confirms the syllable being composed and only the next Return tags', 'needs macOS and WebKit: Chrome on Linux cannot run the macOS input method');
  S.blocked('C3.N2', 'on a real Mac: the keyboard is in the tag field as soon as the popover opens, and returns to the app the person came from when it closes', 'needs macOS: focus between apps is the Swift shell\'s work (App.swift), not compiled or run here');
};
