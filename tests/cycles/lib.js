/* Test asset: what the five cycles share. A cycle is a list of checks with measured numbers; it is run against the
 * build as it stands, the results are kept under a label, things are fixed, and it is run again under another label. */
'use strict';
process.env.TZ = 'Asia/Seoul';
var fs = require('fs'), os = require('os'), path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var L = require('../rounds/lib.js');

function suite() {
  var checks = [], measures = {}, notes = [];
  return {
    check: function (id, text, pass, detail) { checks.push({ id: id, text: text, pass: !!pass, detail: pass ? '' : String(detail == null ? '' : detail).slice(0, 600) }); return !!pass; },
    blocked: function (id, text, why) { checks.push({ id: id, text: text, pass: null, blocked: why }); },
    measure: function (key, value) { measures[key] = value; },
    note: function (text) { notes.push(text); },
    result: function () { return { checks: checks, measures: measures, notes: notes }; }
  };
}
function stats(list) {
  var a = list.slice().sort(function (x, y) { return x - y; });
  if (!a.length) return { n: 0 };
  function q(p) { return a[Math.min(a.length - 1, Math.floor(p * a.length))]; }
  return { n: a.length, min: a[0], median: q(0.5), p95: q(0.95), max: a[a.length - 1] };
}
function random(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function temp(name) { return fs.mkdtempSync(path.join(os.tmpdir(), name + '-')); }
function remove(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* leave it */ } }

/* a page of this build (or of the 0.10.3 build given in CONTEXT_BASELINE) in Chrome at the installed size */
async function browser() {
  var chromium = require('playwright').chromium;
  return chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
}
async function popoverPage(br, root, mac, hooks) {
  hooks = hooks || {};
  var pg = await (await br.newContext({ viewport: { width: 352, height: 440 }, deviceScaleFactor: 1 })).newPage(), errors = [], asked = [];
  pg.on('pageerror', function (e) { errors.push(String(e)); });
  await pg.exposeFunction('__workIndexTestCall', function (op, arg) {
    asked.push(op);
    if (op === 'close' || op === 'quit' || op === 'access' || op === 'settings') { if (hooks[op]) hooks[op](arg); return { ok: true }; }
    var delay = hooks.delay ? hooks.delay(op) : 0;
    return new Promise(function (res) { setTimeout(function () { res(mac.call(op, arg)); }, delay); });
  });
  await pg.goto('file://' + path.join(root, 'app', 'Resources', 'popover.html'));
  pg.errors = errors; pg.asked = asked;
  pg.open = async function (bid, name) { await pg.evaluate(function (i) { return window.workIndexOpened(i); }, { bundleId: bid, name: name || '' }); await pg.waitForTimeout(60); };
  return pg;
}
/* counts what a person does: every click and every key press that the test sends goes through here */
function hands(pg) {
  var h = { clicks: 0, keys: 0, typed: 0, log: [] };
  h.click = async function (sel) { h.clicks++; h.log.push('click ' + sel); await pg.click(sel); await pg.waitForTimeout(40); };
  h.key = async function (key) { h.keys++; h.log.push('key ' + key); await pg.keyboard.press(key); await pg.waitForTimeout(40); };
  h.type = async function (text) { h.typed += Array.from(text).length; h.log.push('type ' + text); await pg.keyboard.type(text); await pg.waitForTimeout(20); };
  h.total = function () { return h.clicks + h.keys + h.typed; };
  h.actions = function () { return h.clicks + h.keys; };          /* typing a name counts as its key presses in total(), not here */
  return h;
}
function baseline() { var b = process.env.CONTEXT_BASELINE || path.join(ROOT, 'tests', 'baseline-0.10.3'); return fs.existsSync(path.join(b, 'app', 'Resources', 'popover.html')) ? b : null; }

module.exports = { ROOT: ROOT, L: L, suite: suite, stats: stats, random: random, temp: temp, remove: remove, browser: browser, popoverPage: popoverPage, hands: hands, baseline: baseline,
  Scene: require('../visual/scene.js'), MenuBar: require('../lib/menubar.js'), Core: require('../../core/rules.js'), Popover: require('../../core/popover.js'), Status: require('../../core/status.js'), Access: require('../../core/access.js') };
