/* Test asset: a pretend menu-bar shell with its own clock. It does what app/Sources/Status.swift is written to do
 * with the commands of core/status.js, against the pretend Mac, and it counts what a real Mac would have suffered:
 * questions sent to apps, permission prompts, apps opened. Time only moves when a test moves it. */
'use strict';
var fs = require('fs'), path = require('path');
var Status = require('../../core/status.js');
var OWN = 'local.workindex.app', TIMEOUT = 1000;

function create(mac, opts) {
  opts = opts || {};
  var eng = Status.create();
  var sim = { now: 1000000, eng: eng, own: OWN, shows: [], asks: [], front: null, running: {}, perm: {}, pids: {}, nextPid: 500, timerAt: null, due: [], held: [], busyUntil: 0, scope: false, scopes: [],
    latency: opts.latency || function () { return 30; },
    counts: { asks: 0, scripts: 0, scriptsBy: {}, permChecks: 0, prompts: 0, launches: 0, indexReads: 0, skipped: 0, ticks: 0 } };
  function stamp() { try { var s = fs.statSync(mac.indexPath()); return s.mtimeMs + ':' + s.size + ':' + s.ino; } catch (e) { return 'none'; } }
  function permOf(bid) { return mac.automationDenied[bid] ? -1743 : (sim.perm[bid] == null ? 0 : sim.perm[bid]); }
  function feed(e) { e.now = sim.now; if (e.type !== 'index') e.stamp = stamp(); eng.step(e).forEach(run); }
  function run(c) {
    if (c.do === 'show') sim.shows.push({ at: sim.now, state: c.state, title: c.title, tags: c.tags, tooltip: c.tooltip, label: c.label, front: sim.front ? sim.front.bundleId : '', script: sim.lastScript });
    else if (c.do === 'scope') { sim.scope = !!c.on; sim.scopes.push({ at: sim.now, on: !!c.on, front: sim.front ? sim.front.bundleId : '' }); if (opts.onScope) opts.onScope(!!c.on); }
    else if (c.do === 'wait') sim.timerAt = sim.now + c.ms;
    else if (c.do === 'idle') sim.timerAt = null;
    else if (c.do === 'index') {
      sim.counts.indexReads++;
      var text = null, failed = false;
      try { text = fs.readFileSync(mac.indexPath(), 'utf8'); } catch (e) { failed = e.code !== 'ENOENT'; }
      var ev = failed ? { type: 'index', stamp: stamp(), failed: true } : text == null ? { type: 'index', stamp: stamp(), missing: true } : { type: 'index', stamp: stamp(), text: text };
      later(0, function () { feed(ev); });
    }
    else if (c.do === 'ask') ask(c);
  }
  function inFront(c) { return !!sim.front && sim.front.bundleId === c.bundleId && sim.front.pid === c.pid && !!sim.running[c.bundleId]; }
  /* The shell's steps, as Status.swift is written: is the app still running and in front; is it already allowed
     (looked up without a prompt); only then the read-only question, on the main thread, where it holds up everything
     else of the shell until the app answers or the question gives up (1 s). An answer about an app that has left
     the front meanwhile is not passed on. */
  function ask(c) {
    sim.counts.asks++; sim.asks.push({ at: sim.now, bundleId: c.bundleId, seq: c.seq });
    var base = { type: 'answer', seq: c.seq, bundleId: c.bundleId, pid: c.pid };
    if (!inFront(c)) { sim.counts.skipped++; later(1, function () { feed(Object.assign({ skipped: true, perm: 0 }, base)); }); return; }
    sim.counts.permChecks++;
    var perm = permOf(c.bundleId);
    if (perm !== 0) { later(2, function () { feed(Object.assign({ perm: perm }, base)); }); return; }
    /* the question is sent now: this is the moment macOS would prompt, or open the app, if the two looks above were missing */
    if (!sim.running[c.bundleId]) sim.counts.launches++;
    if (permOf(c.bundleId) !== 0) sim.counts.prompts++;
    var hung = !!(opts.hang && opts.hang(c.bundleId, sim.now)), takes = hung ? TIMEOUT : Math.min(TIMEOUT, Math.max(1, sim.latency(c.bundleId, c.seq)));
    sim.busyUntil = sim.now + takes;
    later(takes, function () {
      sim.busyUntil = 0;
      sim.counts.scripts++; sim.counts.scriptsBy[c.bundleId] = (sim.counts.scriptsBy[c.bundleId] || 0) + 1;
      sim.lastScript = { bundleId: c.bundleId, at: sim.now, seq: c.seq };
      var r = hung || takes >= TIMEOUT ? { ok: false, code: -1712, message: 'AppleEvent timed out.' } : mac.selectionNow(c.bundleId), e = Object.assign({ perm: 0, ok: !!r.ok }, base);
      if (permOf(c.bundleId) === -1743) r = { ok: false, code: -1743 };
      e.ok = !!r.ok;
      if (r.ok) e.reply = r.reply; else e.code = r.code;
      var f = r.ok ? String(r.reply).split('\u001F') : [];
      if (f[0] === 'path' && f[1] && !/^[a-z][a-z0-9+.-]*:\/\//i.test(f[1])) {
        try {
          var real = fs.realpathSync(f[1]);
          if (!fs.statSync(real).isDirectory() && !mac.fileDenied[real]) {
            e.realPath = real;
            if (/\.eml$/i.test(real)) { var fd = fs.openSync(real, 'r'), buf = Buffer.alloc(16384), n = fs.readSync(fd, buf, 0, 16384, 0); fs.closeSync(fd); e.emlHead = buf.slice(0, n).toString('latin1'); }
          }
        } catch (err) { /* not a saved file */ }
      }
      if (!inFront(c)) { sim.counts.skipped++; e = Object.assign({ skipped: true, perm: 0 }, base); }
      feed(e);
      var held = sim.held; sim.held = [];                          /* what the system reported while the question ran is taken up now, in order */
      held.forEach(function (ev) { feed(ev); });
    });
  }
  /* something the system tells the shell: it is heard at once, unless a question is running on the main thread */
  function hear(e) { if (sim.busyUntil && sim.now < sim.busyUntil) sim.held.push(e); else feed(e); }
  function later(ms, fn) { sim.due.push({ at: sim.now + ms, fn: fn, n: sim.due.length }); }
  sim.advance = function (ms) {
    var end = sim.now + ms;
    for (;;) {
      var next = null;
      sim.due.forEach(function (d) { if (next == null || d.at < next.at) next = d; });
      var t = sim.timerAt;
      if (t != null && sim.busyUntil > t) t = sim.busyUntil + 0.5;
      if (next && (t == null || next.at <= t) && next.at <= end) { sim.now = Math.max(sim.now, next.at); sim.due.splice(sim.due.indexOf(next), 1); next.fn(); continue; }
      if (t != null && t <= end) { sim.now = Math.max(sim.now, t); sim.timerAt = null; sim.counts.ticks++; feed({ type: 'tick' }); continue; }
      break;
    }
    sim.now = end;
  };
  sim.activate = function (bid, o) {
    o = o || {};
    if (!sim.pids[bid]) sim.pids[bid] = sim.nextPid++;
    sim.running[bid] = true; sim.front = { bundleId: bid, pid: sim.pids[bid] };
    hear({ type: 'app', bundleId: bid, name: o.name || '', pid: sim.pids[bid], own: bid === OWN, popover: !!o.popover });
  };
  sim.quit = function (bid) { sim.running[bid] = false; delete sim.pids[bid]; };
  sim.popover = function (open) { hear({ type: 'popover', open: !!open }); };
  sim.saved = function () { hear({ type: 'saved' }); };
  sim.pause = function () { hear({ type: 'pause' }); };
  sim.resume = function () { hear({ type: 'resume' }); if (sim.front) sim.activate(sim.front.bundleId); };
  sim.access = function () { hear({ type: 'access' }); };
  sim.label = function () { return sim.shows.length ? sim.shows[sim.shows.length - 1] : null; };
  sim.text = function () { var l = sim.label(); return l ? l.state + (l.title ? ':' + l.title : '') : ''; };
  sim.feed = feed;
  return sim;
}
module.exports = { create: create, OWN: OWN };
