/* Regression group PO: the popover's rules, driven with a pretend Mac (tests/lib/mac.js). Used by run.js. */
'use strict';
var fs = require('fs'), path = require('path');
module.exports = async function (ctx) {
  var t = ctx.t, fresh = ctx.fresh, fx = ctx.fx, demoFx = ctx.demoFx, Core = ctx.Core, Popover = ctx.Popover, Mac = require('./lib/mac.js'), Xlsx = require('./lib/xlsx.js');
  var NOTES = 'com.apple.Notes', MAIL = 'com.apple.mail', FINDER = 'com.apple.finder', EXCEL = 'com.microsoft.Excel';
  var clock = Date.parse('2026-11-19T10:00:00+09:00');
  function setup(name) {
    var mac = Mac.create(fresh(name).dir);
    mac.pop = Popover.create(mac.host, { now: function () { return clock; } });
    mac.addNote({ id: 'x-coredata://FICTIONAL-0001/ICNote/p1', title: 'Supplier call notes', text: 'Harborline holds the price until Nov 30.\nOpen: who signs off above the cap?', modified: '2026-11-12T17:20:00', created: '2026-11-12T16:50:00' });
    mac.addNote({ id: 'x-coredata://FICTIONAL-0001/ICNote/p2', title: 'Budget meeting notes', text: 'CANARY-NOTE-B: travel budget is separate.', modified: '2026-11-13T10:00:00', created: '2026-11-13T09:40:00' });
    mac.addMail({ numericId: '4821', messageId: '20261110.0912.rq2@harborline-tooling.example', subject: 'Revised tooling quote', sent: '2026-11-10T09:12:00', account: 'Work', mailbox: 'INBOX', from: 'Dana Okafor <dana.okafor@harborline-tooling.example>', text: 'The revised quote is USD 48,500.' });
    return mac;
  }
  var A = 'applenotes:x-coredata://FICTIONAL-0001/ICNote/p1', B = 'applenotes:x-coredata://FICTIONAL-0001/ICNote/p2', M = 'mid:20261110.0912.rq2@harborline-tooling.example';
  var mac = setup('po'), pop = mac.pop, v;

  mac.select(NOTES, ['x-coredata://FICTIONAL-0001/ICNote/p1']);
  v = await pop.opened({ bundleId: NOTES });
  t('PO01', 'the icon is clicked with one note selected in Notes: the popover shows that note; nothing is written and nothing is copied', v.target.state === 'object' && v.target.kind === 'Note' && v.target.title === 'Supplier call notes' && v.target.tags.length === 0 && v.recent.length === 0 && mac.indexText() === null && mac.clipboard === null && mac.requests.join() === 'indexStamp,readIndex,indexStamp,selection com.apple.Notes', JSON.stringify(v.target) + mac.requests.join());
  v = await pop.save('Cost');
  var rec = mac.objects()[A];
  t('PO02', 'plain “Cost” and Save: that note is tagged; one entry holding only the index fields; “Cost” is now a recent tag', v.tagMessage === 'Tagged Cost.' && v.target.tags.join() === 'Cost' && Object.keys(mac.objects()).length === 1 && Object.keys(rec).sort().join() === Core.RECORD_FIELDS.slice().sort().join() && rec.capturedAt === '2026-11-19T10:00:00+09:00' && v.recent.join() === 'Cost', JSON.stringify(v));
  var before = mac.indexText();
  v = await pop.save('Cost PineRidge Budget'); var three = v.tagMessage;
  v = await pop.save('Cost!'); var bang = v.tagMessage, untouched = mac.indexText() === before;
  v = await pop.save('::Cost, #PineRidge');
  t('PO03', '0 to 2 plain tags: a third is refused, punctuation is refused, a pasted ::Cost or #PineRidge is taken as the plain name; still one entry', three === 'At most 2 tags for one source. Remove 1.' && bang === 'Use letters, digits, - or _ in a tag.' && untouched && v.tagMessage === 'Tagged PineRidge.' && mac.objects()[A].tags.join() === 'Cost,PineRidge' && Object.keys(mac.objects()).length === 1, three + ' | ' + bang + ' | ' + v.tagMessage);

  /* wrong-target writes */
  before = mac.indexText();
  mac.select(NOTES, ['x-coredata://FICTIONAL-0001/ICNote/p2']);
  v = await pop.save('Budget');
  t('PO04', 'the selection in Notes changes while the popover is open: Save writes nothing, on either note, and says so', v.target.state === 'none' && /The selection in Notes changed while this was open\. Nothing was tagged\./.test(v.target.message) && mac.indexText() === before && !mac.objects()[B], JSON.stringify(v.target));
  var again = await pop.save('Budget');
  t('PO05', 'after that refusal the popover has no target: pressing Save again still writes nothing', again.tagMessage === 'Nothing is selected to tag.' && mac.indexText() === before);
  mac.select(NOTES, ['x-coredata://FICTIONAL-0001/ICNote/p1']); await pop.opened({ bundleId: NOTES });
  mac.select(NOTES, ['x-coredata://FICTIONAL-0001/ICNote/p1', 'x-coredata://FICTIONAL-0001/ICNote/p2']); v = await pop.save('Budget'); var multi = v.target.state === 'none' && mac.indexText() === before;
  mac.select(NOTES, ['x-coredata://FICTIONAL-0001/ICNote/p1']); await pop.opened({ bundleId: NOTES });
  mac.automationDenied[NOTES] = true; v = await pop.save('Budget'); var revoked = v.target.state === 'none' && mac.indexText() === before;
  v = await pop.opened({ bundleId: NOTES }); var deniedMsg = [v.target.reason, v.target.app, v.target.message].join('|'); mac.automationDenied = {};
  t('PO06', 'two notes selected at Save, or permission withdrawn at Save: nothing is written. Permission refused at the click: the popover names the app and says why (the page then offers Automation settings)', multi && revoked && deniedMsg === 'denied|Notes|contexta is not allowed to ask Notes which item is selected.', deniedMsg);

  /* one workbook reached through Finder and through Excel */
  var wb = mac.write('maintenance.xlsx', fs.readFileSync(fx('maintenance-900.xlsx')));
  mac.select(FINDER, [wb]); v = await pop.opened({ bundleId: FINDER }); v = await pop.save('Cost');
  var fid = 'file:' + wb, finderOk = v.target.kind === 'Workbook' && v.target.title === 'maintenance.xlsx' && mac.objects()[fid].tags.join() === 'Cost' && mac.objects()[fid].sourceTimeType === 'modified';
  mac.openDocument[EXCEL] = wb; v = await pop.opened({ bundleId: EXCEL }); var seen = v.target.tags.join(); v = await pop.save('Cost Maintenance');
  var n = Object.keys(mac.objects()).length, same = fs.readFileSync(wb).equals(fs.readFileSync(fx('maintenance-900.xlsx')));
  t('PO07', 'the same workbook registered from Finder and from Excel is one item: Excel already shows the Finder tag, and the second tag lands on the same entry; the file is untouched', finderOk && seen === 'Cost' && n === 2 && mac.objects()[fid].tags.join() === 'Cost,Maintenance' && same, seen + ' n=' + n);
  var trail = [];
  for (var i = 0; i < 12; i++) {
    var viaExcel = i % 2 === 1, want = ['', 'Cost', 'Cost Maintenance', 'maintenance', '금형 Cost', ''][i % 6];
    v = await pop.opened({ bundleId: viaExcel ? EXCEL : FINDER }); v = await pop.save(want);
    var now = mac.objects()[fid]; trail.push((now ? now.tags.join('+') : '-') + '/' + Object.keys(mac.objects()).length);
  }
  t('PO08', 'tagging, retagging and untagging the workbook 12 times, alternately from Finder and Excel, always leaves one entry or none: never a second item, never a third tag', trail.join(' ') === '-/1 Cost/2 Cost+Maintenance/2 maintenance/2 금형+Cost/2 -/1 -/1 Cost/2 Cost+Maintenance/2 maintenance/2 금형+Cost/2 -/1', trail.join(' '));
  var eml = mac.write('Revised tooling quote.eml', fs.readFileSync(demoFx('Revised tooling quote - Pine Ridge housing.eml')));
  mac.select(MAIL, ['4821']); await pop.opened({ bundleId: MAIL }); await pop.save('Cost');
  mac.select(FINDER, [eml]); v = await pop.opened({ bundleId: FINDER });
  t('PO09', 'a message tagged in Mail and the same message saved as a file are one item (same Message-ID): the file already shows the tag', v.target.kind === 'Email' && v.target.tags.join() === 'Cost' && !!mac.objects()[M] && Object.keys(mac.objects()).length === 2, JSON.stringify(v.target));

  /* recent tags come from the index, not from a history */
  clock += 60000; mac.select(NOTES, ['x-coredata://FICTIONAL-0001/ICNote/p2']); await pop.opened({ bundleId: NOTES }); v = await pop.save('Travel');
  var order1 = v.recent.join();
  clock += 60000; mac.select(FINDER, [wb]); await pop.opened({ bundleId: FINDER }); v = await pop.save('Cost');
  var order2 = v.recent.join();
  clock += 60000; mac.select(NOTES, ['x-coredata://FICTIONAL-0001/ICNote/p2']); await pop.opened({ bundleId: NOTES }); v = await pop.save('');
  t('PO10', 'recent tags are the tags of the entries updated last, read from the index: a tag no entry carries any more is not offered', order1.split(',')[0] === 'Travel' && order2.split(',')[0] === 'Cost' && order2.indexOf('Travel') > 0 && v.recent.indexOf('Travel') < 0 && !/Travel/.test(mac.indexText()), order1 + ' | ' + order2 + ' | ' + v.recent.join());

  /* looking up and copying */
  mac.select(NOTES, ['x-coredata://FICTIONAL-0001/ICNote/p2']); await pop.opened({ bundleId: NOTES }); await pop.save('Cost');
  mac.requests = []; mac.counts = {};
  v = await pop.lookup('Cost');
  var L = v.lookup, heads = L.sources.map(function (s) { return s.label + ' ' + s.kind + ' ' + s.when.replace(/, 2026.*/, '') + ' ' + s.dateLabel.replace(/ \(.*/, ''); }).join(' | ');
  t('PO11', 'one tag gathers the mail message, the workbook and the note, one entry each, in order of their own dates with the kind of date; nothing has been copied', heads === 'W1 Workbook Nov 9 last saved | E1 Email Nov 10 sent | N1 Note Nov 12 last saved | N2 Note Nov 13 last saved' && L.counts.total === 4 && L.sources.every(function (s) { return s.selected && s.status === 'read'; }) &&
    /B2: 900/.test(L.sources[0].lines.join('\n')) && /USD 48,500/.test(L.sources[1].lines.join('\n')) && /L2: Open: who signs off above the cap\?/.test(L.sources[2].lines.join('\n')) && mac.clipboard === null && !mac.counts.copyText, heads);
  v = await pop.setSelected(B, false);
  var shown = pop.preview(); v = await pop.copy();
  t('PO12', 'the note with the canary line is unticked, then Copy: the clipboard holds exactly the reviewed text, three sources with their citations, and no trace of the unticked note', mac.clipboard === shown && v.copyMessage === 'Copied 3 sources. Paste it into your AI chat. Nothing was sent.' && v.copyState === 'copied' && /This copy holds 3 of the 4 sources linked to ::Cost/.test(mac.clipboard) && !/CANARY-NOTE-B|Budget meeting notes|ICNote\/p2/.test(mac.clipboard) &&
    /\[W1 › Summary!A1\]/.test(mac.clipboard) && /Cite the message as \[E1\]/.test(mac.clipboard) && /Cite lines as \[N1 › L2\]/.test(mac.clipboard) && mac.counts.copyText === 1, (mac.clipboard || '').slice(0, 300));
  mac.clipboard = 'UNTOUCHED'; mac.counts = {};
  await pop.opened({ bundleId: NOTES }); await pop.lookup('Cost'); await pop.setSelected(A, false); await pop.setSelected(A, true); pop.preview(); await pop.closed();
  await pop.opened({ bundleId: NOTES }); await pop.lookup('Cost');
  for (var k = 0; k < 4; k++) await pop.setSelected([fid, M, A, B][k], false);
  v = await pop.copy();
  t('PO13', 'no accidental export: opening, looking up, ticking, previewing and closing never touch the clipboard; Copy with nothing ticked copies nothing', mac.clipboard === 'UNTOUCHED' && !mac.counts.copyText && v.copyMessage === 'Tick at least one source.', mac.clipboard + ' ' + JSON.stringify(mac.counts));

  /* current saved contents only */
  await pop.opened({ bundleId: FINDER }); v = await pop.lookup('::Cost');
  var first = /B2: 900/.test(v.lookup.sources[0].lines.join());
  fs.writeFileSync(wb, fs.readFileSync(fx('maintenance-820.xlsx')));
  v = await pop.copy();
  var refused = v.copyMessage === 'Not copied: W1 changed after it was shown. Check it, then copy again.' && v.copyState === 'stale' && v.lookup.sources.filter(function (s) { return s.changed; }).map(function (s) { return s.label; }).join() === 'W1' && mac.clipboard === 'UNTOUCHED', relisted = v.lookup.sources.filter(function (s) { return s.kind === 'Workbook'; });
  var list = JSON.stringify(v.lookup); v = await pop.copy();
  t('PO14', 'the workbook is overwritten (900 → 820) after it was shown and before Copy: nothing is copied, the list is refreshed to 820, and the next Copy carries one workbook with 820 and no 900', first && refused && relisted.length === 1 && /B2: 820/.test(relisted[0].lines.join()) && !/\b900\b/.test(list) && /Copied 4 sources/.test(v.copyMessage) && /B2: 820\b/.test(mac.clipboard) && !/\b900\b/.test(mac.clipboard) && (mac.clipboard.match(/maintenance\.xlsx”/g) || []).length === 2 && !/\b900\b|\b820\b/.test(mac.indexText()), v.copyMessage);
  fs.rmSync(wb); mac.notes['x-coredata://FICTIONAL-0001/ICNote/p1'].locked = true; mac.automationDenied[MAIL] = true;
  v = await pop.lookup('Cost');
  var gone = v.lookup.sources.filter(function (s) { return s.group === 'unavailable'; }), txt = JSON.stringify(v.lookup);
  t('PO15', 'a deleted workbook, a note that is now locked and a Mail permission refusal are each listed as unavailable with the reason, and with none of their contents or dates', gone.length === 3 && /file not found/.test(txt) && /The note is locked/.test(txt) && /Privacy & Security › Automation/.test(txt) && gone.every(function (s) { return s.lines.length === 0 && s.when === ''; }) && !/B2:|820|USD 48,500|Harborline holds/.test(txt) && v.lookup.counts.unavailable === 3, txt.slice(0, 400));
  mac.fileDenied[eml] = true; mac.select(FINDER, [eml]); v = await pop.opened({ bundleId: FINDER });
  var fileDenied = v.target.state === 'none' && /macOS is not letting contexta read that file/.test(v.target.message);
  mac.fileDenied = {}; mac.automationDenied = {}; mac.notes['x-coredata://FICTIONAL-0001/ICNote/p1'].locked = false;
  await pop.closed(); var held = pop.held();
  t('PO16', 'a file macOS will not let the app read cannot be tagged; and once the popover closes, nothing of the target or the list is held', fileDenied && held === '{"app":"","target":{"state":"none","reason":"other-app","message":"Select one note, mail message or saved file in its app, then click the contexta icon."},"tagText":"","tagMessage":"","recent":[],"lookup":null,"copyMessage":""}', held);

  /* failures of the index itself */
  mac.select(NOTES, ['x-coredata://FICTIONAL-0001/ICNote/p1']); await pop.opened({ bundleId: NOTES }); mac.failWrite = true; before = mac.indexText();
  v = await pop.save('Cost Budget'); mac.failWrite = false; var notSaved = v.tagMessage === 'The index could not be saved. Nothing was tagged.' && mac.indexText() === before;
  fs.writeFileSync(mac.indexPath(), '{not json'); v = await pop.opened({ bundleId: NOTES }); var e1 = v.indexError; v = await pop.save('Cost'); var e2 = v.tagMessage; v = await pop.lookup('Cost');
  t('PO17', 'the index cannot be saved, or cannot be read: nothing is tagged or gathered, the popover says so, and the unreadable file is left as it is', notSaved && /not readable/.test(e1) && /not readable/.test(e2) && /not readable/.test(v.lookup.error) && fs.readFileSync(mac.indexPath(), 'utf8') === '{not json', e1 + ' | ' + e2);
  fs.writeFileSync(mac.indexPath(), before);

  mac.requests = [];
  v = await pop.opened({ bundleId: 'com.google.Chrome' }); var chrome = v.target.state === 'none' && mac.requests.join() === 'indexStamp,readIndex,indexStamp';
  v = await pop.opened({ bundleId: '' });
  t('PO18', 'a browser or any other app in front: it is asked nothing, there is no target, and lookup still works', chrome && v.target.state === 'none' && (await pop.lookup('Cost')).lookup.counts.total >= 1 && mac.requests.filter(function (r) { return /^selection/.test(r); }).length === 0, mac.requests.join());
  t('PO19', 'a recent-tag button adds the tag to the field or takes it out; a lookup field takes plain names, ::names and two tags', Popover.toggleTag('', 'Cost') === 'Cost' && Popover.toggleTag('Cost', 'PineRidge') === 'Cost PineRidge' && Popover.toggleTag('cost PineRidge', 'Cost') === 'PineRidge' && Popover.lookupQuery('Cost 금형').tags.map(function (x) { return x.name; }).join() === 'Cost,금형' && Popover.lookupQuery('what about ::Cost?').tags.length === 1);
  await pop.opened({ bundleId: NOTES }); v = await pop.lookup('Cost'); var labelsAll = v.lookup.sources.map(function (s) { return s.label; }).join();
  await pop.setSelected(v.lookup.sources[0].id, false); var p2 = pop.preview(), kept = v.lookup.sources.slice(1).map(function (s) { return s.label; });
  t('PO20', 'the labels a person reviewed are the labels in the copied text, whichever sources are unticked', kept.every(function (l) { return p2.indexOf('[' + l + ']') >= 0; }) && p2.indexOf('[' + v.lookup.sources[0].label + ']') < 0, labelsAll + ' → ' + kept.join());
  mac.requests = []; await pop.opened({ bundleId: NOTES }); await pop.lookup('Cost'); await pop.lookup('Scan'); await pop.setSelected('x', true);
  var reads1 = mac.requests.filter(function (r) { return r === 'readIndex'; }).length, stamps = mac.requests.filter(function (r) { return r === 'indexStamp'; }).length;
  var lines = mac.indexText().split('\n');
  var other = JSON.parse(mac.indexText()), anyId = Object.keys(other.objects)[0]; other.objects[anyId].tags = ['Elsewhere']; other.objects[anyId].tagKeys = ['elsewhere'];
  fs.writeFileSync(mac.indexPath(), JSON.stringify(other)); mac.requests = [];
  var seenElsewhere = (await pop.lookup('Elsewhere')).lookup.counts.total, reads2 = mac.requests.filter(function (r) { return r === 'readIndex'; }).length;
  t('PO22', 'the index is read once when the popover opens and reused for the lookups that follow; if another program changes the index file meanwhile, the next lookup reads it again', reads1 === 1 && stamps >= 3 && seenElsewhere === 1 && reads2 === 1, 'reads ' + reads1 + ', stamps ' + stamps + ', after change: found ' + seenElsewhere + ', reads ' + reads2);
  t('PO23', 'the index file keeps one entry per line and nothing but entries', lines[0] === '{"schema":1,"app":"work-index","objects":{' && lines[lines.length - 2] === '}}' && lines.slice(1, -2).every(function (l) { return /^"[^"]+":\{"id":/.test(l); }), lines[0] + ' … ' + lines[lines.length - 2]);
  var word = mac.write('quote.docx', 'not a real document'), pdf = mac.write('scan.pdf', fs.readFileSync(demoFx('first-quote-scan.pdf')));
  mac.select(FINDER, [pdf]); await pop.opened({ bundleId: FINDER }); await pop.save('Scan'); v = await pop.lookup('Scan');
  t('PO21', 'a file with no reader (PDF) can be tagged and is listed as present but not read; nothing is invented for it', v.lookup.sources.length === 1 && v.lookup.sources[0].status === 'not-read' && /no reader for \.pdf/.test(v.lookup.sources[0].reason) && v.lookup.sources[0].lines.length === 0 && !!word);
};
