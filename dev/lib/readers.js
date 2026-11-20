/* Work Index — development harness: the file-system side of reading, for Node.
 * All parsing is in core/read.js (the same code the Mac app runs). This file only opens files. */
'use strict';
var fs = require('fs');
var path = require('path');
var Core = require('../../core/rules.js');
var Read = require('../../core/read.js');

function offsetMinutes(ms) { return -new Date(ms).getTimezoneOffset(); }
function localIso(ms) { return Core.toLocalIso(ms, offsetMinutes(ms)); }
function reasonCode(err) {
  var c = err && err.code;
  if (c === 'ENOENT' || c === 'ENOTDIR') return 'missing';
  if (c === 'EACCES' || c === 'EPERM') return 'denied';
  if (c === 'EISDIR') return 'folder';
  if (c === 'ELOOP') return 'link';
  return 'error';
}
/* the file as it is on disk right now: { ok, realPath, bytes, mtimeMs, size } or { ok:false, reason } */
function openFile(p, resolve) {
  var real = p, st;
  try {
    if (resolve) real = fs.realpathSync(path.resolve(String(p)));
    st = fs.statSync(real);
  } catch (e) { return { ok: false, reason: reasonCode(e), detail: e.code || e.message }; }
  if (st.isDirectory()) return { ok: false, reason: 'folder' };
  if (!st.isFile()) return { ok: false, reason: 'not-a-file' };
  if (st.size > Read.MAX_FILE) return { ok: true, realPath: real, bytes: null, mtimeMs: st.mtimeMs, size: st.size };
  try { return { ok: true, realPath: real, bytes: fs.readFileSync(real), mtimeMs: st.mtimeMs, size: st.size }; }
  catch (e2) { return { ok: false, reason: reasonCode(e2), detail: e2.code || e2.message }; }
}
function describePath(input) { return Read.describeFile(openFile(input, true), String(input)); }
/* a path, a file:// link or a web link typed or pasted by the user */
function describeInput(input, title) {
  var s = String(input == null ? '' : input).trim().replace(/^["']|["']$/g, '');
  if (!s) return { ok: false, reason: 'nothing to tag' };
  if (/^https?:\/\//i.test(s)) { var u = Core.describeUrl(s, title); return u.ok ? u : { ok: false, reason: u.reason === 'not-one-message' ? 'that link is a mailbox or a search, not one message' : 'that link cannot be tagged' }; }
  if (/^file:\/\//i.test(s)) { try { s = decodeURIComponent(new URL(s).pathname); } catch (e) { return { ok: false, reason: 'that file link is not valid' }; } }
  if (s.indexOf('~/') === 0) s = path.join(require('os').homedir(), s.slice(2));
  return describePath(s);
}
/* Read one indexed source as it is saved right now. */
function readObject(record, opts) {
  opts = opts || {};
  var loc = record.locator || {};
  if (loc.type === 'url') return { status: 'external', reason: 'web link; Work Index does not fetch pages. Open it in a client that is signed in there' };
  if (loc.type === 'apple-notes' || loc.type === 'apple-mail') {
    if (!opts.mac) return { status: 'unavailable', reason: 'this ' + (loc.type === 'apple-notes' ? 'Apple Notes note' : 'Apple Mail message') + ' can only be read on the Mac where it was tagged' };
    return opts.mac.read(record);
  }
  if (loc.type !== 'file') return { status: 'unavailable', reason: 'unknown kind of locator' };
  return Read.readFile(record, openFile(loc.value, false), opts);
}
/* cheap check for the index-only listing: is the source still where the entry says? (contents not read) */
function availability(record) {
  var loc = record.locator || {};
  if (loc.type === 'url') return 'web link, not checked';
  if (loc.type !== 'file') return 'not checked';
  try { return fs.statSync(loc.value).isFile() ? 'available' : 'unavailable: no longer a file'; }
  catch (e) { return 'unavailable: ' + Read.fileReason({ reason: reasonCode(e), detail: e.code }, loc.value); }
}
module.exports = { unzip: Read.unzip, readWorkbook: Read.readWorkbook, readCsv: Read.readCsv, readEmail: Read.readEmail, describePath: describePath, describeInput: describeInput,
  readObject: readObject, availability: availability, localIso: localIso, offsetMinutes: offsetMinutes, openFile: openFile };
