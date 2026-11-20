#!/usr/bin/env node
/* Runs the three rounds on this build and writes one result file:  node tests/rounds/run-rounds.js <label> [--quick]
 * Then  node tests/rounds/report.js  writes QA-REPORT.md from every result file in tests/rounds/results. */
'use strict';
var fs = require('fs'), path = require('path'), L = require('./lib.js');
var label = process.argv[2] || 'run', quick = process.argv.indexOf('--quick') >= 0, only = (process.argv.filter(function (a) { return /^--only=/.test(a); })[0] || '').replace('--only=', '');
(async function () {
  var result = { label: label, at: new Date().toISOString(), buildHash: L.buildHash(), environment: L.environment(), rounds: {} };
  if (!only || only === '1') result.rounds.r1 = await require('./round1.js')({ sizes: quick ? [100, 1000] : [100, 1000, 10000] });
  if (!only || only === '2') result.rounds.r2 = await require('./round2.js')();
  if (!only || only === '3') result.rounds.r3 = await require('./round3.js')();
  var dir = path.join(__dirname, 'results'); fs.mkdirSync(dir, { recursive: true });
  var file = path.join(dir, label + '.json');
  if (only && fs.existsSync(file)) { var prev = JSON.parse(fs.readFileSync(file, 'utf8')); Object.keys(result.rounds).forEach(function (k) { prev.rounds[k] = result.rounds[k]; }); prev.buildHash = result.buildHash; prev.at = result.at; result = prev; }
  fs.writeFileSync(file, JSON.stringify(result, null, 1));
  Object.keys(result.rounds).forEach(function (k) {
    var r = result.rounds[k], failed = r.checks.filter(function (c) { return !c.pass; });
    console.log('\n== Round ' + k.slice(1) + ' (' + r.name + '): ' + (r.checks.length - failed.length) + '/' + r.checks.length + ' simulated checks pass; ' + r.blocked.length + ' blocked ==');
    failed.forEach(function (c) { console.log('FAIL ' + c.id + '  ' + c.what + '\n       expected: ' + String(c.expected).slice(0, 300) + '\n       actual:   ' + String(c.actual).slice(0, 300)); });
  });
  console.log('\nbuild ' + result.buildHash + ' → ' + path.relative(L.ROOT, file));
})().catch(function (e) { console.error(e); process.exit(2); });
