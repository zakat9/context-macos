/* Work Index v9 — macOS only: ask the app in front which single object is active, and read an Apple Notes
 * note or Apple Mail message again by its identifier. Uses documented Apple Events through /usr/bin/osascript,
 * which macOS gates behind the Automation permission prompt. The scripts only read; see lib/core.js.
 * NOT exercised in the build environment (Linux): see QA-LOG.md, "Not run". */
'use strict';
var cp = require('child_process');
var Core = require('../../core/rules.js');
var Readers = require('./readers.js');

function isMac() { return process.platform === 'darwin'; }
function osa(src) { return cp.execFileSync('/usr/bin/osascript', ['-e', src], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }); }
function frontBundleId() {
  var asn = cp.execFileSync('/usr/bin/lsappinfo', ['front'], { encoding: 'utf8', timeout: 5000 }).trim();
  var info = cp.execFileSync('/usr/bin/lsappinfo', ['info', '-only', 'bundleid', asn], { encoding: 'utf8', timeout: 5000 });
  var m = info.match(/"CFBundleIdentifier"\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}
function explain(e) {
  var t = String((e && e.stderr) || (e && e.message) || e);
  if (/-1743|not authori[sz]ed|Not authorized to send Apple events/i.test(t)) return 'macOS is not allowing this. Allow it under System Settings › Privacy & Security › Automation';
  if (/-1712|timed out/i.test(t)) return 'the app did not answer in time';
  if (/-1728|-1719|Can.t get/i.test(t)) return 'the object could not be found in the app';
  return 'the app could not be asked (' + t.trim().split('\n').pop().slice(0, 160) + ')';
}
/* the single object that is active in the app in front → something describeInput/bind can use */
function active() {
  if (!isMac()) return { ok: false, reason: 'Detecting the active object needs macOS. Give a file path or a link instead.' };
  var bid, src, reply;
  try { bid = frontBundleId(); } catch (e) { return { ok: false, reason: 'could not tell which app is in front' }; }
  /* Chromium-family browsers not in the built-in list (their identifiers are not guessed): WORKINDEX_BROWSERS=id1,id2 */
  src = Core.scriptForApp(bid, String(process.env.WORKINDEX_BROWSERS || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean));
  if (!src) return { ok: false, reason: 'the app in front (' + bid + ') is not one Work Index can ask. Give a file path or a link instead; for a Chromium-family browser, set WORKINDEX_BROWSERS=' + bid };
  try { reply = osa(src); } catch (e) { return { ok: false, reason: explain(e) }; }
  var a = Core.parseActive(reply, Readers.offsetMinutes(Date.now()));
  if (!a.ok) return a;
  if (a.desc) return a;
  if (a.path) return Readers.describePath(a.path);
  return Readers.describeInput(a.url, a.title);
}
function read(record) {
  var src = Core.scriptForRead(record.locator);
  if (!src) return { status: 'unavailable', reason: 'the entry does not hold enough to find this object again' };
  var reply;
  try { reply = osa(src); } catch (e) { return { status: 'unavailable', reason: explain(e) }; }
  var f = String(reply).replace(/\n$/, '').split(Core.SEP), off = Readers.offsetMinutes(Date.now());
  if (f[0] === 'ERR') return { status: 'unavailable', reason: f[1] || 'not accessible' };
  if (f[0] === 'note') return { status: 'ok', content: { type: 'text', lines: String(f.slice(4).join(Core.SEP)).replace(/\r\n?/g, '\n').split('\n') },
    observed: { title: f[1], sourceTime: Core.isotToIso(f[2], off), sourceTimeType: Core.isotToIso(f[2], off) ? 'modified' : 'unknown', sourceCreated: Core.isotToIso(f[3], off) } };
  if (f[0] === 'email') {
    if (Core.messageId(f[1]) !== record.id) return { status: 'unavailable', reason: 'a different message is now at that place in Mail' };
    return { status: 'ok', content: { type: 'email', headers: { from: f[4], subject: f[2], messageId: f[1] }, text: f.slice(5).join(Core.SEP), attachments: [] },
      observed: { title: f[2], sourceTime: Core.isotToIso(f[3], off), sourceTimeType: Core.isotToIso(f[3], off) ? 'sent' : 'unknown', sourceCreated: null } };
  }
  return { status: 'unavailable', reason: 'the app gave an unexpected answer' };
}
/* a small native text field, so a tag can be typed without switching to another window */
function promptTags(title) {
  var t = String(title).replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 120);
  var out = osa('set r to display dialog "Tag “' + t + '”\\nOne or two tags, for example ::Cost" default answer "::" with title "Work Index" buttons {"Cancel", "Tag"} default button "Tag"\nreturn text returned of r');
  return out.replace(/\n$/, '');
}
function copy(text) { cp.execFileSync('/usr/bin/pbcopy', [], { input: text, timeout: 5000 }); }
module.exports = { isMac: isMac, active: active, read: read, promptTags: promptTags, copy: copy };
