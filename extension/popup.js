/* Context: Insert context — the picker. It opens from the toolbar button or the shortcut the person set for it.
 * It asks the page script where the person is writing, asks the Context Mac app (through the local helper the
 * person set up) for tags and sources, and, only when Insert is pressed, hands the text to the page script.
 * It never sends a message, and writes the clipboard only when "Copy instead" is pressed. */
(function () {
  'use strict';
  var Lib = ContextComposerLib;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  var S = { tab: null, cap: null, capWhy: '', tags: [], hi: 0, look: null, off: {}, busy: false, hostWhy: '', said: '', saidOn: false, port: null, turn: 0, waiting: {} };

  var WHY = {
    'not-chat': 'This tab is not ChatGPT. Insert works in the ChatGPT message box only.',
    'not-a-popup': 'Open this from the toolbar button or with your shortcut, while you are in a ChatGPT tab.',
    'no-script': 'This ChatGPT tab was open before the extension was. Reload the tab once.',
    'no-composer': 'The ChatGPT message box was not found on this page.',
    ambiguous: 'More than one message box was found, so it is not clear where to insert.',
    unsupported: 'This message box is of a kind Context does not know.',
    'not-in-composer': 'The caret is not in the message box. Click in the message box where the evidence should go, then open this again.',
    selection: 'Text is selected in the message box. Click where the evidence should go, so that nothing is replaced, then open this again.'
  };
  var REFUSED = {
    'stale-capture': 'The page was reloaded or this was opened again elsewhere.',
    'chat-changed': 'The chat changed after this was opened.',
    'composer-changed': 'The message box changed after this was opened.',
    'draft-changed': 'The draft changed after this was opened.',
    'caret-moved': 'The caret moved after this was opened.',
    'not-in-composer': 'The caret is no longer in the message box.',
    'tab-changed': 'Another tab or window came to the front.',
    'not-taken': 'The message box did not take the text.',
    'bad-text': 'There was no text to insert.',
    error: 'The page could not be reached.'
  };
  var HOSTWHY = {
    'not-found': 'Context is not connected to this browser. In the Context Mac app, open Settings and set up Insert context for this browser.',
    forbidden: 'This browser is not allowed to reach Context. In the Context Mac app, open Settings and set up Insert context again.',
    exited: 'The Context helper stopped. Open the Context Mac app and try again.',
    'not-running': 'The Context Mac app is not running. Open it, then open this again.',
    off: 'Insert context is switched off in the Context Mac app. It is switched on in its Settings.',
    'not-paired': 'Context was not set up for this browser. In the Context Mac app, open Settings and set up Insert context for this browser.',
    timeout: 'Context did not answer.'
  };

  /* ── the Context app, through the local helper ── */
  function connect() {
    try { S.port = chrome.runtime.connectNative(Lib.HOST); } catch (e) { S.hostWhy = 'not-found'; return; }
    S.port.onMessage.addListener(function (m) { var w = m && S.waiting[m.id]; if (w) { delete S.waiting[m.id]; w(m); } });
    S.port.onDisconnect.addListener(function () {
      var text = (chrome.runtime.lastError && chrome.runtime.lastError.message) || '';
      S.port = null; S.hostWhy = /not found/i.test(text) ? 'not-found' : /forbidden/i.test(text) ? 'forbidden' : 'exited';
      Object.keys(S.waiting).forEach(function (id) { var w = S.waiting[id]; delete S.waiting[id]; w({ ok: false, reason: S.hostWhy }); });
      render();
    });
  }
  function ask(op, extra) {
    return new Promise(function (resolve) {
      if (!S.port) { resolve({ ok: false, reason: S.hostWhy || 'exited' }); return; }
      var id = ++S.turn, m = { id: id, op: op }; Object.keys(extra || {}).forEach(function (k) { m[k] = extra[k]; });
      S.waiting[id] = resolve;
      setTimeout(function () { if (S.waiting[id]) { delete S.waiting[id]; resolve({ ok: false, reason: 'timeout' }); } }, 12000);
      try { S.port.postMessage(m); } catch (e) { delete S.waiting[id]; resolve({ ok: false, reason: 'exited' }); }
    });
  }
  function hostTrouble(r) { if (r && !r.ok && HOSTWHY[r.reason]) { S.hostWhy = r.reason; return true; } return false; }
  function toPage(message) {
    message.to = 'context-composer';
    return chrome.tabs.sendMessage(S.tab.id, message).catch(function () { return { ok: false, reason: 'error' }; });
  }

  /* ── what is shown ── */
  function say(text, on) { S.said = text || ''; S.saidOn = !!on; }
  function ticked() { return S.look ? S.look.sources.filter(function (s) { return !S.off[s.id]; }).map(function (s) { return s.id; }) : []; }
  function render() {
    var canInsert = !!S.cap, matches = Lib.filterTags(S.tags, $('tag').value), box = $('tags'), list = $('list');
    $('target').textContent = canInsert ? 'Into the ChatGPT message box, at the caret' + (S.cap.empty ? ' (the box is empty).' : S.cap.atEnd ? ' (the end of your draft).' : ' (inside your draft).') : (WHY[S.capWhy] || 'Checking where you are writing…');
    $('chat').textContent = canInsert ? 'Chat: ' + (S.cap.title || 'ChatGPT') : S.capWhy ? 'Nothing can be inserted from here. You can still copy.' : '';
    box.textContent = '';
    $('tag').disabled = !!S.hostWhy;
    if (!S.look && !S.hostWhy) {
      if (S.hi >= matches.length) S.hi = Math.max(0, matches.length - 1);
      matches.forEach(function (t, i) {
        var b = el('button', 'tagrow' + (i === S.hi ? ' hi' : '')); b.type = 'button'; b.tabIndex = -1; b.setAttribute('data-tag', t.name);
        var n = el('span', 'n', t.name); n.dir = 'auto'; n.title = t.name; b.appendChild(n); b.appendChild(el('span', 'c', plural(t.count, 'source')));
        b.addEventListener('click', function () { choose(t.name); });
        box.appendChild(b);
      });
    }
    $('sources').hidden = !S.look || !S.look.sources.length;
    list.textContent = '';
    if (S.look && S.look.sources.length) {
      var c = S.look.counts || {}, n = ticked().length, total = S.look.sources.length;
      $('summary').textContent = plural(total, 'source') + ' for ' + S.look.query.join(' and ') + ', oldest first.' + (c.unavailable ? ' ' + c.unavailable + ' unavailable.' : '');
      $('all').hidden = $('none').hidden = total < 2;
      S.look.sources.forEach(function (s) {
        var row = el('label', 'src' + (S.off[s.id] ? ' off' : '')), box2 = el('input'); box2.type = 'checkbox'; box2.checked = !S.off[s.id]; box2.setAttribute('data-id', s.id);
        box2.setAttribute('aria-label', 'Include ' + s.label + ', ' + s.kind + ': ' + s.title);
        box2.addEventListener('change', function () { if (box2.checked) delete S.off[s.id]; else S.off[s.id] = true; say(''); render(); var again = document.querySelector('input[data-id="' + CSS.escape(s.id) + '"]'); if (again) again.focus(); });
        row.appendChild(box2);
        var w = el('span', 'w'), l1 = el('span', 'l1'); l1.appendChild(el('span', 'badge', s.label));
        var t = el('span', 't', s.title); t.dir = 'auto'; t.title = s.title; l1.appendChild(t);
        if (s.changed) l1.appendChild(el('span', 'flag', 'Changed'));
        w.appendChild(l1);
        var m = el('span', 'm', s.group === 'unavailable' ? s.kind + ', unavailable: ' + s.reason : s.kind + ', ' + (s.when ? s.dateLabel + ' ' + s.when : 'date unknown') + (s.status === 'read' ? '' : s.status === 'too-long' ? ' (too long: listed, not quoted)' : ' (not read: ' + s.reason + ')'));
        m.title = m.textContent; w.appendChild(m);
        row.appendChild(w); list.appendChild(row);
      });
      $('insert').textContent = n === total ? 'Insert ' + plural(n, 'source') : n ? 'Insert ' + n + ' of ' + total : 'Insert';
      $('insert').disabled = !n || !canInsert || S.busy; $('copy').disabled = !n || S.busy;
    } else { $('insert').textContent = 'Insert'; $('insert').disabled = true; $('copy').disabled = true; }
    var text = S.hostWhy ? HOSTWHY[S.hostWhy] : S.said || (S.look ? (S.look.sources.length ? (canInsert ? 'Untick what should stay out, then press Insert.' : 'Untick what should stay out. You can copy; nothing can be inserted from here.') : S.look.empty)
      : S.tags.length ? (matches.length ? 'Type to search your tags. Return chooses.' : 'No tag matches “' + $('tag').value + '”.') : S.loaded ? 'No tags yet. Tag something with the Context Mac app first.' : 'Asking Context…');
    $('msg').textContent = text; $('msg').className = S.hostWhy || S.saidOn ? 'on' : '';
    document.body.setAttribute('data-ready', String(Date.now()));
  }

  /* ── what the person does ── */
  function choose(name) {
    if (S.busy) return;
    S.busy = true; say('Reading the sources of ' + name + ' as they are saved now…'); $('tag').value = name; render();
    ask('lookup', { tag: name }).then(function (r) {
      S.busy = false;
      if (hostTrouble(r)) { render(); return; }
      if (!r.ok) { say(r.message || 'That did not work.', true); render(); return; }
      if (r.tags) S.tags = r.tags;
      S.look = r; S.off = {}; say('');
      render();
      if (r.sources.length) ($('insert').disabled ? $('copy') : $('insert')).focus();
    });
  }
  /* the text for the ticked sources, or the reason there is none; the list is brought up to date when a source changed */
  function fetchText() {
    return ask('render', { token: S.look.token, selected: ticked() }).then(function (r) {
      if (hostTrouble(r)) return null;
      if (r.ok) return r;
      if (r.reason === 'changed') { S.look.sources = r.sources; S.look.counts = r.counts; say(r.message + ' Nothing was inserted or copied.', true); }
      else if (r.reason === 'index-changed' || r.reason === 'expired') { S.look = null; if (r.tags) S.tags = r.tags; $('tag').value = ''; say((r.message || 'Choose the tag again.') + ' Nothing was inserted or copied.', true); }
      else say((r.message || 'That did not work.') + ' Nothing was inserted or copied.', true);
      return null;
    });
  }
  function insert() {
    if (S.busy || !S.cap || !S.look || !ticked().length) return;
    S.busy = true; say('Checking the sources again…'); render();
    fetchText().then(function (r) {
      if (!r) { S.busy = false; render(); if (!S.look) $('tag').focus(); return; }
      /* the browser is asked once more: the same tab, in front, in the same window, on the same chat */
      return chrome.tabs.get(S.tab.id).then(function (t) { return t; }, function () { return null; }).then(function (t) {
        if (!t || !t.active || t.windowId !== S.tab.windowId || t.url !== S.tab.url) return { ok: false, reason: t && t.active && t.url !== S.tab.url ? 'chat-changed' : 'tab-changed' };
        return toPage({ op: 'insert', capture: S.cap.capture, document: S.cap.document, text: r.text });
      }).then(function (res) {
        S.busy = false;
        if (res && res.ok) { ask('done', { result: 'inserted' }); window.close(); return; }
        var why = res && res.reason === 'unverified' ? 'The message box did not take the text as expected. ' + (res.restored ? 'Your draft is as it was.' : 'Look at your draft before you go on.') : (REFUSED[res && res.reason] || 'The message box could not be reached.') + ' Nothing was inserted.';
        S.cap = null; S.capWhy = 'refused';
        WHY.refused = why; say(why + ' You can copy instead, or close this and open it again.', true);
        render(); $('copy').focus();
      });
    });
  }
  function copy() {
    if (S.busy || !S.look || !ticked().length) return;
    S.busy = true; render();
    fetchText().then(function (r) {
      S.busy = false;
      if (!r) { render(); return; }
      navigator.clipboard.writeText(r.text).then(function () { ask('done', { result: 'copied' }); say('✓ Copied ' + plural(r.count, 'source') + '. Paste it yourself. Nothing was sent.', true); render(); },
        function () { say('The text could not be copied.', true); render(); });
    });
  }

  $('tag').addEventListener('input', function () { if (S.look) { S.look = null; S.off = {}; } S.hi = 0; say(''); render(); });
  $('tag').addEventListener('keydown', function (e) {
    if (e.isComposing || e.keyCode === 229) return;
    var matches = Lib.filterTags(S.tags, $('tag').value);
    if (e.key === 'ArrowDown') { e.preventDefault(); if (S.look) { var first = document.querySelector('#list input'); if (first) first.focus(); } else { S.hi = Math.min(matches.length - 1, S.hi + 1); render(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); S.hi = Math.max(0, S.hi - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (S.look) { if (!$('insert').disabled) $('insert').focus(); } else if (matches.length) choose(matches[S.hi].name); }
  });
  $('insert').addEventListener('click', insert);
  $('copy').addEventListener('click', copy);
  $('all').addEventListener('click', function () { S.off = {}; say(''); render(); });
  $('none').addEventListener('click', function () { if (S.look) S.look.sources.forEach(function (s) { S.off[s.id] = true; }); say(''); render(); });
  window.addEventListener('pagehide', function () { if (S.tab && S.cap) { try { chrome.tabs.sendMessage(S.tab.id, { to: 'context-composer', op: 'release' }).catch(function () {}); } catch (e) { /* closing */ } } });

  /* ── start: where is the person writing, and what does Context have ── */
  render();
  chrome.tabs.getCurrent().then(function (own) {
    if (own) { S.capWhy = 'not-a-popup'; return null; }                       /* opened as a page, not as the picker */
    return chrome.tabs.query({ active: true, currentWindow: true });
  }).then(function (tabs) {
    if (!tabs) return null;
    S.tab = tabs[0] || null;
    if (!S.tab || typeof S.tab.url !== 'string' || S.tab.url.indexOf('https://chatgpt.com/') !== 0) { S.capWhy = 'not-chat'; return null; }
    return chrome.tabs.sendMessage(S.tab.id, { to: 'context-composer', op: 'capture' }).then(function (c) { return c || { ok: false, reason: 'no-script' }; }, function () { return { ok: false, reason: 'no-script' }; });
  }).then(function (c) {
    if (c && c.ok) S.cap = c; else if (c) S.capWhy = c.reason;
    render();
    connect();
    return ask('open');
  }).then(function (r) {
    S.loaded = true;
    if (!hostTrouble(r) && r.ok) S.tags = r.tags || [];
    else if (!S.hostWhy && r && !r.ok) say(r.message || 'Context could not open its index.', true);
    render(); $('tag').focus();
  });
})();
