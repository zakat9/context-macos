/* Round 1 — Speed. Cold and warm tag lookup and evidence-ready latency on synthetic data of 100, 1,000 and 10,000
 * distinct records, against a plain local search over the same files. A fast result only counts if it is the right
 * evidence: every timing is tied to a correctness check on what was returned. */
'use strict';
var fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
var L = require('./lib.js'), Core = require('../../core/rules.js'), Read = require('../../core/read.js'), Popover = require('../../core/popover.js');
var TARGETS = { warmResolveP95Ms: 100, warmReadyP95Ms: 500, coldReadyP95Ms: 1500 };

function makeCorpus(dir, N, K) {
  var mac = L.Mac.create(dir), seed = 1000 + N, index = Core.emptyIndex(), truth = [];
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  var people = ['Dana Okafor', 'Mina Seo', 'Jonas Reyes', 'Ines Varga', '서미나', '박준호'], topics = ['tooling', 'hiring', 'travel', 'audit', 'lease', '견적', 'training', 'freight'];
  for (var i = 0; i < N; i++) {
    var target = i < K, kind = i % 3, day = 1 + (i * 7 + Math.floor(rnd() * 3)) % 27, hh = 9 + (i % 9), mm = (i * 13) % 60, noise = !target && i % 31 === 5;
    var iso = '2026-10-' + ('0' + day).slice(-2) + 'T' + ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2) + ':' + ('0' + (i % 60)).slice(-2), amount = 10000 + i * 7, topic = topics[i % topics.length];
    var words = (target || noise ? 'Pine Ridge ' : '') + topic + ' ' + people[i % people.length] + ' item ' + i + ' amount USD ' + amount.toLocaleString('en-US') + (target ? ' TRUTH-' + i : ''), name, data, title;
    if (kind === 0) { name = 'note-' + i + '.md'; title = name; data = 'Note ' + i + '\n' + words + '\n'; }
    else if (kind === 1) { name = 'mail-' + i + '.eml'; title = 'Subject ' + i + ' ' + topic; data = L.Xlsx.eml({ fromName: people[i % people.length], fromAddress: 'p' + (i % 6) + '@northfield-devices.example', subject: title, date: new Date(iso + '+09:00').toUTCString().replace('GMT', '+0000'), messageId: 'm' + i + '.' + N + '@northfield-devices.example', text: words }); }
    else { name = 'book-' + i + '.xlsx'; title = name; data = L.Xlsx.write({ modified: new Date(iso + '+09:00').toISOString().replace('.000Z', 'Z'), sheets: [{ name: 'Sheet1', cells: { A1: 'Item', B1: 'Amount', A2: words, B2: amount } }] }); }
    var p = mac.write(name, data, iso + '+09:00'), st = fs.statSync(p), d = Read.describeFile({ ok: true, realPath: p, bytes: new Uint8Array(fs.readFileSync(p)), mtimeMs: Math.floor(st.mtimeMs), size: st.size }, p);
    Core.bind(index, d.desc, target ? ['Cost'] : ['Proj' + (i % 97)], { now: '2026-11-01T09:00:00+09:00' });
    if (target) truth.push({ id: d.desc.id, title: d.desc.title, time: Date.parse(d.desc.sourceTime), token: 'TRUTH-' + i, text: kind !== 2, noise: false });
  }
  fs.mkdirSync(mac.home, { recursive: true }); fs.writeFileSync(mac.indexPath(), Core.dumpIndex(index));
  truth.sort(function (a, b) { return (a.time - b.time) || (a.title < b.title ? -1 : a.title > b.title ? 1 : (a.id < b.id ? -1 : 1)); });
  return { mac: mac, truth: truth, entries: Object.keys(index.objects).length, indexBytes: fs.statSync(mac.indexPath()).size };
}

function dropCache() { try { cp.spawnSync('sync'); fs.writeFileSync('/proc/sys/vm/drop_caches', '3'); return true; } catch (e) { return false; } }

module.exports = async function (opts) {
  opts = opts || {};
  var sizes = opts.sizes || [100, 1000, 10000], K = 12, out = { name: 'Speed', targets: TARGETS, sizes: [], checks: [], blocked: [], notes: [] };
  var base = fs.mkdtempSync(path.join(os.tmpdir(), 'workindex-round1-'));
  function check(id, what, pass, expected, actual) { out.checks.push({ id: id, what: what, pass: !!pass, expected: expected, actual: actual }); }
  for (var si = 0; si < sizes.length; si++) {
    var N = sizes[si], dir = path.join(base, 'n' + N), made = makeCorpus(dir, N, K), mac = made.mac, row = { records: N, linked: K, indexBytes: made.indexBytes };
    var wantOrder = made.truth.map(function (x) { return x.title; }).join('|');
    /* warm: the same process, repeated */
    var resolve = [], ready = [], pop = Popover.create(mac.host), okWarm = true, i;
    for (i = 0; i < 40; i++) {
      var r = L.timeMs(function () { var idx = Core.loadIndex(fs.readFileSync(mac.indexPath(), 'utf8')); return Core.resolve(idx, ['cost']); });
      if (i >= 5) resolve.push(r[0]);
      if (r[1].length !== K) okWarm = false;
      var e = await L.timeAsync(function () { return pop.lookup('Cost'); });
      if (i >= 5) ready.push(e[0]);
      var v = e[1].lookup;
      if (v.sources.map(function (s) { return s.title; }).join('|') !== wantOrder || v.counts.read !== K || !made.truth.every(function (tr, k) { return v.sources[k].lines.join('\n').indexOf(tr.token) >= 0; })) okWarm = false;
    }
    row.warmResolve = L.stats(resolve); row.warmReady = L.stats(ready);
    /* cold: a new process each time */
    var coldReady = [], coldTotal = [], coldWall = [], okCold = true;
    for (i = 0; i < 15; i++) {
      var t0 = process.hrtime.bigint(), run = cp.spawnSync(process.execPath, [path.join(__dirname, 'cold-probe.js'), dir, 'Cost'], { encoding: 'utf8' }), wall = Number(process.hrtime.bigint() - t0) / 1e6, j = null;
      try { j = JSON.parse(run.stdout); } catch (err) { okCold = false; continue; }
      coldReady.push(j.readyMs + j.resolveMs); coldTotal.push(j.totalMs); coldWall.push(wall);
      if (j.order.join('|') !== wantOrder || j.read !== K) okCold = false;
    }
    row.coldReady = L.stats(coldReady); row.coldProcess = L.stats(coldTotal); row.coldWall = L.stats(coldWall);
    /* colder still: the operating system's file cache is emptied before each new process (when this machine allows it) */
    var emptied = [], emptiedWall = [], grepEmptied = [];
    for (i = 0; i < 8 && dropCache(); i++) {
      var c0 = process.hrtime.bigint(), run2 = cp.spawnSync(process.execPath, [path.join(__dirname, 'cold-probe.js'), dir, 'Cost'], { encoding: 'utf8' }), w2 = Number(process.hrtime.bigint() - c0) / 1e6, j2 = null;
      try { j2 = JSON.parse(run2.stdout); } catch (err2) { okCold = false; continue; }
      emptied.push(j2.readyMs + j2.resolveMs); emptiedWall.push(w2);
      if (j2.order.join('|') !== wantOrder || j2.read !== K) okCold = false;
    }
    for (i = 0; i < 8 && dropCache(); i++) { var e0 = process.hrtime.bigint(); cp.spawnSync('grep', ['-rlI', '--', 'Pine Ridge', mac.files], { encoding: 'utf8' }); grepEmptied.push(Number(process.hrtime.bigint() - e0) / 1e6); }
    if (emptied.length) { row.coldestReady = L.stats(emptied); row.coldestWall = L.stats(emptiedWall); }
    if (grepEmptied.length) row.baselineGrepColdest = L.stats(grepEmptied);
    /* baseline: plain local search for the words a person would remember ("Pine Ridge"), over the same files */
    var grep = [], found = null;
    for (i = 0; i < 15; i++) { var g0 = process.hrtime.bigint(), g = cp.spawnSync('grep', ['-rlI', '--', 'Pine Ridge', mac.files], { encoding: 'utf8' }); grep.push(Number(process.hrtime.bigint() - g0) / 1e6); found = g.stdout.split('\n').filter(Boolean); }
    var scan = [];
    for (i = 0; i < 5; i++) scan.push(L.timeMs(function () { return fs.readdirSync(mac.files).filter(function (n) { return fs.readFileSync(path.join(mac.files, n)).indexOf('Pine Ridge') >= 0; }).length; })[0]);
    var truthPaths = {}; made.truth.forEach(function (tr) { var rec = JSON.parse(fs.readFileSync(mac.indexPath(), 'utf8')).objects[tr.id]; truthPaths[rec.locator.value] = 1; });
    var hit = found.filter(function (p) { return truthPaths[fs.realpathSync(p)]; }).length;
    row.baselineGrep = L.stats(grep); row.baselineScan = L.stats(scan); row.baseline = { query: 'Pine Ridge', found: found.length, rightOnes: hit, wanted: K, missed: K - hit, extra: found.length - hit, givesOrder: false, givesCitations: false, readsWorkbookCells: false };
    out.sizes.push(row);
    check('1.' + N + '.a', N + ' records: warm tag lookup (read index, resolve) p95 within ' + TARGETS.warmResolveP95Ms + ' ms', row.warmResolve.p95 <= TARGETS.warmResolveP95Ms, '≤ ' + TARGETS.warmResolveP95Ms + ' ms', row.warmResolve.p95 + ' ms (median ' + row.warmResolve.median + ')');
    check('1.' + N + '.b', N + ' records: warm evidence ready (' + K + ' sources read and laid out) p95 within ' + TARGETS.warmReadyP95Ms + ' ms', row.warmReady.p95 <= TARGETS.warmReadyP95Ms, '≤ ' + TARGETS.warmReadyP95Ms + ' ms', row.warmReady.p95 + ' ms (median ' + row.warmReady.median + ')');
    check('1.' + N + '.c', N + ' records: cold evidence ready (new process; lookup plus reading) p95 within ' + TARGETS.coldReadyP95Ms + ' ms', row.coldReady.p95 <= TARGETS.coldReadyP95Ms && coldReady.length === 15, '≤ ' + TARGETS.coldReadyP95Ms + ' ms', row.coldReady.p95 + ' ms (median ' + row.coldReady.median + '; whole process ' + row.coldWall.median + ' ms median)');
    if (row.coldestReady) check('1.' + N + '.e', N + ' records: evidence ready from the coldest start (new process, file cache emptied first) p95 within ' + TARGETS.coldReadyP95Ms + ' ms', row.coldestReady.p95 <= TARGETS.coldReadyP95Ms, '≤ ' + TARGETS.coldReadyP95Ms + ' ms', row.coldestReady.p95 + ' ms (median ' + row.coldestReady.median + '; whole process ' + row.coldestWall.median + ' ms median)');
    check('1.' + N + '.d', N + ' records: every timed result was the right evidence (all ' + K + ' linked sources, in source-date order, with their current contents), warm and cold', okWarm && okCold, 'all ' + K + ', in order, every run', okWarm && okCold ? 'yes, in 40 warm and 15 cold runs' : 'NO: warm ' + okWarm + ', cold ' + okCold);
  }
  /* the popover page itself, in Chrome, on the largest corpus: click a tag → list on screen */
  try {
    var chromium = require('playwright').chromium, big = path.join(base, 'n' + sizes[sizes.length - 1]), bmac = L.Mac.create(big);
    var br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] }), pg = await (await br.newContext({ viewport: { width: 440, height: 700 } })).newPage();
    await pg.exposeFunction('__workIndexTestCall', function (op, arg) { return op === 'close' || op === 'quit' ? { ok: true } : bmac.call(op, arg); });
    await pg.goto('file://' + path.join(L.ROOT, 'app', 'Resources', 'popover.html'));
    var ui = [], opening = [];
    for (var u = 0; u < 20; u++) {
      opening.push(await pg.evaluate(function () { var t = performance.now(); return window.workIndexOpened({ bundleId: '' }).then(function () { return performance.now() - t; }); }));
      ui.push(await pg.evaluate(function () { var t = performance.now(), f = document.getElementById('lookupField'); f.value = 'Cost'; document.getElementById('lookupForm').dispatchEvent(new Event('submit', { cancelable: true })); return new Promise(function (res) { (function wait() { if (document.querySelectorAll('#sources .src').length === 12) res(performance.now() - t); else setTimeout(wait, 1); })(); }); }));
    }
    await br.close();
    out.page = { records: sizes[sizes.length - 1], browser: 'Chrome for Testing (not the app\'s WebKit view)', openPopover: L.stats(opening.slice(3)), tagToListOnScreen: L.stats(ui.slice(3)) };
    check('1.page', 'the popover page in Chrome, ' + sizes[sizes.length - 1] + ' records: from choosing the tag to 12 sources on screen, p95 within ' + TARGETS.warmReadyP95Ms + ' ms', out.page.tagToListOnScreen.p95 <= TARGETS.warmReadyP95Ms, '≤ ' + TARGETS.warmReadyP95Ms + ' ms', out.page.tagToListOnScreen.p95 + ' ms (median ' + out.page.tagToListOnScreen.median + ')');
  } catch (e) { out.notes.push('The page timing in Chrome was not run here: ' + String(e.message).split('\n')[0]); }
  out.blocked.push({ what: 'Cold launch of the Mac app and time from clicking the menu-bar icon to the popover showing the selected object', why: 'needs the app built and run on a Mac; no Mac or Swift compiler here' });
  out.blocked.push({ what: 'Evidence-ready latency inside the app (WebKit view, Swift file reading, AppleScript to Notes and Mail)', why: 'same; the time Notes and Mail take to answer was not measured at all' });
  out.notes.push(out.sizes[0] && out.sizes[0].coldestReady ? '“Cold start” is a new process. “Coldest start” also empties the operating system\'s file cache before each run, so the index and every source are read from disk.' : '“Cold” is a new process with the operating system\'s file cache warm; the cache could not be emptied on this machine.');
  out.notes.push('The baseline search finds files that contain the remembered words. By construction of this synthetic corpus it cannot see inside workbooks (compressed) and also returns files that merely mention the project. Its speed is reported next to that outcome, not instead of it.');
  try { fs.rmSync(base, { recursive: true, force: true }); } catch (e2) { /* leave it */ }
  return out;
};
