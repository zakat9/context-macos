/* Test asset: a pretend macOS for the App access window. It keeps, per app, whether it is installed and open and
 * what the person has decided, and it stands in for the macOS permission prompt: when a request needs one, it
 * records it, lets only one be on screen at a time, and takes the person's answer from the test.
 * This is a mock. It shows what Context's own rules do around the prompt; it cannot show what macOS does. */
'use strict';
var ALL = [['com.apple.Notes', 'Notes'], ['com.apple.mail', 'Mail'], ['com.apple.finder', 'Finder'], ['com.microsoft.Excel', 'Microsoft Excel'], ['com.microsoft.Word', 'Microsoft Word'], ['com.microsoft.Powerpoint', 'Microsoft PowerPoint'],
  ['com.apple.iWork.Numbers', 'Numbers'], ['com.apple.iWork.Pages', 'Pages'], ['com.apple.iWork.Keynote', 'Keynote'], ['com.apple.Preview', 'Preview'], ['com.apple.TextEdit', 'TextEdit']];
function create(setup) {
  var os = { apps: {}, prompts: [], opened: [], checks: [], settingsOpened: 0, closed: 0, shown: 0, onScreen: 0, maxOnScreen: 0, answer: null, waiting: null, failOpen: {} };
  ALL.forEach(function (a) { var s = (setup && setup[a[0]]) || {}; os.apps[a[0]] = { id: a[0], name: a[1], installed: s.installed !== false, running: !!s.running, perm: s.perm == null ? -1744 : s.perm }; });
  /* the person's answer to the prompt for one app: 'allow' | 'deny', given by the test, possibly later */
  function decide(id) {
    return new Promise(function (resolve) {
      os.onScreen++; os.maxOnScreen = Math.max(os.maxOnScreen, os.onScreen); os.prompts.push(id);
      function done(answer) { os.onScreen--; os.waiting = null; os.apps[id].perm = answer === 'allow' ? 0 : -1743; resolve(); }
      if (os.answer) Promise.resolve(os.answer(id)).then(done); else os.waiting = { id: id, answer: done };
    });
  }
  os.host = {
    apps: function () { return Promise.resolve({ ok: true, apps: ALL.map(function (a) { var x = os.apps[a[0]]; return { id: x.id, name: x.name, installed: x.installed, running: x.running }; }) }); },
    check: function (id) { os.checks.push(id); var a = os.apps[id]; return Promise.resolve(a && a.running ? { ok: true, code: a.perm } : { ok: false }); },
    request: function (id) {
      var a = os.apps[id];
      if (!a) return Promise.resolve({ ok: false });
      if (!a.running) {
        if (!a.installed) return Promise.resolve({ ok: true, code: -10814 });
        os.opened.push(id);
        if (os.failOpen[id]) return Promise.resolve({ ok: true, code: -600 });
        a.running = true;
      }
      if (a.perm !== -1744) return Promise.resolve({ ok: true, code: a.perm });       /* macOS has decided already: no prompt */
      return decide(id).then(function () { return { ok: true, code: a.perm }; });
    },
    settings: function () { os.settingsOpened++; return Promise.resolve({ ok: true }); }
  };
  os.call = function (op, arg) {
    if (op === 'close') { os.closed++; return Promise.resolve({ ok: true }); }
    if (op === 'show') { os.shown++; return Promise.resolve({ ok: true }); }
    return os.host[op] ? os.host[op](arg) : Promise.resolve({ ok: false });
  };
  return os;
}
module.exports = { create: create, ALL: ALL };
