/* contexta: Insert context — the small pure parts shared by the page script and the picker.
 * No access to anything: text in, text out. Also run by the tests in Node. */
var ContextComposerLib = (function () {
  'use strict';
  var HOST = 'local.workindex.composer';
  var BLOCK = /^(P|DIV|LI|UL|OL|PRE|BLOCKQUOTE|H[1-6]|TR|TABLE|SECTION|ARTICLE)$/;

  /* The text of an editable message box, read from its structure, not from how it is laid out: text as written,
     a line break for <br>, one line break between blocks (paragraphs), an empty paragraph as an empty line.
     With a stop position (a node and an offset, as a caret gives them) it returns the text before that position,
     so its length is the caret's place in the draft. */
  function textOf(root, stopNode, stopOffset) {
    var out = '', needBreak = false, stopped = false;
    function content(s) { if (needBreak) { out += '\n'; needBreak = false; } out += s; }
    function lastInBlock(node) {            /* is this <br> the last thing in its block: the placeholder an editor keeps in a line */
      var n = node;
      while (n && n !== root) {
        var next = n.nextSibling;
        while (next) { if (next.nodeType === 1 || (next.nodeType === 3 && next.data.length)) return false; next = next.nextSibling; }
        n = n.parentNode;
        if (n && n.nodeType === 1 && BLOCK.test(n.nodeName)) return true;
      }
      return true;
    }
    function hasContentBefore(node) {       /* does anything precede this <br> inside its block */
      var n = node;
      while (n && n !== root) {
        var prev = n.previousSibling;
        while (prev) { if (prev.nodeType === 1 || (prev.nodeType === 3 && prev.data.length)) return true; prev = prev.previousSibling; }
        n = n.parentNode;
        if (n && n.nodeType === 1 && BLOCK.test(n.nodeName)) return false;
      }
      return false;
    }
    function walk(node) {
      if (stopped) return;
      if (node.nodeType === 3) {
        if (node === stopNode) { content(node.data.slice(0, stopOffset)); stopped = true; return; }
        if (node.data.length) content(node.data);
        return;
      }
      if (node.nodeType !== 1) return;
      var block = node !== root && BLOCK.test(node.nodeName);
      if (block && out.length) needBreak = true;
      if (node.nodeName === 'BR') {
        if (node === stopNode) { stopped = true; return; }
        if (!lastInBlock(node)) content('\n');
        else if (!hasContentBefore(node)) content('');           /* an empty line */
        return;
      }
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) {
        if (node === stopNode && i === stopOffset) { stopped = true; return; }
        walk(kids[i]);
        if (stopped) return;
      }
      if (node === stopNode) { stopped = true; return; }
      if (block) needBreak = true;
    }
    walk(root);
    if (stopNode && stopped && needBreak) out += '\n';           /* the caret stands at the start of the next line */
    return out;
  }

  /* what must be the same before and after: every visible character, in order; how an editor writes its line breaks
     and spaces between them is its own business */
  function norm(s) { return String(s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }
  /* the evidence goes on lines of its own: a line break before it unless the caret is at the start of a line,
     and after it unless a line break already follows */
  function frame(text, before, caret) {
    var lead = caret > 0 && before.charAt(caret - 1) !== '\n' ? '\n' : '', trail = before.charAt(caret) === '\n' ? '' : '\n';
    return lead + String(text).replace(/\r\n?/g, '\n') + trail;
  }
  /* was exactly this text added at exactly that place, and nothing else touched */
  function verifyInsert(before, caret, added, after, exact) {
    var want = before.slice(0, caret) + added + before.slice(caret);
    return exact ? after === want : norm(after) === norm(want);
  }
  function filterTags(tags, query) {
    var q = String(query || '').normalize('NFC').toLowerCase().trim().replace(/^(::|#|＃)/, '');
    return (tags || []).filter(function (t) { return !q || String(t.name).normalize('NFC').toLowerCase().indexOf(q) >= 0; });
  }
  function conversationOf(loc) { return String(loc.origin) + String(loc.pathname) + String(loc.search || ''); }
  function token() { var a = new Uint32Array(4); (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : require('crypto').webcrypto).getRandomValues(a); return Array.prototype.map.call(a, function (x) { return x.toString(36); }).join(''); }

  return { HOST: HOST, textOf: textOf, norm: norm, frame: frame, verifyInsert: verifyInsert, filterTags: filterTags, conversationOf: conversationOf, token: token };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ContextComposerLib;
