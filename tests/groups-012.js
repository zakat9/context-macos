/* Regression groups new in 0.12. Used by run.js.
 *   RN  Manage tags › Rename everywhere        rules + the popover's engine, over the pretend Mac
 *   SC  Settings › Shortcuts › Tag current item   rules + a MODEL of the Mac side (tests/lib/settings-standin.js,
 *       tests/lib/menubar.js): the Swift that registers the hot key is not compiled or run here
 *   IN  Insert context, the app's rules        core/insert.js, also as the app bundles it, in a bare JavaScript context
 *   EX  Insert context, the extension's pure parts (extension/lib.js)
 * Every tag, note, message and file here is fictional and lives in a temporary folder. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = async function (ctx) {
  var t = ctx.t, fresh = ctx.fresh, ROOT = ctx.ROOT, Core = ctx.Core, Popover = ctx.Popover;
  var Mac = require('./lib/mac.js'), Xlsx = require('./lib/xlsx.js'), Menubar = require('./lib/menubar.js'), Standin = require('./lib/settings-standin.js');
  var Settings = require('../core/settings.js'), Insert = require('../core/insert.js'), Lib = require('../extension/lib.js');
  var NOTES = 'com.apple.Notes', MAIL = 'com.apple.mail', FINDER = 'com.apple.finder', EXCEL = 'com.microsoft.Excel';
  var clock = Date.parse('2026-11-20T10:00:00+09:00');
  var N1 = 'x-coredata://FICTIONAL-0012/ICNote/p1', N2 = 'x-coredata://FICTIONAL-0012/ICNote/p2';

  /* seven fictional sources in four apps. Tags (the truth, kept here by hand):
       note 1  ZzAlpha ZzTravel      note 2  ZzAlpha ZzBeta      mail 1  ZzAlpha       mail 2  ZzBeta
       workbook  ZzAlpha ZzBeta      csv  출장비                  saved message  ZzAlpha 출장비
     ZzAlpha is on 5, ZzBeta on 3 (2 of them also have ZzAlpha), 출장비 on 2, ZzTravel on 1. */
  async function world(name) {
    var mac = Mac.create(fresh(name).dir), tick = 0;
    mac.pop = Popover.create(mac.host, { now: function () { return clock + (tick++) * 60000; } });
    mac.addNote({ id: N1, title: 'Zz supplier call', text: 'Harborline holds the price until Nov 30.', modified: '2026-11-12T17:20:00', created: '2026-11-12T16:50:00' });
    mac.addNote({ id: N2, title: 'Zz budget meeting', text: 'Travel budget is separate.', modified: '2026-11-13T10:00:00', created: '2026-11-13T09:40:00' });
    mac.addMail({ numericId: '7001', messageId: 'zz1@harborline-tooling.example', subject: 'Zz revised quote', sent: '2026-11-10T09:12:00', account: 'Work', mailbox: 'INBOX', from: 'Dana Okafor <dana.okafor@harborline-tooling.example>', text: 'The revised quote is USD 48,500.' });
    mac.addMail({ numericId: '7002', messageId: 'zz2@northfield-devices.example', subject: 'Zz cap confirmed', sent: '2026-11-14T15:05:00', account: 'Work', mailbox: 'INBOX', from: 'Mina Seo <mina.seo@northfield-devices.example>', text: 'The cap is USD 820 a month.' });
    mac.paths = {
      wb: mac.write('zz-costs.xlsx', Xlsx.write({ modified: '2026-11-16T05:30:00Z', sheets: [{ name: 'Summary', cells: { A1: 'Line', B1: 'Amount', A2: 'Mold maintenance', B2: 820 } }] }), '2026-11-16T14:30:00+09:00'),
      csv: mac.write('zz-출장비.csv', '항목,금액\n항공,₩1,200,000\n', '2026-11-17T09:00:00+09:00'),
      eml: mac.write('zz-saved.eml', Xlsx.eml({ fromName: '서미나', fromAddress: 'mina.seo@northfield-devices.example', subject: 'Zz 출장 정산', date: 'Tue, 17 Nov 2026 11:00:00 +0900', messageId: 'zz3@northfield-devices.example', text: '합계는 ₩1,200,000 입니다.' }), '2026-11-17T11:00:00+09:00')
    };
    async function tag(bid, sel, tags) { mac.select(bid, [sel]); var v = await mac.pop.opened({ bundleId: bid }); if (v.target.state !== 'object') throw new Error('fixture: ' + bid + ' ' + JSON.stringify(v.target)); v = await mac.pop.save(tags); await mac.pop.closed(); return v; }
    await tag(NOTES, N1, 'ZzAlpha ZzTravel'); await tag(NOTES, N2, 'ZzAlpha ZzBeta'); await tag(MAIL, '7001', 'ZzAlpha'); await tag(MAIL, '7002', 'ZzBeta');
    await tag(FINDER, mac.paths.wb, 'ZzAlpha ZzBeta'); await tag(FINDER, mac.paths.csv, '출장비'); await tag(FINDER, mac.paths.eml, 'ZzAlpha 출장비');
    mac.requests.length = 0; mac.counts = {};
    return mac;
  }
  function tagsBy(objects) { var by = {}; Object.keys(objects).forEach(function (id) { objects[id].tags.forEach(function (n) { (by[n] = by[n] || []).push(objects[id].title); }); }); Object.keys(by).forEach(function (k) { by[k].sort(); }); return by; }
  function withoutTags(objects) { return JSON.stringify(Object.keys(objects).map(function (id) { var r = Object.assign({}, objects[id]); delete r.tags; delete r.tagKeys; return r; })); }
  function sourcesState(mac) { return JSON.stringify([mac.notes, mac.mails, Object.keys(mac.paths).map(function (k) { var s = fs.statSync(mac.paths[k]); return [s.size, s.mtimeMs, fs.readFileSync(mac.paths[k]).toString('base64')]; })]); }

  /* ───────── RN. Rename everywhere ───────── */
  var mac = await world('rn-rules'), idx0 = Core.loadIndex(mac.indexText()), text0 = mac.indexText();
  var titles = tagsBy(idx0.objects);
  t('RN00', 'fixture: seven fictional sources in Notes, Mail and Finder carry the tags the test keeps by hand (ZzAlpha 5, ZzBeta 3, 출장비 2, ZzTravel 1)', Object.keys(idx0.objects).length === 7 && titles.ZzAlpha.length === 5 && titles.ZzBeta.length === 3 && titles['출장비'].length === 2 && titles.ZzTravel.length === 1, JSON.stringify(titles));
  var p1 = Core.planRename(idx0, 'ZzAlpha', 'ZzGamma'), a1 = Core.applyRename(idx0, p1), by1 = tagsBy(a1.index.objects);
  t('RN01', 'rename to a name that is not in use: the preview counts the 5 sources that change and 0 that already have it; afterwards exactly those 5 carry the new name, in the place the old one had, and nobody carries the old one', p1.ok && p1.mode === 'rename' && p1.sources === 5 && p1.changes === 5 && p1.alreadyHave === 0 && p1.destinationBefore === 0 && p1.destinationAfter === 5 &&
    a1.ok && a1.changed === 5 && !by1.ZzAlpha && by1.ZzGamma.join() === titles.ZzAlpha.join() && a1.index.objects['applenotes:' + N1].tags.join() === 'ZzGamma,ZzTravel' && a1.index.objects['applenotes:' + N2].tags.join() === 'ZzGamma,ZzBeta', JSON.stringify([p1, by1]));
  t('RN02', 'nothing else moves: the same source ids in the same order, every other field of every entry (dates included) unchanged, other tags untouched, and the index that was handed in is not altered', Object.keys(a1.index.objects).join() === Object.keys(idx0.objects).join() && withoutTags(a1.index.objects) === withoutTags(idx0.objects) &&
    by1.ZzBeta.join() === titles.ZzBeta.join() && by1['출장비'].join() === titles['출장비'].join() && by1.ZzTravel.join() === titles.ZzTravel.join() && Core.dumpIndex(idx0) === text0 && Object.keys(a1.index.objects).every(function (id) { var r = a1.index.objects[id]; return r.tagKeys.join() === r.tags.map(Core.tagKey).join(); }));
  var p2 = Core.planRename(idx0, 'ZzAlpha', 'zzbeta'), a2 = Core.applyRename(idx0, p2), by2 = tagsBy(a2.index.objects), o2 = a2.index.objects;
  t('RN03', 'the new name is already a tag (typed in another case): that is a merge, the existing spelling is kept, and the preview says 5 change, 2 already have it, 3 sources before and 6 after', p2.ok && p2.mode === 'merge' && p2.to.name === 'ZzBeta' && p2.sources === 5 && p2.changes === 5 && p2.alreadyHave === 2 && p2.destinationBefore === 3 && p2.destinationAfter === 6, JSON.stringify(p2));
  t('RN04', 'merge with overlap: a source that had both tags ends with the one tag once; the others get it where the old tag was and keep their second tag; no source ever has more than two tags or the same tag twice', a2.changed === 5 && a2.merged === 2 && !by2.ZzAlpha && by2.ZzBeta.length === 6 &&
    o2['applenotes:' + N2].tags.join() === 'ZzBeta' && o2['applenotes:' + N1].tags.join() === 'ZzBeta,ZzTravel' && Object.keys(o2).every(function (id) { var r = o2[id]; return r.tags.length <= 2 && r.tags.length === r.tagKeys.length && r.tagKeys.filter(function (k, i, a) { return a.indexOf(k) !== i; }).length === 0; }) &&
    Object.keys(o2).join() === Object.keys(idx0.objects).join() && withoutTags(o2) === withoutTags(idx0.objects), JSON.stringify(by2));
  var nfd = '출장비'.normalize('NFD'), p3 = Core.planRename(idx0, nfd, '여비'), a3 = Core.applyRename(idx0, p3), p3b = Core.planRename(idx0, '출장비', 'ZzAlpha'), p3c = Core.planRename(idx0, 'zzalpha', 'ZZALPHA');
  t('RN05', 'Korean: a tag is found whether it is typed composed or decomposed and can be renamed to another Korean name; merging 출장비 into ZzAlpha sees the one source that has both; changing only the capitals is a re-spelling of the same tag', nfd !== '출장비' && p3.ok && p3.mode === 'rename' && p3.sources === 2 && tagsBy(a3.index.objects)['여비'].length === 2 && !tagsBy(a3.index.objects)['출장비'] &&
    p3b.ok && p3b.mode === 'merge' && p3b.sources === 2 && p3b.alreadyHave === 1 && p3b.destinationAfter === 6 && p3c.ok && p3c.mode === 'respell' && p3c.changes === 5 && tagsBy(Core.applyRename(idx0, p3c).index.objects).ZZALPHA.length === 5, JSON.stringify([p3, p3b, p3c]));
  var refusals = [['', 'ZzGamma', 'no-tag'], ['ZzAlpha', '', 'empty'], ['ZzAlpha', '   ', 'empty'], ['ZzAlpha', 'Cost!', 'bad-name'], ['ZzAlpha', '2026', 'bad-name'], ['ZzAlpha', 'a'.repeat(41), 'bad-name'], ['ZzAlpha', 'R&D', 'bad-name'], ['ZzAlpha', 'two words', 'bad-name'], ['ZzAlpha', 'ZzAlpha', 'no-op'], ['ZzAlpha', '::ZzAlpha', 'no-op'], ['ZzNobody', 'ZzGamma', 'unknown-tag']];
  var got = refusals.map(function (r) { var p = Core.planRename(idx0, r[0], r[1]); return p.ok ? 'ok' : p.code; });
  t('RN06', 'refused, each with its own message and no plan: no tag chosen, an empty name, punctuation, digits only, over 40 characters, two words, the very same name, and a tag that is not in the index', got.join() === refusals.map(function (r) { return r[2]; }).join() && refusals.every(function (r) { var p = Core.planRename(idx0, r[0], r[1]); return !p.ok && typeof p.message === 'string' && p.message.length > 8; }) && !Core.applyRename(idx0, Core.planRename(idx0, 'ZzAlpha', 'ZzAlpha')).ok, got.join());

  /* the popover's engine */
  var pop = mac.pop, before = sourcesState(mac), v;
  v = await pop.manageOpen();
  var listed = {}; v.manage.tags.forEach(function (x) { listed[x.name] = x.count; });
  var s1 = await pop.manageSearch('zz'), s2 = await pop.manageSearch('출'), s3 = await pop.manageSearch('#zzb'), s4 = await pop.manageSearch('nothing-like-this'); await pop.manageSearch('');
  t('RN07', 'Manage tags lists every tag once with the number of distinct sources it is on, and the list is searched as you type (any case, Korean, a pasted #)', v.manage.total === 4 && listed.ZzAlpha === 5 && listed.ZzBeta === 3 && listed['출장비'] === 2 && listed.ZzTravel === 1 && s1.manage.tags.length === 3 && s2.manage.tags.map(function (x) { return x.name; }).join() === '출장비' && s3.manage.tags.map(function (x) { return x.name; }).join() === 'ZzBeta' && s4.manage.tags.length === 0, JSON.stringify([listed, s1.manage.tags, s3.manage.tags]));
  await pop.renameChoose('ZzAlpha'); v = await pop.renamePreview('ZzBeta');
  var wrong = await pop.renameCommit('rename'), afterWrong = mac.indexText() === text0 && !mac.counts.writeIndex;
  t('RN08', 'the preview for an existing name asks for Merge and nothing else will do: pressing Rename is refused and writes nothing', v.manage.plan.ok && v.manage.plan.action === 'merge' && v.manage.plan.changes === 5 && v.manage.plan.alreadyHave === 2 && v.manage.fromCount === 5 && wrong.manage.state === 'error' && /Press Merge/.test(wrong.manage.message) && afterWrong, JSON.stringify([v.manage.plan, wrong.manage.message]));
  var cancelled = await pop.renameCancel(); await pop.manageClose();
  t('RN09', 'Cancel (and closing Manage tags) leaves the index file byte for byte as it was, with no write attempted', cancelled.manage.from === '' && cancelled.manage.plan === null && mac.indexText() === text0 && !mac.counts.writeIndex && pop.view().manage === null);

  /* a conflicting edit between the preview and the press */
  await pop.manageOpen(); await pop.renameChoose('ZzAlpha'); v = await pop.renamePreview('ZzBeta');
  var shown = v.manage.plan, other = Core.loadIndex(mac.indexText());
  other.objects['mid:zz2@northfield-devices.example'].tags = ['ZzBeta', 'ZzAlpha']; other.objects['mid:zz2@northfield-devices.example'].tagKeys = ['zzbeta', 'zzalpha'];     /* another window tags mail 2 with ZzAlpha */
  fs.writeFileSync(mac.indexPath(), Core.dumpIndex(other)); var text1 = mac.indexText(); mac.counts = {};
  var stale = await pop.renameCommit('merge');
  t('RN10', 'the index changed after the numbers were shown (another edit put the tag on one more source): the press is refused, nothing is written, and the preview is replaced by the numbers as they are now (6 change, 3 already have it)', text1 !== text0 && stale.manage.state === 'stale' && /The index changed after these numbers were shown\. Nothing was renamed\./.test(stale.manage.message) && mac.indexText() === text1 && !mac.counts.writeIndex &&
    shown.changes === 5 && stale.manage.plan.ok && stale.manage.plan.changes === 6 && stale.manage.plan.alreadyHave === 3 && stale.manage.from === 'ZzAlpha', JSON.stringify([stale.manage.message, stale.manage.plan]));
  mac.failWrite = true;
  var failed = await pop.renameCommit('merge'), afterFail = mac.indexText() === text1, leftovers = fs.readdirSync(mac.home).join();
  t('RN11', 'the save fails (disk full): it says so, nothing was renamed, the index file is byte for byte as before and no partial file is left; the choice is still on screen to try again', failed.manage.state === 'error' && failed.manage.message === 'The index could not be saved. Nothing was renamed.' && afterFail && leftovers === 'index.json' && mac.counts.writeIndex === 1 && failed.manage.from === 'ZzAlpha' && failed.manage.plan && failed.manage.plan.ok, JSON.stringify([failed.manage.message, leftovers]));
  mac.failWrite = false; mac.counts = {}; mac.requests.length = 0;
  var done = await pop.renameCommit('merge'), o3 = mac.objects(), by3 = tagsBy(o3);
  t('RN12', 'pressed again once the disk is fine: one save renames everything at once — 6 sources changed, 3 already had it — and the result on disk is exactly the expected one', done.manage.state === 'done' && done.manage.message === 'Merged ZzAlpha into ZzBeta: 6 sources changed, 3 already had it.' && mac.counts.writeIndex === 1 && !by3.ZzAlpha && by3.ZzBeta.length === 7 - 1 &&
    o3['applenotes:' + N1].tags.join() === 'ZzBeta,ZzTravel' && o3['applenotes:' + N2].tags.join() === 'ZzBeta' && o3['mid:zz2@northfield-devices.example'].tags.join() === 'ZzBeta' && Object.keys(o3).join() === Object.keys(other.objects).join() && withoutTags(o3) === withoutTags(other.objects), JSON.stringify([done.manage.message, by3]));
  t('RN13', 'the rename touched nothing but the index: no note, message or file was read, asked about or changed, nothing was copied, and the whole rename made only index reads and one index write', sourcesState(mac) === before && mac.clipboard === null && Object.keys(mac.counts).sort().join() === 'indexStamp,readIndex,writeIndex'.split(',').filter(function (k) { return mac.counts[k]; }).sort().join() && !mac.counts.selection && !mac.counts.readNote && !mac.counts.readMail && !mac.counts.readFile && !mac.counts.copyText, JSON.stringify(mac.counts));
  var names = done.tags.map(function (x) { return x.name + ' ' + x.count; }), mlist = done.manage.tags.map(function (x) { return x.name + ' ' + x.count; });
  await pop.manageClose();
  var lookOld = await pop.lookup('ZzAlpha'), lookNew = await pop.lookup('ZzBeta');
  t('RN14', 'at once, without reopening: recent tags and the Manage list show ZzBeta on 6 and no ZzAlpha; looking up the old name finds nothing, the new name finds the 6 sources', names.indexOf('ZzBeta 6') >= 0 && names.join().indexOf('ZzAlpha') < 0 && mlist.indexOf('ZzBeta 6') >= 0 && mlist.join().indexOf('ZzAlpha') < 0 &&
    (!lookOld.lookup || lookOld.lookup.sources.length === 0) && lookNew.lookup && lookNew.lookup.sources.length === 6, JSON.stringify([names, lookOld.lookup && lookOld.lookup.sources.length, lookNew.lookup && lookNew.lookup.sources.length]));
  /* restart: a new engine over the same index folder (what quitting and starting contexta again amounts to) */
  var again = Popover.create(mac.host, { now: function () { return clock + 3600000; } }); mac.select(NOTES, [N1]);
  var reopened = await again.opened({ bundleId: NOTES }), reLook = await again.lookup('zzbeta');
  t('RN15', 'after a restart the rename is still there: the selected note shows ZzBeta and ZzTravel, the lookup finds the same 6 sources, and the file on disk reads back as a valid index with 7 entries', reopened.target.tags.join() === 'ZzBeta,ZzTravel' && reLook.lookup.sources.length === 6 && Object.keys(Core.loadIndex(mac.indexText()).objects).length === 7 && Core.dumpIndex(Core.loadIndex(mac.indexText())) === mac.indexText());
  /* a preview is not kept across an unrelated change of the popover: tagging in between invalidates it */
  var mac2 = await world('rn-stale'), pop2 = mac2.pop;
  await pop2.manageOpen(); await pop2.renameChoose('ZzTravel'); var pv = await pop2.renamePreview('ZzTrips'); await pop2.manageClose();
  mac2.select(MAIL, ['7001']); await pop2.opened({ bundleId: MAIL }); await pop2.addTag('ZzTravel');
  var noPlan = await pop2.renameCommit('rename'), stillThere = tagsBy(mac2.objects());
  await pop2.manageOpen(); await pop2.renameChoose('ZzTravel'); var pv2 = await pop2.renamePreview('ZzTrips'), ok2 = await pop2.renameCommit('rename');
  t('RN16', 'a preview does not outlive Manage tags: after closing it and tagging another source with the same tag, a stray Rename does nothing; the new preview counts 2, and that rename is carried out on both', pv.manage.plan.changes === 1 && noPlan.manage === null && stillThere.ZzTravel.length === 2 && !stillThere.ZzTrips && pv2.manage.plan.changes === 2 && ok2.manage.message === 'Renamed ZzTravel to ZzTrips on 2 sources.' && tagsBy(mac2.objects()).ZzTrips.length === 2, JSON.stringify([noPlan.manage, ok2.manage.message]));
  /* the menu-bar label and the Insert context picker follow the rename */
  var mac3 = await world('rn-follow'), sim = Menubar.create(mac3), eng3 = Insert.create(mac3.now, { now: function () { return clock; } });
  mac3.select(NOTES, [N1]); sim.activate(NOTES, { name: 'Notes' }); sim.advance(3000);
  var labelBefore = sim.text(), openBefore = eng3.handle({ op: 'open' }).tags.map(function (x) { return x.name + ' ' + x.count; });
  sim.activate(Menubar.OWN, { popover: true }); sim.popover(true);
  await mac3.pop.manageOpen(); await mac3.pop.renameChoose('ZzAlpha'); await mac3.pop.renamePreview('ZzGamma'); await mac3.pop.renameCommit('rename');
  sim.saved(); sim.popover(false); sim.activate(NOTES, { name: 'Notes' }); sim.advance(1500);
  var openAfter = eng3.handle({ op: 'open' }).tags.map(function (x) { return x.name + ' ' + x.count; });
  t('RN17', 'the menu-bar label of the selected note changes from the old name to the new one as soon as the popover closes, and the Insert context picker\'s tag list offers the new name with the same count (pretend menu bar; the app\'s own rules)', labelBefore === 'tags:ZzAlpha, ZzTravel' && sim.text() === 'tags:ZzGamma, ZzTravel' && openBefore.indexOf('ZzAlpha 5') >= 0 && openAfter.indexOf('ZzGamma 5') >= 0 && openAfter.join().indexOf('ZzAlpha') < 0, JSON.stringify([labelBefore, sim.text(), openAfter]));

  /* ───────── SC. Settings › Shortcuts › Tag current item ───────── */
  var T = { code: 'KeyT', ctrlKey: true, altKey: true }, Y = { code: 'KeyY', ctrlKey: true, altKey: true }, chordT = Settings.fromKeyEvent(T).chord, chordY = Settings.fromKeyEvent(Y).chord;
  t('SC01', 'a chord is read from the keys pressed in the Settings window: Control-Option-T is key 17 with those two modifiers and is shown as ⌃⌥T; a modifier alone is still waiting; Return, Tab, an arrow or Escape cannot be a shortcut', JSON.stringify(chordT) === '{"keyCode":17,"modifiers":["control","option"],"key":"T"}' && Settings.show(chordT) === '⌃⌥T' && Settings.words(chordT) === 'Control-Option-T' && JSON.stringify(Settings.SUGGESTED) === JSON.stringify(chordT) &&
    Settings.fromKeyEvent({ code: 'ControlLeft', ctrlKey: true }).waiting === true && Settings.fromKeyEvent({ code: 'AltRight', altKey: true }).waiting === true && ['Enter', 'Tab', 'ArrowUp', 'Escape', 'Backspace'].every(function (c) { var k = Settings.fromKeyEvent({ code: c, ctrlKey: true }); return !k.ok && !k.waiting && /cannot be part of a shortcut/.test(k.message); }) &&
    Settings.show(Settings.fromKeyEvent({ code: 'F5', altKey: true, shiftKey: true, metaKey: true }).chord) === '⌥⇧⌘F5' && Settings.fromKeyEvent({ code: 'Digit6', ctrlKey: true }).chord.keyCode === 22);
  var os = Standin.create(fresh('sc').dir), page = Settings.create(os.host), sv = await page.load();
  t('SC02', 'until the person sets one there is no shortcut: nothing is registered with the pretend macOS, no settings file exists, pressing ⌃⌥T anywhere does nothing, and the window only suggests ⌃⌥T', sv.shortcut === null && sv.suggested === '⌃⌥T' && os.registered === null && !fs.existsSync(os.file) && (os.scope(true), os.press(chordT)) === false && os.pressed === 0 && !sv.insert.on);
  os.scope(false);
  var refusedChords = [[{ code: 'KeyT' }, 'needs-modifier'], [{ code: 'KeyT', shiftKey: true }, 'needs-modifier'], [{ code: 'KeyT', metaKey: true }, 'needs-modifier'], [{ code: 'KeyT', metaKey: true, shiftKey: true }, 'needs-modifier']];
  var codes = refusedChords.map(function (r) { return Settings.check(Settings.fromKeyEvent(r[0]).chord, null, []).code; });
  await page.record(); var r1 = await page.key({ code: 'KeyT', metaKey: true });
  t('SC03', 'a chord without Control or Option (a bare key, Shift, Command, Command-Shift) is refused before macOS is asked, with the reason; nothing is set', codes.join() === 'needs-modifier,needs-modifier,needs-modifier,needs-modifier' && r1.shortcut === null && r1.kind === 'error' && /Use Control or Option/.test(r1.message) && !r1.recording && os.calls.indexOf('setShortcut') < 0 && !fs.existsSync(os.file), JSON.stringify(r1));
  var r2 = await page.useSuggested(), onDisk = os.read();
  t('SC04', 'the suggested ⌃⌥T is set with one press: macOS takes it, it is saved, and it is registered only while an app contexta follows is in front', r2.shortcut.text === '⌃⌥T' && r2.kind === 'done' && r2.message === 'Tag current item is now ⌃⌥T.' && JSON.stringify(onDisk.tagShortcut) === JSON.stringify(chordT) && os.registered === null && os.press(chordT) === false &&
    (os.scope(true), os.press(chordT)) === true && os.pressed === 1 && (os.scope(false), os.press(chordT)) === false && os.pressed === 1, JSON.stringify([r2, onDisk]));
  await page.record(); var same = await page.key(T), callsBefore = os.calls.filter(function (c) { return c === 'setShortcut'; }).length;
  var dup = Settings.check(chordT, chordY, [{ name: 'Tag current item', chord: chordT }]);
  var pageDup = Settings.create(os.host, null, { others: [{ name: 'Open contexta', chord: chordY }] }); await pageDup.load(); await pageDup.record(); var dupView = await pageDup.key(Y);
  t('SC05', 'duplicates: the chord that is already set is not set again (macOS is not asked); a chord another contexta shortcut uses is refused by name, and ⌃⌥T stays', same.shortcut.text === '⌃⌥T' && same.message === '⌃⌥T is already the shortcut.' && callsBefore === 1 && !dup.ok && dup.code === 'duplicate' && /already contexta's shortcut for Tag current item/.test(dup.message) &&
    dupView.shortcut.text === '⌃⌥T' && dupView.kind === 'error' && /⌃⌥Y is already contexta's shortcut for Open contexta\. The shortcut is still ⌃⌥T\./.test(dupView.message) && JSON.stringify(os.read().tagShortcut) === JSON.stringify(chordT), JSON.stringify([same.message, dupView.message]));
  os.taken[Standin.id(chordY)] = true; await page.record();
  var taken = await page.key(Y); os.scope(true);
  t('SC06', 'macOS does not take the new chord (something else holds it): it says so with the number, and the previous shortcut is still set, still saved and still works', taken.shortcut.text === '⌃⌥T' && taken.kind === 'error' && taken.message === 'macOS did not accept ⌃⌥Y: it is already in use (-9878). The shortcut is still ⌃⌥T.' && JSON.stringify(os.read().tagShortcut) === JSON.stringify(chordT) && os.press(chordT) === true && os.press(chordY) === false, taken.message);
  os.taken = {}; os.failWrite = true; await page.record();
  var unsaved = await page.key(Y), stillT = os.press(chordT) === true && os.press(chordY) === false;
  t('SC07', 'macOS takes the chord but the settings file cannot be written: the change is undone, it says the chord could not be saved, and the previous shortcut is the one that works', unsaved.shortcut.text === '⌃⌥T' && unsaved.kind === 'error' && unsaved.message === '⌃⌥Y could not be saved. The shortcut is still ⌃⌥T.' && stillT && JSON.stringify(os.read().tagShortcut) === JSON.stringify(chordT), unsaved.message);
  os.failWrite = false; await page.record();
  var changed = await page.key(Y), nowY = os.press(chordY) === true, notT = os.press(chordT) === false;
  t('SC08', 'changing it: ⌃⌥Y is taken and saved; from then on ⌃⌥Y opens the tag editor and ⌃⌥T does nothing', changed.shortcut.text === '⌃⌥Y' && changed.message === 'Tag current item is now ⌃⌥Y.' && nowY && notT && JSON.stringify(os.read().tagShortcut) === JSON.stringify(chordY), changed.message);
  var os2 = Standin.create(os.dir), page2 = Settings.create(os2.host), sv2 = await page2.load(), regAtStart = os2.registered;
  os2.scope(true);
  t('SC09', 'after a restart the shortcut is the one that was set (⌃⌥Y), read from the settings file, and it is registered again only once a followed app is in front', sv2.shortcut.text === '⌃⌥Y' && regAtStart === null && os2.press(chordY) === true && os2.press(chordT) === false && os2.pressed === 1);
  os2.failWrite = true; var notCleared = await page2.clear(); os2.failWrite = false;
  var cleared = await page2.clear(), os3 = Standin.create(os.dir); os3.scope(true);
  t('SC10', 'clearing it: if the file cannot be written the shortcut stays; cleared, nothing is registered, ⌃⌥Y is free again, the file says no shortcut, and it is still off after another restart', notCleared.shortcut.text === '⌃⌥Y' && notCleared.kind === 'error' && cleared.shortcut === null && cleared.message === 'No shortcut is set. ⌃⌥Y is free again.' && os2.registered === null && os2.press(chordY) === false && os2.read().tagShortcut === null && os3.registered === null && os3.press(chordY) === false, JSON.stringify([notCleared.message, cleared.message]));
  await page2.record(); var esc = await page2.key({ code: 'Escape' }), idle = await page2.key(T);
  t('SC11', 'while a shortcut is being set, Escape cancels and nothing changes; keys pressed when nothing is being set are not taken as a shortcut', esc.recording === false && esc.shortcut === null && idle.shortcut === null && os2.calls.filter(function (c) { return c === 'setShortcut'; }).length === 0);
  var junk = [null, 7, 'x', [], { tagShortcut: 'T' }, { tagShortcut: { keyCode: 17, modifiers: ['command'], key: 'T' } }, { tagShortcut: { keyCode: 999, modifiers: ['control'], key: 'T' } }, { tagShortcut: { keyCode: 17.5, modifiers: ['control'] } }, { insert: { on: true, browsers: [] } }, { insert: { on: true, browsers: [{ name: 'X' }] } }];
  t('SC12', 'a settings file that is damaged, or that holds a chord the rules would refuse, or that says Insert context is on with no browser, reads as "nothing set"; unknown fields are dropped', junk.every(function (j) { var s = Settings.sanitize(j); return s.tagShortcut === null && s.insert.on === false && s.insert.browsers.length === 0; }) &&
    JSON.stringify(Settings.sanitize({ tagShortcut: { keyCode: 17, modifiers: ['option', 'control', 'hyper'], key: 'T', extra: 1 }, other: true })) === '{"version":1,"tagShortcut":{"keyCode":17,"modifiers":["control","option"],"key":"T"},"insert":{"on":false,"browsers":[]}}');

  /* the whole path, as a model of the Mac side: the label's rules say when the chord is registered; a press asks the app in
     front BEFORE contexta comes forward; the popover opens on that answer */
  async function rig(name) {
    var m = await world(name), o = Standin.create(fresh(name + '-os').dir), s = Menubar.create(m, { onScope: function (on) { o.scope(on); } });
    await Settings.create(o.host).useSuggested();
    m.pop = Popover.create(m.host, { now: function () { return clock + 7200000; } });
    /* app/Sources/App.swift, tagCurrentItem(), step by step */
    m.press = async function () {
      if (!o.press(chordT)) return null;                                                    /* macOS reports the chord only while it is registered */
      var front = s.front; if (!front || front.bundleId === Menubar.OWN || !Core.scriptForSelection(front.bundleId)) return null;
      var perm = m.automationDenied[front.bundleId] ? -1743 : (s.perm[front.bundleId] == null ? 0 : s.perm[front.bundleId]);      /* looked up without a prompt */
      if (m.beforeCapture) await m.beforeCapture();
      if (!s.front || s.front.bundleId !== front.bundleId) return null;                     /* the person moved on: nothing opens */
      var captured = perm === 0 ? m.now.selection(front.bundleId) : { ok: false, code: perm };
      s.activate(Menubar.OWN, { popover: true }); s.popover(true);
      return m.pop.opened({ bundleId: front.bundleId, name: 'the app', captured: captured, via: 'shortcut' });
    };
    m.os = o; m.sim = s;
    return m;
  }
  var k = await rig('sc-flow');
  k.sim.activate('com.apple.Safari', { name: 'Safari' }); k.sim.advance(500);
  var inSafari = await k.press(), scopeSafari = k.os.registered;
  k.select(NOTES, [N2]); k.sim.activate(NOTES, { name: 'Notes' }); k.sim.advance(1500);
  var scopeNotes = !!k.os.registered; k.counts = {}; k.requests.length = 0;
  var o1 = await k.press(), asked = k.counts.selection, scopeOpen = k.os.registered, pressAgain = k.os.press(chordT);
  t('SC13', 'the chord exists only where it can work: in a browser (not followed) it is not registered and the press does nothing; with Notes in front it is; while contexta\'s own popover is open it is not registered either', inSafari === null && scopeSafari === null && scopeNotes && scopeOpen === null && pressAgain === false && k.sim.scopes.map(function (x) { return x.front.split('.').pop() + (x.on ? '+' : '-'); }).join(' ') === 'Safari- Notes+ app-', JSON.stringify(k.sim.scopes));
  t('SC14', 'with a note selected in Notes, the shortcut opens the tag editor on that note: its title, its existing tags, a tag field to type in — from the one question that was put before contexta came forward (the popover does not ask a second time on opening), and nothing is written yet', o1 && o1.via === 'shortcut' && o1.target.state === 'object' && o1.target.kind === 'Note' && o1.target.title === 'Zz budget meeting' && o1.target.tags.join() === 'ZzAlpha,ZzBeta' && asked === 1 && !k.counts.writeIndex && k.clipboard === null, JSON.stringify([o1 && o1.target, k.counts]));
  var textK = k.indexText(), rm = await k.pop.removeTag('ZzBeta'), add = await k.pop.addTag('ZzQuick');
  t('SC15', 'Return commits to that note and no other: before each write the popover asks Notes again and finds the same note; the tag lands on note 2 only', add.tagMessage === 'Tagged ZzQuick.' && k.objects()['applenotes:' + N2].tags.join() === 'ZzAlpha,ZzQuick' && k.objects()['applenotes:' + N1].tags.join() === 'ZzAlpha,ZzTravel' && k.counts.selection === 3 && k.counts.writeIndex === 2 && rm.target.tags.join() === 'ZzAlpha', JSON.stringify([add.tagMessage, k.counts]));
  await k.pop.closed(); k.sim.popover(false); k.sim.activate(NOTES, { name: 'Notes' }); k.sim.advance(1500);
  /* stale selection: the selection moves to another note after the capture */
  await k.press(); await k.pop.removeTag('ZzQuick'); await k.pop.closed(); k.sim.popover(false); k.sim.activate(NOTES, { name: 'Notes' }); k.sim.advance(1500);        /* note 2 now has one tag, so a second one would fit */
  var o2k = await k.press(); k.select(NOTES, [N1]); var textS = k.indexText(); k.counts = {};
  var staleAdd = await k.pop.addTag('ZzWrong'), staleAgain = await k.pop.addTag('ZzWrong');
  t('SC16', 'the selection changes after the shortcut captured it (another note is selected while the editor is open): Return writes nothing, to either note, says the selection changed, and a second Return still writes nothing', o2k.target.title === 'Zz budget meeting' && o2k.target.tags.join() === 'ZzAlpha' && staleAdd.target.state === 'none' && /The selection in Notes changed while this was open\. Nothing was tagged\./.test(staleAdd.target.message) && k.indexText() === textS && JSON.stringify(k.objects()).indexOf('ZzWrong') < 0 && staleAgain.target.state === 'none' && !k.counts.writeIndex && staleAgain.tagMessage === 'Nothing is selected to tag.', JSON.stringify([staleAdd.target, k.counts]));
  await k.pop.closed(); k.sim.popover(false); k.sim.activate(NOTES, { name: 'Notes' }); k.sim.advance(1500);
  /* the person switches app between the press and the question */
  k.beforeCapture = async function () { k.sim.activate('com.apple.Safari', { name: 'Safari' }); }; k.counts = {};
  var switched = await k.press(); k.beforeCapture = null;
  t('SC17', 'the person switches to another app in the instant after the press: nothing opens, no app is asked anything, nothing is written', switched === null && !k.counts.selection && !k.counts.writeIndex && k.indexText() === textS);
  /* refusals: nothing can be tagged, nothing is written */
  async function refusal(setup) { var m = await rig('sc-ref-' + setup.name); await setup.before(m); m.sim.activate(setup.app, { name: 'x' }); m.sim.advance(1500); var txt = m.indexText(); m.counts = {}; var v = await m.press(), a = v ? await m.pop.addTag('ZzNope') : null; return { v: v, a: a, same: m.indexText() === txt, counts: m.counts, m: m }; }
  var rUnsaved = await refusal({ name: 'unsaved', app: EXCEL, before: async function (m) { m.openDocument[EXCEL] = ''; } });
  var rMulti = await refusal({ name: 'multi', app: NOTES, before: async function (m) { m.select(NOTES, [N1, N2]); } });
  var rNone = await refusal({ name: 'none', app: MAIL, before: async function (m) { m.select(MAIL, []); } });
  var rDenied = await refusal({ name: 'denied', app: NOTES, before: async function (m) { m.select(NOTES, [N1]); m.automationDenied[NOTES] = true; } });
  var rNotAsked = await refusal({ name: 'notasked', app: NOTES, before: async function (m) { m.select(NOTES, [N1]); m.sim.perm[NOTES] = -1744; } });
  var rFolder = await refusal({ name: 'folder', app: FINDER, before: async function (m) { m.select(FINDER, [m.files]); } });
  var all = [rUnsaved, rMulti, rNone, rDenied, rNotAsked, rFolder];
  t('SC18', 'nothing to tag, nothing written: an unsaved document, two notes selected, nothing selected, Notes not allowed, Notes never asked about yet, a folder — each opens the editor with its reason and no tag field target; Return writes nothing', all.every(function (r) { return r.v && r.v.target.state === 'none' && r.a.tagMessage === 'Nothing is selected to tag.' && r.same && !r.counts.writeIndex; }) &&
    rUnsaved.v.target.message === 'Open one saved document in Excel, then press the shortcut again.' && rFolder.v.target.message === 'Only a saved file can be tagged.' && /Select exactly one note/.test(rMulti.v.target.message) && /Select exactly one message/.test(rNone.v.target.message) && rDenied.v.target.reason === 'denied' && rNotAsked.v.target.reason === 'not-asked' && rNotAsked.v.target.message === 'contexta has not been allowed to ask Notes yet.', JSON.stringify(all.map(function (r) { return [r.v && r.v.target.reason, r.v && r.v.target.message]; })));
  t('SC19', 'missing permission never becomes a prompt or a question: when Notes is not allowed, or was never asked about, the shortcut asks Notes nothing at all (the permission is only looked up), and the editor offers App access instead', !rDenied.counts.selection && !rNotAsked.counts.selection && rNotAsked.m.sim.counts.prompts === 0 && rNotAsked.m.sim.counts.launches === 0 && rDenied.m.sim.counts.prompts === 0, JSON.stringify([rDenied.counts, rNotAsked.counts]));
  var f = await rig('sc-file'); f.openDocument[EXCEL] = f.paths.wb; f.sim.activate(EXCEL, { name: 'Excel' }); f.sim.advance(1500);
  var fo = await f.press(), fa = await f.pop.removeTag('ZzBeta'), fb = await f.pop.addTag('ZzSheet');
  t('SC20', 'a saved workbook open in Excel: the shortcut opens the editor on that file with its tags; Return tags that file', fo.target.state === 'object' && fo.target.title === 'zz-costs.xlsx' && fo.target.tags.join() === 'ZzAlpha,ZzBeta' && fb.tagMessage === 'Tagged ZzSheet.' && f.objects()[Object.keys(f.objects()).filter(function (id) { return /zz-costs\.xlsx$/.test(id); })[0]].tags.join() === 'ZzAlpha,ZzSheet' && fa.target.tags.join() === 'ZzAlpha', JSON.stringify([fo.target, fb.tagMessage]));
  var wrongApp = await f.pop.opened({ bundleId: 'com.example.other', captured: { ok: true, reply: 'path\u001F' + f.paths.wb }, via: 'shortcut' });
  t('SC21', 'an answer captured for an app contexta does not follow is not used: there is no target', wrongApp.target.state === 'none' && wrongApp.target.reason === 'other-app');

  /* ───────── IN. Insert context: the app's rules ───────── */
  var im = await world('in'), bundle = fs.readFileSync(path.join(ROOT, 'app', 'Resources', 'insert.js'), 'utf8'), calls = [];
  function b64(r) { if (r && r.bytes) { r = Object.assign({}, r); r.base64 = Buffer.from(r.bytes).toString('base64'); delete r.bytes; } return r; }
  function native(name, fn) { return function (text) { calls.push(name); return JSON.stringify(fn(JSON.parse(text))); }; }
  var nat = { readIndex: native('readIndex', function () { return im.now.readIndex(); }), readFile: native('readFile', function (a) { return b64(im.now.readFile(a.path)); }), readNote: native('readNote', function (a) { return im.now.readNote(a.id); }), readMail: native('readMail', function (a) { return im.now.readMail(a); }),
    decodeText: native('decodeText', function (a) { try { return { ok: true, text: new TextDecoder(a.charset).decode(Buffer.from(a.bytes, 'latin1')) }; } catch (e) { return { ok: false }; } }) };
  var bare = vm.createContext({ contextInsertNative: nat });
  vm.runInContext(bundle, bare);
  var lacks = vm.runInContext('[typeof TextDecoder, typeof TextEncoder, typeof atob, typeof Buffer, typeof require, typeof setTimeout, typeof fetch, typeof document].join()', bare);
  function askBare(req) { return JSON.parse(vm.runInContext('ContextInsert.handleJson', bare)(JSON.stringify(req))); }
  var ref = Insert.create(im.now, {}), bo = askBare({ id: 1, op: 'open' }), ro = ref.handle({ id: 1, op: 'open' });
  var bl = askBare({ id: 2, op: 'lookup', tag: 'ZzAlpha' }), rl = ref.handle({ id: 2, op: 'lookup', tag: 'ZzAlpha' });
  var ids = bl.sources.map(function (s) { return s.id; }), br = askBare({ id: 3, op: 'render', token: bl.token, selected: ids }), rr = ref.handle({ id: 3, op: 'render', token: rl.token, selected: rl.sources.map(function (s) { return s.id; }) });
  function sansTime(text) { return String(text).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}/g, 'T'); }
  t('IN01', 'the Insert context rules exactly as the app bundles them run with nothing but the language itself (no text decoder, base64, timers, network or page in reach) and five text-in, text-out functions, and give the same tags, the same 5 sources and the same evidence text as the rules run directly', lacks === 'undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined' && bo.ok && JSON.stringify(bo.tags) === JSON.stringify(ro.tags) && bl.ok && bl.sources.length === 5 &&
    JSON.stringify(bl.sources.map(function (s) { return [s.id, s.label, s.kind, s.title, s.when, s.status]; })) === JSON.stringify(rl.sources.map(function (s) { return [s.id, s.label, s.kind, s.title, s.when, s.status]; })) && br.ok && rr.ok && sansTime(br.text) === sansTime(rr.text) && br.count === 5 && br.id === 3, lacks + ' ' + JSON.stringify([bo.ok, bl.ok, br.ok, br.reason]));
  var must = ['Harborline holds the price until Nov 30.', 'Travel budget is separate.', 'The revised quote is USD 48,500.', 'Mold maintenance', '820', '합계는 ₩1,200,000 입니다.'], mustNot = ['The cap is USD 820 a month.', '항공'];
  t('IN02', 'the evidence is fenced, cited and dated, and holds what the 5 tagged sources say now — and nothing from the 2 sources that do not carry the tag', br.text.indexOf(Insert.BEGIN + '\n') === 0 && br.text.slice(-Insert.END.length) === Insert.END && must.every(function (x) { return br.text.indexOf(x) >= 0; }) && mustNot.every(function (x) { return br.text.indexOf(x) < 0; }) && /\[E1\]/.test(br.text) && /\[N2\]/.test(br.text) && /\[W1\]/.test(br.text) && /Nov 1\d, 2026 \d\d:\d\d \(\+09:00\) — (sent|last saved)/.test(br.text) && /## Citations/.test(br.text), br.text.slice(0, 300));
  var two = ids.slice(0, 2), bx = askBare({ op: 'render', token: bl.token, selected: two }), labels = bl.sources.slice(0, 2).map(function (s) { return s.label; });
  t('IN03', 'exclusions: with 2 of the 5 ticked the text holds those two sources only and says it is 2 of 5; with none ticked there is no text', bx.ok && bx.count === 2 && bx.of === 5 && labels.every(function (l) { return bx.text.indexOf('[' + l + ']') >= 0; }) && bl.sources.slice(2).every(function (s) { return bx.text.indexOf('[' + s.label + ']') < 0; }) && /This copy holds 2 of the 5 sources linked to ::ZzAlpha/.test(bx.text) && askBare({ op: 'render', token: bl.token, selected: [] }).reason === 'none-selected', bx.text.slice(0, 200));
  t('IN04', 'nothing is written and nothing else is asked: the rules called only the four read functions; the index file, the clipboard and every source are as they were', calls.filter(function (c, i, a) { return a.indexOf(c) === i; }).sort().join() === 'readFile,readIndex,readMail,readNote' && !im.counts.writeIndex && !im.counts.copyText && !im.counts.selection && im.clipboard === null, JSON.stringify(im.counts));
  fs.writeFileSync(im.paths.csv.replace('zz-출장비.csv', 'zz-costs.xlsx'), Xlsx.write({ modified: '2026-11-19T01:00:00Z', sheets: [{ name: 'Summary', cells: { A1: 'Line', B1: 'Amount', A2: 'Mold maintenance', B2: 900 } }] }));
  var bc = askBare({ op: 'render', token: bl.token, selected: ids }), bc2 = askBare({ op: 'render', token: bl.token, selected: ids });
  t('IN05', 'a source is saved again after it was listed (the workbook now says 900): the first press gives no text, names the source and returns the list as it is now; pressing again gives the current value and not the old one', !bc.ok && bc.reason === 'changed' && !bc.text && bc.changed.length === 1 && bc.sources.length === 5 && bc2.ok && bc2.text.indexOf('900') >= 0 && bc2.text.indexOf('820') < 0, JSON.stringify([bc.reason, bc.changed, bc2.ok]));
  var ri = Core.loadIndex(im.indexText()), plan = Core.planRename(ri, 'ZzAlpha', 'ZzGamma'); fs.writeFileSync(im.indexPath(), Core.dumpIndex(Core.applyRename(ri, plan).index));
  var bi = askBare({ op: 'render', token: bl.token, selected: ids }), bo2 = askBare({ op: 'open' });
  t('IN06', 'the tag is renamed in contexta while the picker shows its list: no text is given, the answer says the tags changed and carries the tag list as it is now', !bi.ok && bi.reason === 'index-changed' && !bi.text && bi.tags.some(function (x) { return x.name === 'ZzGamma' && x.count === 5; }) && !bi.tags.some(function (x) { return x.name === 'ZzAlpha'; }) && bo2.tags.some(function (x) { return x.name === 'ZzGamma'; }) && askBare({ op: 'render', token: bl.token, selected: ids }).reason === 'expired');
  /* notes and mail that cannot be read now, as the app's guarded functions answer */
  var closedHost = Object.assign({}, im.now, { readNote: function () { return { ok: false, reason: 'Notes is closed: open it to include this' }; }, readMail: function () { return { ok: false, code: -1744, reason: 'contexta is not allowed to ask Mail (App access)' }; } });
  var ce = Insert.create(closedHost, {}), cl = ce.handle({ op: 'lookup', tag: 'ZzGamma' }), un = cl.sources.filter(function (s) { return s.group === 'unavailable'; });
  var cr = ce.handle({ op: 'render', token: cl.token, selected: un.map(function (s) { return s.id; }) }), cr2 = ce.handle({ op: 'render', token: cl.token, selected: cl.sources.map(function (s) { return s.id; }) });
  t('IN07', 'Notes is closed and Mail is not allowed: their 3 sources are listed as unavailable with the reason, never with old text; ticking only those gives nothing; with the 2 readable files ticked too, the text holds the files and names the 3 as unavailable', un.length === 3 && un.every(function (s) { return /Notes is closed: open it to include this|contexta is not allowed to ask Mail/.test(s.reason); }) && !cr.ok && cr.reason === 'nothing-readable' && cr2.ok && cr2.readable === 2 && cr2.count === 5 &&
    cr2.text.indexOf('Harborline holds the price') < 0 && cr2.text.indexOf('USD 48,500') < 0 && cr2.text.indexOf('Mold maintenance') >= 0 && /unavailable/i.test(cr2.text), JSON.stringify([un.map(function (s) { return s.reason; }), cr.reason, cr2.readable]));
  var big = await world('in-big'); fs.writeFileSync(big.paths.csv, 'col\n' + new Array(60001).join('가나다라\n'));
  var be = Insert.create(big.now, {}), bgl = be.handle({ op: 'lookup', tag: '출장비' }), bgIds = bgl.sources.map(function (s) { return s.id; }), bgr = be.handle({ op: 'render', token: bgl.token, selected: bgIds });
  var small = Insert.create(big.now, { maxText: 3000 }), sl = small.handle({ op: 'lookup', tag: '출장비' }), sr = small.handle({ op: 'render', token: sl.token, selected: bgIds });
  t('IN08', 'length: a 60,000-row file is cut by the same rule as Copy context, and the text says where it was cut (it stays far under the ' + Insert.MAX_TEXT + '-character limit a browser can take in one piece); a text over the limit is refused whole, with its size and what to do, never cut silently (shown with the limit lowered to 3,000)',
    bgr.ok && bgr.text.length < Insert.MAX_TEXT / 4 && /truncated: workbook cut at sheet “Sheet1”, row \d+/.test(bgr.text) && !sr.ok && sr.reason === 'too-large' && !sr.text && /too long to hand over in one piece \(\d+ thousand characters\)\. Untick some of them\./.test(sr.message), JSON.stringify([bgr.ok, bgr.text && bgr.text.length, sr.reason, sr.message]));
  /* a saved message in an older Korean charset, where the language has no decoder: the app's decodeText is used */
  var em = Mac.create(fresh('in-euckr').dir), head = 'From: =?EUC-KR?B?x9Gxuw==?= <han@northfield-devices.example>\r\nSubject: Zz legacy\r\nDate: Tue, 17 Nov 2026 11:00:00 +0900\r\nMessage-ID: <zz-euckr@northfield-devices.example>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=euc-kr\r\nContent-Transfer-Encoding: 8bit\r\n\r\n';
  var emlPath = em.write('zz-legacy.eml', Buffer.concat([Buffer.from(head, 'latin1'), Buffer.from([0xC7, 0xD1, 0xB1, 0xDB, 0x20, 0x38, 0x32, 0x30])]), '2026-11-17T11:00:00+09:00');
  em.pop = Popover.create(em.host, { now: function () { return clock; } }); em.select(FINDER, [emlPath]); await em.pop.opened({ bundleId: FINDER }); await em.pop.save('ZzLegacy'); await em.pop.closed();
  var asked2 = [], nat2 = { readIndex: function () { return JSON.stringify(em.now.readIndex()); }, readFile: function (text) { return JSON.stringify(b64(em.now.readFile(JSON.parse(text).path))); }, readNote: function () { return '{"ok":false}'; }, readMail: function () { return '{"ok":false}'; },
    decodeText: function (text) { var a = JSON.parse(text); asked2.push(a.charset + ':' + Buffer.from(a.bytes, 'latin1').toString('hex')); return JSON.stringify({ ok: true, text: new TextDecoder(a.charset).decode(Buffer.from(a.bytes, 'latin1')) }); } };
  var bare2 = vm.createContext({ contextInsertNative: nat2 }); vm.runInContext(bundle, bare2);
  var h2 = vm.runInContext('ContextInsert.handleJson', bare2), l2 = JSON.parse(h2(JSON.stringify({ op: 'lookup', tag: 'ZzLegacy' }))), r2k = JSON.parse(h2(JSON.stringify({ op: 'render', token: l2.token, selected: l2.sources.map(function (s) { return s.id; }) })));
  t('IN09', 'a saved message written in EUC-KR is read correctly inside the app\'s JavaScript (which has no decoder of its own): the bytes are handed to the app\'s text decoder with the charset\'s name, and the evidence says 한글 820, not broken characters', r2k.ok && r2k.text.indexOf('한글 820') >= 0 && r2k.text.indexOf('�') < 0 && asked2.some(function (x) { return x === 'euc-kr:c7d1b1db20383230'; }), JSON.stringify([r2k.ok, asked2, r2k.text && r2k.text.slice(0, 200)]));
  var unknown = [{ op: 'writeIndex' }, { op: 'copy' }, { op: 'readFile', path: '/etc/passwd' }, { op: 'selection' }, {}].map(function (q) { return askBare(q); });
  t('IN10', 'the extension can ask four things and no others: open, lookup, render, done. Anything else (write the index, copy, read a path, ask for the selection) is answered "unknown" and does nothing', unknown.every(function (u) { return u.ok === false && u.reason === 'unknown'; }) && askBare({ op: 'done' }).ok === true && im.clipboard === null && !im.counts.writeIndex);

  /* ───────── EX. the extension's pure parts ───────── */
  var draft = 'Please compare these.\nThanks', ev = '--- begin ---\nx\n--- end ---';
  t('EX01', 'the evidence goes on lines of its own at the caret: a line break before it unless the caret starts a line, one after it unless a line break follows; Windows line ends are made plain', Lib.frame(ev, draft, draft.length) === '\n' + ev + '\n' && Lib.frame(ev, draft, 0) === ev + '\n' && Lib.frame(ev, draft, 21) === '\n' + ev && Lib.frame(ev, '', 0) === ev + '\n' && Lib.frame('a\r\nb', 'x\n', 2) === 'a\nb\n' && Lib.frame(ev, draft, 22) === ev + '\n');
  var added = Lib.frame(ev, draft, 21), want = draft.slice(0, 21) + added + draft.slice(21);
  t('EX02', 'after inserting, the draft must be the old draft with exactly that text at exactly that place: one character more, less or elsewhere, or a changed character of the old draft, is not accepted', Lib.verifyInsert(draft, 21, added, want, true) && !Lib.verifyInsert(draft, 21, added, want + '!', true) && !Lib.verifyInsert(draft, 21, added, want.replace('Please', 'please'), true) && !Lib.verifyInsert(draft, 21, added, draft.slice(0, 20) + added + draft.slice(20), false) && !Lib.verifyInsert(draft, 21, added, draft, false) &&
    Lib.verifyInsert(draft, 21, added, want.replace(/\n/g, '\n\n').replace(/ /g, ' '), false) && !Lib.verifyInsert(draft, 21, added, want.replace('Thanks', ''), false));
  var tagList = [{ name: 'ZzAlpha', count: 5 }, { name: '출장비', count: 2 }, { name: 'Café', count: 1 }];
  t('EX03', 'the picker\'s tag search: any case, a pasted :: or #, Korean typed composed or decomposed, accents; an empty search lists all', Lib.filterTags(tagList, 'zza').length === 1 && Lib.filterTags(tagList, '::ZZ').length === 1 && Lib.filterTags(tagList, '#출').length === 1 && Lib.filterTags(tagList, '출장'.normalize('NFD')).length === 1 && Lib.filterTags(tagList, 'café').length === 1 && Lib.filterTags(tagList, '').length === 3 && Lib.filterTags(tagList, 'none').length === 0);
  t('EX04', 'which chat is which: the address without its fragment; two chats, or the same chat with another query, are different; the helper\'s name is the one the app registers', Lib.conversationOf({ origin: 'https://chatgpt.com', pathname: '/c/aaa', search: '' }) === 'https://chatgpt.com/c/aaa' && Lib.conversationOf({ origin: 'https://chatgpt.com', pathname: '/c/aaa', search: '' }) !== Lib.conversationOf({ origin: 'https://chatgpt.com', pathname: '/c/bbb', search: '' }) &&
    Lib.conversationOf({ origin: 'https://chatgpt.com', pathname: '/c/aaa', search: '?model=x' }) !== Lib.conversationOf({ origin: 'https://chatgpt.com', pathname: '/c/aaa' }) && Lib.HOST === 'local.workindex.composer' && Lib.token() !== Lib.token() && Lib.token().length >= 16);
};
