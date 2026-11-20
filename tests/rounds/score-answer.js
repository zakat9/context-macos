#!/usr/bin/env node
/* Scores one saved answer (plain text) against the prewritten answer key, on context quality only:
 *   node tests/rounds/score-answer.js <answer.txt>
 * It counts what can be counted from the text. A person should read the answer too: this cannot judge reasoning.
 * Used for the live comparison "Aside alone" versus "Aside with the Work Index context" (see aside-comparison.md). */
'use strict';
var fs = require('fs'), path = require('path'), KEY = require('./answer-key.json');
var text = fs.readFileSync(process.argv[2], 'utf8'), flat = text.replace(/\s+/g, ' ');
function has(re) { return re.test(flat); }
function amount(v) {                                   /* the amount, with its currency, in any common way of writing it */
  var digits = v.amount.toLocaleString('en-US', { minimumFractionDigits: v.amount % 1 ? 2 : 0 }).replace(/[.,]/g, function (c) { return c === ',' ? ',?' : '\\.'; });
  var cur = v.currency === 'USD' ? '(\\$|USD|US dollars?|dollars?)' : '(₩|KRW|원|won)';
  return new RegExp('(' + cur + '\\s?' + digits + '(\\.00)?\\b)|(\\b' + digits + '(\\.00)?\\s?' + cur + ')', 'i');
}
var values = KEY.values.map(function (v) { return { id: v.id, value: has(amount(v)), location: has(new RegExp(v.sheet + '\\s*(!|›|sheet,?|,)?\\s*(cell\\s*)?' + v.cell + '\\b', 'i')) && /tooling-budget\.xlsx/i.test(flat) }; });
function day(d) { var m = d.match(/^(\w+) (\d+), (\d+)/), n = { Nov: 11 }[m[1]]; return new RegExp('(' + m[1] + '[a-z]*\\.? ' + m[2] + '\\b)|(\\b' + m[2] + ' ' + m[1] + ')|(' + m[3] + '-' + n + '-' + ('0' + m[2]).slice(-2) + ')|(\\b' + n + '/' + m[2] + '\\b)', 'i'); }
var R = KEY.requestVsApproval;
var rq = /request/i.test(flat) && has(day(R.request.date)) && /Mina/i.test(flat), ap = /approv/i.test(flat) && has(day(R.approval.date)) && /Jonas/i.test(flat);
var first = KEY.chronology.map(function (c) { var i = flat.indexOf(c.title); return i < 0 ? flat.search(day(c.date)) : i; });
var mentioned = first.filter(function (i) { return i >= 0; }), inOrder = mentioned.every(function (v, i) { return i === 0 || mentioned[i - 1] <= v; });
var stale = KEY.staleTokens.filter(function (t) { return flat.indexOf(t) >= 0; }), irrelevant = KEY.irrelevantTokens.filter(function (t) { return flat.indexOf(t) >= 0; });
var score = {
  file: path.basename(process.argv[2]),
  requiredEvidenceRecovered: KEY.requiredEvidence.filter(function (e) { return flat.indexOf(e.mustContain) >= 0; }).length + ' of ' + KEY.requiredEvidence.length + ' key passages quoted',
  latestValueCorrect: values.filter(function (v) { return v.value; }).length + ' of ' + values.length,
  sourceLocationCorrect: values.filter(function (v) { return v.location; }).length + ' of ' + values.length,
  chronology: mentioned.length + ' of ' + KEY.chronology.length + ' sources mentioned' + (mentioned.length > 1 ? (inOrder ? ', in date order' : ', NOT in date order') : ''),
  requestVersusApproval: rq && ap ? 'both told apart, with who and when' : (rq ? 'request only' : ap ? 'approval only' : 'not told apart'),
  staleEvidenceIncluded: stale.length ? stale.join(', ') : 0,
  irrelevantEvidenceIncluded: irrelevant.length ? irrelevant.join(', ') : 0,
  note: 'Higher context quality needs more recovered evidence and correct values and locations, with zero stale or irrelevant items. A tie, or speed, is not superiority.'
};
console.log(JSON.stringify(score, null, 1));
