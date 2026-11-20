#!/usr/bin/env node
/* Writes QA-REPORT.md from the result files of the three rounds:  node tests/rounds/report.js */
'use strict';
var fs = require('fs'), path = require('path'), L = require('./lib.js');
var dir = path.join(__dirname, 'results');
function load(n) { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (e) { return null; } }
var before = load('run1-as-built.json'), mid = load('run2-after-fixes.json'), after = load('run3-final.json'), reg = load('regression.json') || {};
if (!after) { console.error('No results yet. Run: node tests/rounds/run-rounds.js run3-final'); process.exit(1); }
var out = [];
function p(s) { out.push(s == null ? '' : s); }
function ms(x) { return x >= 100 ? Math.round(x) + ' ms' : (+x.toFixed(1)) + ' ms'; }
function mp(s) { return ms(s.median) + ' / ' + ms(s.p95); }
function tally(r) { var f = r.checks.filter(function (c) { return !c.pass; }).length; return (r.checks.length - f) + ' of ' + r.checks.length; }
function cell(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function failures(r) { return r.checks.filter(function (c) { return !c.pass; }); }
var e = after.environment;

p('# Work Index 0.10.0: three-round QA report');
p();
p('Run on ' + (function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); })(new Date(after.at)) + ' (Asia/Seoul). Build `' + after.buildHash + '` (a hash over `core/`, `app/` and `dev/`). ' + (before && mid ? 'The three rounds were run on the build as it stood (`' + before.buildHash + '`); the failures were fixed and the rounds run again (`' + mid.buildHash + '`), which showed one more speed failure; that was fixed and every round was run a third time on the final build.' : ''));
p();
p('**Read this first.** Every result below is a simulation: the product\'s rules, readers and popover logic run for real against deterministic synthetic sources whose truth was written down beforehand, on a pretend Mac. **The Mac app was not compiled or run, and no Aside or ChatGPT session took place.** Those items are listed as BLOCKED under each round. A blocked item is not a pass.');
p();
p('| Round | Run 1: build as it stood | Run 2: after the first fixes | Run 3: final build | Blocked (not run) |');
p('|---|---|---|---|---|');
[['r1', '1. Speed'], ['r2', '2. Context'], ['r3', '3. AI handoff']].forEach(function (x) {
  p('| ' + x[1] + ' | ' + (before && before.rounds[x[0]] ? tally(before.rounds[x[0]]) + ' pass' : 'not run') + ' | ' + (mid && mid.rounds[x[0]] ? tally(mid.rounds[x[0]]) + ' pass' : 'not run') + ' | **' + tally(after.rounds[x[0]]) + ' pass** | ' + after.rounds[x[0]].blocked.length + ' |');
});
p();
p('Counts are simulated checks. Checks were added between runs (a second-opinion check in round 2, coldest-start timings in round 1), so the totals grow.');
p();
p('Product criterion (Work Index + Aside must beat Aside alone on context quality): **UNVERIFIED**. No live Aside baseline could be run, and a stand-in is not offered as proof. See round 2.');
p();
p('Environment: ' + e.platform + ', ' + e.cpu + ' (' + e.cores + ' cores), ' + e.memoryGb + ' GB, Node ' + e.node + ' (' + e.engine + '), time zone ' + e.timeZone + '. All inputs are fictional and generated from fixed seeds; nothing was read from a real mailbox, note or file, and nothing was sent anywhere.');

/* ───────── round 1 ───────── */
var r1 = after.rounds.r1, b1 = before && before.rounds.r1, m1 = mid && mid.rounds.r1;
p(); p('## Round 1: Speed'); p();
p('Synthetic data: 100, 1,000 and 10,000 distinct tagged records (notes, message files and workbooks on disk), of which 12 carry the tag looked up. Times are median / 95th percentile.');
p();
p('| Measure | Target (p95) | 100 records | 1,000 records | 10,000 records |');
p('|---|---|---|---|---|');
function row(name, target, f) { p('| ' + name + ' | ' + target + ' | ' + r1.sizes.map(function (s) { return f(s); }).join(' | ') + ' |'); }
row('Tag lookup from the index file (read, check, resolve), warm, 35 runs', '≤ ' + r1.targets.warmResolveP95Ms + ' ms', function (s) { return mp(s.warmResolve); });
row('Evidence ready (12 sources read and laid out), warm within one opening of the popover, 35 runs', '≤ ' + r1.targets.warmReadyP95Ms + ' ms', function (s) { return mp(s.warmReady); });
row('Evidence ready from a cold start (new process: index plus 12 sources), 15 runs', '≤ ' + r1.targets.coldReadyP95Ms + ' ms', function (s) { return mp(s.coldReady); });
if (r1.sizes[0].coldestReady) row('Evidence ready from the coldest start (new process, file cache emptied first), 8 runs', '≤ ' + r1.targets.coldReadyP95Ms + ' ms', function (s) { return s.coldestReady ? mp(s.coldestReady) : 'not run'; });
row('The whole process, start to exit, for scale: cold' + (r1.sizes[0].coldestWall ? ' / coldest' : ''), 'none set', function (s) { return ms(s.coldWall.median) + (s.coldestWall ? ' / ' + ms(s.coldestWall.median) : '') + ' median'; });
row('Baseline: plain search for the remembered words with `grep`, 15 runs', 'none set', function (s) { return mp(s.baselineGrep); });
if (r1.sizes[0].baselineGrepColdest) row('Baseline `grep` with the file cache emptied first, 8 runs', 'none set', function (s) { return s.baselineGrepColdest ? mp(s.baselineGrepColdest) : 'not run'; });
p();
p('**A faster wrong answer is not a pass**, so each timing is tied to what came back:');
p();
p('| Outcome on the same data | Work Index | Plain search (`grep "Pine Ridge"`) |');
p('|---|---|---|');
p('| The 12 linked sources found | 12 of 12 at every size, every run (check 1.x.d) | ' + r1.sizes.map(function (s) { return s.baseline.rightOnes + ' of ' + s.baseline.wanted + ' at ' + s.records.toLocaleString('en-US'); }).join('; ') + ' (it cannot see inside workbooks) |');
p('| Files returned that are not linked | 0 | ' + r1.sizes.map(function (s) { return s.baseline.extra + ' at ' + s.records.toLocaleString('en-US'); }).join('; ') + ' |');
p('| Order by source date, citations, current cell values | yes | no: a list of file names |');
p();
p('The search baseline is faster at finding file names (' + r1.sizes.map(function (s) { return ms(s.baselineGrep.median); }).join(', ') + ') and returns a different thing. Its recall and extras follow from how this synthetic corpus was built; they are not a measurement of anyone\'s real files.');
if (r1.page) { p(); p('The popover page itself, in Chrome with ' + r1.page.records.toLocaleString('en-US') + ' records (not the app\'s WebKit view; the pretend Mac answers its requests): opening the popover ' + mp(r1.page.openPopover) + '; from choosing a tag to 12 sources on screen ' + mp(r1.page.tagToListOnScreen) + ' (target ≤ ' + r1.targets.warmReadyP95Ms + ' ms).'); }
p();
p('### Failures, fixes, retest');
p();
if (b1 && failures(b1).length) {
  failures(b1).forEach(function (c) { p('- **Failed as built, ' + c.id + ':** ' + c.what + '. Expected ' + c.expected + ', observed ' + c.actual + '.'); });
  p('- **Cause:** the whole index text (5.6 MB at 10,000 records) was fetched and checked again for every lookup, twice per opening of the popover.');
  p('- **Fix:** the index is read once when the popover opens and reused while the file\'s stamp is unchanged (re-read if another program changes it: regression check PO22); the index file is written one entry per line (' + (b1.sizes[2] ? (b1.sizes[2].indexBytes / 1e6).toFixed(1) + ' MB → ' + (r1.sizes[2].indexBytes / 1e6).toFixed(1) + ' MB at 10,000 records' : 'smaller') + '); tag checking is cheaper.');
  var a = r1.page, bb = b1.page;
  if (a && bb) p('- **Retest (run 2):** tag to list on screen ' + mp(bb.tagToListOnScreen) + ' → ' + (m1 && m1.page ? mp(m1.page.tagToListOnScreen) : mp(a.tagToListOnScreen)) + '. Warm evidence ready at 10,000 records ' + mp(b1.sizes[2].warmReady) + ' → ' + (m1 ? mp(m1.sizes[2].warmReady) : mp(r1.sizes[2].warmReady)) + '.');
  if (m1 && failures(m1).length) {
    failures(m1).forEach(function (c) { p('- **Failed in run 2, ' + c.id + ':** ' + c.what + '. Expected ' + c.expected + ', observed ' + c.actual + '. The same measure had been ' + ms(b1.sizes[2].warmResolve.p95) + ' in run 1 and ' + ms(98.12) + ' in the first pass of run 2: at the limit, and over it in this pass.'); });
    p('- **Cause:** on every load each of the 10,000 index entries was re-checked field by field in the slowest way (each tag name re-validated, each date parsed, each title rewritten).');
    p('- **Fix:** within one load a tag name is checked once and reused, and dates and titles in the usual form are accepted by a quick test; anything unusual still takes the full check, so nothing unknown can ride along (regression checks A11, A12).');
    p('- **Retest (run 3):** ' + mp(m1.sizes[2].warmResolve) + ' → ' + mp(r1.sizes[2].warmResolve) + ' at 10,000 records. All ' + r1.checks.length + ' checks pass.');
  }
  p('- **Still slow, not fixed:** opening the popover with 10,000 records took ' + (a ? mp(a.openPopover) : 'n/a') + ' in this harness, almost all of it moving the index text to the page. No target was set for it; the real cost inside the app is unknown (blocked).');
  p('- **Test asset corrected:** in the first run the unrelated files that mention the project all happened to be workbooks, which `grep` cannot see, so the baseline showed 0 extra files. The generator was fixed; the table above is the corrected run.');
} else p('No check failed.');
p();
p('### Blocked (not run)');
p();
r1.blocked.forEach(function (b) { p('- ' + b.what + ': ' + b.why + '.'); });
r1.notes.forEach(function (n) { p('- Note: ' + n); });

/* ───────── round 2 ───────── */
var r2 = after.rounds.r2, b2 = before && before.rounds.r2;
p(); p('## Round 2: Context'); p();
p('One synthetic corpus, "Pine Ridge tooling budget" (5 to 19 November 2026): a workbook in USD and KRW saved three times, four Mail messages (a quote, a request, an approval, one without a readable date), an Apple Note edited once, a message saved as a file, and a tagged file that is later deleted. The workbook is registered from Finder and again from Excel. Untagged and other-tag sources carry canary lines. The answer key (`tests/rounds/answer-key.json`) was written by hand before the run.');
p();
p('| Measure against the answer key | Result after fixes |');
p('|---|---|');
p('| Required evidence recovered | ' + r2.scores.evidence.recovered + ' of ' + r2.scores.evidence.of + ' passages, each under its own source |');
p('| Correct latest value at the correct cell, in its currency | ' + r2.scores.values.right + ' of ' + r2.scores.values.of + ' |');
function chk(id) { var c = r2.checks.filter(function (x) { return x.id === id; })[0]; return c ? (c.pass ? 'pass' : '**FAIL**') : 'not run'; }
p('| Chronology across sources, with the kind of date | ' + chk('2.03') + ' (six dated sources in order; unknown date apart; missing file marked) |');
p('| Request versus approval kept apart (who, when, request first) | ' + chk('2.10') + ' |');
p('| Conflict shown, not settled (note says USD 50,000; later approval and workbook say USD 55,000) | ' + chk('2.11') + ' |');
p('| Stale evidence included (values from earlier saves) | ' + r2.scores.stale + ' |');
p('| Irrelevant evidence included (untagged or other-tag sources) | ' + r2.scores.irrelevant + ' |');
p('| Unticked evidence included in the copy | ' + r2.scores.unselected + ' |');
p('| Same workbook from Finder and Excel | ' + chk('2.01') + ': one item |');
p('| Copied only on Copy, exactly what was reviewed | ' + chk('2.14') + ' |');
p('| Source saved again after being shown | ' + chk('2.18') + ': Copy refuses until the list shows what is saved |');
p();
p('Current amounts as copied, against the key:');
p();
p('| Cell | Answer key | Copied context | |');
p('|---|---|---|---|');
r2.scores.values.detail.forEach(function (d) { p('| ' + cell(d.cell) + ' | ' + cell(d.expected) + ' | ' + cell(d.actual) + ' | ' + (d.pass ? 'match' : '**differs**') + ' |'); });
var lo = r2.checks.filter(function (c) { return c.id === '2.19'; })[0];
if (lo) p(); if (lo) p('Second opinion: LibreOffice, opening the same workbook, shows ' + (lo.pass ? 'the same seven amounts as the key' : 'different amounts: ' + cell(lo.actual)) + ' (check 2.19), so the key and the reader are not merely agreeing with each other.');
p();
p('All ' + r2.checks.length + ' checks: ' + tally(r2) + ' pass. Product-side time for this lookup: ' + r2.timing.evidenceReadyMs + ' ms for ' + r2.timing.sources + ' sources. Interactions used to tag the nine sources beforehand: ' + r2.interactions.iconClicks + ' icon clicks, ' + r2.interactions.tagsTyped + ' typed tags, ' + r2.interactions.chipPresses + ' recent-tag presses, ' + r2.interactions.saves + ' saves (counted from the script; not time).');
p();
p('### Work Index + Aside versus Aside alone, on context quality');
p();
p('**Status: ' + r2.comparison.status + '.** ' + r2.comparison.why);
p();
p('What was measured here is only the evidence package Work Index hands over: ' + r2.comparison.measuredHere.replace(/^Only the evidence package Work Index hands over, scored against the answer key: /, ''));
p('That shows the handed-over context is complete, current and clean for this corpus. It does not show that Aside answers better with it than without it. To verify: ' + r2.comparison.toRun);
p();
p('### Failures, fixes, retest');
p();
if (b2 && failures(b2).length) {
  failures(b2).forEach(function (c) { p('- **Failed as built, ' + c.id + ':** ' + c.what + '.'); p('  - Expected: ' + c.expected); p('  - Observed: ' + c.actual); });
  p('- **Cause:** the workbook reader printed the stored number and ignored the cell\'s number format, so every amount lost its currency: 55000 instead of $55,000.00, 64990000 instead of ₩64,990,000.');
  p('- **Fix:** amounts are shown the way the workbook shows them (symbols, codes, 원, accounting formats, negatives). A format the reader does not fully understand is left as the stored number rather than guessed; a value the format would round is shown with the stored number beside it. Regression checks R06 and R07 (21 formats) were added.');
  p('- **Retest:** ' + r2.scores.values.right + ' of ' + r2.scores.values.of + ' amounts match the key; ' + tally(r2) + ' checks pass, including the LibreOffice second opinion.');
} else p('No check failed.');
p();
p('### Blocked (not run)');
p();
r2.blocked.forEach(function (b) { p('- ' + b.what + ': ' + b.why); });
r2.notes.forEach(function (n) { p('- Note: ' + n); });

/* ───────── round 3 ───────── */
var r3 = after.rounds.r3, b3 = before && before.rounds.r3;
p(); p('## Round 3: AI handoff (Aside and ChatGPT)'); p();
p('Same corpus and answer key. Live sessions and simulations are kept apart, and so are the two routes: *direct lookup* (the person types only the tag and a question) and *Copy context* (the person reviews, copies and pastes).');
p();
p('| Client | Route | Live or simulated | Result |');
p('|---|---|---|---|');
r3.matrix.forEach(function (m) { p('| ' + m.client + ' | ' + m.route + ' | ' + m.mode + ' | **' + m.status + '.** ' + cell(m.detail) + ' |'); });
p();
p('In the simulated rows the client is replaced by a stand-in reader that answers from the pasted text alone by finding the cited cell or message. It is not a model: it shows the text is sufficient and correctly cited, not what Aside or ChatGPT would say.');
p();
p('| Check | Expected | Observed | |');
p('|---|---|---|---|');
r3.checks.forEach(function (c) { p('| ' + c.id + ' ' + cell(c.what) + ' | ' + cell(c.expected) + ' | ' + cell(c.actual) + ' | ' + (c.pass ? 'pass' : '**FAIL**') + ' |'); });
p();
var s = r3.stages, ac = r3.actions;
p('Stages, product side only (pretend Mac, this environment; no client, model or person time): open popover ' + s.openPopoverMs + ' ms; tag to evidence ready ' + s.tagToEvidenceReadyMs + ' ms; Copy ' + s.copyMs + ' ms; ' + s.pastedCharacters.toLocaleString('en-US') + ' characters handed over. The scripted adapter session took ' + s.adapterSessionMs + ' ms including process start.');
p();
p('User actions, counted from the script (interactions, not time or effort):');
p();
p('| Route | Actions besides typing the question | Typed characters |');
p('|---|---|---|');
p('| Copy context: click icon, press tag, untick one source, press Copy, switch to the client, paste, send | ' + ac.copyContextRoute.pointerOrKeyActionsBesidesTyping + ' | ' + ac.copyContextRoute.typeQuestionCharacters + ' (the question) |');
p('| Direct lookup, if a client supported it: send | ' + ac.directRouteIfItExisted.pointerOrKeyActionsBesidesTyping + ' | ' + ac.directRouteIfItExisted.typeQuestionCharacters + ' (the question plus the tag) |');
p('| Tagging beforehand, both routes (nine sources) | ' + (ac.taggingBeforehand.iconClicks + ac.taggingBeforehand.chipPresses + ac.taggingBeforehand.saves) + ' (' + ac.taggingBeforehand.iconClicks + ' icon clicks, ' + ac.taggingBeforehand.chipPresses + ' recent-tag presses, ' + ac.taggingBeforehand.saves + ' saves) | ' + ac.taggingBeforehand.tagsTyped + ' tags typed |');
p();
p('The Copy route costs six more actions per question than a direct route would, and is the only one with a review step: in check 3.08 the direct adapter returned the source the person had left out.');
p();
p('### Failures, fixes, retest');
p();
if (b3 && failures(b3).length) {
  failures(b3).forEach(function (c) { p('- **Failed as built, ' + c.id + ':** ' + c.what + '. Observed: ' + cell(c.actual)); });
  p('- **Cause and fix:** the same missing currency display as in round 2; fixed there. The stand-in reader got 55000 where the key says $55,000.00.');
  p('- **Retest:** ' + tally(r3) + ' simulated checks pass in runs 2 and 3. During the first retest, check 3.06 failed once because its list of permitted local requests did not yet include the new index-stamp request added by the round 1 fix; the check was corrected and passes.');
} else p('No check failed.');
p();
p('### Blocked (not run)');
p();
r3.blocked.forEach(function (b) { p('- ' + b.what + ': ' + b.why); });
r3.notes.forEach(function (n) { p('- Note: ' + n); });

/* ───────── regression and reproduction ───────── */
p(); p('## Regression after the fixes'); p();
if (reg.final) p('The existing suites were run again on the final build `' + reg.final.build + '`: ' + reg.final.regressionNode + ' regression checks on Node, ' + reg.final.regressionJavaScriptCore + ' on JavaScriptCore (Bun), ' + reg.final.page + ' checks of the popover page in Chrome. Before the fixes (build `' + reg.asBuilt.build + '`): ' + reg.asBuilt.regression + ' and ' + reg.asBuilt.page + '. After the first fixes (build `' + reg.afterFirstFixes.build + '`): ' + reg.afterFirstFixes.regression + ' and ' + reg.afterFirstFixes.page + '; four checks were added with the fixes (R06, R07, PO22, PO23).');
p();
p('## Not executed, named separately'); p();
p('- **Mac app (GUI):** not compiled, not run. Every item in `LIVE-CHECKS.md` sections A to C is open: the build, the menu-bar icon and popover, focus returning to the previous app, Automation prompts, Notes, Mail, Finder and Excel answering, Korean input, timings in the app.');
p('- **Clients:** no Aside session, no ChatGPT session, no connector connected to either. The Aside comparison is unverified.');
p('- **Signing:** no Developer ID signing, no notarization, no release, no upload. `RELEASE-PLAN.md` is a plan only.');
p();
p('## Reproduce'); p();
p('    node tests/run.js                                   # regression suite');
p('    node tests/rounds/run-rounds.js my-run              # the three rounds → tests/rounds/results/my-run.json');
p('    node tests/rounds/report.js                         # this report, from the three saved runs in tests/rounds/results');
p();
p('Timings move from run to run on a shared machine; the pass and fail marks above are the ones observed in the saved runs, not best cases.');
p();
p('Assets: `tests/rounds/lib.js` (corpus and scenario), `answer-key.json`, `round1.js`, `round2.js`, `round3.js`, `tests/lib/mac.js` (the pretend Mac), `tests/lib/xlsx.js` (workbook and message writer), `tests/rounds/results/` (both runs).');
fs.writeFileSync(path.join(L.ROOT, 'QA-REPORT.md'), out.join('\n') + '\n');
console.log('QA-REPORT.md  ' + out.length + ' lines');
