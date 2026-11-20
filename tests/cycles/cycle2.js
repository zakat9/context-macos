/* Cycle 2 — first run, batch permission, denial and revoke, recovery.
 * The macOS prompt is MOCKED here (tests/lib/macos-prompts.js): these checks show what Context's own rules and pages
 * do around it. What macOS itself does is in the blocked list at the end. */
'use strict';
var fs = require('fs'), path = require('path');

module.exports = async function (S, C) {
  var Prompts = require('../lib/macos-prompts.js'), L = C.L, NOTES = L.NOTES, MAIL = L.MAIL, FINDER = 'com.apple.finder', EXCEL = 'com.microsoft.Excel';
  var FIRST = {}; FIRST[NOTES] = { running: true }; FIRST[MAIL] = { running: true }; FIRST[FINDER] = { running: true }; FIRST[EXCEL] = {}; FIRST['com.apple.Preview'] = {}; FIRST['com.apple.TextEdit'] = {};
  ['com.microsoft.Word', 'com.microsoft.Powerpoint', 'com.apple.iWork.Numbers', 'com.apple.iWork.Pages', 'com.apple.iWork.Keynote'].forEach(function (b) { FIRST[b] = { installed: false }; });
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  async function until(fn) { for (var i = 0; i < 200 && !fn(); i++) await tick(); return fn(); }
  function line(v) { return v.rows.map(function (r) { return r.name.replace('Microsoft ', '') + '=' + r.status + (r.ticked ? '✓' : ''); }).join(' '); }

  /* ── first run ── */
  var os = Prompts.create(FIRST), ac = C.Access.create(os.host), show = await ac.shouldShowAtLaunch(false), v = ac.view();
  S.check('C2.01', 'first run (no index, nothing allowed): the window asks to be shown; it lists the six installed apps in a fixed order, names the five that are not installed in one line, and ticks to begin with only the three that are open and not asked yet; looking has prompted nothing and opened nothing',
    show === true && line(v) === 'Notes=not-asked✓ Mail=not-asked✓ Finder=not-asked✓ Excel=closed Preview=closed TextEdit=closed' && v.missing.length === 5 && v.selectedCount === 3 && v.canRequest && os.prompts.length === 0 && os.opened.length === 0 && os.checks.join() === [NOTES, MAIL, FINDER].join(),
    line(v) + ' | missing ' + v.missing.length + ' | prompts ' + os.prompts.length + ' opened ' + os.opened.length);
  S.check('C2.02', 'before the button is pressed the window says plainly what will happen: how many separate macOS prompts, and that nothing opens', v.note === 'macOS will ask 3 times, one prompt after another.', v.note);

  /* ── one button, three prompts, one at a time ── */
  var seen = [], run = ac.start();
  await until(function () { return os.waiting; }); seen.push(ac.view().note + ' [' + os.onScreen + ' on screen]'); var mid = line(ac.view()), busy = ac.view().busy, canWhile = ac.view().canRequest; os.waiting.answer('allow');
  await until(function () { return os.waiting && os.waiting.id === MAIL; }); seen.push(ac.view().note); ac.refresh(); await tick(); var stillAsking = ac.view().busy && line(ac.view()).indexOf('Mail=asking') >= 0; os.waiting.answer('deny');
  await until(function () { return os.waiting && os.waiting.id === FINDER; }); seen.push(ac.view().note); os.waiting.answer('allow');
  v = await run;
  S.check('C2.03', 'Request selected (3): macOS is asked for one app at a time, top to bottom; the window names the app whose prompt is up and its place in the row; each answer is shown as it comes; the button cannot be pressed again meanwhile',
    os.prompts.join() === [NOTES, MAIL, FINDER].join() && os.maxOnScreen === 1 && seen[0] === 'Asking Notes (1 of 3). Answer the macOS prompt. [1 on screen]' && seen[1] === 'Asking Mail (2 of 3). Answer the macOS prompt.' && seen[2] === 'Asking Finder (3 of 3). Answer the macOS prompt.' && /Notes=asking/.test(mid) && busy && !canWhile,
    seen.join(' | ') + ' | ' + mid);
  S.check('C2.04', 'the window coming back to the front while a prompt is up (it does, after every prompt) does not restart or disturb the row of requests', stillAsking, line(ac.view()));
  S.check('C2.05', 'allowed, not allowed, allowed: each row says so; the summary counts them and says the one thing that is true about "Not allowed": macOS will not ask again, only Settings can change it; the refused app gets a Settings button; nothing is left ticked',
    line(v) === 'Notes=allowed Mail=denied Finder=allowed Excel=closed Preview=closed TextEdit=closed' && v.note === '2 allowed, 1 not allowed. macOS asks only once per app: use Settings to change it.' && v.rows[1].settings && !v.rows[0].settings && v.selectedCount === 0 && !v.busy, line(v) + ' | ' + v.note);
  S.check('C2.06', 'honest count: exactly as many prompts as apps that were ticked and undecided (3); pressing the button again with nothing ticked does nothing', os.prompts.length === 3 && (await ac.start(), os.prompts.length === 3), String(os.prompts.length));

  /* ── denial → Settings → recovery; revoke ── */
  var p0 = os.prompts.length;
  os.apps[MAIL].perm = 0; v = await ac.refresh(); var mailBack = v.rows[1].status;
  os.apps[NOTES].perm = -1743; v = await ac.refresh();
  S.check('C2.07', 'Mail is switched on in System Settings and the window comes back to the front: Mail reads Allowed; Notes is switched off there: Notes reads Not allowed with a Settings button; neither change caused a prompt, and a refused app cannot be ticked (macOS would not ask)',
    mailBack === 'allowed' && v.rows[0].status === 'denied' && v.rows[0].settings && !v.rows[0].eligible && os.prompts.length === p0 && (ac.toggle(NOTES, true), ac.view().selectedCount === 0), line(v));

  /* the same revoke, seen from the menu bar and the popover */
  var sc = await C.Scene.build(C.Popover), sim = C.MenuBar.create(sc.mac);
  sim.activate(NOTES); sim.advance(1000); var was = sim.text();
  sim.perm[NOTES] = -1743; sc.mac.automationDenied[NOTES] = true; sim.advance(2500); var labelOff = sim.label();
  var pop = C.Popover.create(sc.mac.host), pv = await pop.opened({ bundleId: NOTES }), before = sc.mac.indexText(); var tryTag = await pop.addTag('Budget');
  sim.perm[NOTES] = 0; delete sc.mac.automationDenied[NOTES]; var onAt = sim.now; sim.advance(6000); var backAt = (sim.shows.filter(function (s) { return s.at >= onAt && s.state === 'tags'; })[0] || {}).at;
  pv = [pv, await pop.opened({ bundleId: NOTES })];
  S.check('C2.08', 'Notes is switched off in Settings while its tag is in the menu bar: the tag is cleared and the item says it is not allowed; the popover says the same, names Notes, and tags nothing; when Notes is switched on again the tag returns by itself and the popover shows the note',
    was === 'tags:Cost' && labelOff.state === 'off' && /not allowed to ask Notes/.test(labelOff.tooltip) && pv[0].target.reason === 'denied' && pv[0].target.app === 'Notes' && tryTag.tagMessage === 'Nothing is selected to tag.' && sc.mac.indexText() === before && sim.text() === 'tags:Cost' && pv[1].target.state === 'object' && sim.counts.prompts === 0,
    [was, labelOff.state, pv[0].target.reason, tryTag.tagMessage, sim.text(), pv[1].target.state].join(' | '));
  S.measure('revoke: switched on again in Settings → tag back in the menu bar (pretend ms; the setting is looked at every 5 s)', backAt - onAt);
  sc.cleanup();

  /* ── stopping, closed apps, failures ── */
  os = Prompts.create(FIRST); ac = C.Access.create(os.host); await ac.refresh();
  run = ac.start(); await until(function () { return os.waiting; }); os.waiting.answer('allow');
  await until(function () { return os.waiting && os.waiting.id === MAIL; }); ac.stop(); var stopNote = ac.view().note; os.waiting.answer('allow'); v = await run;
  S.check('C2.09', 'Stop while the second prompt is up: that prompt can still be answered, the third app is not asked, and the summary says how many were not asked', os.prompts.join() === [NOTES, MAIL].join() && stopNote === 'Stopping after this prompt…' && v.note === 'Stopped. 1 not asked. 2 allowed.' && line(v).indexOf('Finder=not-asked') >= 0, v.note + ' | ' + line(v));

  os = Prompts.create(FIRST); os.answer = function () { return 'allow'; }; ac = C.Access.create(os.host); await ac.refresh();
  ac.toggleAll(); var all = ac.view(), allNote = all.note; ac.toggleAll(); var noneTicked = ac.view().selectedCount; ac.toggle(EXCEL, true); var oneNote = ac.view().note;
  v = await ac.start();
  S.check('C2.10', 'closed apps are never ticked for you; ticking one says it will open; Select all ticks all six and says how many will open; only a ticked closed app is opened, in the background, and then asked',
    all.selectedCount === 6 && all.allSelected && allNote === 'macOS will ask 6 times, one prompt after another. 3 apps will open.' && noneTicked === 0 && oneNote === 'macOS will ask once. One app will open.' && os.opened.join() === EXCEL && os.prompts.join() === EXCEL && v.rows[3].status === 'allowed', allNote + ' | ' + oneNote + ' | opened ' + os.opened.join());
  os.failOpen['com.apple.Preview'] = true; ac.toggle('com.apple.Preview', true); v = await ac.start();
  S.check('C2.11', 'an app that does not open is reported as such, is not asked, and can be ticked again', v.rows[4].status === 'no-open' && v.rows[4].text === 'Did not open' && v.rows[4].eligible && os.prompts.indexOf('com.apple.Preview') < 0 && v.note === '1 not answered.', v.rows[4].text + ' | ' + v.note);

  /* ── when the window shows itself ── */
  var a1 = Prompts.create(FIRST), a2 = Prompts.create(FIRST); a2.apps[FINDER].perm = 0;
  var s1 = await C.Access.create(a1.host).shouldShowAtLaunch(true), s2 = await C.Access.create(a2.host).shouldShowAtLaunch(false), s3 = await C.Access.create(Prompts.create(FIRST).host).shouldShowAtLaunch(false);
  S.check('C2.12', 'at launch the window shows itself only when there is nothing to work with yet (no index and no app allowed); with an index, or with any app allowed, it stays away; deciding this prompts nothing and opens nothing', s1 === false && s2 === false && s3 === true && a1.prompts.length + a2.prompts.length + a1.opened.length + a2.opened.length === 0, [s1, s2, s3].join());
  var done = Prompts.create(FIRST); [NOTES, MAIL, FINDER].forEach(function (b) { done.apps[b].perm = 0; }); ['com.microsoft.Excel', 'com.apple.Preview', 'com.apple.TextEdit'].forEach(function (b) { done.apps[b].running = true; done.apps[b].perm = 0; });
  var dv = await C.Access.create(done.host).refresh();
  S.check('C2.13', 'everything allowed: nothing is ticked, the button is off, and the window says where to go next', dv.selectedCount === 0 && !dv.canRequest && !dv.canSelect && dv.note === 'All set. Click the tag icon in the menu bar.', dv.note);

  /* ── the page itself, in Chrome at the window's size (360 × 338) ── */
  var br = await C.browser(), shots = process.env.CONTEXT_SHOTS ? path.join(process.env.CONTEXT_SHOTS, 'access') : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  try {
    var po = Prompts.create(FIRST), pg = await (await br.newContext({ viewport: { width: 360, height: 338 }, deviceScaleFactor: 2 })).newPage(), errors = [];
    pg.on('pageerror', function (e) { errors.push(String(e)); });
    await pg.exposeFunction('__contextAccessTestCall', function (op, arg) { return po.call(op, arg); });
    await pg.goto('file://' + path.join(C.ROOT, 'app', 'Resources', 'access.html'));
    var launch = await pg.evaluate(function () { return window.contextAccessLaunch(false); });
    await pg.evaluate(function () { return window.contextAccessShown({}); }); await pg.waitForTimeout(80);
    async function snap(name) { if (shots) await pg.screenshot({ path: path.join(shots, name + '.png') }); }
    var rows = await pg.$$eval('#list .app', function (x) { return x.map(function (r) { return r.querySelector('.name').textContent + ': ' + r.querySelector('.st').textContent + (r.querySelector('input') && r.querySelector('input').checked ? ' [x]' : ''); }); });
    var btn = await pg.textContent('#requestBtn'), focus = await pg.evaluate(function () { return document.activeElement.getAttribute('data-key'); }), fits = await pg.evaluate(function () { return document.documentElement.scrollWidth <= 360 && document.documentElement.scrollHeight <= 338 && document.getElementById('list').scrollHeight <= document.getElementById('list').clientHeight + 1; });
    await snap('01-first-run');
    S.check('C2.14', 'the page at 360 × 338, first run: the launch rule asks for the window; six rows, three ticked, "Request selected (3)"; everything fits without scrolling; the keyboard starts on the first tick box',
      launch === 'show' && po.shown === 1 && rows.length === 6 && rows[0] === 'Notes: Not asked yet [x]' && rows[3] === 'Microsoft Excel: Not open. Opens when asked.' && btn === 'Request selected (3)' && fits && focus === 'tick:' + NOTES && errors.length === 0, JSON.stringify(rows) + ' ' + btn + ' fits=' + fits + ' focus=' + focus + ' ' + errors.join());
    /* keyboard only: untick Mail, press Return, answer prompts (the mock), Escape */
    await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Space'); var after1 = await pg.textContent('#requestBtn');
    await pg.keyboard.press('Space'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(80);
    var asking = await pg.textContent('#note'), doneText = await pg.textContent('#doneBtn'), reqText = await pg.textContent('#requestBtn'); await snap('02-asking-first-of-three');
    po.waiting.answer('allow'); await pg.waitForTimeout(60); po.waiting.answer('deny'); await pg.waitForTimeout(60); await snap('03-asking-third-of-three'); po.waiting.answer('allow'); await pg.waitForTimeout(80);
    var noteEnd = await pg.textContent('#note'), settingsBtn = await pg.$('[data-key="settings:' + MAIL + '"]'); await snap('04-two-allowed-one-refused');
    await settingsBtn.click(); await pg.keyboard.press('Escape'); await pg.waitForTimeout(40);
    S.check('C2.15', 'keyboard only: arrow to Mail, Space unticks (button says 2), Space ticks again, Return presses Request selected; while asking, the left button reads Stop; afterwards the refused row has a Settings… button that opens Automation settings; Escape closes the window',
      after1 === 'Request selected (2)' && asking === 'Asking Notes (1 of 3). Answer the macOS prompt.' && doneText === 'Stop' && reqText === 'Asking 1 of 3…' && noteEnd === '2 allowed, 1 not allowed. macOS asks only once per app: use Settings to change it.' && po.settingsOpened === 1 && po.closed === 1, [after1, asking, doneText, reqText, noteEnd, po.settingsOpened, po.closed].join(' | '));
    var sizes = await pg.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('button, #list label'), function (e) { var b = e.getBoundingClientRect(); return { what: (e.id || e.className || e.tagName) + ' ' + e.textContent.trim().slice(0, 18), w: Math.round(b.width), h: Math.round(b.height) }; }).filter(function (x) { return x.w > 0; }); });
    var small = sizes.filter(function (x) { return x.h < 20 || x.w < 20; });
    S.check('C2.16', 'every button and every tick-box row in the window is at least 20 × 20 points (the macOS minimum control size in Apple\'s accessibility guidance)', small.length === 0 && sizes.length >= 8, JSON.stringify(small));
    po.apps[MAIL].perm = 0; ['com.microsoft.Excel', 'com.apple.Preview', 'com.apple.TextEdit'].forEach(function (b) { po.apps[b].running = true; po.apps[b].perm = 0; });
    await pg.evaluate(function () { return window.contextAccessShown({}); }); await pg.waitForTimeout(80); await snap('05-all-set');
    var setNote = await pg.textContent('#note'), missingLine = await pg.textContent('#missing');
    S.check('C2.18', 'after the refused app is switched on in Settings and the rest are allowed, the window no longer repeats the old "1 not allowed" summary: it says all is set; the not-installed line names all five apps in full', setNote === 'All set. Click the tag icon in the menu bar.' && missingLine === 'Not installed: Keynote, Numbers, Pages, PowerPoint, Word' && await pg.evaluate(function () { var m = document.getElementById('missing'); return m.scrollWidth <= m.clientWidth; }), setNote + ' | ' + missingLine);
    var po2 = Prompts.create(); Object.keys(po2.apps).forEach(function (b, i) { po2.apps[b].running = i % 2 === 0 || i === 1; po2.apps[b].perm = i === 1 ? -1743 : -1744; });      /* Mail is open and was refused */
    var pg2 = await (await br.newContext({ viewport: { width: 360, height: 338 }, deviceScaleFactor: 2 })).newPage();
    await pg2.exposeFunction('__contextAccessTestCall', function (op, arg) { return po2.call(op, arg); });
    await pg2.goto('file://' + path.join(C.ROOT, 'app', 'Resources', 'access.html')); await pg2.evaluate(function () { return window.contextAccessShown({ focus: 'com.apple.mail' }); }); await pg2.waitForTimeout(80);
    var eleven = await pg2.evaluate(function () { var l = document.getElementById('list'); return { rows: l.querySelectorAll('.app').length, scrolls: l.scrollHeight > l.clientHeight + 1, wide: document.documentElement.scrollWidth, focus: document.activeElement.getAttribute('data-key'), visible: Array.prototype.filter.call(l.querySelectorAll('.app'), function (r) { var b = r.getBoundingClientRect(), lb = l.getBoundingClientRect(); return b.top >= lb.top - 1 && b.bottom <= lb.bottom + 1; }).length }; });
    if (shots) await pg2.screenshot({ path: path.join(shots, '06-eleven-apps-opened-from-denied-popover.png') });
    S.check('C2.17', 'all eleven apps installed: the list scrolls inside the same window (no wider, no taller); opened from the popover\'s "not allowed" state, the keyboard lands on that app\'s Settings… button', eleven.rows === 11 && eleven.scrolls && eleven.wide <= 360 && eleven.focus === 'settings:com.apple.mail', JSON.stringify(eleven));
    S.measure('window size (px): 0.10.3 → 0.11', '360 × 338 → 360 × 338');
    S.measure('rows visible without scrolling: six installed apps / eleven installed apps', rows.length + ' of 6 / ' + eleven.visible + ' of 11');
  } finally { await br.close(); }

  /* ── before and after, by what a person has to do ── */
  S.measure('first run, three open apps → all three requested: clicks in Context before (0.10.3, read from App.swift, not run)', '4 (three tick boxes + Request selected), or 2 with Select all, which also opens every closed app');
  S.measure('first run, three open apps → all three requested: clicks in Context after (0.11, mocked prompts)', '1 (Request selected; the three are ticked to begin with)');
  S.measure('macOS prompts to answer, before and after', '3 and 3 (one per app; Context cannot reduce, merge or answer them)');
  S.measure('window appears at launch: before → after', 'every launch → only when there is no index and no app is allowed yet (and whenever asked for)');
  S.measure('app was refused → reach the Automation setting: before → after', 'read the path and find it in System Settings → one button (popover or window) opens that pane');
  S.blocked('C2.N1', 'on a real Mac: the macOS prompt appears once per app, in order, with Context named; "Don\'t Allow" is reported as Not allowed; a closed app opens without coming to the front', 'needs macOS: prompts here are mocked');
  S.blocked('C2.N2', 'on a real Mac: the Settings… buttons open Privacy & Security › Automation; switching an app on or off there is picked up when the window returns to the front, by the popover, and by the menu-bar label within 5 s', 'needs macOS');
  S.blocked('C2.N3', 'on a real Mac: the App access window (a web view in the same 360 × 338 window) looks and behaves as in the Chrome render, and Return / Escape / arrows work in it', 'needs macOS: the Swift for the window (Access.swift) has not been compiled or run here');
};
