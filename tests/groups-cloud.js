/* Regression group new in 0.12.2: files in cloud folders (Google Drive, Dropbox, OneDrive, Box, iCloud Drive).
 * Used by run.js.
 *   CL  naming a cloud file by its service (never by the account folder), online-only placeholders, Google Docs
 *       pointer files, and the whole path from Finder to the copied text over the pretend Mac.
 * Every path here is fictional and does not exist on this machine: the pretend Mac answers for it the way the app
 * answers (app/Sources/Host.swift readFile). No real cloud folder, account or network is used. */
'use strict';
var fs = require('fs'), path = require('path');
module.exports = async function (ctx) {
  var t = ctx.t, fresh = ctx.fresh, ROOT = ctx.ROOT, Core = ctx.Core, Popover = ctx.Popover, Read = require('../core/read.js');
  var Mac = require('./lib/mac.js'), Xlsx = require('./lib/xlsx.js');
  var FINDER = 'com.apple.finder', EMAIL = 'mina.fictional@example.com';
  var GD = '/Users/mina/Library/CloudStorage/GoogleDrive-' + EMAIL, DB = '/Users/mina/Library/CloudStorage/Dropbox';

  /* ── naming ── */
  var cases = [
    [GD + '/My Drive/Reports/2026 Q3 costs.xlsx', 'Google Drive › My Drive › Reports › 2026 Q3 costs.xlsx'],
    [GD + '/Shared drives/Tooling/견적서.csv', 'Google Drive › Shared drives › Tooling › 견적서.csv'],
    [DB + '/Team/notes.md', 'Dropbox › Team › notes.md'],
    ['/Users/mina/Library/CloudStorage/Dropbox-Northfield/plan.txt', 'Dropbox › plan.txt'],
    ['/Users/mina/Dropbox/old/plan.txt', 'Dropbox › old › plan.txt'],
    ['/Users/mina/Library/CloudStorage/OneDrive-Personal/Budget.xlsx', 'OneDrive › Budget.xlsx'],
    ['/Users/mina/Library/CloudStorage/OneDrive-NorthfieldDevices/Shared/a.csv', 'OneDrive › Shared › a.csv'],
    ['/Users/mina/Library/CloudStorage/Box-Box/Specs/spec.txt', 'Box › Specs › spec.txt'],
    ['/Users/mina/Library/Mobile Documents/com~apple~CloudDocs/Travel/receipts.csv', 'iCloud Drive › Travel › receipts.csv'],
    ['/Users/mina/Library/CloudStorage/pCloud-mina/x.txt', 'pCloud › x.txt']
  ];
  var named = cases.map(function (c) { var r = Core.cloudPlace(c[0]); return r ? r.text : null; });
  t('CL01', 'a file in a cloud folder is named by its service and its place inside it: Google Drive (My Drive and shared drives), Dropbox (also a team folder and the older ~/Dropbox), OneDrive (personal and work), Box, iCloud Drive, and another provider by its own name',
    named.every(function (n, i) { return n === cases[i][1]; }), JSON.stringify(named));
  var local = Core.locatorText({ type: 'file', value: '/Users/mina/Documents/costs.xlsx' }), cloudText = Core.locatorText({ type: 'file', value: cases[0][0] });
  t('CL02', 'where a cloud file is cited, the account folder (for Google Drive the email address) and the home folder are left out; a file elsewhere is cited by its path as before',
    cloudText === 'Google Drive › My Drive › Reports › 2026 Q3 costs.xlsx (cloud folder on this Mac)' && cloudText.indexOf(EMAIL) < 0 && cloudText.indexOf('/Users/') < 0 && local === '/Users/mina/Documents/costs.xlsx' && Core.cloudPlace('/Users/mina/Documents/costs.xlsx') === null,
    JSON.stringify([cloudText, local]));

  /* ── an online-only placeholder, and a Google Docs pointer ── */
  var when = Date.parse('2026-11-18T07:40:00Z'), onlineFile = { ok: true, realPath: DB + '/Team/supplier list.csv', mtimeMs: when, size: 52000, online: true };
  var rec = { id: Core.fileId(onlineFile.realPath), locator: { type: 'file', value: onlineFile.realPath } };
  var rOnline = Read.readFile(rec, onlineFile), dOnline = Read.describeFile(onlineFile, onlineFile.realPath);
  t('CL03', 'an online-only file (its contents still in the cloud) is tagged by its name and file date without its contents, and a lookup lists it as not read with what to do, instead of downloading it',
    dOnline.ok && dOnline.desc.title === 'supplier list.csv' && dOnline.desc.sourceTime && dOnline.desc.locator.value === onlineFile.realPath &&
    rOnline.status === 'unreadable' && /^online only in Dropbox: its contents are not on this Mac, and contexta does not download them\. In Finder choose "Make Available Offline" or "Download Now"/.test(rOnline.reason) && !rOnline.content && rOnline.observed.sourceTime,
    JSON.stringify([dOnline, rOnline]));
  var pointer = new TextEncoder().encode(JSON.stringify({ doc_id: 'FICTIONAL123', email: EMAIL, url: 'https://docs.google.com/spreadsheets/d/FICTIONAL123' }));
  var gFile = { ok: true, realPath: GD + '/My Drive/Budget 2027.gsheet', bytes: pointer, mtimeMs: when, size: pointer.length };
  var rG = Read.readFile({ id: Core.fileId(gFile.realPath), locator: { type: 'file', value: gFile.realPath } }, gFile), dG = Read.describeFile(gFile, gFile.realPath);
  t('CL04', 'a Google Sheets file in Google Drive (a pointer; its text is online) can be tagged and is listed as not read, saying how to include it; the pointer\'s contents (account email, address) are not used',
    dG.ok && dG.desc.title === 'Budget 2027.gsheet' && rG.status === 'unreadable' && /^a Google Sheets file: its text is in Google Drive online, not on this Mac\. To include it, download a copy/.test(rG.reason) && JSON.stringify(rG).indexOf(EMAIL) < 0 && JSON.stringify(rG).indexOf('FICTIONAL123') < 0,
    JSON.stringify([dG, rG]));

  /* ── from Finder to the copied text ── */
  var mac = Mac.create(fresh('cloud').dir), tick = 0, clock = Date.parse('2026-11-20T10:00:00+09:00');
  var pop = Popover.create(mac.host, { now: function () { return clock + (tick++) * 60000; } });
  var wbPath = GD + '/My Drive/Reports/2026 Q3 costs.xlsx', wbBytes = Xlsx.write({ modified: '2026-11-16T05:30:00Z', sheets: [{ name: 'Summary', cells: { A1: 'Line', B1: 'Amount', A2: 'Mold maintenance', B2: 820 } }] });
  mac.cloud[wbPath] = { bytes: wbBytes, mtimeMs: Date.parse('2026-11-16T05:30:00Z') };
  mac.cloud[onlineFile.realPath] = { online: true, size: 52000, mtimeMs: when };
  mac.cloud[gFile.realPath] = { bytes: pointer, mtimeMs: when };
  async function tagIt(p, tags) { mac.select(FINDER, [p]); var v = await pop.opened({ bundleId: FINDER, name: 'Finder' }); var shown = v.target; await pop.save(tags); await pop.closed(); return shown; }
  var shownWb = await tagIt(wbPath, 'ZzCloud'), shownOnline = await tagIt(onlineFile.realPath, 'ZzCloud'), shownG = await tagIt(gFile.realPath, 'ZzCloud');
  var objs = mac.objects(), ids = Object.keys(objs).filter(function (k) { return objs[k].tags.indexOf('ZzCloud') >= 0; });
  t('CL05', 'three files selected in Finder inside Google Drive and Dropbox (one synced, one online only, one Google Sheets pointer) are each tagged; the tag editor shows where each one is by service, not by the account folder',
    ids.length === 3 && shownWb.state === 'object' && shownWb.folder === 'Google Drive › My Drive › Reports' && shownOnline.folder === 'Dropbox › Team' && shownG.folder === 'Google Drive › My Drive' &&
    [shownWb, shownOnline, shownG].every(function (s) { return String(s.folder).indexOf(EMAIL) < 0; }), JSON.stringify([ids, shownWb.folder, shownOnline.folder, shownG.folder, shownWb.state]));
  mac.select(FINDER, []); await pop.opened({ bundleId: FINDER, name: 'Finder' });
  var v = await pop.lookup('ZzCloud'), src = (v.lookup && v.lookup.sources) || [];
  function by(title) { return src.filter(function (s) { return s.title === title; })[0] || {}; }
  t('CL06', 'looking the tag up: the synced workbook is read as saved now; the online-only file and the Google Sheets file are listed as not read, each saying why; every row\'s location names the service, never the account folder',
    src.length === 3 && by('2026 Q3 costs.xlsx').status === 'read' && by('supplier list.csv').status === 'not-read' && /online only in Dropbox/.test(by('supplier list.csv').reason) && by('Budget 2027.gsheet').status === 'not-read' && /Google Sheets file/.test(by('Budget 2027.gsheet').reason) &&
    src.every(function (s) { return s.where.indexOf(EMAIL) < 0 && s.where.indexOf('/Library/CloudStorage') < 0; }) && by('2026 Q3 costs.xlsx').where === 'Google Drive › My Drive › Reports › 2026 Q3 costs.xlsx (cloud folder on this Mac)',
    JSON.stringify(src.map(function (s) { return [s.title, s.status, s.reason, s.where]; })));
  var copied = await pop.copy(), text = mac.clipboard || '';
  t('CL07', 'the copied text quotes the workbook\'s cells and cites all three by service and place; the account email, the home folder and the Google pointer\'s contents appear nowhere in it',
    copied.copyState === 'copied' && /Mold maintenance/.test(text) && /Where: Google Drive › My Drive › Reports › 2026 Q3 costs\.xlsx \(cloud folder on this Mac\)/.test(text) && /Dropbox › Team › supplier list\.csv/.test(text) && /Budget 2027\.gsheet/.test(text) &&
    text.indexOf(EMAIL) < 0 && text.indexOf('/Users/mina') < 0 && text.indexOf('FICTIONAL123') < 0, text.slice(0, 1500));

  /* ── the Swift side, by its text ── */
  var host = fs.readFileSync(path.join(ROOT, 'app', 'Sources', 'Host.swift'), 'utf8'), status = fs.readFileSync(path.join(ROOT, 'app', 'Sources', 'Status.swift'), 'utf8');
  var body = (host.match(/func readFile\(_ path: String\) -> \[String: Any\] \{[\s\S]*?\n\}/) || [''])[0];
  t('CL08', 'the app checks for an online-only placeholder with lstat (SF_DATALESS) before it would read a file\'s contents, answers it without contents, and the menu-bar label never opens one (no .eml header read); nothing downloads, opens a network connection or names a cloud service in Swift',
    /let datalessFlag: UInt32 = 0x40000000/.test(host) && /lstat\(path, &info\) == 0/.test(host) && body.indexOf('isOnlineOnly(real)') >= 0 && body.indexOf('isOnlineOnly(real)') < body.indexOf('contents(atPath:') &&
    /"online": true\]/.test(body) && /hasSuffix\("\.eml"\), !isOnlineOnly\(real\)/.test(status) && !/startDownloadingUbiquitousItem|NSFileCoordinator|NSFileProvider|URLSession|googleapis|dropboxapi/.test(host + status),
    body.slice(0, 400));
};
