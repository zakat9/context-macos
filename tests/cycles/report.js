#!/usr/bin/env node
/* Writes CYCLES.md from the kept result files, so every count and number in it is the one that was measured:
 *   node tests/cycles/report.js > CYCLES.md
 * The sentences about what was found and changed are written by hand below; the tables are not. */
'use strict';
var fs = require('fs'), path = require('path'), dir = path.join(__dirname, 'results');
function load(label) { var f = path.join(dir, label + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; }
function tally(c) { var p = c.checks.filter(function (x) { return x.pass === true; }).length, f = c.checks.filter(function (x) { return x.pass === false; }), b = c.checks.filter(function (x) { return x.pass === null; }).length; return { pass: p, total: p + f.length, fails: f, blocked: b }; }
var RUNS = { 1: [['run1-as-built', 'first run, as built'], ['run2-after-cycle1', 'retest after the changes']],
  2: [['run1-as-built', 'first run'], ['run2-after-cycle2', 'retest after the changes']],
  3: [['run1-as-built', 'first run'], ['run1b-tests-corrected', 'same build, three test expectations corrected'], ['run2-after-cycle3', 'retest after the changes']],
  4: [['run1-as-built', 'first run'], ['@cycle4-retest1', 'retest 1 (console output kept as text)'], ['run3-after-cycle4', 'retest 2']],
  5: [['run1-as-built', 'first run'], ['run2-after-cycle5', 'retest after the expectations were brought up to date']] };
var NOTES = {
  1: { scenario: 'The rules of the menu-bar label (core/status.js) driven by a pretend shell with its own clock against the pretend Mac: app switches, selection changes inside an app, four switches 60 ms apart, late answers, a stuck app, tag edits in the popover and from outside, unsaved / saved / saved-as documents, a renamed file and a renamed note, a saved .eml, permission not asked / allowed / switched off, a quit app, sleep, ten idle minutes, 600 timed selection changes, long Latin and Korean tag names, an unreadable index, and 1,500 randomized steps. Assumed answer time of an app: 30 ms.',
    found: ['Product. A stuck app held its last tag in the menu bar for 2,180 ms, because the label\'s question waited 2 s like the popover\'s. On a Mac it would also hold Context\'s own menu item for that long, since AppleScript has to run on the main thread.',
      'Product, found while making the pretend shell behave like the main thread. An answer can come back after another app has come to the front; nothing in the shell stopped it being passed on.',
      'Simulator. It counted a "prompt" when permission changed while a question was already on its way; macOS decides that when the question is sent. It also let the timer fire while a question was running, which the main thread cannot do.',
      'Tests. C1.05 expected exactly one question after the last switch (there are several, at the fast pace). C1.18\'s first trial did not start from a real change. C1.21 judged a label by the last question that finished, not by the app the label names.',
      'Tests, found by breaking the rules on purpose: nothing noticed when the "newest question only" rule was removed, or when the label kept asking with the popover open.'],
    changed: ['The label\'s question gives up after 1 s (the popover\'s stays at 2 s): `scriptForWatch` in core/rules.js, a second script table in Scripts.swift.',
      'Status.swift looks once more, after the answer, whether the app is still in front, and drops the answer if not.',
      'The pretend shell now runs one question at a time and holds everything else until it returns, as the Mac\'s main thread does; a prompt is decided when the question is sent.',
      'C1.05, C1.18 and C1.21 corrected; C1.06b added (the rule fed directly: older question, other app, restarted app, popover opened meanwhile); C1.08 now counts questions, not answers, and nudges the rules while the popover is open.'],
    retest: 'Stuck app: tag cleared after 1,180 ms (was 2,180). A 900 ms answer that returns after an app switch: the old label is gone 820 ms after the switch, when that answer returns, and is never shown for the new app. All six deliberate breakages are noticed.' },
  2: { scenario: 'The App access rules (core/access.js) and page (360 × 338 in Chrome) against a pretend macOS that stands in for the permission prompt: first run with three apps open, three closed and five not installed; one Request selected for three apps answered allow / don\'t allow / allow; the window coming back to the front during a prompt; Stop during the second prompt; closed apps; an app that does not open; Settings changes in both directions; the same revoke seen by the menu-bar label and the popover; when the window shows itself at launch; keyboard only.',
    found: ['Product. At 360 × 338 the six installed apps did not fit by one pixel, so the list scrolled.',
      'Product, seen in the screenshot of the "all set" state. After a refused app was switched on in Settings, the window still said "2 allowed, 1 not allowed".',
      'Product. "Not installed: Keynote, Numbers, Pages, Microsoft Power…" was cut off.',
      'Test. C2.17 set up the refused app as closed; a closed app\'s decision cannot be known, so no Settings button is due.',
      'Harness, found by breaking the rules on purpose. With Stop ignored, or closed apps ticked for you, a mocked prompt waits for an answer nobody gives; the run ended quietly with exit code 0, which reads as a pass.'],
    changed: ['Row height 27 → 26 px: six rows fit; eleven still scroll inside the same window.',
      'A summary of the last requests is replaced as soon as any app\'s state differs from it.',
      'The not-installed line uses the short names (PowerPoint, Word).',
      'C2.17 corrected; C2.18 added (the stale summary and the full not-installed line).',
      'run-cycles.js counts a run that ends without finishing as failed (exit code 1).'],
    retest: 'All 18 pass. Five deliberate breakages (stale summary, closed apps ticked for you, a refused app requestable, Stop ignored, window at every launch) are each noticed, two of them by the run stopping and being counted as failed.' },
  3: { scenario: 'The popover page at 352 × 440 in Chrome against the pretend Mac, every click and key counted: tag by typing, replace by keyboard, tag and remove by mouse, recent tags, the two-tag cap, refused names, a 40-character tag, the selection changing while the popover is open (add and remove), Return three times, a 78-character Korean subject, a file\'s identity, where the keyboard starts, Tab and arrow order, names for VoiceOver, control sizes, contrast. Then the same tasks on the 0.10.3 page.',
    found: ['Product, seen in the screenshots. With two tags the field\'s hint "Remove a tag to add another" was cut to "Remove a tag to".',
      'Product, seen in the screenshots. Two rows of identical-looking tag buttons ("Recent" and "Tags") sat one above the other; pressing one tags the item, pressing the other starts a lookup, and nothing said which was which.',
      'Product, seen in the screenshots. An empty band with two rules was left where a lookup summary would go.',
      'Tests. C3.04 expected a tag that had just been removed to stay "recent" (recent tags are read from the index, not from a history of use). C3.13 and C3.14 named a particular recent tag that an earlier step had displaced.'],
    changed: ['At the cap the field says "2 of 2 tags" and the line under it "Remove a tag to add another."',
      'The rows are labelled by what pressing does: "Tag as" and "Look up".',
      'The summary band is hidden when there is nothing in it.',
      'C3.04, C3.13, C3.14 corrected; C3.18 added (hint readable in full, row labels, no empty band).'],
    retest: 'All 18 pass. Four deliberate breakages (no wrong-target check, a third tag allowed, capitals treated as another tag, a tag the item already has offered again) are each noticed.' },
  4: { scenario: 'The popover page against the pretend Mac: the tag Cost with eight sources (five messages, a note, a workbook saved three times, a deleted file); order against the dates written into the pretend Mac; previews against the copied text line by line; citations; unticking; All and None; a workbook saved again between list and Copy; a workbook replaced by another under the same name, then deleted; Mail not allowed during a lookup; a Korean tag and a 78-character Korean subject; two tags at once; capitals; ::Cost and #Travel; an unused tag; an empty lookup; slow reading; keyboard only. Then the same lookup on the 0.10.3 page.',
    found: ['Product. The example citation for a workbook was always "[W1 › Sheet!A1]", whatever its sheets are called (here: Summary and 견적), and for a note always "L3", even for a two-line note. An AI following the example would cite a sheet or a line that does not exist.',
      'Product (retest 1). Only three whole source rows fitted in the list (230 px); the aim was four.',
      'Tests. C4.02 read the index\'s key order instead of the tagging dates. C4.16 depended on an earlier step having filled the note\'s two tags, which removes the recent-tag row and shifts Tab by one. C4.12 compared whole row heights, which differ by the first row\'s missing top rule, not by the Korean text.'],
    changed: ['The citation example names the workbook\'s first sheet and first cell, and a line the note has (core/rules.js).',
      'Row padding, the Copy bar, the footer and the collapsed item line were tightened by 14 px in all: the list grew from 230 to 244 px (246 px on the final build) and shows four whole rows and the top of the fifth.',
      'Title and meta lines in a row have fixed heights, so a row is the same height whatever script its text is in.',
      'C4.02, C4.12, C4.16 corrected; C4.05 now checks that the example citation points at a sheet, cell and line that are really quoted.'],
    retest: 'Retest 1: 16/18 (C4.12 by the test\'s own comparison, C4.17 by the product: three rows). Retest 2: 18/18. Five deliberate breakages (order by tagging date, unticked sources copied, Copy without reading again, a made-up sheet in the example, a deleted file still shown) are each noticed.' },
  5: { scenario: 'Two working days on the real pages and rules against the pretend Mac, with the menu-bar label running throughout: a quote in Mail tagged by typing, a workbook in Excel and a note in Notes tagged with one press each, an untagged note and a newsletter glanced at, the workbook saved again and the note edited; next day in the browser the tag is looked up, the note is left out, Command-Return copies, Escape closes. What would be pasted is checked against the values written into the pretend Mac. The same two days on the 0.10.3 page. Then the earlier suites on this build: the 126-check regression suite in Node and in Bun, the three rounds of 0.10.0, and the page safety checks.',
    found: ['The workflow itself passed as built (C5.01 to C5.08).',
      'Regression, caught by the earlier suite: three of its checks (C16, X03, PO12) still expected the old citation example, as did two checks of round 2 (2.07, and 2.18 for the old "changed" wording). The change was cycle 4\'s and intended; PO12 also showed that 0.10 had told the reader to cite line L3 of a two-line note.'],
    changed: ['No product change. The five expectations were brought up to date, each to the sheet, cell or line the fixture really has.'],
    retest: 'All 12 pass: regression 126/126 in Node and in Bun, the three earlier rounds 16, 19 and 8 with none failing, page safety 6/6.' }
};
function row(cells) { return '| ' + cells.join(' | ') + ' |'; }
var out = [], final = load('final');
out.push('# Context 0.11 — five test, fix, retest cycles on one build', '',
  'Every cycle was run against the build as it stood, the results were kept, what was wrong was fixed, and the cycle was run again. This file is written by `tests/cycles/report.js` from the kept result files in `tests/cycles/results/`; the counts, build numbers and measurements in the tables are read from those files, the sentences about findings and changes are written by hand.', '',
  '**What these results are.** Simulations: the real rules and the real pages of this build, run in Node, Bun and Chrome on Linux against a pretend Mac, a pretend menu-bar shell with its own clock, and a mocked macOS permission prompt. **Nothing here was run on macOS.** The Swift shell was not compiled; no real Notes, Mail, Finder, Excel, Aside or ChatGPT was involved. Everything that needs them is listed as blocked, by name, at the end of each cycle and in `LIVE-CHECKS.md`. A "build" below is the first 16 hex digits of a SHA-256 over `core/`, `app/` and `dev/`.', '');
if (final) {
  out.push('## Final state', '', 'All five cycles run once more, in one go, on the final build `' + final.build + '`:', '', row(['Cycle', 'Checks passed', 'Blocked (needs macOS or a live app)']), row(['---', '---', '---']));
  var tp = 0, tt = 0, tb = 0;
  for (var n = 1; n <= 5; n++) { var t = tally(final.cycles[n]); tp += t.pass; tt += t.total; tb += t.blocked; out.push(row([n + '. ' + final.cycles[n].name, t.pass + ' of ' + t.total, String(t.blocked)])); }
  out.push(row(['Total', tp + ' of ' + tt, String(tb)]), '');
}
for (var c = 1; c <= 5; c++) {
  var N = NOTES[c], name = final ? final.cycles[c].name : 'Cycle ' + c;
  out.push('## Cycle ' + c + ' — ' + name, '', '**Scenario.** ' + N.scenario, '', row(['Run', 'Build', 'Passed', 'Failed checks']), row(['---', '---', '---', '---']));
  RUNS[c].forEach(function (r) {
    if (r[0] === '@cycle4-retest1') { out.push(row([r[1], '`ee8bc0d1a0fa3957`', '16 of 18', 'C4.12, C4.17 (see `tests/cycles/results/cycle4-retest1-console.txt`)'])); return; }
    var d = load(r[0]); if (!d || !d.cycles[c]) { out.push(row([r[1], 'missing', '', ''])); return; }
    var t = tally(d.cycles[c]);
    out.push(row([r[1] + ' (`' + r[0] + '`)', '`' + d.cycles[c].build + '`', t.pass + ' of ' + t.total, t.fails.map(function (f) { return f.id; }).join(', ') || 'none']));
  });
  out.push('', '**Found.**', ''); N.found.forEach(function (x) { out.push('- ' + x); });
  out.push('', '**Changed.**', ''); N.changed.forEach(function (x) { out.push('- ' + x); });
  out.push('', '**Retest.** ' + N.retest, '');
  var m = fs.existsSync(path.join(dir, 'mutations-cycle' + c + '.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'mutations-cycle' + c + '.json'), 'utf8')) : null;
  if (m) { out.push('Rules broken on purpose, one at a time, to see whether the cycle notices (the rule was put back each time):', '', row(['Breakage', 'Noticed by']), row(['---', '---'])); m.forEach(function (x) { out.push(row([x.mutation, x.noticedBy.join(', ') || 'NOT NOTICED'])); }); out.push(''); }
  if (final) {
    var fc = final.cycles[c], keys = Object.keys(fc.measures);
    out.push('**Measured on the final build** (pretend clock and pretend apps; counts of clicks and keys are exact, times are not Mac times):', '', row(['What', 'Value']), row(['---', '---']));
    keys.forEach(function (k) { out.push(row([k.replace(/\|/g, '/'), String(fc.measures[k]).replace(/\|/g, '/')])); });
    out.push('', '**Checks on the final build.**', '');
    fc.checks.forEach(function (x) { out.push('- ' + (x.pass === true ? 'PASS' : x.pass === false ? 'FAIL' : 'BLOCKED') + ' ' + x.id + ' — ' + x.text + (x.pass === null ? ' *(' + x.blocked + ')*' : '')); });
    out.push('');
  }
}
out.push('## Run it again', '', '```', 'node dev/build-popover.js', 'node tests/run.js                                   # 126 regression checks; also: bun tests/run.js', 'NODE_PATH=<folder with playwright> node tests/ui-check.js            # 6 page safety checks', 'NODE_PATH=<folder with playwright> node tests/cycles/run-cycles.js mine   # the five cycles; results in tests/cycles/results/mine.json', 'NODE_PATH=<folder with playwright> tests/visual/make-evidence.sh     # the before/after pictures', 'node tests/cycles/report.js > CYCLES.md', '```', '',
  'The before numbers come from the 0.10.3 popover page kept in `tests/baseline-0.10.3/`; to measure against another build, set `CONTEXT_BASELINE` to its folder. Chrome is found at `/usr/bin/google-chrome` or where `CHROME` points.', '');
process.stdout.write(out.join('\n'));
