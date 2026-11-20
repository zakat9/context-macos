/* Test asset: a pretend Mac for the Settings window. It does what app/Sources/Settings.swift and HotKey.swift are
 * written to do: keep the settings in one small file, register the Tag current item chord with a pretend macOS
 * (which refuses a chord that something else holds), keep it registered only while an app Context follows is in
 * front, and register or remove the browser helper's file. It is a model of that Swift, not the Swift. */
'use strict';
var fs = require('fs'), path = require('path');
var Settings = require('../../core/settings.js');
function id(chord) { var c = Settings.clean(chord); return c ? c.keyCode + ':' + c.modifiers.join('+') : ''; }

function create(dir, setup) {
  setup = setup || {};
  var os = { dir: dir, file: path.join(dir, 'settings.json'), taken: {}, failWrite: false, failRegister: null, current: null, registered: null, active: false, pressed: 0, onPressed: null, calls: [],
    chromeFolder: path.join(dir, 'Chrome', 'NativeMessagingHosts'), chromeInstalled: setup.chromeInstalled !== false, picked: null };
  if (os.chromeInstalled) fs.mkdirSync(os.chromeFolder, { recursive: true });
  function read() { try { return Settings.sanitize(JSON.parse(fs.readFileSync(os.file, 'utf8'))); } catch (e) { return Settings.sanitize(null); } }
  function write(s) { if (os.failWrite) return false; fs.mkdirSync(dir, { recursive: true }); var tmp = os.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(Settings.sanitize(s), null, 1)); fs.renameSync(tmp, os.file); return true; }
  function macRegister(chord) { if (os.failRegister != null) return os.failRegister; return os.taken[id(chord)] ? -9878 : 0; }       /* what RegisterEventHotKey would answer */
  function apply() { os.registered = os.active && os.current ? os.current : null; }
  /* at launch: what the file says, registered only if an app Context follows is in front */
  os.start = function () { os.current = read().tagShortcut; apply(); return os; };
  os.scope = function (on) { os.active = !!on; apply(); };
  os.press = function (chord) { if (os.registered && Settings.same(os.registered, chord)) { os.pressed++; if (os.onPressed) os.onPressed(); return true; } return false; };
  os.host = {
    state: function () { os.calls.push('state'); var s = read(); return Promise.resolve({ ok: true, tagShortcut: s.tagShortcut, insert: { on: s.insert.on, browsers: s.insert.browsers.map(function (b) { return b.name; }) }, extensionFolder: '/Applications/Context.app/Contents/Resources/composer-extension' }); },
    setShortcut: function (chord) {
      os.calls.push('setShortcut');
      var c = Settings.clean(chord), ok = c && Settings.check(c, null, []).ok;
      if (!ok) return Promise.resolve({ ok: false, reason: 'bad' });
      var status = macRegister(c);                                  /* the new chord is tried while the old one is still registered */
      if (status !== 0) return Promise.resolve({ ok: false, code: status });
      var s = read(); s.tagShortcut = c;
      if (!write(s)) return Promise.resolve({ ok: false, reason: 'not-saved' });       /* the trial registration is given up; the old chord was never touched */
      os.current = c; apply();
      return Promise.resolve({ ok: true });
    },
    clearShortcut: function () { os.calls.push('clearShortcut'); var s = read(); s.tagShortcut = null; if (!write(s)) return Promise.resolve({ ok: false, reason: 'not-saved' }); os.current = null; apply(); return Promise.resolve({ ok: true }); },
    insertEnable: function (which) {
      os.calls.push('insertEnable:' + which);
      var b = which === 'chrome' ? { name: 'Google Chrome', bundleId: 'com.google.Chrome', folder: os.chromeFolder } : os.picked;
      if (!b) return Promise.resolve({ ok: false, reason: 'cancelled' });
      if (!fs.existsSync(b.folder)) return Promise.resolve({ ok: false, reason: 'no-folder' });
      var manifest = path.join(b.folder, 'local.workindex.composer.json'), s = read();
      if (os.failWrite) return Promise.resolve({ ok: false, reason: 'not-saved' });
      fs.writeFileSync(manifest, JSON.stringify({ name: 'local.workindex.composer', description: 'Context: Insert context', path: '/Applications/Context.app/Contents/MacOS/WorkIndex', type: 'stdio', allowed_origins: ['chrome-extension://' + (setup.extensionId || 'x') + '/'] }));
      s.insert.browsers = s.insert.browsers.filter(function (x) { return x.bundleId !== b.bundleId; }).concat([{ name: b.name, bundleId: b.bundleId, manifest: manifest }]); s.insert.on = true;
      write(s);
      return Promise.resolve({ ok: true, insert: { on: true, browsers: s.insert.browsers.map(function (x) { return x.name; }) } });
    },
    insertDisable: function () { os.calls.push('insertDisable'); var s = read(); s.insert.browsers.forEach(function (b) { try { fs.unlinkSync(b.manifest); } catch (e) { /* already gone */ } }); s.insert = { on: false, browsers: [] }; if (!write(s)) return Promise.resolve({ ok: false }); return Promise.resolve({ ok: true }); }
  };
  os.call = function (op, arg) { if (op === 'close' || op === 'reveal') { os.calls.push(op); return Promise.resolve({ ok: true }); } return os.host[op] ? os.host[op](arg) : Promise.resolve({ ok: false }); };
  os.read = read;
  return os.start();
}
module.exports = { create: create, id: id };
