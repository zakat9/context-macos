/* Test asset: a pretend Mac. Apps with a selection, notes and mail held in memory, real files in a temporary folder,
 * an index folder, a clipboard, and a record of every request the popover makes. It answers the popover's host
 * requests the way the app's Swift side is written to (same reply shapes, same error numbers).
 * The tests keep the truth here, separately from the product, and compare the product's output against it. */
'use strict';
var fs = require('fs'), path = require('path');
var S = '\u001F';

function create(dir) {
  /* The app reports files by their resolved path. On macOS the temporary folder sits behind a link (/var → /private/var),
     so the pretend Mac keeps the resolved path too, or every path comparison differs by that prefix. */
  try { dir = fs.realpathSync(dir); } catch (e) { /* not made yet: kept as given */ }
  var mac = {
    dir: dir, home: path.join(dir, 'home'), files: path.join(dir, 'files'),
    notes: {}, mails: {},                      /* id → { id, title, text, modified, created, locked } ; numericId → { messageId, subject, sent, account, mailbox, from, text } */
    selected: { 'com.apple.Notes': [], 'com.apple.mail': [], 'com.apple.finder': [] }, openDocument: {},     /* bundle id → path of the saved document that is open */
    automationDenied: {}, fileDenied: {}, cloud: {}, failWrite: false, failCopy: false,
    clipboard: null, requests: [], counts: {}
  };
  fs.mkdirSync(mac.files, { recursive: true });
  function note(op, arg) { mac.requests.push(op + (typeof arg === 'string' ? ' ' + arg.slice(0, 80) : '')); mac.counts[op] = (mac.counts[op] || 0) + 1; }
  function indexPath() { return path.join(mac.home, 'index.json'); }
  mac.indexPath = indexPath;
  function selectionNow(bid) {
      if (mac.automationDenied[bid]) return ({ ok: false, code: -1743, message: 'Not authorized to send Apple events.' });
      if (bid === 'com.apple.Notes' || bid === 'com.apple.mail' || bid === 'com.apple.finder') {
        var sel = mac.selected[bid], what = bid === 'com.apple.Notes' ? 'note in Notes' : bid === 'com.apple.mail' ? 'message in Mail' : 'file in Finder';
        if (sel.length !== 1) return ({ ok: true, reply: 'ERR' + S + 'Select exactly one ' + what + '.' });
        if (bid === 'com.apple.finder') return ({ ok: true, reply: 'path' + S + sel[0] });
        if (bid === 'com.apple.Notes') {
          var n = mac.notes[sel[0]];
          if (!n) return ({ ok: false, code: -1728, message: 'Can’t get note.' });
          if (n.locked) return ({ ok: true, reply: 'ERR' + S + 'Locked notes are not tagged.' });
          return ({ ok: true, reply: ['note', n.id, n.title, n.modified, n.created].join(S) });
        }
        var m = mac.mails[sel[0]];
        if (!m) return ({ ok: false, code: -1728, message: 'Can’t get message.' });
        return ({ ok: true, reply: ['email', m.messageId, m.subject, m.sent, m.account, m.mailbox, m.numericId].join(S) });
      }
      if (Object.prototype.hasOwnProperty.call(mac.openDocument, bid)) {
        var p = mac.openDocument[bid];
        if (!p) return (bid.indexOf('com.microsoft.') === 0 ? { ok: false, code: -1728, message: 'Can’t get active document.' } : { ok: true, reply: 'ERR' + S + 'Save the document first: only saved files can be tagged.' });
        return ({ ok: true, reply: 'path' + S + p });
      }
      return ({ ok: false, code: 0, message: 'not followed' });
    }
  mac.selectionNow = selectionNow;
  /* every request, answered at once (the bridge to the browser extension asks the app in this way) */
  var now = {
    selection: function (bid) { note('selection', bid); return (selectionNow(bid)); },
    readNote: function (id) {
      note('readNote', id);
      if (mac.automationDenied['com.apple.Notes']) return ({ ok: false, code: -1743, message: 'Not authorized to send Apple events to Notes.' });
      var n = mac.notes[id];
      if (!n) return ({ ok: false, code: -1728, message: 'Can’t get note id.' });
      if (n.locked) return ({ ok: true, reply: 'ERR' + S + 'The note is locked.' });
      return ({ ok: true, reply: ['note', n.title, n.modified, n.created, n.text].join(S) });
    },
    readMail: function (where) {
      note('readMail', JSON.stringify(where));
      if (mac.automationDenied['com.apple.mail']) return ({ ok: false, code: -1743, message: 'Not authorized to send Apple events to Mail.' });
      var m = mac.mails[where.numericId];
      if (!m || m.account !== where.account || m.mailbox !== where.mailbox) return ({ ok: false, code: -1728, message: 'Can’t get message.' });
      return ({ ok: true, reply: ['email', m.messageId, m.subject, m.sent, m.from, m.text].join(S) });
    },
    readFile: function (p) {
      note('readFile', p);
      if (mac.fileDenied[p]) return ({ ok: false, reason: 'denied' });
      /* fictional files in cloud folders (paths that do not exist on this machine), answered as the app answers:
         an online-only placeholder with its name, size and date and "online", never its contents */
      if (Object.prototype.hasOwnProperty.call(mac.cloud, p)) {
        var c = mac.cloud[p];
        if (c.online) return ({ ok: true, realPath: p, mtimeMs: c.mtimeMs, size: c.size, online: true });
        return ({ ok: true, realPath: p, bytes: c.bytes, mtimeMs: c.mtimeMs, size: c.bytes.length });
      }
      var real, st;
      try { real = fs.realpathSync(p); st = fs.statSync(real); }
      catch (e) { return ({ ok: false, reason: e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'missing' : e.code === 'ELOOP' ? 'link' : e.code === 'EACCES' ? 'denied' : 'error', detail: e.code }); }
      if (mac.fileDenied[real]) return ({ ok: false, reason: 'denied' });
      if (st.isDirectory()) return ({ ok: false, reason: 'folder' });
      if (st.size > 40 * 1024 * 1024) return ({ ok: true, realPath: real, mtimeMs: Math.floor(st.mtimeMs), size: st.size });
      return ({ ok: true, realPath: real, bytes: new Uint8Array(fs.readFileSync(real)), mtimeMs: Math.floor(st.mtimeMs), size: st.size });
    },
    readIndex: function () {
      note('readIndex');
      try { return ({ ok: true, text: fs.readFileSync(indexPath(), 'utf8') }); }
      catch (e) { return (e.code === 'ENOENT' ? { ok: true, missing: true } : { ok: false }); }
    },
    indexStamp: function () {
      note('indexStamp');
      try { var st = fs.statSync(indexPath()); return ({ ok: true, stamp: st.mtimeMs + ':' + st.size + ':' + st.ino }); }
      catch (e) { return ({ ok: true, stamp: 'none' }); }
    },
    writeIndex: function (text) {
      note('writeIndex');
      if (mac.failWrite) return ({ ok: false, message: 'disk full' });
      fs.mkdirSync(mac.home, { recursive: true });
      var tmp = indexPath() + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, indexPath());
      return ({ ok: true });
    },
    copyText: function (text) {
      note('copyText');
      if (mac.failCopy) return ({ ok: false });
      mac.clipboard = String(text);
      return ({ ok: true });
    }
  };
  mac.now = now;
  mac.host = {};
  Object.keys(now).forEach(function (name) { mac.host[name] = function (arg) { return Promise.resolve(now[name](arg)); }; });
  /* the same requests as plain data, for the page test: bytes travel as base64, as they do from the real app */
  mac.call = function (op, arg) {
    return mac.host[op](arg).then(function (r) { if (r && r.bytes) { r.base64 = Buffer.from(r.bytes).toString('base64'); delete r.bytes; } return r; });
  };
  mac.objects = function () { try { return JSON.parse(fs.readFileSync(indexPath(), 'utf8')).objects; } catch (e) { return {}; } };
  mac.indexText = function () { try { return fs.readFileSync(indexPath(), 'utf8'); } catch (e) { return null; } };
  mac.addNote = function (n) { mac.notes[n.id] = n; return n; };
  mac.addMail = function (m) { mac.mails[m.numericId] = m; return m; };
  mac.write = function (name, data, mtimeIso) { var p = path.join(mac.files, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); if (mtimeIso) { var d = new Date(mtimeIso); fs.utimesSync(p, d, d); } return fs.realpathSync(p); };
  mac.select = function (bid, ids) { mac.selected[bid] = [].concat(ids); };
  return mac;
}
module.exports = { create: create, SEP: S };
