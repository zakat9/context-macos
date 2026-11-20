#!/usr/bin/env node
/* Runs the five cycles against this build and keeps the results under a label:
 *   NODE_PATH=<playwright> node tests/cycles/run-cycles.js <label> [--only=1,3]
 * Results: tests/cycles/results/<label>.json (one file per run; a cycle run alone is merged into the label's file). */
'use strict';
var fs = require('fs'), path = require('path');
var C = require('./lib.js');
var label = process.argv[2], only = (process.argv.filter(function (a) { return /^--only=/.test(a); })[0] || '').replace('--only=', '').split(',').filter(Boolean).map(Number);
if (!label || /^--/.test(label)) { console.error('usage: run-cycles.js <label> [--only=1,3]'); process.exit(2); }
var NAMES = { 1: 'Menu-bar label: transitions, correctness, latency, idle work', 2: 'First run, batch permission, denial and revoke, recovery', 3: 'Tagging by keyboard and mouse, recent tags, two-tag cap, wrong-target rejection',
  4: 'Tag lookup: Korean, latest-only, source-date order, missing and replaced files, exact citations', 5: 'End-to-end office workflow to Copy context, selected-only content, earlier regressions' };
var running = 0, finished = false;
/* a cycle that waits for something that never comes would otherwise end the program quietly, looking like a pass */
process.on('beforeExit', function () { if (!finished) { console.log('Cycle ' + running + ' DID NOT FINISH: a step waited for something that never came. Counted as failed.'); process.exit(1); } });
(async function () {
  var file = path.join(__dirname, 'results', label + '.json'), out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { label: label, cycles: {} };
  out.build = C.L.buildHash(); out.environment = C.L.environment(); out.ranAt = new Date().toISOString();
  var bad = 0;
  for (var n = 1; n <= 5; n++) {
    if (only.length && only.indexOf(n) < 0) continue;
    var S = C.suite(), started = Date.now(); running = n;
    try { await require('./cycle' + n + '.js')(S, C); } catch (e) { S.check('C' + n + '.crash', 'the cycle runs to its end', false, (e && e.stack) || e); }
    var r = S.result(); r.name = NAMES[n]; r.build = out.build; r.seconds = Math.round((Date.now() - started) / 100) / 10;
    out.cycles[n] = r;
    var fails = r.checks.filter(function (c) { return c.pass === false; }), blocked = r.checks.filter(function (c) { return c.pass === null; });
    bad += fails.length;
    console.log('Cycle ' + n + ' — ' + NAMES[n] + ': ' + r.checks.filter(function (c) { return c.pass === true; }).length + '/' + (r.checks.length - blocked.length) + ' passed' + (blocked.length ? ', ' + blocked.length + ' blocked' : '') + '  (' + r.seconds + ' s)');
    fails.forEach(function (c) { console.log('  FAIL ' + c.id + '  ' + c.text + '\n       → ' + c.detail.split('\n').join('\n         ')); });
  }
  finished = true;
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log('build ' + out.build + ' → ' + path.relative(C.ROOT, file));
  process.exit(bad ? 1 : 0);
})();
