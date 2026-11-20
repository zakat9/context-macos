/* Context: Insert context — the page script. It runs on chatgpt.com only and does nothing until the picker asks.
 *
 * It answers two requests from the extension's own picker, and none from the page:
 *   capture   Where exactly is the person writing? One message box, the caret in it, the draft as it is, this chat.
 *             If any of that is unclear (no message box, two of them, the caret elsewhere, text selected), it says
 *             so and nothing can be inserted.
 *   insert    Put this text at that caret. First everything captured is looked at again: the same chat, the same
 *             message box, the same draft, the caret where it was. Any difference: nothing is inserted. Afterwards
 *             the draft is read back: it must be the old draft with exactly the new text at the caret.
 *
 * It never reads or writes the clipboard, never presses a key or a button, never submits, and never touches any
 * element other than the one message box. It keeps nothing after the page is left.
 */
(function () {
  'use strict';
  var Lib = ContextComposerLib;
  var documentId = Lib.token();          /* a new page load is a new document: a capture made before it is void */
  var held = null;                       /* the one capture: { id, el, kind, draft, caret, chat } */
  var SETTLE = 90;                       /* milliseconds an editor is given to accept or undo what was put in */

  function visible(el) { return !!(el && el.isConnected && el.getClientRects().length); }
  /* ChatGPT's message box: the one visible element with the id "prompt-textarea", a text area or an editable block */
  function findComposer() {
    var all = Array.prototype.filter.call(document.querySelectorAll('#prompt-textarea'), visible);
    if (!all.length) return { ok: false, reason: 'no-composer' };
    if (all.length > 1) return { ok: false, reason: 'ambiguous' };
    var el = all[0];
    if (el.tagName === 'TEXTAREA') return el.readOnly || el.disabled ? { ok: false, reason: 'unsupported' } : { ok: true, el: el, kind: 'textarea' };
    if (el.tagName === 'INPUT') return { ok: false, reason: 'unsupported' };             /* never a one-line field, never a password field */
    if (el.isContentEditable) return { ok: true, el: el, kind: 'editable' };
    return { ok: false, reason: 'unsupported' };
  }
  function draftOf(c) { return c.kind === 'textarea' ? c.el.value : Lib.textOf(c.el); }
  /* the caret as a place in the draft; null when there is none inside the message box; start ≠ end when text is selected */
  function caretOf(c) {
    if (c.kind === 'textarea') return typeof c.el.selectionStart === 'number' ? { start: c.el.selectionStart, end: c.el.selectionEnd } : null;
    var sel = window.getSelection();
    if (!sel || sel.rangeCount !== 1) return null;
    var r = sel.getRangeAt(0);
    if (!c.el.contains(r.startContainer) || !c.el.contains(r.endContainer)) return null;
    return { start: Lib.textOf(c.el, r.startContainer, r.startOffset).length, end: Lib.textOf(c.el, r.endContainer, r.endOffset).length };
  }
  function inComposer(c) { var a = document.activeElement; return a === c.el || (c.kind === 'editable' && !!a && c.el.contains(a)); }

  function capture() {
    held = null;
    var c = findComposer();
    if (!c.ok) return c;
    if (!inComposer(c)) return { ok: false, reason: 'not-in-composer' };
    var caret = caretOf(c);
    if (!caret) return { ok: false, reason: 'not-in-composer' };
    if (caret.start !== caret.end) return { ok: false, reason: 'selection' };
    var draft = draftOf(c);
    held = { id: Lib.token(), el: c.el, kind: c.kind, draft: draft, caret: caret.start, chat: Lib.conversationOf(location) };
    return { ok: true, capture: held.id, document: documentId, chat: held.chat, title: String(document.title || '').slice(0, 80), draftLength: Array.from(draft).length, atEnd: caret.start === draft.length, empty: !draft.length, kind: c.kind };
  }

  function insert(m) {
    var H = held, text = m && m.text;
    if (!H || !m || m.capture !== H.id || m.document !== documentId) return { ok: false, reason: 'stale-capture' };
    if (typeof text !== 'string' || !text.length || text.length > 400000) return { ok: false, reason: 'bad-text' };
    /* everything that was captured, looked at again, immediately before anything is changed */
    if (Lib.conversationOf(location) !== H.chat) { held = null; return { ok: false, reason: 'chat-changed' }; }
    var c = findComposer();
    if (!c.ok || c.el !== H.el || c.kind !== H.kind) { held = null; return { ok: false, reason: 'composer-changed' }; }
    if (!inComposer(c)) return { ok: false, reason: 'not-in-composer' };
    var before = draftOf(c);
    if (before !== H.draft) { held = null; return { ok: false, reason: 'draft-changed' }; }
    var caret = caretOf(c);
    if (!caret || caret.start !== caret.end || caret.start !== H.caret) { held = null; return { ok: false, reason: 'caret-moved' }; }

    var added = Lib.frame(text, before, H.caret), exact = c.kind === 'textarea';
    held = null;                                   /* one capture, one attempt */
    function same() { var k = caretOf(c); return draftOf(c) === before && !!k && k.start === k.end && k.start === H.caret; }
    function settle() { return new Promise(function (done) { setTimeout(done, SETTLE); }); }
    function taken() { return Lib.verifyInsert(before, H.caret, added, draftOf(c), exact); }
    function fail() {
      var after = draftOf(c);
      if (after === before) return { ok: false, reason: 'not-taken' };
      /* something other than the expected text appeared: take our step back and say so */
      var restored = false;
      try { if (exact) { c.el.value = before; c.el.setSelectionRange(H.caret, H.caret); c.el.dispatchEvent(new InputEvent('input', { bubbles: true })); } else document.execCommand('undo'); restored = draftOf(c) === before; } catch (e) { restored = false; }
      return { ok: false, reason: 'unverified', restored: restored };
    }
    /* first as typed text would arrive */
    if (exact) { c.el.setRangeText(added, H.caret, H.caret, 'end'); c.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: added })); }
    else document.execCommand('insertText', false, added);
    /* an editor that keeps its own copy of the text may put its copy back a moment later: the draft is read again
       after it has had that moment, and only what stays counts */
    return settle().then(function () {
      if (taken()) return { ok: true, inserted: Array.from(added).length, how: exact ? 'textarea' : 'typed' };
      if (exact || !same()) return fail();
      /* the editor did not take typed-in text: hand the text to its own handling of pasted text, in a private data
         object. The system clipboard is neither read nor written. */
      var data = new DataTransfer(); data.setData('text/plain', added);
      c.el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      return settle().then(function () { return taken() ? { ok: true, inserted: Array.from(added).length, how: 'handed-over' } : fail(); });
    });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, reply) {
    if (!sender || sender.id !== chrome.runtime.id || sender.tab) return;      /* only the extension's own picker, never a page or another tab's script */
    if (!message || message.to !== 'context-composer') return;
    var out;
    try { out = message.op === 'capture' ? capture() : message.op === 'insert' ? insert(message) : message.op === 'release' ? (held = null, { ok: true }) : { ok: false, reason: 'unknown' }; }
    catch (e) { held = null; out = { ok: false, reason: 'error', detail: String(e && e.message || e).slice(0, 200) }; }
    Promise.resolve(out).then(reply, function (e) { held = null; reply({ ok: false, reason: 'error', detail: String(e && e.message || e).slice(0, 200) }); });
    return true;                                   /* the answer to an insert comes a moment later */
  });
  window.addEventListener('pagehide', function () { held = null; });
})();
