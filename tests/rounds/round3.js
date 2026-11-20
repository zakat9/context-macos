/* Round 3 — AI handoff, for Aside and ChatGPT together. Two things are kept apart throughout:
 *   live      a real session in the client             (none could be run here: every live cell is BLOCKED, not PASS)
 *   simulated the product's side run for real, with a stand-in for the client
 * and two routes:
 *   direct lookup   the person types only the tag and a question; the client fetches the evidence itself
 *   Copy context    the person reviews the evidence in the popover, copies it and pastes it into the client
 * The stand-in "reader" is not a model. It answers from the pasted text alone, by finding the cited cell or message,
 * so it shows whether the handed-over text is enough to answer correctly with a correct citation. It cannot show
 * what Aside or ChatGPT would actually say. */
'use strict';
var fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
var L = require('./lib.js'), Popover = require('../../core/popover.js');
var KEY = JSON.parse(fs.readFileSync(path.join(__dirname, 'answer-key.json'), 'utf8'));

/* answers the answer key's questions from a pasted text and nothing else */
function reader(pasted) {
  var S = L.parseContext(pasted || ''), answers = [], wb = S.filter(function (s) { return s.kind === 'Workbook' && s.title === 'tooling-budget.xlsx' && s.group === 'timeline'; })[0];
  KEY.values.forEach(function (val) {
    var got = wb ? L.cellLine(wb, val.sheet, val.cell) : null;
    if (got != null) answers.push({ id: val.id, answer: got.replace(/ \(formula =.*\)$/, ''), citation: '[' + wb.label + ' › ' + val.sheet + '!' + val.cell + ']', label: wb.label });
  });
  function message(phrase) { return S.filter(function (s) { return s.kind === 'Email' && s.quoted.join('\n').indexOf(phrase) >= 0; })[0]; }
  var rq = message('Requesting approval to raise'), ap = message('Approved. The Pine Ridge tooling cap');
  if (rq && ap) answers.push({ id: 'request-vs-approval', answer: 'requested ' + rq.when.replace(/ \(.*/, '') + ' by ' + ((rq.quoted[0] || '').replace(/^From: /, '').replace(/ <.*/, '')) + '; approved ' + ap.when.replace(/ \(.*/, '') + ' by ' + ((ap.quoted[0] || '').replace(/^From: /, '').replace(/ <.*/, '')), citation: '[' + rq.label + '] then [' + ap.label + ']', label: ap.label, order: rq.order < ap.order });
  return answers;
}
function grade(pasted, answers) {
  var right = 0, cited = 0, wrong = [];
  KEY.values.forEach(function (val) {
    var a = answers.filter(function (x) { return x.id === val.id; })[0];
    if (a && a.answer === val.display) right++; else wrong.push(val.id + ': expected ' + val.display + ', got ' + (a ? a.answer : 'no answer'));
    if (a && new RegExp('^- \\[' + a.label + '\\] Workbook — “tooling-budget\\.xlsx”', 'm').test(pasted) && pasted.indexOf('[' + val.sheet + '] ') >= 0) cited++;
  });
  var rv = answers.filter(function (x) { return x.id === 'request-vs-approval'; })[0], R = KEY.requestVsApproval;
  var rvOk = !!rv && rv.order && rv.answer === 'requested ' + R.request.date + ' by ' + R.request.by + '; approved ' + R.approval.date + ' by ' + R.approval.by;
  return { valuesRight: right, valuesOf: KEY.values.length, citationsRight: cited, requestVsApproval: rvOk, wrong: wrong, rv: rv ? rv.answer : 'no answer' };
}
function count(text, tokens) { return tokens.filter(function (tk) { return (text || '').indexOf(tk) >= 0; }); }

module.exports = async function () {
  var out = { name: 'AI handoff', checks: [], matrix: [], blocked: [], notes: [], stages: {}, actions: {} };
  function check(id, what, pass, expected, actual) { out.checks.push({ id: id, what: what, pass: !!pass, expected: expected, actual: actual }); }
  var question = 'What is the current approved tooling budget cap, where is it recorded, and was the increase requested or approved?';

  /* live: nothing could be run */
  [['Aside', 'direct lookup', 'No Aside here. Aside\'s documentation describes no way to give its own agent a connector, so this route may not exist at all.'],
   ['Aside', 'Copy context', 'No Aside here. Needs a Mac with the app built: copy in the popover, paste into Aside\'s chat.'],
   ['ChatGPT', 'direct lookup', 'No live connector exists. ChatGPT needs a public HTTPS endpoint or OpenAI\'s tunnel; neither was set up, and this build ships neither. Not supported in this build.'],
   ['ChatGPT', 'Copy context', 'No ChatGPT session here. Needs a Mac with the app built: copy in the popover, paste into ChatGPT.']].forEach(function (c) {
    out.matrix.push({ client: c[0], route: c[1], mode: 'live', status: 'BLOCKED', detail: c[2] });
    out.blocked.push({ what: c[0] + ', ' + c[1] + ', live', why: c[2] });
  });

  /* simulated, tag alone: the client is handed the question with the tag and nothing else */
  var alone = reader('::' + KEY.tag + ' ' + question), g0 = grade('', alone);
  check('3.01', 'simulated, tag alone (no connector, nothing pasted): the stand-in reader has nothing to read and answers nothing. This build gives neither client a way to resolve a bare tag', alone.length === 0 && g0.valuesRight === 0, '0 answers', alone.length + ' answers');
  out.matrix.push({ client: 'Aside and ChatGPT', route: 'direct lookup (tag alone)', mode: 'simulated', status: 'NOT AVAILABLE', detail: 'With no connector in the client, a bare ::Cost resolves to nothing: 0 of ' + (KEY.values.length + 1) + ' questions answerable. This is a missing route, not a pass and not a product defect of the popover.' });

  /* simulated, reviewed Copy context: the product's side for real (popover rules, pretend Mac), the client replaced by the reader */
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workindex-round3-')), mac = L.Mac.create(dir), clock = { ms: 0 };
  var played = await L.playScenario(mac, Popover, clock), pop = played.pop;
  mac.counts = {}; mac.requests = []; mac.clipboard = null;
  var a = await L.timeAsync(function () { return pop.opened({ bundleId: L.FINDER }); });
  var b = await L.timeAsync(function () { return pop.lookup(KEY.tag); });
  await pop.setSelected(played.ids.kestrel, false);
  var c = await L.timeAsync(function () { return pop.copy(); });
  var pasted = mac.clipboard || '', answers = reader(pasted), g = grade(pasted, answers);
  out.stages = { openPopoverMs: +a[0].toFixed(1), tagToEvidenceReadyMs: +b[0].toFixed(1), copyMs: +c[0].toFixed(1), pastedCharacters: pasted.length, note: 'product side only, on a pretend Mac in this environment; no client time, no model time, no person time' };
  out.actions = { copyContextRoute: { clickIcon: 1, pressTag: 1, untickSource: 1, pressCopy: 1, switchToClient: 1, paste: 1, typeQuestionCharacters: question.length, send: 1, pointerOrKeyActionsBesidesTyping: 7 },
    directRouteIfItExisted: { typeQuestionCharacters: question.length + KEY.tag.length + 3, send: 1, pointerOrKeyActionsBesidesTyping: 1 },
    taggingBeforehand: played.actions, note: 'counted from the scripted flow; these are interactions, not time and not effort' };
  check('3.02', 'simulated, reviewed Copy context: from the pasted text alone the reader gets all ' + KEY.values.length + ' current amounts exactly, in their currency', g.valuesRight === KEY.values.length, KEY.values.map(function (x) { return x.display; }).join(', '), g.wrong.length ? g.wrong.join('; ') : 'all ' + g.valuesRight + ' exact');
  check('3.03', 'each answer\'s citation resolves, inside the pasted text, to the workbook and the sheet and cell it names', g.citationsRight === KEY.values.length, KEY.values.length + ' of ' + KEY.values.length, g.citationsRight + ' of ' + KEY.values.length + (answers[0] ? ' (for example ' + answers[0].citation + ')' : ''));
  check('3.04', 'request versus approval can be told apart from the pasted text: who, when, and request first', g.requestVsApproval, 'requested ' + KEY.requestVsApproval.request.date + ' by Mina Seo; approved ' + KEY.requestVsApproval.approval.date + ' by Jonas Reyes', g.rv);
  var canary = count(pasted, KEY.unselected.tokens), stale = count(pasted, KEY.staleTokens), irr = count(pasted, KEY.irrelevantTokens);
  check('3.05', 'the unticked source\'s canary is untouched: nothing of it, nothing stale and nothing irrelevant is in what was pasted', canary.length + stale.length + irr.length === 0, '0 tokens', canary.concat(stale, irr).join(', ') || '0 tokens');
  check('3.06', 'never auto-sent: the product wrote the clipboard once, on Copy, and made no other outward request', mac.counts.copyText === 1 && mac.requests.every(function (r) { return /^(readIndex|indexStamp|selection|readFile|readMail|readNote|writeIndex|copyText)/.test(r); }), '1 clipboard write; every other request is a local read of the index, the selection or a tagged source, or a write of the index', (mac.counts.copyText || 0) + ' clipboard write(s); requests: ' + Object.keys(mac.counts).join(', '));
  var passB = g.valuesRight === KEY.values.length && g.citationsRight === KEY.values.length && g.requestVsApproval && canary.length + stale.length + irr.length === 0;
  out.matrix.push({ client: 'Aside and ChatGPT', route: 'Copy context (reviewed, pasted)', mode: 'simulated', status: passB ? 'PASS' : 'FAIL', detail: 'Product side run for real on a pretend Mac; the client replaced by a stand-in reader, not a model. ' + g.valuesRight + '/' + KEY.values.length + ' amounts, ' + g.citationsRight + '/' + KEY.values.length + ' citations, request versus approval ' + (g.requestVsApproval ? 'told apart' : 'NOT told apart') + ', canary untouched ' + (canary.length ? 'NO' : 'yes') + '. The same text is handed to either client: nothing in it is client-specific.' });

  /* simulated, direct lookup through the parked connector (an offline adapter): a scripted client, not Aside and not ChatGPT */
  var fdir = path.join(dir, 'folder'), files = L.writeFileCorpus(fdir), home = path.join(dir, 'adapter-home'), Ops = require('../../dev/lib/ops.js');
  ['workbook', 'kestrel', 'quote', 'request', 'approval', 'note'].forEach(function (k) { Ops.tagInput(home, files[k], 'Cost'); });
  Ops.tagInput(home, files.trip, 'Travel');
  var t0 = process.hrtime.bigint();
  var session = cp.spawnSync(process.execPath, [path.join(L.ROOT, 'dev', 'workindex.js'), '--home', home, 'mcp'], { encoding: 'utf8', input: [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'scripted-adapter-client', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'workindex_context', arguments: { query: '::' + KEY.tag + ' ' + question } } }].map(function (m) { return JSON.stringify(m); }).join('\n') + '\n' });
  var adapterMs = Number(process.hrtime.bigint() - t0) / 1e6, text = '';
  try { text = JSON.parse(session.stdout.trim().split('\n')[1]).result.content[0].text; } catch (e) { text = ''; }
  var ga = grade(text, reader(text)), allReturned = count(text, ['UNSELECTED-CANARY-KESTREL']).length === 1, noise = count(text, KEY.irrelevantTokens.concat(KEY.staleTokens));
  check('3.07', 'simulated, direct lookup through the parked connector (offline adapter, scripted client, the sources as files): a tag-only question returns evidence from which all amounts and citations come out right', ga.valuesRight === KEY.values.length && ga.citationsRight === KEY.values.length && ga.requestVsApproval && noise.length === 0, KEY.values.length + ' amounts, citations, request before approval, nothing stale or irrelevant', ga.valuesRight + ' amounts, ' + ga.citationsRight + ' citations, request/approval ' + ga.requestVsApproval + (noise.length ? ', leaked: ' + noise.join(', ') : ''));
  check('3.08', 'the direct route has no review step: it returns every linked source, including the one a person unticked in the Copy route', allReturned, 'the competing quote is present', allReturned ? 'present' : 'absent');
  out.stages.adapterSessionMs = +adapterMs.toFixed(1);
  out.matrix.push({ client: 'neither (scripted client)', route: 'direct lookup through the parked connector', mode: 'simulated', status: ga.valuesRight === KEY.values.length && ga.citationsRight === KEY.values.length && noise.length === 0 ? 'PASS' : 'FAIL', detail: 'Offline adapter only: experimental/connector, a scripted MCP client, and the reader. It shows the connector hands a tag-only question the right evidence. It is not Aside, not ChatGPT, and no model answered. It has no review step, so nothing can be left out by the person.' });
  out.notes.push('“PASS” in a simulated row means the product\'s side behaved correctly against the answer key. It says nothing about what Aside or ChatGPT would answer; those rows are BLOCKED.');
  out.notes.push('Direct tag lookup is not claimed for ChatGPT or for Aside. The popover\'s Copy context is the only handoff this build provides.');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) { /* leave it */ }
  return out;
};
module.exports.reader = reader;
