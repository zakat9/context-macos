/* Cycle 4 — looking a tag up: Korean names, latest-only contents, order by each source's own date, missing and
 * replaced files, exact citations. The page of this build runs in Chrome at 352 × 440 against the pretend Mac; the
 * same lookups are then done on the 0.10.3 page for the before numbers. The truth is kept in the test, apart from
 * the product: the dates and values written into the pretend Mac. */
'use strict';
var fs = require('fs'), path = require('path');

module.exports = async function (S, C) {
  var L = C.L, Core = C.Core, NOTES = L.NOTES, MAIL = L.MAIL, FINDER = 'com.apple.finder';
  var P11 = 'x-coredata://FICTIONAL-0002/ICNote/p11', P12 = 'x-coredata://FICTIONAL-0002/ICNote/p12';
  var br = await C.browser(), shots = process.env.CONTEXT_SHOTS ? path.join(process.env.CONTEXT_SHOTS, 'cycle4') : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  try {
    var sc = await C.Scene.build(C.Popover), mac = sc.mac, slow = 0;
    var pg = await C.popoverPage(br, C.ROOT, mac, { delay: function (op) { return /^read(File|Mail|Note)$/.test(op) ? slow : 0; } }), H = C.hands(pg);
    async function text(sel) { return (await pg.textContent(sel)) || ''; }
    async function focused() { return pg.evaluate(function () { var a = document.activeElement; return a ? (a.getAttribute('data-key') || a.id || a.tagName) : ''; }); }
    async function rows() {
      return pg.$$eval('#sources > *', function (els) { return els.map(function (e) {
        if (e.classList.contains('group')) return { group: e.textContent };
        if (!e.classList.contains('src')) return { other: e.textContent };
        return { label: e.querySelector('.badge').textContent, title: e.querySelector('.t').textContent, meta: e.querySelector('.meta').textContent, ex: e.querySelector('.ex').textContent, ticked: e.querySelector('input').checked, changed: !!e.querySelector('.flag'), open: !!e.querySelector('.quote'), quote: e.querySelector('.quote') ? e.querySelector('.quote').textContent : '', id: e.querySelector('input').getAttribute('data-id') };
      }); });
    }
    async function listed() { await pg.waitForFunction(function () { return document.getElementById('sources').getAttribute('aria-busy') === 'false' && !document.getElementById('copyBtn').textContent.match(/Checking/); }); await pg.waitForTimeout(60); return rows(); }
    async function look(tag) { await pg.fill('#lookupField', tag); await pg.press('#lookupField', 'Enter'); return listed(); }
    async function snap(name) { if (shots) await pg.screenshot({ path: path.join(shots, name + '.png') }); }
    function visible() { return pg.evaluate(function () { var s = document.getElementById('sources'), box = s.getBoundingClientRect(), n = 0; Array.prototype.forEach.call(s.querySelectorAll('.src'), function (r) { var b = r.getBoundingClientRect(); if (b.top >= box.top - 0.5 && b.bottom <= box.bottom + 0.5) n++; }); return { height: s.clientHeight, full: n, rows: s.querySelectorAll('.src').length, screens: Math.ceil(s.scrollHeight / s.clientHeight) }; }); }

    /* ── order by each source's own date ── */
    mac.select(NOTES, [P11]); await pg.open(NOTES, 'Notes');
    var r = await look('Cost'), src = r.filter(function (x) { return x.label; }), sum = await text('#summary'), mode = await pg.getAttribute('body', 'data-mode'), vis = await visible();
    await snap('01-lookup-cost');
    var want = [['E1', 'Email, sent Nov 6, 2026 15:40'], ['E2', 'Email, sent Nov 10, 2026 09:12'], ['E3', 'Email, sent Nov 12, 2026 16:30'], ['N1', 'Note, last saved Nov 13, 2026 17:05'], ['E4', 'Email, sent Nov 17, 2026 14:05'], ['W1', 'Workbook, last saved Nov 18, 2026 16:40'], ['E5', 'Email, date unknown'], ['X1', 'Workbook, unavailable']];
    S.check('C4.01', 'the tag Cost: eight sources, one row each, in the order of their own dates (a message by when it was sent, a note or file by when it was last saved), each row saying which kind of date it is; the message without a date and the missing file are set apart under their own headings, after the dated ones',
      src.map(function (x) { return x.label + '|' + x.meta; }).join('\n') === want.map(function (x) { return x.join('|'); }).join('\n') && r[6].group === 'Date unknown' && r[8].group === 'Could not be read now. Listed by name only.' && sum === '8 sources, oldest first. 1 unavailable.' && mode === 'find', src.map(function (x) { return x.label + '|' + x.meta; }).join(' ; ') + ' || ' + sum);
    var truth = [['2026-11-06T15:40', 'Competing quote: Pine Ridge housing mold'], ['2026-11-10T09:12', 'Revised tooling quote: Pine Ridge housing'], ['2026-11-12T16:30', 'Request: raise the Pine Ridge tooling cap'], ['2026-11-13T17:05', 'Supplier call: Harborline'], ['2026-11-17T14:05', 'Approved: Pine Ridge tooling cap'], ['2026-11-18T16:40', 'tooling-budget.xlsx']];
    S.check('C4.02', 'that order equals the dates written into the pretend Mac, sorted; it is not the order in which the sources were tagged (the workbook was tagged first and is listed last of the dated ones)',
      src.slice(0, 6).map(function (x) { return x.title; }).join('|') === truth.map(function (x) { return x[1]; }).join('|') && truth.map(function (x) { return x[0]; }).join() === truth.map(function (x) { return x[0]; }).sort().join() && Object.keys(mac.objects()).map(function (k) { return mac.objects()[k]; }).sort(function (a, b) { return a.capturedAt < b.capturedAt ? -1 : 1; })[0].title === 'tooling-budget.xlsx', src.map(function (x) { return x.title; }).join(' | '));

    /* ── latest only ── */
    var w = src[5], n1 = src[3];
    S.check('C4.03', 'latest only: the workbook was saved three times (cap 50,000 → 50,000 → 55,000; quote 51,234 → 48,234 → 48,500) and the note was rewritten once; each has one row, showing only what is saved now',
      /B1: \$55,000\.00/.test(w.ex) && !/51,234|48,234|50,000\.00/.test(JSON.stringify(src)) && /hold the price until Nov 30/.test(n1.ex) && !/STALE-NOTE-V1|Nov 25/.test(JSON.stringify(src)) && src.filter(function (x) { return x.title === 'tooling-budget.xlsx'; }).length === 1, w.ex + ' | ' + n1.ex);

    /* ── previews are exactly what will be copied; citations ── */
    await pg.click('[data-key="more:' + w.id + '"]'); await pg.waitForTimeout(60); var open1 = (await rows()).filter(function (x) { return x.label === 'W1'; })[0];
    await pg.click('[data-key="lines:' + w.id + '"]').catch(function () {}); await pg.waitForTimeout(60); var openAll = (await rows()).filter(function (x) { return x.label === 'W1'; })[0];
    await snap('02-preview-open');
    var copied0 = mac.clipboard; await pg.click('#copyBtn'); await pg.waitForTimeout(150);
    var clip = mac.clipboard || '', parsed = L.parseContext(clip), secW = parsed.filter(function (s) { return s.label === 'W1'; })[0], copyMsg = await text('#copyMsg'), fCopy = await focused();
    var quotedInPreview = openAll.quote.split('\n').slice(0, -1).join('\n');                                 /* the last line of a preview is where the source is */
    S.check('C4.04', 'the preview of a source is line for line what Copy puts on the clipboard for it, and the row\'s label is the label used for it in the copied text',
      copied0 === null && secW && secW.quoted.join('\n') === quotedInPreview && open1.open && /\[Summary\] A1: Budget cap · B1: \$55,000\.00/.test(openAll.quote) && openAll.quote.split('\n').pop() === path.join(mac.files, 'tooling-budget.xlsx'), (secW ? secW.quoted.length : 'no W1') + ' lines copied vs ' + quotedInPreview.split('\n').length + ' previewed');
    var labelsShown = src.map(function (x) { return x.label; }).join(), labelsCopied = parsed.filter(function (s) { return s.label; }).map(function (s) { return s.label; }).join();
    var cites = clip.match(/\[(?:[ENWFP]\d+)(?: › [^\]]+)?\]/g) || [], knownLabels = src.map(function (x) { return x.label; });
    var exampleW = clip.match(/Cite cells as \[W1 › ([^!\]]+)!([A-Z]+\d+)\]/), exampleN = clip.match(/Cite lines as \[N1 › L(\d+)\]/), secN = parsed.filter(function (s) { return s.label === 'N1'; })[0];
    var wrongCite = cites.filter(function (c) { return knownLabels.indexOf(c.replace(/^\[|\]$/g, '').split(' › ')[0]) < 0; });
    S.check('C4.05', 'citations: the copied text names the same eight labels in the same order as the list; every citation in it points at one of those labels; the example citation for the workbook names a sheet and a cell that the quoted workbook really has, and the one for the note a line it really has; cell B1 holds the current value; the missing file is named with its reason and nothing else',
      labelsShown === labelsCopied && wrongCite.length === 0 && L.cellLine(secW, 'Summary', 'B1') === '$55,000.00' && exampleW && L.cellLine(secW, exampleW[1], exampleW[2]) !== null && exampleN && secN.quoted.some(function (l) { return l.indexOf('L' + exampleN[1] + ': ') === 0; }) && /\[X1\] Workbook “vendor-shortlist\.csv” — file not found/.test(clip) && !/Harborline,48500/.test(clip), labelsShown + ' / ' + labelsCopied + ' wrong: ' + wrongCite.join() + ' B1=' + (secW && L.cellLine(secW, 'Summary', 'B1')) + ' example: ' + (exampleW ? exampleW[0] : (clip.match(/Cite cells as [^.]*/) || [''])[0]));
    S.check('C4.06', 'Copy is the only thing that writes the clipboard, it says how many sources were copied and that nothing was sent, and the keyboard stays on the Copy button', copyMsg === '✓ Copied 8 sources. Paste it into your AI chat. Nothing was sent.' && fCopy === 'copyBtn' && mac.counts.copyText === 1, copyMsg + ' ' + fCopy);
    await snap('03-copied');

    /* ── choosing sources ── */
    mac.clipboard = 'UNTOUCHED'; mac.counts.copyText = 0;
    await pg.click('[data-key="more:' + w.id + '"]');
    H = C.hands(pg); await H.click('[data-key="tick:' + src[0].id + '"]'); await pg.evaluate(function (id) { var e = document.querySelector('[data-id="' + id + '"]'); e.scrollIntoView({ block: 'nearest' }); }, src[6].id); await H.click('[data-key="tick:' + src[6].id + '"]');
    var btn2 = (await text('#copyBtn')).replace('⌘↩', '').trim(), untouched = mac.clipboard === 'UNTOUCHED'; await H.click('#copyBtn'); await pg.waitForTimeout(150);
    var clip2 = mac.clipboard, p2 = L.parseContext(clip2);
    S.check('C4.07', 'two sources are unticked (the competing quote and the undated message): the button says "Copy 6 of 8"; nothing reaches the clipboard until Copy; the copied text holds exactly the six ticked sources, says it is 6 of 8, and has no trace of the two left out',
      btn2 === 'Copy 6 of 8' && untouched && p2.filter(function (s) { return s.label; }).map(function (s) { return s.label; }).join() === 'E2,E3,N1,E4,W1,X1' && /This copy holds 6 of the 8 sources linked to ::Cost/.test(clip2) && !/UNSELECTED-CANARY-KESTREL|Kestrel|51,200|P20 is enough|FYI: steel grade/.test(clip2), btn2 + ' | ' + p2.map(function (s) { return s.label; }).join());
    S.measure('copy six of eight sources, mouse: clicks after', H.clicks + ' (two tick boxes, Copy)');
    await pg.click('#noneBtn'); await pg.waitForTimeout(60); var noneBtn = await pg.isDisabled('#copyBtn'), noneMsg = await text('#copyMsg'); await pg.click('#allBtn'); await pg.waitForTimeout(60); var allBtn = (await text('#copyBtn')).replace('⌘↩', '').trim();
    S.check('C4.08', 'None unticks everything: Copy is off and the line beside it says to tick a source; All ticks everything again', noneBtn && noneMsg === 'Tick at least one source to copy.' && allBtn === 'Copy 8 sources', noneMsg + ' | ' + allBtn);

    /* ── a source changes between being shown and being copied ── */
    mac.clipboard = 'UNTOUCHED'; fs.writeFileSync(path.join(mac.files, 'tooling-budget.xlsx'), L.workbook(2));
    await pg.click('#copyBtn'); await pg.waitForTimeout(200);
    var st = await rows(), wRow = st.filter(function (x) { return x.label === 'W1'; })[0], staleMsg = await text('#copyMsg'), fStale = await focused(), role = await pg.getAttribute('#copyMsg', 'role');
    await snap('04-changed-since-shown');
    await pg.click('#copyBtn'); await pg.waitForTimeout(200); var clip3 = mac.clipboard;
    S.check('C4.09', 'the workbook is saved again after the list was shown, then Copy: nothing is copied; the message names W1; that row is marked Changed, opened to show what is saved now, and has the keyboard; pressing Copy again copies the new values and none of the old',
      staleMsg === 'Not copied: W1 changed after it was shown. Check it, then copy again.' && role === 'alert' && wRow.changed && wRow.open && /B2: \$48,234\.00/.test(wRow.quote) && fStale === 'tick:' + wRow.id && /B2: \$48,234\.00/.test(clip3) && !/48,500\.00|55,000\.00/.test(clip3.split('### ').filter(function (x) { return /\[W1\]/.test(x); })[0] || ''), staleMsg + ' | changed=' + wRow.changed + ' open=' + wRow.open + ' focus=' + fStale);
    fs.writeFileSync(path.join(mac.files, 'tooling-budget.xlsx'), L.workbook(3));

    /* ── replaced and missing files ── */
    var wbPath = path.join(mac.files, 'tooling-budget.xlsx'), keep = fs.readFileSync(wbPath);
    fs.writeFileSync(wbPath, fs.readFileSync(path.join(C.ROOT, 'tests', 'fixtures', 'maintenance-820.xlsx')));       /* another workbook put in its place, same name */
    r = await look('Cost'); var rep = r.filter(function (x) { return x.title === 'tooling-budget.xlsx'; })[0], repAt = r.filter(function (x) { return x.label; }).map(function (x) { return x.label; }).indexOf(rep.label);
    fs.rmSync(wbPath); r = await look('Cost'); var goneRow = r.filter(function (x) { return x.title === 'tooling-budget.xlsx'; })[0], sum2 = await text('#summary');
    fs.writeFileSync(wbPath, keep); var d = new Date('2026-11-18T07:40:00Z'); fs.utimesSync(wbPath, d, d);
    S.check('C4.10', 'the workbook is replaced by a different workbook under the same name: its row shows the new file\'s contents and its own date, and takes the place in the order that date gives it; then the file is deleted: the row moves under "Could not be read now" with the reason, and shows no date and no contents',
      /B2: 820/.test(rep.ex) && !/55,000|48,500/.test(rep.ex) && /^Workbook, last saved /.test(rep.meta) && goneRow.meta === 'Workbook, unavailable' && /^Unavailable: file not found at .*tooling-budget\.xlsx \(moved, renamed or deleted\)\.$/.test(goneRow.ex) && sum2 === '8 sources, oldest first. 2 unavailable.', rep.meta + ' | ' + rep.ex + ' | ' + goneRow.meta + ' | ' + goneRow.ex);
    mac.automationDenied[MAIL] = true; r = await look('Cost'); var mailRows = r.filter(function (x) { return /^E/.test(x.label) || (/^X/.test(x.label) && x.meta === 'Email, unavailable'); });
    var deniedRows = r.filter(function (x) { return x.meta === 'Email, unavailable'; }); mac.automationDenied = {};
    S.check('C4.11', 'Mail is not allowed at the moment of a lookup: the tagged Mail messages are listed as unavailable with the reason, with no dates and nothing of their contents; the message saved as a file is still read', deniedRows.length === 4 && deniedRows.every(function (x) { return /Automation/.test(x.ex) && !/USD|Jonas|Dana/.test(x.ex); }) && r.some(function (x) { return x.title === 'Competing quote: Pine Ridge housing mold' && /^Email, sent/.test(x.meta); }), deniedRows.length + ' | ' + (deniedRows[0] || {}).ex);

    /* ── Korean ── */
    var pop = C.Popover.create(mac.host); mac.select(MAIL, ['6001']); await pop.opened({ bundleId: MAIL }); await pop.addTag('금형견적'); mac.select(NOTES, [P11]); await pop.opened({ bundleId: NOTES }); await pop.addTag('금형견적');
    await pg.open(NOTES, 'Notes'); r = await look('금형견적'); var kr = r.filter(function (x) { return x.label; }), krSum = await text('#summary'), krChip = await pg.getAttribute('[data-key="chip:find:금형견적"]', 'aria-pressed');
    var krRow = await pg.evaluate(function () { function inner(r) { return Math.round(r.querySelector('.pick').getBoundingClientRect().height) + '+' + Math.round(r.querySelector('.more').getBoundingClientRect().height); }
      var t = document.querySelectorAll('#sources .src .t')[1]; return { text: t.textContent, cut: t.scrollWidth > t.clientWidth, full: t.title, h: inner(t.closest('.src')), h0: inner(document.querySelectorAll('#sources .src')[0]) }; });
    await snap('05-korean-tag-long-korean-title');
    await pg.click('#copyBtn'); await pg.waitForTimeout(150); var krClip = mac.clipboard;
    S.check('C4.12', 'a Korean tag typed into the lookup field finds its two sources in date order; the 78-character Korean subject stays on one line in the list (same row height as the others) with its full text on hover; the copied text carries the Korean title and the note\'s Korean line unchanged',
      kr.map(function (x) { return x.label; }).join() === 'N1,E1' && krSum === '2 sources, oldest first.' && krChip === 'true' && krRow.cut && krRow.full === C.Scene.LONG && krRow.h === krRow.h0 && krClip.indexOf('“' + C.Scene.LONG + '”') > 0 && /국내 가공 견적은 ₩12,400,000 \(부가세 별도\)\./.test(krClip) && /# Context context for ::금형견적/.test(krClip), kr.map(function (x) { return x.label; }).join() + ' | ' + JSON.stringify(krRow));
    r = await look('cost pineridge'); var both = r.filter(function (x) { return x.label; }).map(function (x) { return x.title; });
    r = await look('::COST'); var caps = r.filter(function (x) { return x.label; }).length; r = await look('#Travel'); var hash = r.filter(function (x) { return x.label; }).map(function (x) { return x.title; }).join();
    S.check('C4.13', 'two tags typed together find only the sources that carry both; capitals do not matter; a pasted ::Cost or #Travel works as the plain name', both.join('|') === 'Revised tooling quote: Pine Ridge housing|tooling-budget.xlsx' && caps === 8 && hash === 'Busan trip', both.join('|') + ' ' + caps + ' ' + hash);

    /* ── nothing found, nothing typed, loading ── */
    r = await look('Budget2027'); var unk = await text('#summary'), unkChips = await pg.$$eval('#lookupChips .chip', function (x) { return x.length; }), unkCopy = await pg.isDisabled('#copyBtn'); await snap('06-unknown-tag');
    await pg.fill('#lookupField', ''); await pg.press('#lookupField', 'Enter'); await pg.waitForTimeout(80); var empty = await text('#summary');
    S.check('C4.14', 'a tag nobody used: the popover says so in plain words and points at the tags in use, which stay one press away; an empty lookup asks for a tag; Copy is off in both', unk === 'No source has the tag Budget2027. Tags in use are listed above.' && unkChips >= 3 && unkCopy && empty === 'Type a tag, or choose one below.', unk + ' | ' + empty);
    slow = 150; await pg.fill('#lookupField', 'Cost'); await pg.press('#lookupField', 'Enter'); await pg.waitForTimeout(400);
    var loading = await pg.evaluate(function () { var p = document.getElementById('progress'); return { text: document.getElementById('summary').textContent, bar: !p.hidden, value: p.value, max: p.max, busy: document.getElementById('sources').getAttribute('aria-busy'), copy: document.getElementById('copyBtn').disabled }; });
    await snap('07-reading'); await listed(); slow = 0;
    S.check('C4.15', 'while the sources are being read (slowed down here to 150 ms each): the popover says which one of how many it is reading, shows a progress bar, marks the list busy for VoiceOver and keeps Copy off', /^Reading \d of 8 as saved now…$/.test(loading.text) && loading.bar && loading.max === 8 && loading.value >= 1 && loading.busy === 'true' && loading.copy, JSON.stringify(loading));

    /* ── keyboard only ── */
    mac.select(NOTES, [P12]); await pg.open(NOTES, 'Notes'); mac.clipboard = 'UNTOUCHED';
    H = C.hands(pg); await H.key('Tab'); await H.key('Tab'); var onLookup = await focused(); await H.type('Cost'); await H.key('Enter'); await listed();
    await H.key('ArrowDown'); var k1 = await focused(); await H.key('ArrowDown'); await H.key('ArrowDown'); await H.key('Space'); await H.key('ArrowRight'); var kOpen = (await rows()).filter(function (x) { return x.open; }).map(function (x) { return x.label; }).join();
    await H.key('ArrowLeft'); var kClosed = (await rows()).filter(function (x) { return x.open; }).length; await H.key('Meta+Enter'); await pg.waitForTimeout(150);
    var kClip = L.parseContext(mac.clipboard).filter(function (s) { return s.label; }).map(function (s) { return s.label; }).join(), kFocus = await focused();
    S.check('C4.16', 'keyboard only, from the open popover: Tab to the lookup field, type the tag, Return; Down into the list and along it; Space unticks the third source; Right opens its preview and Left closes it; Command-Return copies the seven that are ticked',
      onLookup === 'lookupField' && /^tick:/.test(k1) && kOpen === 'E3' && kClosed === 0 && kClip === 'E1,E2,N1,E4,W1,E5,X1' && kFocus === 'copyBtn', [onLookup, k1, kOpen, kClosed, kClip, kFocus].join(' | '));
    S.measure('copy seven of eight sources, keyboard only: keys after (4 typed + keys)', H.total() + ' (Tab, Tab, 4 typed, Return, Down ×3, Space, Right, Left, ⌘↩)');
    vis = await visible();
    S.measure('list of sources: height (px) and rows fully visible without scrolling, after', vis.height + ' px, ' + vis.full + ' of ' + vis.rows + ' rows; ' + vis.screens + ' screens to see them all');
    /* 0.12.1: the popover's height follows its content within the room the app reports. At the old fixed 440 (a small
       screen now) the taller bottom toolbar costs one row (4 → 3); in a 720-point room the popover grows and shows about twice as many rows. */
    await pg.evaluate(function () { return window.workIndexOpened({ bundleId: 'com.apple.Notes', name: 'Notes', room: 720 }); }); await pg.waitForTimeout(60);
    await look('Cost'); var visRoom = await visible();
    S.check('C4.17', 'with an item selected: in a 440-point room (the old fixed size) the list shows at least three whole source rows and scrolls for the rest; in a 720-point room the popover grows and the list shows at least six whole rows; the page had no errors', vis.full >= 3 && visRoom.full >= 6 && visRoom.height > vis.height && visRoom.rows === 8 && pg.errors.length === 0, JSON.stringify([vis, visRoom]) + ' ' + pg.errors.join());
    await pg.evaluate(function () { return window.workIndexOpened({ bundleId: 'com.apple.Notes', name: 'Notes', room: 440 }); }); await pg.waitForTimeout(60);  /* back to the browser's 440 */

    /* ── the same lookup on 0.10.3 ── */
    var base = C.baseline();
    if (base) {
      var sb = await C.Scene.build(require(path.join(base, 'core', 'popover.js'))), mb = sb.mac, pb = await C.popoverPage(br, base, mb), HB;
      mb.select(NOTES, [P12]); await pb.open(NOTES, 'Notes');
      HB = C.hands(pb); await HB.key('Tab'); await HB.key('Tab'); await HB.key('Tab'); await HB.key('Tab'); await HB.key('Tab'); var onB = await pb.evaluate(function () { return document.activeElement.id; });
      await HB.type('Cost'); await HB.key('Enter'); await pb.waitForFunction(function () { return document.querySelectorAll('#sources .src').length > 0; }); await pb.waitForTimeout(100);
      var visB = await pb.evaluate(function () { var s = document.getElementById('sources'), box = s.getBoundingClientRect(), n = 0; Array.prototype.forEach.call(s.querySelectorAll('.src'), function (r) { var b = r.getBoundingClientRect(); if (b.top >= box.top - 0.5 && b.bottom <= box.bottom + 0.5) n++; }); return { height: s.clientHeight, full: n, rows: s.querySelectorAll('.src').length, screens: Math.ceil(s.scrollHeight / s.clientHeight) }; });
      /* keyboard only on 0.10.3: Tab through the row of recent tags and the sources to the third tick box, Space, then Tab on to Copy */
      var guard = 0; while (guard++ < 60) { await HB.key('Tab'); var at = await pb.evaluate(function () { var a = document.activeElement, boxes = Array.prototype.slice.call(document.querySelectorAll('#sources input[type=checkbox]')); return boxes.indexOf(a); }); if (at === 2) break; }
      await HB.key('Space'); guard = 0; while (guard++ < 60) { await HB.key('Tab'); if (await pb.evaluate(function () { return document.activeElement.id === 'copyBtn'; })) break; }
      await HB.key('Enter'); await pb.waitForTimeout(150);
      var clipB = L.parseContext(mb.clipboard || '').filter(function (s) { return s.label; }).map(function (s) { return s.label; }).join();
      var loadB = await (async function () { await pb.open(NOTES, 'Notes'); await pb.fill('#lookupField', 'Cost'); var p = pb.press('#lookupField', 'Enter'); await pb.waitForTimeout(5); var t = await pb.textContent('#summary'); await p; return t; })();
      S.check('C4.18', 'the before numbers were taken from the 0.10.3 page doing the same lookup and copying the same seven sources', onB === 'lookupField' && clipB === 'E1,E2,N1,E4,W1,E5,X1' && visB.rows === 8, onB + ' ' + clipB + ' ' + JSON.stringify(visB));
      S.measure('list of sources: height (px) and rows fully visible, before → after', visB.height + ' px, ' + visB.full + ' of ' + visB.rows + ' rows, ' + visB.screens + ' screens → ' + vis.height + ' px, ' + vis.full + ' of ' + vis.rows + ' rows, ' + vis.screens + ' screens');
      S.measure('copy seven of eight sources, keyboard only: keys before → after', HB.total() + ' → ' + (H.total() - 2) + ' like for like (' + H.total() + ' with the preview opened and closed on the way, which the before run did not do)');
      S.measure('sign that sources are being read, before → after', (loadB ? '“' + loadB + '”' : 'none (the popover looks idle)') + ' → “Reading 3 of 8 as saved now…” and a progress bar');
      S.measure('a source changed before Copy: what points at it, before → after', 'a sentence; the list is redrawn without a mark → the message names the label; the row is marked Changed, opened and given the keyboard');
      sb.cleanup();
    } else S.blocked('C4.18', 'before numbers from the 0.10.3 page', 'the 0.10.3 build was not found (set CONTEXT_BASELINE)');
    sc.cleanup();
  } finally { await br.close(); }
  S.blocked('C4.N1', 'on a real Mac: Notes and Mail return the tagged note and message as read here; Excel, Numbers and Preview documents are read from disk as saved', 'needs macOS: the apps here are pretend ones');
  S.blocked('C4.N2', 'on a real Mac: VoiceOver reads each row as its tick box with label, kind and title, and announces "Reading…" and the Copy result', 'needs macOS VoiceOver');
};
