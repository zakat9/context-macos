/* Context — Settings: the rules of the Settings window.
 *
 * Two things can be set, and they have nothing to do with each other:
 *
 *   Shortcuts › Tag current item   A key chord of the person's choosing. Nothing is set until they set it. The Mac
 *                                  app registers it with macOS as a hot key (macOS then tells the app when it is
 *                                  pressed; the app listens to no other key) and only while an app Context follows is
 *                                  in front. A chord that is refused here, or that macOS does not accept, changes
 *                                  nothing: the chord that was set before stays set.
 *   Insert context                 Whether the browser extension may ask this app for tags and sources, and for
 *                                  which browser the local helper is registered. Off until switched on.
 *
 * host (promises of plain objects; in the app these are answered by Settings.swift):
 *   state()            → { ok, tagShortcut: chord | null, insert: { on, browsers: [name] }, extensionFolder }
 *   setShortcut(chord) → { ok } | { ok:false, code, reason }      macOS registers the new chord before the old one is given up
 *   clearShortcut()    → { ok }
 *   insertEnable(which) / insertDisable() → { ok, insert } | { ok:false, reason }        reveal() → shows the extension folder
 *
 * A chord is { keyCode, modifiers: [...], key }: keyCode is the Mac's number for the key's position, key its label.
 */
var ContextSettings = (function () {
  'use strict';
  /* KeyboardEvent.code → the Mac's virtual key code (positions on an ANSI keyboard) */
  var CODES = { KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9, KeyB: 11, KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16, KeyT: 17,
    Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21, Digit6: 22, Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27, Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31, KeyU: 32,
    BracketLeft: 33, KeyI: 34, KeyP: 35, KeyL: 37, KeyJ: 38, Quote: 39, KeyK: 40, Semicolon: 41, Backslash: 42, Comma: 43, Slash: 44, KeyN: 45, KeyM: 46, Period: 47, Space: 49, Backquote: 50,
    F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111 };
  var LABEL = { Equal: '=', Minus: '-', BracketRight: ']', BracketLeft: '[', Quote: '\'', Semicolon: ';', Backslash: '\\', Comma: ',', Slash: '/', Period: '.', Space: 'Space', Backquote: '`' };
  var ORDER = ['control', 'option', 'shift', 'command'], SIGN = { control: '⌃', option: '⌥', shift: '⇧', command: '⌘' }, WORD = { control: 'Control', option: 'Option', shift: 'Shift', command: 'Command' };
  var SUGGESTED = { keyCode: 17, modifiers: ['control', 'option'], key: 'T' };
  var MODIFIER_KEYS = /^(Control|Alt|Shift|Meta|OS)(Left|Right)$|^(CapsLock|Fn|FnLock)$/;

  function clean(chord) {
    if (!chord || typeof chord.keyCode !== 'number' || chord.keyCode < 0 || chord.keyCode > 127 || Math.floor(chord.keyCode) !== chord.keyCode) return null;
    var mods = ORDER.filter(function (m) { return Array.isArray(chord.modifiers) && chord.modifiers.indexOf(m) >= 0; });
    return { keyCode: chord.keyCode, modifiers: mods, key: String(chord.key == null ? '' : chord.key).slice(0, 8) || '?' };
  }
  function show(chord) { var c = clean(chord); return c ? c.modifiers.map(function (m) { return SIGN[m]; }).join('') + c.key : ''; }
  function words(chord) { var c = clean(chord); return c ? c.modifiers.map(function (m) { return WORD[m]; }).concat([c.key]).join('-') : ''; }
  function same(a, b) { a = clean(a); b = clean(b); return !!a && !!b && a.keyCode === b.keyCode && a.modifiers.join() === b.modifiers.join(); }
  /* a key press in the Settings window while a shortcut is being set */
  function fromKeyEvent(e) {
    if (!e || MODIFIER_KEYS.test(String(e.code))) return { ok: false, waiting: true };
    var code = CODES[e.code];
    if (code == null) return { ok: false, message: 'That key cannot be part of a shortcut. Use a letter, a digit or F1 to F12 with Control or Option.' };
    var mods = []; if (e.ctrlKey) mods.push('control'); if (e.altKey) mods.push('option'); if (e.shiftKey) mods.push('shift'); if (e.metaKey) mods.push('command');
    var label = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^F\d+$/.test(e.code) ? e.code : LABEL[e.code];
    return { ok: true, chord: clean({ keyCode: code, modifiers: mods, key: label }) };
  }
  /* may this chord be the shortcut? `current` is what is set now; `others` are Context's other shortcuts: [{ name, chord }] */
  function check(chord, current, others) {
    var c = clean(chord);
    if (!c) return { ok: false, code: 'bad', message: 'That is not a key chord.' };
    if (c.modifiers.indexOf('control') < 0 && c.modifiers.indexOf('option') < 0) return { ok: false, code: 'needs-modifier', message: 'Use Control or Option in the shortcut, so that it does not take over a key you type or a menu command.' };
    if (current && same(c, current)) return { ok: false, code: 'same', message: show(c) + ' is already the shortcut.' };
    var clash = (others || []).filter(function (o) { return same(o.chord, c); })[0];
    if (clash) return { ok: false, code: 'duplicate', message: show(c) + ' is already Context\'s shortcut for ' + clash.name + '.' };
    return { ok: true, chord: c };
  }
  /* what is kept in the settings file: known fields only */
  function sanitize(raw) {
    var out = { version: 1, tagShortcut: null, insert: { on: false, browsers: [] } };
    if (!raw || typeof raw !== 'object') return out;
    var c = clean(raw.tagShortcut); if (c && check(c, null, []).ok) out.tagShortcut = c;
    if (raw.insert && typeof raw.insert === 'object') {
      out.insert.browsers = (Array.isArray(raw.insert.browsers) ? raw.insert.browsers : []).filter(function (b) { return b && typeof b.name === 'string' && typeof b.bundleId === 'string' && typeof b.manifest === 'string'; })
        .map(function (b) { return { name: b.name.slice(0, 80), bundleId: b.bundleId.slice(0, 200), manifest: b.manifest.slice(0, 1024) }; });
      out.insert.on = raw.insert.on === true && out.insert.browsers.length > 0;
    }
    return out;
  }

  function create(host, onChange, opts) {
    opts = opts || {};
    var st = { loaded: false, tagShortcut: null, recording: false, message: '', kind: '', insert: { on: false, browsers: [] }, insertMessage: '', insertKind: '', extensionFolder: '', busy: false };
    function changed() { if (onChange) onChange(view()); return view(); }
    function ask(name, arg) { var p; try { p = Promise.resolve(host[name](arg)); } catch (e) { p = Promise.reject(e); } return p.then(function (r) { return r || { ok: false }; }, function () { return { ok: false }; }); }
    function take(s) { st.tagShortcut = clean(s.tagShortcut); st.insert = { on: !!(s.insert && s.insert.on), browsers: ((s.insert && s.insert.browsers) || []).slice() }; if (s.extensionFolder) st.extensionFolder = String(s.extensionFolder); }
    function load() { return ask('state').then(function (s) { if (s.ok) take(s); st.loaded = true; return changed(); }); }
    function record() { st.recording = true; st.message = ''; st.kind = ''; return changed(); }
    function cancel() { st.recording = false; st.message = ''; st.kind = ''; return changed(); }
    /* a chord was chosen (pressed in the window, or the suggested one). Nothing changes unless macOS takes it. */
    function assign(chord) {
      var was = st.tagShortcut, c = check(chord, was, opts.others || []);
      st.recording = false;
      if (!c.ok) { st.message = c.message + (was && c.code !== 'same' ? ' The shortcut is still ' + show(was) + '.' : ''); st.kind = c.code === 'same' ? '' : 'error'; return Promise.resolve(changed()); }
      st.busy = true;
      return ask('setShortcut', c.chord).then(function (r) {
        st.busy = false;
        if (r.ok) { st.tagShortcut = c.chord; st.message = 'Tag current item is now ' + show(c.chord) + '.'; st.kind = 'done'; }
        else {
          st.message = (r.reason === 'not-saved' ? show(c.chord) + ' could not be saved.' : 'macOS did not accept ' + show(c.chord) + (r.code === -9878 ? ': it is already in use' : '') + (r.code != null ? ' (' + r.code + ').' : '.')) +
            (was ? ' The shortcut is still ' + show(was) + '.' : ' No shortcut is set.');
          st.kind = 'error';
        }
        return changed();
      });
    }
    function key(e) {
      if (!st.recording || st.busy) return Promise.resolve(view());
      if (e && e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return Promise.resolve(cancel());
      var k = fromKeyEvent(e);
      if (k.waiting) return Promise.resolve(view());
      if (!k.ok) { st.recording = false; st.message = k.message + (st.tagShortcut ? ' The shortcut is still ' + show(st.tagShortcut) + '.' : ''); st.kind = 'error'; return Promise.resolve(changed()); }
      return assign(k.chord);
    }
    function useSuggested() { return assign(SUGGESTED); }
    function clear() {
      if (!st.tagShortcut || st.busy) return Promise.resolve(view());
      var was = st.tagShortcut; st.busy = true;
      return ask('clearShortcut').then(function (r) {
        st.busy = false; st.recording = false;
        if (r.ok) { st.tagShortcut = null; st.message = 'No shortcut is set. ' + show(was) + ' is free again.'; st.kind = 'done'; }
        else { st.message = 'The shortcut could not be cleared. It is still ' + show(was) + '.'; st.kind = 'error'; }
        return changed();
      });
    }
    function insertEnable(which) {
      st.busy = true;
      return ask('insertEnable', which).then(function (r) {
        st.busy = false;
        if (r.ok) { st.insert = { on: !!r.insert.on, browsers: (r.insert.browsers || []).slice() }; st.insertMessage = 'Registered. Now the three steps, in that browser.'; st.insertKind = 'done'; }
        else if (r.reason !== 'cancelled') { st.insertMessage = { 'no-folder': 'That browser\'s folder for local helpers was not found. Is the browser installed, and has it been started once?', 'not-saved': 'The helper could not be registered. Nothing was changed.', 'not-a-browser': 'That is not an application.', 'no-socket': 'Context could not open its local connection. Nothing was changed.' }[r.reason] || 'That did not work. Nothing was changed.'; st.insertKind = 'error'; }
        return changed();
      });
    }
    function insertDisable() {
      st.busy = true;
      return ask('insertDisable').then(function (r) {
        st.busy = false;
        if (r.ok) { st.insert = { on: false, browsers: [] }; st.insertMessage = 'Insert context is off. The browser extension can no longer reach Context.'; st.insertKind = 'done'; }
        else { st.insertMessage = 'It could not be switched off completely. Try again.'; st.insertKind = 'error'; }
        return changed();
      });
    }
    function view() {
      return { loaded: st.loaded, busy: st.busy, shortcut: st.tagShortcut ? { text: show(st.tagShortcut), words: words(st.tagShortcut) } : null, recording: st.recording, suggested: show(SUGGESTED), suggestedWords: words(SUGGESTED),
        message: st.message, kind: st.message ? st.kind : '', insert: { on: st.insert.on, browsers: st.insert.browsers.slice() }, insertMessage: st.insertMessage, insertKind: st.insertMessage ? st.insertKind : '', extensionFolder: st.extensionFolder };
    }
    return { load: load, record: record, cancel: cancel, key: key, useSuggested: useSuggested, clear: clear, insertEnable: insertEnable, insertDisable: insertDisable, view: view };
  }
  return { create: create, show: show, words: words, same: same, clean: clean, check: check, fromKeyEvent: fromKeyEvent, sanitize: sanitize, SUGGESTED: SUGGESTED, CODES: CODES };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ContextSettings;
