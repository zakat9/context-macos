/* Round 2 — contexta. One tag across a workbook (USD and KRW, saved three times), Mail messages, a note and a message
 * file, registered from different apps over two weeks. Scored against the prewritten answer key (answer-key.json):
 * current saved values at the right cells, correct citations, chronology across sources, request versus approval,
 * and nothing stale, irrelevant or unticked in what is copied. */
'use strict';
var fs = require('fs'), os = require('os'), path = require('path');
var L = require('./lib.js'), Popover = require('../../core/popover.js');
var KEY = JSON.parse(fs.readFileSync(path.join(__dirname, 'answer-key.json'), 'utf8'));

module.exports = async function () {
  var out = { name: 'contexta', checks: [], scores: {}, blocked: [], notes: [], comparison: null };
  function check(id, what, pass, expected, actual) { out.checks.push({ id: id, what: what, pass: !!pass, expected: expected, actual: actual }); }
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workindex-round2-')), mac = L.Mac.create(dir), clock = { ms: 0 };
  var played = await L.playScenario(mac, Popover, clock), pop = played.pop, objects = mac.objects();
  var wbRec = objects[played.ids.workbook];
  check('2.01', 'the workbook registered from Finder (5 Nov) and from Excel (11 Nov), and re-saved twice since, is one item', !!wbRec && Object.keys(objects).filter(function (k) { return /tooling-budget\.xlsx$/.test(objects[k].locator.value); }).length === 1 && wbRec.tags.join() === 'Cost,PineRidge', '1 item, tags Cost + PineRidge', wbRec ? wbRec.tags.join(' + ') : 'missing');
  check('2.02', 'eight sources carry Cost and one carries Travel: nine index entries, no duplicates', Object.keys(objects).length === 9, 9, Object.keys(objects).length);

  mac.counts = {}; mac.clipboard = null;
  await pop.opened({ bundleId: L.FINDER });
  var t0 = process.hrtime.bigint(), v = await pop.lookup(KEY.tag), readyMs = Number(process.hrtime.bigint() - t0) / 1e6;
  var full = pop.preview(), S = L.parseContext(full);
  function byTitle(title) { return S.filter(function (s) { return s.title === title; })[0]; }
  var sourceOf = {}; KEY.chronology.concat(KEY.dateUnknown).forEach(function (c) { sourceOf[c.key] = byTitle(c.title); });

  /* chronology across sources */
  var timeline = S.filter(function (s) { return s.group === 'timeline'; }).sort(function (a, b) { return a.order - b.order; });
  var gotOrder = timeline.map(function (s) { return s.kind + ' | ' + s.title + ' | ' + s.when.replace(/ \(\+09:00\)$/, '') + ' | ' + s.dateKind.replace(/ \(.*$/, ''); });
  var wantOrder = KEY.chronology.map(function (c) { return c.kind + ' | ' + c.title + ' | ' + c.date + ' | ' + c.dateKind; });
  check('2.03', 'chronology: the six dated sources appear once each in the order of their own dates, with the right kind of date', gotOrder.join('\n') === wantOrder.join('\n'), wantOrder.join(' → '), gotOrder.join(' → '));
  var undated = S.filter(function (s) { return s.group === 'undated'; }), gone = S.filter(function (s) { return s.group === 'unavailable'; });
  check('2.04', 'unknown date: the message without a readable date is listed apart, not placed in the order', undated.length === 1 && undated[0].title === KEY.dateUnknown[0].title, KEY.dateUnknown[0].title, undated.map(function (s) { return s.title; }).join());
  check('2.05', 'missing: the deleted file is listed as unavailable with the reason, and with none of its contents', gone.length === 1 && gone[0].title === KEY.unavailable[0].title && gone[0].reason.indexOf(KEY.unavailable[0].reason) >= 0 && !/Harborline,48500|Kestrel,51200/.test(full), KEY.unavailable[0].title + ': ' + KEY.unavailable[0].reason, gone.map(function (s) { return s.title + ': ' + s.reason; }).join());

  /* current saved value at the right cell, in the right currency */
  var W = sourceOf.workbook, right = 0, detail = [];
  KEY.values.forEach(function (val) {
    var got = W ? L.cellLine(W, val.sheet, val.cell) : null, shown = got == null ? '(not found)' : got.replace(/ \(formula =.*\)$/, ''), formula = got && (got.match(/\(formula =(.*)\)$/) || [])[1];
    var ok = shown === val.display && (!val.formula || formula === val.formula);
    if (ok) right++;
    detail.push({ id: val.id, cell: val.sheet + '!' + val.cell, expected: val.display + (val.formula ? ' (formula =' + val.formula + ')' : ''), actual: got == null ? '(not found)' : got, pass: ok });
  });
  out.scores.values = { right: right, of: KEY.values.length, detail: detail };
  check('2.06', 'latest value and location: each of the ' + KEY.values.length + ' answer-key amounts is at its cell with its currency as saved (USD two decimals, KRW none, 원 suffix, USD suffix), formulas with their text', right === KEY.values.length, KEY.values.map(function (x) { return x.sheet + '!' + x.cell + ' ' + x.display; }).join('; '), detail.map(function (d) { return d.cell + ' ' + d.actual; }).join('; '));
  var cite = full.split('\n').filter(function (l) { return W && l.indexOf('- [' + W.label + '] ') === 0; })[0] || '';
  check('2.07', 'citation: the workbook\'s label resolves to its file, its last-saved date and its sheets, and says how to cite a cell', /tooling-budget\.xlsx”; last saved Nov 18, 2026 16:40/.test(cite) && /sheets: Summary A1:B4, 견적 A1:B5/.test(cite) && cite.indexOf('Cite cells as [' + (W && W.label) + ' › Summary!A1]') > 0 && /tooling-budget\.xlsx$/.test(cite), 'file, date, sheets and cell form', cite);
  var cites = timeline.concat(undated).every(function (s) { return full.split('\n').some(function (l) { return l.indexOf('- [' + s.label + '] ' + s.kind + ' — “' + s.title + '”') === 0; }); });
  check('2.08', 'citation: every source in the copy has one citation line with the same label, kind and title', cites, 'one line per source', cites ? 'yes' : 'no');

  /* required evidence, request versus approval, conflict */
  var rec = KEY.requiredEvidence.filter(function (r) { var s = sourceOf[r.source]; return s && s.quoted.join('\n').indexOf(r.mustContain) >= 0; });
  out.scores.evidence = { recovered: rec.length, of: KEY.requiredEvidence.length };
  check('2.09', 'required evidence recovered: each answer-key passage is quoted under its own source', rec.length === KEY.requiredEvidence.length, KEY.requiredEvidence.length + ' of ' + KEY.requiredEvidence.length, rec.length + ' of ' + KEY.requiredEvidence.length);
  var rq = sourceOf.request, ap = sourceOf.approval, R = KEY.requestVsApproval;
  var rvA = rq && ap && rq.quoted.join('\n').indexOf(R.request.mustContain) >= 0 && ap.quoted.join('\n').indexOf(R.approval.mustContain) >= 0 && rq.order < ap.order && rq.when.indexOf(R.request.date) === 0 && ap.when.indexOf(R.approval.date) === 0 &&
    rq.quoted.join('\n').indexOf('From: ' + R.request.by) >= 0 && ap.quoted.join('\n').indexOf('From: ' + R.approval.by) >= 0 && rq.label !== ap.label;
  check('2.10', 'request versus approval: the request (Mina Seo, 12 Nov) and the approval (Jonas Reyes, 17 Nov) are two separate dated sources, request first, each in its sender\'s words', rvA, 'request ' + R.request.date + ' before approval ' + R.approval.date, rq && ap ? rq.label + ' ' + rq.when + ' / ' + ap.label + ' ' + ap.when : 'missing');
  var C = KEY.conflict, own = full.split('\n').filter(function (l) { return !/^>/.test(l); }).join('\n');
  var conflict = sourceOf.note.quoted.join('\n').indexOf(C.earlier.mustContain) >= 0 && ap.quoted.join('\n').indexOf(C.later.mustContain) >= 0 && sourceOf.note.order < ap.order && !/50,000|55,000|55000|50000/.test(own);
  check('2.11', 'conflict: the note\'s earlier “USD 50,000” and the later approval\'s “USD 55,000” both appear, each under its own source and date; the tool itself states no amount and settles nothing', conflict, 'both present, in date order, no statement by the tool', conflict ? 'both present; the tool\'s own lines contain no amount' : 'failed');

  /* nothing stale, nothing irrelevant, nothing unticked */
  var stale = KEY.staleTokens.filter(function (tk) { return full.indexOf(tk) >= 0; }), irrelevant = KEY.irrelevantTokens.filter(function (tk) { return full.indexOf(tk) >= 0; });
  out.scores.stale = stale.length; out.scores.irrelevant = irrelevant.length;
  check('2.12', 'no prior values: none of the ' + KEY.staleTokens.length + ' tokens that exist only in earlier saves of the workbook or the note appears', stale.length === 0, 0, stale.length ? stale.join(', ') : 0);
  check('2.13', 'no irrelevant evidence: nothing from the untagged note, the Travel note or the untagged old copy of the workbook appears', irrelevant.length === 0, 0, irrelevant.length ? irrelevant.join(', ') : 0);
  var noCopyYet = mac.clipboard === null && !mac.counts.copyText;
  await pop.setSelected(played.ids.kestrel, false);
  var reviewed = pop.preview(); v = await pop.copy();
  var leaked = KEY.unselected.tokens.filter(function (tk) { return (mac.clipboard || '').indexOf(tk) >= 0; });
  out.scores.unselected = leaked.length;
  check('2.14', 'no accidental export: nothing reached the clipboard until Copy was pressed, and it was written exactly once', noCopyYet && mac.counts.copyText === 1 && mac.clipboard === reviewed, 'clipboard empty before Copy; one write; equal to the reviewed text', noCopyYet + ' / writes ' + mac.counts.copyText + ' / equal ' + (mac.clipboard === reviewed));
  check('2.15', 'no unticked evidence: with the competing quote unticked, none of its tokens is in the copy, and the copy says it holds 7 of the 8 linked sources', leaked.length === 0 && /This copy holds 7 of the 8 sources linked to ::Cost/.test(mac.clipboard || ''), 0, leaked.length ? leaked.join(', ') : 0);
  var S2 = L.parseContext(mac.clipboard || ''), keep = S2.filter(function (s) { return s.group === 'timeline'; }).map(function (s) { return s.label + ' ' + s.title; }).join(' | '), want = timeline.filter(function (s) { return s.title !== KEY.chronology[0].title; }).map(function (s) { return s.label + ' ' + s.title; }).join(' | ');
  check('2.16', 'the labels a person reviewed are the labels in the copy after unticking one source', keep === want, want, keep);
  var indexText = mac.indexText(), inIndex = KEY.values.map(function (x) { return String(x.amount); }).concat(KEY.staleTokens, ['Requesting approval', 'Harborline will hold']).filter(function (tk) { return indexText.indexOf(tk) >= 0; });
  check('2.17', 'the index holds no contents: none of the amounts, earlier values or quoted passages is in index.json', inIndex.length === 0, 0, inIndex.length ? inIndex.join(', ') : 0);
  /* the workbook is saved again while its list is on screen */
  await pop.lookup(KEY.tag);
  fs.writeFileSync(path.join(mac.files, 'tooling-budget.xlsx'), L.workbook(2)); mac.clipboard = 'UNTOUCHED';
  v = await pop.copy();
  var refused = mac.clipboard === 'UNTOUCHED' && /^Not copied: W1 changed/.test(v.copyMessage) && v.copyState === 'stale';      /* 0.11 wording: the message names the source */
  fs.writeFileSync(path.join(mac.files, 'tooling-budget.xlsx'), L.workbook(3)); v = await pop.copy(); if (/^Not copied/.test(v.copyMessage)) v = await pop.copy();
  check('2.18', 'a source saved again after it was shown is never copied as it was shown: Copy is refused until the list shows what is saved', refused && /Copied/.test(v.copyMessage) && KEY.staleTokens.every(function (tk) { return mac.clipboard.indexOf(tk) < 0; }), 'refused, then a copy without stale tokens', refused + ' / ' + v.copyMessage.slice(0, 40));

  /* an independent second opinion on how the workbook shows its amounts: LibreOffice, if it is installed */
  try {
    var cp = require('child_process'), lo = path.join(dir, 'lo'); fs.mkdirSync(lo);
    fs.writeFileSync(path.join(lo, 'tooling-budget.xlsx'), L.workbook(3));
    var conv = cp.spawnSync('soffice', ['--headless', '--norestore', '-env:UserInstallation=file://' + path.join(lo, 'profile'), '--convert-to', 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true,false,false,-1', '--outdir', lo, path.join(lo, 'tooling-budget.xlsx')], { encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' }) });
    var csvs = fs.readdirSync(lo).filter(function (n) { return /\.csv$/.test(n); });
    if (conv.error || !csvs.length) out.notes.push('LibreOffice was not available to cross-check the displayed amounts.');
    else {
      var shownBy = {}; csvs.forEach(function (n) { var sheet = n.normalize('NFC').replace(/^tooling-budget-/, '').replace(/\.csv$/, ''), rows = require('../../core/read.js').readCsv(fs.readFileSync(path.join(lo, n), 'utf8'), ',').sheets[0].rows; rows.forEach(function (r) { r.cells.forEach(function (c) { shownBy[sheet + '!' + c.ref] = c.v; }); }); });
      var agree = KEY.values.filter(function (x) { return String(shownBy[x.sheet + '!' + x.cell] || '').replace(/\s+/g, ' ').trim() === x.display; });
      check('2.19', 'second opinion: LibreOffice, opening the same workbook, shows the same ' + KEY.values.length + ' amounts as the answer key (so the key and the reader are not just agreeing with each other)', agree.length === KEY.values.length, KEY.values.map(function (x) { return x.display; }).join('; '), KEY.values.map(function (x) { return shownBy[x.sheet + '!' + x.cell]; }).join('; '));
    }
  } catch (e) { out.notes.push('LibreOffice cross-check not run: ' + e.message); }

  out.timing = { evidenceReadyMs: +readyMs.toFixed(1), sources: v.lookup ? v.lookup.sources.length : 0 };
  out.interactions = played.actions;
  out.comparison = { claim: 'Work Index + Aside gives better context quality than Aside alone', status: 'UNVERIFIED', why: 'No live Aside session could be run here, and a mock is not accepted as proof. Nothing above measures Aside, with or without Work Index.',
    measuredHere: 'Only the evidence package Work Index hands over, scored against the answer key: ' + rec.length + '/' + KEY.requiredEvidence.length + ' required passages, ' + right + '/' + KEY.values.length + ' latest values at the right cell, chronology ' + (gotOrder.join() === wantOrder.join() ? 'correct' : 'wrong') + ', request before approval ' + (rvA ? 'yes' : 'no') + ', stale ' + stale.length + ', irrelevant ' + irrelevant.length + ', unticked ' + leaked.length + '.',
    toRun: 'tests/rounds/aside-comparison.md: same corpus (written to a folder by make-corpus.js), same permissions, same five questions, same model, clean sessions; score both answers with score-answer.js. Superiority needs a higher context-quality score; a tie or speed alone does not count.' };
  out.blocked.push({ what: 'Work Index + Aside versus Aside alone on context quality', why: 'needs live Aside sessions on a Mac; not available here. Status: UNVERIFIED, not PASS.' });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* leave it */ }
  return out;
};
