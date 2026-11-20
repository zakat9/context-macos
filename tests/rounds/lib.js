/* Shared by the three rounds: build hash, environment, statistics, and the synthetic corpus for rounds 2 and 3.
 * Everything is fictional and deterministic: same code, same files, same truth. */
'use strict';
process.env.TZ = 'Asia/Seoul';
var fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
var ROOT = path.join(__dirname, '..', '..');
var Xlsx = require('../lib/xlsx.js'), Mac = require('../lib/mac.js');

function walk(dir, out) { fs.readdirSync(dir).sort().forEach(function (n) { var p = path.join(dir, n), st = fs.statSync(p); if (st.isDirectory()) walk(p, out); else out.push(p); }); return out; }
/* one hash over the product's files (rules, readers, popover, the Mac shell, the harness): changes when any of them changes */
function buildHash() {
  var h = crypto.createHash('sha256');
  ['core', 'app', 'dev'].forEach(function (d) { walk(path.join(ROOT, d), []).forEach(function (p) { if (/\/build\//.test(p)) return; h.update(path.relative(ROOT, p) + '\n'); h.update(fs.readFileSync(p)); }); });
  return h.digest('hex').slice(0, 16);
}
function environment() {
  var cpus = os.cpus();
  return { platform: os.platform() + ' ' + os.release(), cpu: (cpus[0] && cpus[0].model) || 'unknown', cores: cpus.length, memoryGb: Math.round(os.totalmem() / 1073741824), node: process.version, engine: process.versions.bun ? 'JavaScriptCore (Bun ' + process.versions.bun + ')' : 'V8 ' + process.versions.v8, timeZone: process.env.TZ };
}
function stats(a) {
  var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length;
  function q(p) { return s[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))]; }
  return { n: n, median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), min: +s[0].toFixed(2), max: +s[n - 1].toFixed(2) };
}
function timeMs(fn) { var t0 = process.hrtime.bigint(); var r = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, r]; }
async function timeAsync(fn) { var t0 = process.hrtime.bigint(); var r = await fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, r]; }

/* ───────── the corpus for rounds 2 and 3: "Pine Ridge tooling budget", 5 to 19 November 2026 ─────────
   The workbook is saved three times; only the last save is the truth. The note is edited once. One tagged file is
   deleted. Untagged and other-tag sources carry canary lines that must never show up under ::Cost. */
var NOTES = 'com.apple.Notes', MAIL = 'com.apple.mail', FINDER = 'com.apple.finder', EXCEL = 'com.microsoft.Excel';
function workbook(version) {
  var v = { 1: { cap: 50000, quote: 51234, mold: 68512000, mach: 12000000, saved: '2026-11-05T02:00:00Z' },
            2: { cap: 50000, quote: 48234, mold: 66321000, mach: 12000000, saved: '2026-11-11T08:15:00Z' },
            3: { cap: 55000, quote: 48500, mold: 64990000, mach: 12400000, saved: '2026-11-18T07:40:00Z' } }[version];
  return Xlsx.write({ created: '2026-11-05T01:30:00Z', modified: v.saved, sheets: [
    { name: 'Summary', cells: { A1: 'Budget cap', B1: { v: v.cap, format: '"$"#,##0.00' }, A2: 'Selected quote', B2: { v: v.quote, format: '[$$-409]#,##0.00' }, A3: 'Headroom', B3: { f: 'B1-B2', v: v.cap - v.quote, format: '"$"#,##0.00' }, A4: 'Status', B4: version === 3 ? 'Cap approved Nov 17' : 'Draft' } },
    { name: '견적', cells: { A1: '항목', B1: '금액', A2: '금형', B2: { v: v.mold, format: '"₩"#,##0' }, A3: '가공', B3: { v: v.mach, format: '[$₩-412]#,##0' }, A4: '합계', B4: { f: 'B2+B3', v: v.mold + v.mach, format: '#,##0"원"' }, A5: 'Freight', B5: { v: 1350.5, format: '#,##0.00 "USD"' } } }
  ] });
}
/* Plays the scenario on a pretend Mac through the popover's rules, exactly as a person would: select, click, type, save.
   Returns what was done (the interactions) so the rounds can count them. */
async function playScenario(mac, Popover, clockRef) {
  var pop = Popover.create(mac.host, { now: function () { return clockRef.ms; } }), actions = { iconClicks: 0, tagsTyped: 0, chipPresses: 0, saves: 0 }, log = [];
  function at(iso) { clockRef.ms = Date.parse(iso); }
  async function tag(app, text, viaChip) {
    actions.iconClicks++; var v = await pop.opened({ bundleId: app });
    if (viaChip) actions.chipPresses++; else actions.tagsTyped++;
    actions.saves++; v = await pop.save(text); log.push(app.split('.').pop() + ': ' + (v.tagMessage || v.target.message));
    await pop.closed(); return v;
  }
  var wb = path.join(mac.files, 'tooling-budget.xlsx');
  at('2026-11-05T11:10:00+09:00'); mac.write('tooling-budget.xlsx', workbook(1)); mac.select(FINDER, [wb]); await tag(FINDER, 'Cost');
  mac.write('tooling-budget (old copy).xlsx', Xlsx.write({ modified: '2026-11-05T02:00:00Z', sheets: [{ name: 'Summary', cells: { A1: 'Budget cap', B1: 50000, A2: 'Selected quote', B2: 51234, A3: 'IRRELEVANT-CANARY-OLD-COPY' } }] }));
  at('2026-11-06T16:00:00+09:00');
  var kestrel = mac.write('Competing quote - Kestrel.eml', Xlsx.eml({ fromName: 'Ines Varga', fromAddress: 'ines.varga@kestrel-moldworks.example', subject: 'Competing quote: Pine Ridge housing mold', date: 'Fri, 06 Nov 2026 15:40:00 +0900', messageId: '20261106.1540.k1@kestrel-moldworks.example',
    text: 'Mina,\n\nKestrel Moldworks can build the 2-cavity mold for USD 51,200.\nUNSELECTED-CANARY-KESTREL: lead time 8 weeks.\n\nInes Varga' }));
  mac.select(FINDER, [kestrel]); await tag(FINDER, 'Cost', true);
  at('2026-11-10T09:30:00+09:00');
  mac.addMail({ numericId: '5001', messageId: '20261110.0912.rq2@harborline-tooling.example', subject: 'Revised tooling quote: Pine Ridge housing', sent: '2026-11-10T09:12:00', account: 'Work', mailbox: 'INBOX', from: 'Dana Okafor <dana.okafor@harborline-tooling.example>',
    text: 'Hi Mina,\n\nRevised quote for the Pine Ridge housing mold:\n- 2-cavity mold, P20 steel: USD 48,500\n- Lead time: 6 weeks from purchase order\n\nDana Okafor\nHarborline Tooling' });
  mac.select(MAIL, ['5001']); await tag(MAIL, 'Cost PineRidge');
  at('2026-11-11T17:20:00+09:00'); mac.write('tooling-budget.xlsx', workbook(2)); mac.openDocument[EXCEL] = wb; await tag(EXCEL, 'Cost PineRidge');
  at('2026-11-12T16:40:00+09:00');
  mac.addMail({ numericId: '5002', messageId: '20261112.1630.req@northfield-devices.example', subject: 'Request: raise the Pine Ridge tooling cap', sent: '2026-11-12T16:30:00', account: 'Work', mailbox: 'Sent', from: 'Mina Seo <mina.seo@northfield-devices.example>',
    text: 'Jonas,\n\nRequesting approval to raise the Pine Ridge tooling cap from USD 50,000 to USD 55,000.\nReason: H13 steel option and freight.\n\nMina Seo' });
  mac.select(MAIL, ['5002']); await tag(MAIL, 'Cost', true);
  at('2026-11-13T11:00:00+09:00');
  mac.addNote({ id: 'x-coredata://FICTIONAL-0002/ICNote/p11', title: 'Supplier call: Harborline', created: '2026-11-13T10:50:00', modified: '2026-11-13T10:55:00', text: 'Supplier call: Harborline\nPrice held until Nov 25 (STALE-NOTE-V1).\nCap is USD 50,000 for now.' });
  mac.select(NOTES, ['x-coredata://FICTIONAL-0002/ICNote/p11']); await tag(NOTES, 'Cost', true);
  at('2026-11-13T17:05:00+09:00');
  mac.notes['x-coredata://FICTIONAL-0002/ICNote/p11'].text = 'Supplier call: Harborline\nHarborline will hold the price until Nov 30.\nCap is USD 50,000 for now.\n국내 가공 견적은 ₩12,400,000 (부가세 별도).\nOpen: who signs off above the cap?';
  mac.notes['x-coredata://FICTIONAL-0002/ICNote/p11'].modified = '2026-11-13T17:05:00';
  mac.addNote({ id: 'x-coredata://FICTIONAL-0002/ICNote/p12', title: 'Lunch order', created: '2026-11-13T12:00:00', modified: '2026-11-13T12:00:00', text: 'IRRELEVANT-CANARY-UNTAGGED-NOTE: two bibimbap, one kimbap. Cost split three ways.' });
  mac.addNote({ id: 'x-coredata://FICTIONAL-0002/ICNote/p13', title: 'Busan trip', created: '2026-11-13T13:00:00', modified: '2026-11-13T13:00:00', text: 'IRRELEVANT-CANARY-TRAVEL: KTX tickets, cost ₩119,600.' });
  mac.select(NOTES, ['x-coredata://FICTIONAL-0002/ICNote/p13']); await tag(NOTES, 'Travel');
  at('2026-11-14T10:00:00+09:00'); var shortlist = mac.write('vendor-shortlist.csv', 'Vendor,Quote\nHarborline,48500\nKestrel,51200\n'); mac.select(FINDER, [shortlist]); await tag(FINDER, 'Cost', true);
  at('2026-11-15T09:00:00+09:00');
  mac.addMail({ numericId: '5003', messageId: 'fyi-steel@northfield-devices.example', subject: 'FYI: steel grade', sent: '', account: 'Work', mailbox: 'Drafts', from: 'Mina Seo <mina.seo@northfield-devices.example>', text: 'P20 is enough for 300k shots.' });
  mac.select(MAIL, ['5003']); await tag(MAIL, 'Cost', true);
  at('2026-11-16T09:00:00+09:00'); fs.rmSync(shortlist);
  at('2026-11-17T14:20:00+09:00');
  mac.addMail({ numericId: '5004', messageId: '20261117.1405.ok@northfield-devices.example', subject: 'Approved: Pine Ridge tooling cap', sent: '2026-11-17T14:05:00', account: 'Work', mailbox: 'INBOX', from: 'Jonas Reyes <jonas.reyes@northfield-devices.example>',
    text: 'Mina,\n\nApproved. The Pine Ridge tooling cap is USD 55,000 as of today.\n\nJonas Reyes\nFinance, Northfield Devices' });
  mac.select(MAIL, ['5004']); await tag(MAIL, 'Cost', true);
  at('2026-11-18T16:45:00+09:00'); mac.write('tooling-budget.xlsx', workbook(3));
  at('2026-11-19T09:30:00+09:00');
  return { pop: pop, actions: actions, log: log, ids: { kestrel: 'mid:20261106.1540.k1@kestrel-moldworks.example', workbook: 'file:' + fs.realpathSync(wb) } };
}
/* the same sources as plain files (notes as .md, mail as .eml), for tools that only see a folder */
function writeFileCorpus(dir) {
  fs.mkdirSync(dir, { recursive: true });
  function put(name, data, mtime) { var p = path.join(dir, name); fs.writeFileSync(p, data); if (mtime) { var d = new Date(mtime); fs.utimesSync(p, d, d); } return p; }
  var out = {};
  out.workbook = put('tooling-budget.xlsx', workbook(3), '2026-11-18T16:40:00+09:00');
  out.oldCopy = put('tooling-budget (old copy).xlsx', workbook(1), '2026-11-05T11:00:00+09:00');
  out.kestrel = put('Competing quote - Kestrel.eml', Xlsx.eml({ fromName: 'Ines Varga', fromAddress: 'ines.varga@kestrel-moldworks.example', subject: 'Competing quote: Pine Ridge housing mold', date: 'Fri, 06 Nov 2026 15:40:00 +0900', messageId: '20261106.1540.k1@kestrel-moldworks.example', text: 'Mina,\n\nKestrel Moldworks can build the 2-cavity mold for USD 51,200.\nUNSELECTED-CANARY-KESTREL: lead time 8 weeks.\n\nInes Varga' }));
  out.quote = put('Revised tooling quote.eml', Xlsx.eml({ fromName: 'Dana Okafor', fromAddress: 'dana.okafor@harborline-tooling.example', subject: 'Revised tooling quote: Pine Ridge housing', date: 'Tue, 10 Nov 2026 09:12:00 +0900', messageId: '20261110.0912.rq2@harborline-tooling.example', text: 'Hi Mina,\n\nRevised quote for the Pine Ridge housing mold:\n- 2-cavity mold, P20 steel: USD 48,500\n- Lead time: 6 weeks from purchase order\n\nDana Okafor\nHarborline Tooling' }));
  out.request = put('Request - raise the cap.eml', Xlsx.eml({ fromName: 'Mina Seo', fromAddress: 'mina.seo@northfield-devices.example', to: 'Jonas Reyes <jonas.reyes@northfield-devices.example>', subject: 'Request: raise the Pine Ridge tooling cap', date: 'Thu, 12 Nov 2026 16:30:00 +0900', messageId: '20261112.1630.req@northfield-devices.example', text: 'Jonas,\n\nRequesting approval to raise the Pine Ridge tooling cap from USD 50,000 to USD 55,000.\nReason: H13 steel option and freight.\n\nMina Seo' }));
  out.approval = put('Approved - tooling cap.eml', Xlsx.eml({ fromName: 'Jonas Reyes', fromAddress: 'jonas.reyes@northfield-devices.example', subject: 'Approved: Pine Ridge tooling cap', date: 'Tue, 17 Nov 2026 14:05:00 +0900', messageId: '20261117.1405.ok@northfield-devices.example', text: 'Mina,\n\nApproved. The Pine Ridge tooling cap is USD 55,000 as of today.\n\nJonas Reyes\nFinance, Northfield Devices' }));
  out.note = put('Supplier call - Harborline.md', 'Supplier call: Harborline\nHarborline will hold the price until Nov 30.\nCap is USD 50,000 for now.\n국내 가공 견적은 ₩12,400,000 (부가세 별도).\nOpen: who signs off above the cap?\n', '2026-11-13T17:05:00+09:00');
  out.lunch = put('Lunch order.md', 'IRRELEVANT-CANARY-UNTAGGED-NOTE: two bibimbap, one kimbap. Cost split three ways.\n', '2026-11-13T12:00:00+09:00');
  out.trip = put('Busan trip.md', 'IRRELEVANT-CANARY-TRAVEL: KTX tickets, cost ₩119,600.\n', '2026-11-13T13:00:00+09:00');
  return out;
}

/* ───────── reading a copied context back, as plain text (the checks know nothing of the product's internals) ───────── */
function parseContext(text) {
  var sections = [], cur = null, group = '';
  String(text).split('\n').forEach(function (line) {
    var g = line.match(/^## (.*)$/);
    if (g) { group = /^Timeline/.test(g[1]) ? 'timeline' : /^Date unknown/.test(g[1]) ? 'undated' : /^Unavailable/.test(g[1]) ? 'unavailable' : /^Citations/.test(g[1]) ? 'citations' : g[1]; cur = null; return; }
    var h = line.match(/^### (?:(\d+)\. )?(.*?) — (?:(.*?) — )?(\w[\w ]*?) \[(\w+)\]$/);
    if (h) { cur = { group: group, order: h[1] ? +h[1] : null, when: h[3] ? h[2] : '', dateKind: h[3] || '', kind: h[4], label: h[5], title: '', quoted: [], other: [] }; if (!h[3] && /^Date unknown/.test(h[2])) cur.when = ''; sections.push(cur); return; }
    if (group === 'unavailable' && /^- \[X\d+\]/.test(line)) { var u = line.match(/^- \[(X\d+)\] (\w[\w ]*?) “(.*?)” — (.*)$/); sections.push({ group: 'unavailable', label: u ? u[1] : '', kind: u ? u[2] : '', title: u ? u[3] : '', when: '', dateKind: '', quoted: [], other: [line], reason: u ? u[4] : line }); return; }
    if (!cur) return;
    if (!cur.title && /^“/.test(line)) { cur.title = line.replace(/^“/, '').replace(/”.*$/, ''); return; }
    if (/^> ?/.test(line)) cur.quoted.push(line.replace(/^> ?/, '')); else if (line.trim()) cur.other.push(line);
  });
  return sections;
}
function cellLine(section, sheet, cell) {
  var hit = null;
  section.quoted.forEach(function (l) { if (l.indexOf('[' + sheet + '] ') !== 0) return; l.slice(sheet.length + 3).split(' · ').forEach(function (part) { var m = part.match(/^([A-Z]+\d+): (.*)$/); if (m && m[1] === cell) hit = m[2]; }); });
  return hit;
}
module.exports = { ROOT: ROOT, buildHash: buildHash, environment: environment, stats: stats, timeMs: timeMs, timeAsync: timeAsync, playScenario: playScenario, writeFileCorpus: writeFileCorpus, workbook: workbook, parseContext: parseContext, cellLine: cellLine, Mac: Mac, Xlsx: Xlsx,
  NOTES: NOTES, MAIL: MAIL, FINDER: FINDER, EXCEL: EXCEL };
