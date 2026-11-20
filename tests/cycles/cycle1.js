/* Cycle 1 — the menu-bar label: transitions, correctness, update latency and idle work.
 * Everything here runs the real rules (core/status.js) against the pretend Mac with a pretend clock.
 * Nothing here is a macOS measurement: times are the rules' own waits plus an assumed answer time per question. */
'use strict';
var fs = require('fs'), path = require('path'), cp = require('child_process');

module.exports = async function (S, C) {
  var L = C.L, Core = C.Core, NOTES = L.NOTES, MAIL = L.MAIL, FINDER = 'com.apple.finder', EXCEL = 'com.microsoft.Excel', TEXTEDIT = 'com.apple.TextEdit', CHROME = 'com.google.Chrome';
  var P11 = 'x-coredata://FICTIONAL-0002/ICNote/p11', P12 = 'x-coredata://FICTIONAL-0002/ICNote/p12', P13 = 'x-coredata://FICTIONAL-0002/ICNote/p13';
  var ANSWER = 30;                                           /* assumed time for an app to answer, in pretend milliseconds */
  async function world(opts) { var sc = await C.Scene.build(C.Popover); sc.sim = C.MenuBar.create(sc.mac, opts); return sc; }
  function states(sim, from) { return sim.shows.slice(from || 0).map(function (s) { return s.state + (s.title ? ':' + s.title : ''); }).join(' → '); }

  /* ── transitions ── */
  var w = await world(), mac = w.mac, sim = w.sim, wb = path.join(mac.files, 'tooling-budget.xlsx');
  sim.activate(CHROME); sim.advance(600000);
  S.check('C1.01', 'an app Context does not follow (a browser) in front for ten minutes: the item is dimmed, and no app is asked anything; the timer is not even running', sim.text() === 'off' && sim.counts.asks === 0 && sim.counts.scripts === 0 && sim.counts.ticks === 0 && sim.timerAt === null, sim.text() + ' ' + JSON.stringify(sim.counts));

  var n0 = sim.shows.length, t0 = sim.now;
  sim.activate(NOTES); var atOnce = sim.text(); sim.advance(1000);
  var shown = sim.shows.filter(function (s) { return s.state === 'tags'; })[0];
  S.check('C1.02', 'Notes comes to the front with a tagged note selected: the label is cleared at once, then shows the note\'s tag', atOnce === 'wait' && sim.text() === 'tags:Cost' && states(sim, n0) === 'wait → tags:Cost', states(sim, n0));
  S.measure('activation: app switch → tags shown (pretend ms, incl. ' + ANSWER + ' ms answer)', shown ? shown.at - t0 : null);

  n0 = sim.shows.length;
  mac.select(NOTES, [P12]); sim.advance(2500); var a = sim.text();
  mac.select(NOTES, [P13]); sim.advance(2500); var b = sim.text();
  mac.select(NOTES, [P11, P12]); sim.advance(2500); var c = sim.text(), cTip = sim.label().tooltip;
  mac.select(NOTES, [P11]); sim.advance(2500);
  S.check('C1.03', 'the selection changes inside Notes: untagged note → outlined icon, another tagged note → its tag, two notes → dimmed with the reason, back → the first tag; never a blank or a wrong tag in between',
    a === 'none' && b === 'tags:Travel' && c === 'off' && /Select exactly one note/.test(cTip) && sim.text() === 'tags:Cost' && states(sim, n0) === 'none → tags:Travel → off → tags:Cost', states(sim, n0));
  var none = sim.shows.filter(function (s) { return s.state === 'none'; })[0], off = sim.shows.filter(function (s) { return s.state === 'off'; })[0];
  S.check('C1.04', 'no tags and unavailable are told apart three ways: a different state for the icon, a different tooltip, a different accessibility label; neither shows any text in the menu bar',
    none.title === '' && off.title === '' && none.state !== off.state && /^No tags on this note\. Click to tag it\./.test(none.tooltip) && /^Context\. No tags\. Note in Notes: Lunch order\.$/.test(none.label) && /Nothing to tag in this app/.test(off.tooltip) && none.label !== off.label, JSON.stringify([none, off]));

  /* ── fast switching and answers that come back in the wrong order ── */
  var before = JSON.parse(JSON.stringify(sim.counts)); n0 = sim.shows.length;
  sim.activate(MAIL); sim.advance(60); sim.activate(FINDER); sim.advance(60); sim.activate(CHROME); sim.advance(60); sim.activate(NOTES); sim.advance(1000);
  S.check('C1.05', 'four app switches 60 ms apart (Mail, Finder, a browser, Notes): the apps only passed through are never asked, the label is blank while moving, and ends on the note in Notes',
    (sim.counts.scriptsBy[MAIL] || 0) === (before.scriptsBy[MAIL] || 0) && (sim.counts.scriptsBy[FINDER] || 0) === (before.scriptsBy[FINDER] || 0) && sim.counts.scriptsBy[NOTES] > before.scriptsBy[NOTES] && sim.text() === 'tags:Cost' && states(sim, n0) === 'wait → wait → off → wait → tags:Cost', states(sim, n0) + ' ' + JSON.stringify(sim.counts.scriptsBy));

  var slow = await world({ latency: function (bid) { return bid === NOTES ? 900 : 30; } });
  slow.mac.select(MAIL, ['5001']);
  slow.sim.activate(NOTES); slow.sim.advance(200); slow.sim.activate(MAIL); slow.sim.advance(3000);
  var dropped = slow.sim.eng.peek().count.dropped + slow.sim.counts.skipped, wrong = slow.sim.shows.filter(function (s) { return (s.state === 'tags' || s.state === 'none') && s.tooltip.indexOf(' in ' + Core.SELECTION_APPS[s.front] + ': ') < 0; });
  S.check('C1.06', 'Notes answers late (900 ms), after Mail has come to the front and answered: the late answer is not believed, and the label is the Mail message\'s tags', slow.sim.text() === 'tags:Cost, PineRidge' && dropped >= 1 && wrong.length === 0, states(slow.sim) + ' dropped=' + dropped);
  var switchAt = 1000000 + 200, clearedAt = (slow.sim.shows.filter(function (s) { return s.at >= switchAt; })[0] || {}).at;
  S.measure('app switch while a question is still running (900 ms answer): old app\'s label gone after (pretend ms)', clearedAt - switchAt);
  slow.cleanup();
  /* the rule itself, fed directly: the shell normally keeps such answers away, the rules must not depend on that */
  var eng = C.Status.create(), reply = 'note\u001Fx-coredata://A/ICNote/p1\u001FOne\u001F\u001F', said = [];
  function feedE(e) { var out = eng.step(e); out.forEach(function (c) { if (c.do === 'show') said.push(c.state); }); return out; }
  feedE({ type: 'app', bundleId: NOTES, name: 'Notes', pid: 7, now: 0, stamp: 'none' }); feedE({ type: 'index', stamp: 'none', missing: true, now: 1 });
  var seq = feedE({ type: 'tick', now: 130, stamp: 'none' }).filter(function (c) { return c.do === 'ask'; })[0].seq, n1 = said.length;
  feedE({ type: 'answer', seq: seq - 1, bundleId: NOTES, pid: 7, perm: 0, ok: true, reply: reply, now: 150, stamp: 'none' });                 /* an older question */
  feedE({ type: 'answer', seq: seq, bundleId: MAIL, pid: 7, perm: 0, ok: true, reply: reply, now: 151, stamp: 'none' });                      /* another app */
  feedE({ type: 'answer', seq: seq, bundleId: NOTES, pid: 8, perm: 0, ok: true, reply: reply, now: 152, stamp: 'none' });                     /* Notes was restarted */
  var unbelieved = said.length === n1;
  feedE({ type: 'popover', open: true, now: 153, stamp: 'none' });
  feedE({ type: 'answer', seq: seq, bundleId: NOTES, pid: 7, perm: 0, ok: true, reply: reply, now: 154, stamp: 'none' });                     /* the popover opened meanwhile */
  feedE({ type: 'popover', open: false, now: 155, stamp: 'none' });
  var seq2 = feedE({ type: 'tick', now: 156, stamp: 'none' }).filter(function (c) { return c.do === 'ask'; })[0].seq;
  feedE({ type: 'answer', seq: seq2, bundleId: NOTES, pid: 7, perm: 0, ok: true, reply: reply, now: 170, stamp: 'none' });
  S.check('C1.06b', 'the rule by itself: an answer to an older question, an answer naming another app, an answer from a restarted copy of the app and an answer that arrives after the popover opened are all not believed; the answer to the newest question is',
    unbelieved && said.length === n1 + 1 && said[said.length - 1] === 'none' && eng.peek().count.dropped === 4, said.join(' → ') + ' dropped=' + eng.peek().count.dropped);

  var hang = false, stuck = await world({ hang: function () { return hang; } });
  stuck.sim.activate(NOTES); stuck.sim.advance(1000); var had = stuck.sim.text(); hang = true; var hangAt = stuck.sim.now; stuck.sim.advance(4000);
  var cleared = stuck.sim.shows.filter(function (s) { return s.at > hangAt && s.state === 'off'; })[0], asksWhileStuck = stuck.sim.counts.asks; stuck.sim.advance(60000); var perMinuteStuck = stuck.sim.counts.asks - asksWhileStuck;
  hang = false; stuck.sim.advance(11000);
  S.check('C1.07', 'Notes stops answering: the tag is cleared (not left standing), Notes is asked less often while it is stuck, and the tag returns by itself when Notes answers again', had === 'tags:Cost' && !!cleared && /not answering/.test(cleared.tooltip) && perMinuteStuck <= 8 && stuck.sim.text() === 'tags:Cost', had + ' → ' + (cleared ? cleared.state : 'still ' + stuck.sim.text()) + ', ' + perMinuteStuck + ' asks/min while stuck → ' + stuck.sim.text());
  S.measure('stuck app: questions per minute while it does not answer', perMinuteStuck);
  S.measure('stuck app: tag cleared after (pretend ms)', cleared ? cleared.at - hangAt : null);
  stuck.cleanup();

  /* ── tag edits ── */
  sim.activate(NOTES); sim.advance(1000);
  var pop = C.Popover.create(mac.host), scripts0 = sim.counts.scripts, asksAtOpen;
  sim.popover(true); sim.activate(C.MenuBar.OWN, { popover: true }); asksAtOpen = sim.counts.asks;
  await pop.opened({ bundleId: NOTES }); await pop.addTag('PineRidge'); var t1 = sim.now; sim.saved(); sim.advance(0); var afterAdd = sim.text(), addAt = sim.label().at;
  await pop.removeTag('Cost'); sim.saved(); sim.advance(0); var afterRemove = sim.text();
  await pop.removeTag('PineRidge'); sim.saved(); sim.advance(0); var afterAll = sim.text();
  await pop.addTag('Cost'); sim.saved(); sim.advance(0);
  sim.access(); sim.advance(30000); var whileOpen = sim.counts.asks - asksAtOpen;      /* even a nudge ("permissions may have changed") must not make it ask while the popover is open */
  sim.popover(false); sim.activate(NOTES); sim.advance(1000);
  S.check('C1.08', 'tags are added and removed in the popover: the label follows each change at once, without asking Notes again; while the popover is open Notes is not asked at all; after it closes the label is checked against Notes',
    afterAdd === 'tags:Cost, PineRidge' && addAt === t1 && afterRemove === 'tags:PineRidge' && afterAll === 'none' && whileOpen === 0 && sim.text() === 'tags:Cost' && sim.counts.scripts > scripts0, [afterAdd, afterRemove, afterAll, 'asked while open: ' + whileOpen, sim.text()].join(' | '));
  var idx = Core.loadIndex(mac.indexText()); Core.bind(idx, { id: 'applenotes:' + P12, kind: 'note', title: 'Lunch order', locator: { type: 'apple-notes', value: P12 }, sourceTime: null, sourceTimeType: 'unknown', sourceCreated: null }, ['Lunch'], { replace: true, now: '2026-11-20T09:00:00+09:00' });
  mac.select(NOTES, [P12]); sim.advance(2500); var pre = sim.text(); fs.writeFileSync(mac.indexPath(), Core.dumpIndex(idx)); var editAt = sim.now; sim.advance(2500);
  S.check('C1.09', 'the index file is changed by something else (not the popover) while its note is selected: the label picks the change up at its next look', pre === 'none' && sim.text() === 'tags:Lunch' && sim.label().at - editAt <= 2000 + ANSWER, pre + ' → ' + sim.text() + ' after ' + (sim.label().at - editAt) + ' ms');
  mac.select(NOTES, [P11]);

  /* ── saves and renames ── */
  n0 = sim.shows.length;
  mac.openDocument[EXCEL] = ''; sim.activate(EXCEL); sim.advance(1000); var unsaved = sim.text();
  mac.openDocument[EXCEL] = wb; sim.advance(2500); var saved = sim.text();
  var copyPath = path.join(mac.files, 'tooling-budget v2.xlsx'); fs.copyFileSync(wb, copyPath); mac.openDocument[EXCEL] = copyPath; sim.advance(2500); var savedAs = sim.text();
  mac.openDocument[TEXTEDIT] = ''; sim.activate(TEXTEDIT); sim.advance(1000); var draft = sim.label();
  S.check('C1.10', 'saves: a workbook that is not saved yet shows no tags; once it is the saved, tagged file its tags show; after Save As to a new name the new file shows no tags (they are not carried over); an unsaved TextEdit document says to save first',
    unsaved === 'off' && saved === 'tags:Cost, PineRidge' && savedAs === 'none' && draft.state === 'off' && /Save the document first/.test(draft.tooltip), [unsaved, saved, savedAs, draft.state, draft.tooltip].join(' | '));

  var renamed = path.join(mac.files, 'tooling-budget (final).xlsx'), entries = mac.indexText();
  mac.select(FINDER, [wb]); sim.activate(FINDER); sim.advance(1000); var f1 = sim.text();
  fs.renameSync(wb, renamed); mac.select(FINDER, [renamed]); var renameAt = sim.now; sim.advance(2500); var f2 = sim.text(), clearedAfter = sim.label().at - renameAt;
  var orphan = path.join(mac.files, 'tooling-budget.xlsx'); mac.select(FINDER, [orphan]); sim.advance(2500); var f3 = sim.label();
  fs.renameSync(renamed, wb); mac.select(FINDER, [wb]); sim.advance(2500);
  S.check('C1.11', 'a tagged file is renamed in Finder: its old tags stop showing within one look (the renamed file is a different saved file to the index), nothing is written to the index, and renaming it back shows them again',
    f1 === 'tags:Cost, PineRidge' && f2 === 'none' && f3.state === 'off' && mac.indexText() === entries && sim.text() === 'tags:Cost, PineRidge', [f1, f2, f3.state, sim.text()].join(' | '));
  S.measure('rename: old tags cleared after (pretend ms)', clearedAfter);
  mac.notes[P11].title = 'Supplier call: Harborline (Nov)'; sim.activate(NOTES); sim.advance(1000);
  S.check('C1.12', 'a tagged note is renamed in Notes: it is the same note, so its tag stays, and the tooltip carries the new title', sim.text() === 'tags:Cost' && /Supplier call: Harborline \(Nov\)/.test(sim.label().tooltip), sim.label().tooltip);
  mac.notes[P11].title = 'Supplier call: Harborline';

  var eml = path.join(mac.files, 'Competing quote - Kestrel.eml');
  mac.select(FINDER, [eml]); sim.activate(FINDER); sim.advance(1000);
  var viaPopover = (await (async function () { var p = C.Popover.create(mac.host); var v = await p.opened({ bundleId: FINDER }); return v.target.tags.join(', '); })());
  S.check('C1.13', 'a saved mail message (.eml) selected in Finder: the label shows the same tags the popover shows for it (it is identified by its Message-ID, read from the first lines of the file only)', sim.text() === 'tags:Cost' && viaPopover === 'Cost' && /^Tag: Cost\nEmail in Finder/.test(sim.label().tooltip), sim.text() + ' / popover: ' + viaPopover + ' / ' + sim.label().tooltip);

  /* ── permission: never a prompt, never an app opened ── */
  var p = await world();
  p.sim.perm[MAIL] = -1744; p.mac.select(MAIL, ['5001']); p.sim.activate(MAIL); p.sim.advance(60000);
  var notAsked = p.sim.label(), mailScripts = p.sim.counts.scriptsBy[MAIL] || 0, looks = p.sim.counts.permChecks;
  p.sim.perm[MAIL] = 0; var allowAt = p.sim.now; p.sim.access(); p.sim.advance(1000); var recovered = p.sim.text(), recoverMs = p.sim.label().at - allowAt;
  p.sim.perm[MAIL] = -1743; var revokeAt = p.sim.now; p.sim.advance(2500); var revoked = p.sim.label(), revokeMs = revoked.at - revokeAt, s2 = p.sim.counts.scriptsBy[MAIL]; p.sim.advance(60000);
  S.check('C1.14', 'Mail has never been asked for (macOS has not decided): for a minute in front it is sent nothing, so macOS has nothing to prompt about; the item is dimmed and says to use App access; after it is allowed there the tags show; when it is switched off in Settings the tags are cleared at the next look and Mail is sent nothing more',
    notAsked.state === 'off' && /has not asked to follow Mail yet\. Click, then choose App access/.test(notAsked.tooltip) && mailScripts === 0 && p.sim.counts.prompts === 0 && recovered === 'tags:Cost, PineRidge' && revoked.state === 'off' && /not allowed to ask Mail/.test(revoked.tooltip) && p.sim.counts.scriptsBy[MAIL] === s2 && p.sim.counts.prompts === 0,
    [notAsked.state, mailScripts, p.sim.counts.prompts, recovered, revoked.state, p.sim.counts.scriptsBy[MAIL] - s2].join(' | '));
  S.measure('permission: looks at the macOS setting per minute while not allowed (no question to the app)', looks);
  S.measure('permission: allowed in App access → tags shown (pretend ms)', recoverMs);
  S.measure('permission: switched off in Settings → tags cleared (pretend ms)', revokeMs);
  p.sim.perm[MAIL] = 0; p.sim.activate(NOTES); p.sim.advance(1000); p.sim.quit(NOTES); var launches0 = p.sim.counts.scripts; p.sim.advance(10000);
  S.check('C1.15', 'Notes quits while the system still reports it in front: it is not asked again, so it cannot be opened by the label', p.sim.counts.launches === 0 && p.sim.counts.scripts === launches0 && p.sim.counts.skipped > 0, JSON.stringify(p.sim.counts));
  p.cleanup();

  /* ── asleep, locked ── */
  sim.activate(NOTES); sim.advance(1000); var asks0 = sim.counts.asks; sim.pause(); var asleep = sim.text(); sim.advance(600000); var during = sim.counts.asks - asks0; sim.resume(); sim.advance(1000);
  S.check('C1.16', 'the Mac sleeps for ten minutes: the label is cleared, nothing is asked meanwhile, and on waking the label is checked afresh', asleep === 'off' && during === 0 && sim.text() === 'tags:Cost', asleep + ' asks while asleep: ' + during + ' → ' + sim.text());

  /* ── idle work and update latency ── */
  var q = await world(); q.sim.activate(NOTES);
  var marks = [10000, 60000, 120000, 600000], counts = [], last = 0, lastAsks = 0;
  marks.forEach(function (m) { q.sim.advance(m - last); counts.push(q.sim.counts.asks - lastAsks); lastAsks = q.sim.counts.asks; last = m; });
  var steadyPerMinute = counts[3] / 8, reads = q.sim.counts.indexReads;
  S.check('C1.17', 'idle work with Notes in front and nothing changing: looks slow down from 2 a second to 1 a second after 10 s and to 1 every 2 s after a minute; the index file is read once, then only its date is looked at',
    counts[0] >= 18 && counts[0] <= 21 && counts[1] >= 49 && counts[1] <= 51 && steadyPerMinute <= 30 && reads === 1, JSON.stringify(counts) + ' steady/min=' + steadyPerMinute + ' index reads=' + reads);
  S.measure('idle work: questions to the app in front, first 10 s after a change', counts[0]);
  S.measure('idle work: questions per minute, 10–60 s after a change', Math.round(counts[1] * 60 / 50));
  S.measure('idle work: questions per minute, steady (nothing changed for over a minute)', steadyPerMinute);
  S.measure('idle work: questions per minute, unsupported app in front / popover open / asleep', 0);
  S.measure('idle work: index file reads over ten unchanged minutes', reads);
  var rnd = C.random(20261120), lat = { fast: [], mid: [], slow: [] };
  [['fast', 2000], ['mid', 30000], ['slow', 90000]].forEach(function (tier) {
    for (var i = 0; i < 200; i++) {
      q.mac.select(NOTES, []); q.sim.advance(3000); q.mac.select(NOTES, [P11]); q.sim.advance(3000);      /* two real changes, so the pace starts over */
      q.sim.advance(tier[1] + Math.floor(rnd() * 2000));                                 /* quiet for this long */
      var want = i % 2 ? P13 : P12, at = q.sim.now; q.mac.select(NOTES, [want]); q.sim.advance(2600);
      var hit = q.sim.shows.filter(function (s) { return s.at >= at && (want === P13 ? s.title === 'Travel' : s.state === 'none'); })[0];
      lat[tier[0]].push(hit ? hit.at - at : 99999);
    }
  });
  var sf = C.stats(lat.fast), sm = C.stats(lat.mid), ss = C.stats(lat.slow);
  S.check('C1.18', 'update latency over 600 randomized selection changes: the label follows within one look plus the answer time at every pace (0.5 s, 1 s, 2 s)', sf.max <= 500 + ANSWER && sm.max <= 1000 + ANSWER && ss.max <= 2000 + ANSWER, JSON.stringify({ fast: sf, mid: sm, slow: ss }));
  S.measure('latency: selection change → label, within 10 s of the last change (pretend ms: median / p95 / max)', [sf.median, sf.p95, sf.max].join(' / '));
  S.measure('latency: selection change → label, 10–60 s after the last change (median / p95 / max)', [sm.median, sm.p95, sm.max].join(' / '));
  S.measure('latency: selection change → label, steady (median / p95 / max)', [ss.median, ss.p95, ss.max].join(' / '));
  q.cleanup();

  /* ── long names ── */
  var z = await world(), zi = Core.loadIndex(z.mac.indexText());
  Core.bind(zi, { id: 'applenotes:' + P12, kind: 'note', title: '[긴급] 파인리지 하우징 금형 견적 재검토 요청 및 2026년 11월 납기 일정 조정 관련 회신 드립니다 (Harborline Tooling, P20 강재 기준) 추가 확인 사항 정리', locator: { type: 'apple-notes', value: P12 }, sourceTime: null, sourceTimeType: 'unknown', sourceCreated: null }, ['QuarterlyBudgetReview', '하우징금형견적검토'], { replace: true, now: '2026-11-20T09:00:00+09:00' });
  fs.writeFileSync(z.mac.indexPath(), Core.dumpIndex(zi)); z.mac.notes[P12].title = '[긴급] 파인리지 하우징 금형 견적 재검토 요청 및 2026년 11월 납기 일정 조정 관련 회신 드립니다 (Harborline Tooling, P20 강재 기준) 추가 확인 사항 정리';
  z.mac.select(NOTES, [P12]); z.sim.activate(NOTES); z.sim.advance(1000);
  var long = z.sim.label(), parts = long.title.split(', ');
  S.check('C1.19', 'long tag names (Latin and Korean) are shortened in the menu bar to at most 10 character widths each, with an ellipsis; the tooltip and the accessibility label carry the full names, and a long Korean title is cut with an ellipsis in the tooltip',
    long.title === 'Quarterly…, 하우징금…' && parts.every(function (x) { return C.Status.units(x) <= 10; }) && /Tags: QuarterlyBudgetReview, 하우징금형견적검토\n/.test(long.tooltip) && /Tags: QuarterlyBudgetReview, 하우징금형견적검토\./.test(long.label) && /…$/.test(long.tooltip) && Array.from(long.tooltip.split('\n')[1]).length <= 95, JSON.stringify(long));
  S.measure('longest menu-bar text for two 40-character tags (character widths, without the icon)', C.Status.units(C.Status.compact(['A'.repeat(40), '가'.repeat(40)])));
  fs.writeFileSync(z.mac.indexPath(), '{not json'); z.sim.advance(2500); var broken = z.sim.label(), asksBroken = z.sim.counts.asks; z.sim.advance(60000); var asksWhileBroken = z.sim.counts.asks - asksBroken;
  fs.writeFileSync(z.mac.indexPath(), Core.dumpIndex(zi)); z.sim.activate(NOTES); z.sim.advance(1000);
  S.check('C1.20', 'the index file becomes unreadable: the label stops showing tags and says why, nothing is asked meanwhile, and it recovers when the file is readable again', broken.state === 'off' && /index file cannot be read/.test(broken.tooltip) && asksWhileBroken === 0 && z.sim.text() === 'tags:Quarterly…, 하우징금…', broken.state + ' ' + asksWhileBroken + ' ' + z.sim.text());
  z.cleanup();

  /* ── randomized: whatever happens, after things settle the label is the truth, and it never speaks for another app ── */
  var r = await world({ latency: function () { return lat2(); } }), rr = C.random(77), lat2 = function () { return 30; }, apps = [NOTES, MAIL, FINDER, EXCEL, CHROME], rm = r.mac, rs = r.sim, bad = [], settles = 0;
  var files = [path.join(rm.files, 'tooling-budget.xlsx'), path.join(rm.files, 'Competing quote - Kestrel.eml'), path.join(rm.files, 'tooling-budget (old copy).xlsx')];
  function pick(list) { return list[Math.floor(rr() * list.length)]; }
  function truth() {
    var f = rs.front ? rs.front.bundleId : '', objs = rm.objects(), rec = null, one = false;
    if (rs.perm[f] != null && rs.perm[f] !== 0) return 'off';
    function byLocator(type, value) { return Object.keys(objs).map(function (k) { return objs[k]; }).filter(function (o) { return o.locator.type === type && o.locator.value === value; })[0] || null; }
    if (f === NOTES) { var s = rm.selected[NOTES]; one = s.length === 1 && !!rm.notes[s[0]]; if (one) rec = byLocator('apple-notes', s[0]); }
    else if (f === MAIL) { var m = rm.selected[MAIL]; one = m.length === 1 && !!rm.mails[m[0]]; if (one) rec = byLocator('apple-mail', rm.mails[m[0]].messageId); }
    else if (f === FINDER || f === EXCEL) { var pth = f === FINDER ? (rm.selected[FINDER].length === 1 ? rm.selected[FINDER][0] : '') : rm.openDocument[EXCEL]; one = !!pth && fs.existsSync(pth); if (one) rec = byLocator('file', fs.realpathSync(pth)); }
    else return 'off';
    if (!one) return 'off';
    return rec && rec.tags.length ? 'tags:' + C.Status.compact(rec.tags) : 'none';
  }
  rs.activate(NOTES);
  for (var step = 0; step < 1500; step++) {
    var op = Math.floor(rr() * 8);
    lat2 = function () { var x = rr(); return x < 0.8 ? 5 + Math.floor(rr() * 200) : x < 0.97 ? 300 + Math.floor(rr() * 900) : 5000; };
    if (op === 0 || op === 1) rs.activate(pick(apps));
    else if (op === 2) rm.select(NOTES, pick([[P11], [P12], [P13], [P11, P12], []]));
    else if (op === 3) rm.select(MAIL, pick([['5001'], ['5002'], ['5003'], ['5004'], ['6001'], []]));
    else if (op === 4) rm.select(FINDER, pick([[files[0]], [files[1]], [files[2]], [path.join(rm.files, 'gone.xlsx')], []]));
    else if (op === 5) rm.openDocument[EXCEL] = pick([files[0], files[2], '']);
    else if (op === 6) { var who = pick([NOTES, MAIL, FINDER, EXCEL]); rs.perm[who] = pick([0, 0, 0, -1743, -1744]); }
    else {                                                       /* a tag edit, written the way the popover writes it */
      var ix = Core.loadIndex(rm.indexText()), key = pick(Object.keys(ix.objects)), want = pick([['Cost'], ['Cost', 'PineRidge'], ['Travel'], ['금형']]);
      Core.bind(ix, ix.objects[key], want, { replace: true, now: '2026-11-20T10:00:00+09:00' }); fs.writeFileSync(rm.indexPath(), Core.dumpIndex(ix)); rs.saved();
    }
    rs.advance(Math.floor(rr() * 1500));
    if (step % 10 === 9) {
      lat2 = function () { return 30; }; rs.advance(16000); settles++;
      var want2 = truth(), got = rs.text() === 'wait' ? 'off' : rs.text();
      if (got !== want2 && bad.length < 5) bad.push('step ' + step + ' in ' + (rs.front && rs.front.bundleId) + ': shows ' + got + ', truth ' + want2);
    }
  }
  var crossed = rs.shows.filter(function (s) { return (s.state === 'tags' || s.state === 'none') && s.tooltip.indexOf(' in ' + Core.SELECTION_APPS[s.front] + ': ') < 0; });      /* a label names its app: it must be the one in front */
  S.check('C1.21', 'randomized: 1,500 app switches, selection changes, permission changes and tag edits with answers taking 5 ms to 5 s; at ' + settles + ' quiet moments the label equals what is truly selected and tagged, and no label was ever shown for an app other than the one in front',
    bad.length === 0 && crossed.length === 0 && rs.counts.prompts === 0 && rs.counts.launches === 0, bad.join(' ; ') + ' crossed=' + crossed.length + ' prompts=' + rs.counts.prompts + ' launches=' + rs.counts.launches);
  S.measure('randomized run: answers not believed or not passed on (older question, or the app had changed)', rs.eng.peek().count.dropped + rs.counts.skipped);
  S.measure('randomized run: questions sent to an app that was not allowed or not running (would prompt / would open it)', rs.counts.prompts + ' / ' + rs.counts.launches);
  r.cleanup();

  /* ── the same rules in JavaScriptCore (the engine the Mac app runs them in) ── */
  var bun = ['/root/.bun/bin/bun', '/usr/local/bin/bun'].filter(function (x) { return fs.existsSync(x); })[0];
  var probe = "var S=require('" + path.join(C.ROOT, 'core', 'status.js') + "');var e=S.create(),out=[];" +
    "[{type:'app',bundleId:'com.apple.Notes',name:'Notes',pid:7,now:0,stamp:'none'},{type:'index',stamp:'none',missing:true,now:1},{type:'tick',now:130,stamp:'none'},{type:'answer',seq:2,bundleId:'com.apple.Notes',pid:7,perm:0,ok:true,reply:'note\\u001Fx-coredata://A/ICNote/p1\\u001F견적 메모\\u001F\\u001F',now:160,stamp:'none'},{type:'app',bundleId:'com.example.x',name:'X',pid:9,now:900,stamp:'none'}].forEach(function(ev){out.push(e.step(ev));});" +
    "console.log(JSON.stringify(out)+S.compact(['QuarterlyBudgetReview','하우징금형견적검토']));";
  var viaNode = cp.execFileSync(process.execPath, ['-e', probe]).toString();
  if (bun) { var viaBun = cp.execFileSync(bun, ['-e', probe]).toString(); S.check('C1.22', 'the label rules give the same commands in JavaScriptCore (Bun) as in V8 (Node) for the same events', viaBun === viaNode && /show/.test(viaNode), viaBun.slice(0, 200)); }
  else S.blocked('C1.22', 'the label rules give the same commands in JavaScriptCore as in V8', 'Bun (JavaScriptCore) is not on this machine');

  S.blocked('C1.N1', 'on a real Mac: the item shows the tags, dims, and clears as above; hovering shows the tooltip; VoiceOver reads the label', 'needs macOS: the Swift shell (Status.swift, App.swift) has not been compiled or run here');
  S.blocked('C1.N2', 'on a real Mac: time for Notes, Mail, Finder and Excel to answer the question, CPU and energy while idle', 'needs macOS: answer times here are assumed (' + ANSWER + ' ms), not measured');
  S.measure('before (0.10.3): tags of the selected item visible without opening the popover', 'no (1 click on the icon, popover covers the work)');
  S.measure('after (0.11): tags of the selected item visible without opening the popover', 'yes (0 clicks)');
  w.cleanup();
};
