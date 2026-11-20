/* One cold start: a fresh process loads the product's rules, resolves a tag and makes its evidence ready, then exits.
 *   node cold-probe.js <pretend-mac-folder> <tag>      prints {"resolveMs":…,"readyMs":…,"sources":…,"loadMs":…} */
'use strict';
var t0 = process.hrtime.bigint();
process.env.TZ = 'Asia/Seoul';
var path = require('path'), fs = require('fs');
var Core = require('../../core/rules.js'), Popover = require('../../core/popover.js'), Mac = require('../lib/mac.js');
function ms(a) { return Number(process.hrtime.bigint() - a) / 1e6; }
var loadMs = ms(t0), mac = Mac.create(process.argv[2]), tag = process.argv[3] || 'Cost';
var t1 = process.hrtime.bigint();
var index = Core.loadIndex(fs.readFileSync(mac.indexPath(), 'utf8')), q = Popover.lookupQuery(tag), found = Core.resolve(index, q.tags.map(function (t) { return t.key; }));
var resolveMs = ms(t1), t2 = process.hrtime.bigint();
Popover.create(mac.host).lookup(tag).then(function (v) {
  process.stdout.write(JSON.stringify({ loadMs: +loadMs.toFixed(2), resolveMs: +resolveMs.toFixed(2), readyMs: +ms(t2).toFixed(2), totalMs: +ms(t0).toFixed(2), resolved: found.length, sources: v.lookup.sources.length, read: v.lookup.counts.read, order: v.lookup.sources.map(function (s) { return s.title; }) }) + '\n');
});
