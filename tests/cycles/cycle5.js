/* Cycle 5 — one office workflow from start to finish, to Copy context for an AI chat (Aside, ChatGPT or any other),
 * with only the selected sources in it; then the earlier regression suites again.
 * The workflow runs the real pages and rules against the pretend Mac. No AI is called: what is checked is the text
 * that would be pasted. Live Aside and ChatGPT are in the blocked list. */
'use strict';
var fs = require('fs'), path = require('path'), cp = require('child_process');

module.exports = async function (S, C) {
  var L = C.L, NOTES = L.NOTES, MAIL = L.MAIL, EXCEL = 'com.microsoft.Excel', ASIDE = 'com.example.aside-browser';
  var NOTE = 'x-coredata://FICTIONAL-0005/ICNote/p1', LUNCH = 'x-coredata://FICTIONAL-0005/ICNote/p2';
  var br = await C.browser(), shots = process.env.CONTEXT_SHOTS ? path.join(process.env.CONTEXT_SHOTS, 'cycle5') : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });

  /* the same two working days, on this build and on 0.10.3 */
  function world(dir) {
    var mac = L.Mac.create(dir);
    mac.addMail({ numericId: '9001', messageId: '20261118.1010.q3@harborline-tooling.example', subject: 'Final quote: Pine Ridge housing mold', sent: '2026-11-18T10:10:00', account: 'Work', mailbox: 'INBOX', from: 'Dana Okafor <dana.okafor@harborline-tooling.example>',
      text: 'Hi Mina,\n\nFinal quote for the Pine Ridge housing mold: USD 48,500, P20 steel, 6 weeks.\n\nDana' });
    mac.addMail({ numericId: '9002', messageId: '20261118.1500.news@vendor-news.example', subject: 'Weekly tooling newsletter', sent: '2026-11-18T15:00:00', account: 'Work', mailbox: 'INBOX', from: 'News <news@vendor-news.example>', text: 'UNTAGGED-CANARY-NEWSLETTER: molds are 12% off this week.' });
    mac.addNote({ id: NOTE, title: 'Call with Jonas about the cap', created: '2026-11-18T16:00:00', modified: '2026-11-18T16:20:00', text: 'Call with Jonas about the cap\nJonas agrees to USD 55,000.\nPRIVATE-CANARY: he is unhappy with Kestrel.' });
    mac.addNote({ id: LUNCH, title: 'Lunch order', created: '2026-11-18T12:00:00', modified: '2026-11-18T12:00:00', text: 'UNTAGGED-CANARY-LUNCH: two bibimbap.' });
    var wb = mac.write('tooling-budget.xlsx', L.workbook(2));
    return { mac: mac, wb: wb, dir: dir };
  }

  try {
    /* ══ after: this build ══ */
    var W = world(C.temp('context-e2e')), mac = W.mac, sim = C.MenuBar.create(mac), closes = 0;
    var pg = await C.popoverPage(br, C.ROOT, mac, { close: function () { closes++; } }), H = C.hands(pg), iconClicks = 0, glances = [];
    async function listed() { await pg.waitForFunction(function () { return document.getElementById('sources').getAttribute('aria-busy') === 'false' && !/Checking/.test(document.getElementById('copyBtn').textContent); }); await pg.waitForTimeout(60); }
    async function icon(app, name) { iconClicks++; sim.popover(true); sim.activate(C.MenuBar.OWN, { popover: true }); await pg.open(app, name); }
    async function closePopover(app) { await H.key('Escape'); sim.popover(false); sim.activate(app); sim.advance(1000); }
    function glance(what) { glances.push(what + ': ' + sim.text()); return sim.text(); }
    async function snap(name) { if (shots) await pg.screenshot({ path: path.join(shots, name + '.png') }); }

    /* day 1, morning: the quote arrives */
    mac.select(MAIL, ['9001']); sim.activate(MAIL); sim.advance(1000); var g1 = glance('quote in Mail, before');
    await icon(MAIL, 'Mail'); await H.type('Cost'); await H.key('Enter'); sim.saved(); sim.advance(0); var duringPopover = sim.text(); await closePopover(MAIL); var g2 = glance('quote in Mail, after');
    /* the budget workbook, open in Excel */
    mac.openDocument[EXCEL] = W.wb; sim.activate(EXCEL); sim.advance(1000); var g3 = glance('workbook in Excel, before');
    await icon(EXCEL, 'Microsoft Excel'); await H.click('[data-key="chip:tag:Cost"]'); sim.saved(); await closePopover(EXCEL); var g4 = glance('workbook in Excel, after');
    /* afternoon: a call note; and two things that must stay out */
    mac.select(NOTES, [NOTE]); sim.activate(NOTES); sim.advance(1000);
    await icon(NOTES, 'Notes'); await H.click('[data-key="chip:tag:Cost"]'); sim.saved(); await closePopover(NOTES); var g5 = glance('call note in Notes, after');
    mac.select(NOTES, [LUNCH]); sim.advance(2500); var g6 = glance('lunch note');
    mac.select(MAIL, ['9002']); sim.activate(MAIL); sim.advance(1000); var g7 = glance('newsletter');
    var day1 = { clicks: H.clicks, keys: H.keys, typed: H.typed, icon: iconClicks };
    S.check('C5.01', 'day 1: three sources are tagged Cost from three apps (typed once in Mail, then one press of the recent tag in Excel and in Notes); each time the menu bar goes from an outlined tag to "Cost" (already while the popover is still open) and still says Cost when back in the app; the lunch note and the newsletter show no tag, so nothing has to be opened to know they are out',
      g1 === 'none' && duringPopover === 'tags:Cost' && g2 === 'tags:Cost' && g3 === 'none' && g4 === 'tags:Cost' && g5 === 'tags:Cost' && g6 === 'none' && g7 === 'none' && Object.keys(mac.objects()).length === 3 && closes === 3, glances.join(' ; '));
    /* evening: the workbook is saved again with the approved numbers */
    fs.writeFileSync(W.wb, L.workbook(3)); sim.activate(EXCEL); sim.advance(1000); var g8 = glance('workbook after saving again');
    mac.notes[NOTE].text = 'Call with Jonas about the cap\nJonas agrees to USD 55,000, in writing by Friday.\nPRIVATE-CANARY: he is unhappy with Kestrel.'; mac.notes[NOTE].modified = '2026-11-18T18:05:00';
    S.check('C5.02', 'the workbook is saved again and the note is edited: nothing has to be done in Context, and the workbook still shows its tag (same file, same entry)', g8 === 'tags:Cost' && Object.keys(mac.objects()).length === 3, g8);

    /* day 2: in the browser, about to ask the AI */
    sim.activate(ASIDE, { name: 'Aside' }); sim.advance(1000); var g9 = glance('in the browser'), asksBrowser = sim.counts.asks; sim.advance(60000);
    mac.clipboard = 'WHAT-WAS-ON-THE-CLIPBOARD'; H = C.hands(pg);
    await icon(ASIDE, 'Aside'); var noneMsg = await pg.textContent('#noneMsg'), f0 = await pg.evaluate(function () { return document.activeElement.id; });
    await H.type('Cost'); await H.key('Enter'); await listed(); await snap('01-day2-lookup-from-the-browser');
    var rows = await pg.$$eval('#sources .src', function (x) { return x.map(function (r) { return r.querySelector('.badge').textContent + ' ' + r.querySelector('.meta').textContent + ' | ' + r.querySelector('.ex').textContent; }); });
    var noteId = 'applenotes:' + NOTE, before = mac.clipboard;
    await H.click('[data-key="tick:' + noteId + '"]'); var btn = (await pg.textContent('#copyBtn')).replace('⌘↩', '').trim(); await snap('02-day2-note-left-out');
    await H.key('Meta+Enter'); await pg.waitForTimeout(150); var msg = await pg.textContent('#copyMsg'); await snap('03-day2-copied');
    await H.key('Escape'); sim.popover(false); sim.activate(ASIDE, { name: 'Aside' });
    var pasted = mac.clipboard, parsed = L.parseContext(pasted), secW = parsed.filter(function (s) { return s.label === 'W1'; })[0], secE = parsed.filter(function (s) { return s.label === 'E1'; })[0];
    var day2 = { clicks: H.clicks, keys: H.keys, typed: H.typed, icon: 1 };
    S.check('C5.03', 'day 2, in the browser: the menu-bar item is dimmed and the browser is asked nothing; the popover opens straight on the lookup field; "Cost" lists the three sources by their own dates, each as it is saved now (the workbook with the evening\'s numbers, the note with its edit)',
      g9 === 'off' && sim.counts.asks === asksBrowser && f0 === 'lookupField' && /Select one note, mail message or saved file/.test(noneMsg) && rows.length === 3 && /^E1 Email, sent Nov 18, 2026 10:10/.test(rows[0]) && /^W1 Workbook, last saved Nov 18, 2026 16:40 \| .*B1: \$55,000\.00/.test(rows[1]) && /^N1 Note, last saved Nov 18, 2026 18:05 \| .*in writing by Friday/.test(rows[2]), rows.join(' ; ') + ' | ' + g9 + ' | ' + f0);
    S.check('C5.04', 'the call note is unticked and Command-Return copies: until then the clipboard is untouched; afterwards it holds exactly the two ticked sources, says it is 2 of 3, and has no trace of the note, the lunch note or the newsletter',
      before === 'WHAT-WAS-ON-THE-CLIPBOARD' && btn === 'Copy 2 of 3' && msg === '✓ Copied 2 sources. Paste it into your AI chat. Nothing was sent.' && parsed.filter(function (s) { return s.label; }).map(function (s) { return s.label; }).join() === 'E1,W1' && /This copy holds 2 of the 3 sources linked to ::Cost/.test(pasted) && !/CANARY|Jonas agrees|Call with Jonas|bibimbap|newsletter|12% off/i.test(pasted) && mac.counts.copyText === 1, btn + ' | ' + msg + ' | ' + parsed.map(function (s) { return s.label; }).join());
    S.check('C5.05', 'what would be pasted answers the question with current values and citable sources: quote USD 48,500 in the message [E1]; cap $55,000.00 in cell B1 and quote $48,500.00 in B2 of the workbook [W1]; none of the workbook\'s earlier numbers (50,000 or 48,234); each source with its date and kind of date',
      /USD 48,500/.test(secE.quoted.join('\n')) && L.cellLine(secW, 'Summary', 'B1') === '$55,000.00' && L.cellLine(secW, 'Summary', 'B2') === '$48,500.00' && !/50,000\.00|48,234/.test(pasted) && secE.dateKind === 'sent' && secW.dateKind === 'last saved' && /Cite cells as \[W1 › Summary!A1\]/.test(pasted) && /Cite the message as \[E1\]/.test(pasted), (secW ? secW.quoted.slice(0, 3).join(' / ') : 'no W1'));
    var sendingApis = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'URLSession', 'NSSharingService'].filter(function (x) { return ['core/popover.html', 'core/popover.js', 'core/rules.js', 'core/read.js', 'core/status.js', 'core/access.js', 'core/access.html', 'app/Sources/App.swift', 'app/Sources/Bridge.swift', 'app/Sources/Host.swift', 'app/Sources/Status.swift', 'app/Sources/Access.swift'].some(function (f) { return fs.readFileSync(path.join(C.ROOT, f), 'utf8').indexOf(x) >= 0; }); });
    S.check('C5.06', 'nothing is sent anywhere: the page and the app contain no call that could send (checked as text), the page asked the Mac for nothing outside its twelve requests, and copying was requested once, by Copy', sendingApis.length === 0 && pg.asked.every(function (op) { return 'selection readNote readMail readFile readIndex indexStamp writeIndex copyText close quit access settings'.split(' ').indexOf(op) >= 0; }) && pg.errors.length === 0, sendingApis.join() + ' ' + pg.errors.join());
    S.check('C5.07', 'over both days the menu-bar label caused no prompt and opened no app, and the index holds three entries with the fields of an entry and nothing of their contents', sim.counts.prompts === 0 && sim.counts.launches === 0 && Object.keys(mac.objects()).length === 3 && !/48,500|55,000|Jonas agrees|CANARY/.test(mac.indexText()) && Object.keys(mac.objects()).every(function (k) { return Object.keys(mac.objects()[k]).sort().join() === C.Core.RECORD_FIELDS.slice().sort().join(); }), JSON.stringify(sim.counts));
    var afterTotal = { tag: day1.icon + day1.clicks + day1.keys + day1.typed, copy: day2.icon + day2.clicks + day2.keys + day2.typed };
    S.measure('day 1 (tag three sources from three apps): actions after', afterTotal.tag + ' = 3 icon clicks + ' + day1.clicks + ' clicks + ' + day1.keys + ' keys + ' + day1.typed + ' typed');
    S.measure('day 2 (look up, leave one out, copy, close): actions after', afterTotal.copy + ' = 1 icon click + ' + day2.clicks + ' click + ' + day2.keys + ' keys + ' + day2.typed + ' typed');
    S.measure('checking whether five items are tagged (three tagged, two not): actions after', '0 (read from the menu bar)');
    fs.mkdirSync(path.join(C.ROOT, 'demo'), { recursive: true });
    fs.writeFileSync(path.join(C.ROOT, 'demo', 'sample-copied-context.md'), pasted.split(W.dir).join('/Users/mina/Work'));
    C.remove(W.dir);

    /* ══ before: 0.10.3, the same two days ══ */
    var base = C.baseline();
    if (base) {
      var B = world(C.temp('context-e2e-before')), mb = B.mac, pb = await C.popoverPage(br, base, mb), HB = C.hands(pb), iconB = 0;
      async function iconBefore(app, name) { iconB++; await pb.open(app, name); }
      mb.select(MAIL, ['9001']); await iconBefore(MAIL, 'Mail'); await HB.type('Cost'); await HB.key('Enter'); await HB.key('Escape');
      mb.openDocument[EXCEL] = B.wb; await iconBefore(EXCEL, 'Microsoft Excel'); await HB.click('#tagChips .chip:has-text("Cost")'); await HB.click('#saveBtn'); await HB.key('Escape');
      mb.select(NOTES, [NOTE]); await iconBefore(NOTES, 'Notes'); await HB.click('#tagChips .chip:has-text("Cost")'); await HB.click('#saveBtn'); await HB.key('Escape');
      var tagB = iconB + HB.total(), okTag = Object.keys(mb.objects()).length === 3;
      /* to know whether an item is tagged, 0.10.3 has to be opened on it and closed again */
      var checkB = 0; for (var i = 0; i < 5; i++) { checkB += 2; }
      fs.writeFileSync(B.wb, L.workbook(3)); mb.notes[NOTE].text = 'Call with Jonas about the cap\nJonas agrees to USD 55,000, in writing by Friday.\nPRIVATE-CANARY: he is unhappy with Kestrel.'; mb.notes[NOTE].modified = '2026-11-18T18:05:00';
      HB = C.hands(pb); iconB = 0; await iconBefore(ASIDE, 'Aside'); var fB = await pb.evaluate(function () { return document.activeElement.id; });
      await HB.type('Cost'); await HB.key('Enter'); await pb.waitForFunction(function () { return document.querySelectorAll('#sources .src').length === 3; }); await pb.waitForTimeout(80);
      var needScroll = await pb.evaluate(function (id) { var s = document.getElementById('sources'), e = s.querySelector('input[data-id="' + id + '"]'), a = e.getBoundingClientRect(), b = s.getBoundingClientRect(); return !(a.top >= b.top && a.bottom <= b.bottom); }, 'applenotes:' + NOTE);
      if (needScroll) { HB.clicks++; HB.log.push('scroll the list to the note'); await pb.evaluate(function (id) { document.querySelector('#sources input[data-id="' + id + '"]').scrollIntoView({ block: 'center' }); }, 'applenotes:' + NOTE); }
      await HB.click('#sources input[data-id="applenotes:' + NOTE + '"]'); await HB.click('#copyBtn'); await pb.waitForTimeout(150); await HB.key('Escape');
      var pastedB = L.parseContext(mb.clipboard || '').filter(function (s) { return s.label; }).map(function (s) { return s.label; }).join(), copyB = iconB + HB.total();
      S.check('C5.08', 'the before numbers were taken from the 0.10.3 page doing the same two days with the same result (three entries; E1 and W1 copied)', okTag && pastedB === 'E1,W1' && fB === 'lookupField', okTag + ' ' + pastedB + ' ' + fB);
      S.measure('day 1 (tag three sources from three apps): actions before → after', tagB + ' → ' + afterTotal.tag);
      S.measure('day 2 (look up, leave one out, copy, close): actions before → after', copyB + (needScroll ? ' (incl. one scroll to reach the note in the list)' : '') + ' → ' + afterTotal.copy);
      S.measure('checking whether five items are tagged: actions before → after', checkB + ' (open and close the popover on each) → 0');
      C.remove(B.dir);
    } else S.blocked('C5.08', 'before numbers from the 0.10.3 page', 'the 0.10.3 build was not found (set CONTEXT_BASELINE)');
  } finally { await br.close(); }

  /* ══ the earlier suites, on this same build ══ */
  function run(cmd, args, env) { try { return cp.execFileSync(cmd, args, { cwd: C.ROOT, env: Object.assign({}, process.env, env || {}), stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000 }).toString(); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } }
  var reg = run(process.execPath, ['tests/run.js']), regLine = (reg.match(/== (\d+)\/(\d+) checks passed.*==/) || [])[0] || 'no summary';
  S.check('C5.09', 'the regression suite carried over from 0.10 (rules, readers, current-state, command line, static checks, Mac reply parsing, Swift as text, popover rules, connector, speed), updated only where wording or structure changed on purpose', /== (\d+)\/\1 checks passed ==/.test(regLine), regLine + (reg.match(/FAIL[^\n]*/g) || []).slice(0, 4).join(' | '));
  S.measure('regression suite (Node)', regLine.replace(/=/g, '').trim());
  var bun = ['/root/.bun/bin/bun', '/usr/local/bin/bun'].filter(function (x) { return fs.existsSync(x); })[0];
  if (bun) { var regB = run(bun, ['tests/run.js']), lineB = (regB.match(/== (\d+)\/(\d+) checks passed.*==/) || [])[0] || 'no summary'; S.check('C5.10', 'the same suite in JavaScriptCore (Bun), the engine family the Mac app runs the rules in', /== (\d+)\/\1 checks passed ==/.test(lineB), lineB + (regB.match(/FAIL[^\n]*/g) || []).slice(0, 4).join(' | ')); S.measure('regression suite (Bun, JavaScriptCore)', lineB.replace(/=/g, '').trim()); }
  else S.blocked('C5.10', 'the same suite in JavaScriptCore', 'Bun is not on this machine');
  var rounds = run(process.execPath, ['tests/rounds/run-rounds.js', 'cycle5-rerun']), roundLines = rounds.split('\n').filter(function (l) { return /^Round \d/.test(l) || /passed/.test(l); });
  var roundFile = path.join(C.ROOT, 'tests', 'rounds', 'results', 'cycle5-rerun.json'), rr = fs.existsSync(roundFile) ? JSON.parse(fs.readFileSync(roundFile, 'utf8')) : null;
  var tally = rr ? Object.keys(rr.rounds || {}).map(function (k) { var c = rr.rounds[k].checks || [], f = c.filter(function (x) { return x.pass === false; }).length, p = c.filter(function (x) { return x.pass === true; }).length; return { round: k.replace('r', ''), pass: p, fail: f, other: (rr.rounds[k].blocked || []).length }; }) : [];
  S.check('C5.11', 'the three rounds of 0.10.0 (speed; current context; AI handoff), run again on this build: no check that passed then fails now', tally.length === 3 && tally.every(function (t) { return t.fail === 0 && t.pass > 0; }), JSON.stringify(tally) + ' ' + roundLines.slice(0, 6).join(' | ').slice(0, 300));
  S.measure('the three earlier rounds on this build (simulated checks passed / failed; live items still blocked)', tally.map(function (t) { return 'round ' + t.round + ': ' + t.pass + ' / ' + t.fail + '; ' + t.other + ' blocked'; }).join(' — '));

  var pages = run(process.execPath, ['tests/ui-check.js']), pagesLine = (pages.match(/== (\d+)\/(\d+) page safety checks passed.*==/) || [])[0] || 'no summary';
  S.check('C5.12', 'the page safety checks carried over from 0.10 (markup never run, the 900 → 820 acceptance test in the page, nothing kept after closing, no requests of the pages\' own), now on both pages', /== (\d+)\/\1 page safety checks passed ==/.test(pagesLine), pagesLine + (pages.match(/FAIL[^\n]*/g) || []).join(' | '));
  S.measure('page safety checks', pagesLine.replace(/=/g, '').trim());

  S.blocked('C5.N1', 'live: paste the copied text into Aside\'s assistant and into ChatGPT, ask the question, and score the answer against the answer key', 'needs the real apps and accounts: no AI was called here; what is checked is the text that would be pasted');
  S.blocked('C5.N2', 'live: Aside looks a tag up directly, without Copy', 'no verified Aside interface for this exists in this build; Copy context is the route');
  S.blocked('C5.N3', 'on a real Mac: the same two days with Mail, Excel and Notes, the menu-bar label visible throughout, and Escape handing the keyboard back to the app', 'needs macOS: the Swift shell has not been compiled or run here');
};
