/* Context — what the menu-bar item shows while the popover is closed.
 *
 * The item shows the tags (0 to 2) of the ONE whole object that is selected in the app in front: a note, a mail
 * message, a saved file. This file decides everything about that: when the app in front is asked, which answers are
 * believed, and what the item shows. The Mac shell (Status.swift) only carries events in and commands out.
 *
 * What it will not do, by construction:
 *   · It asks nothing of an app Context does not follow, and nothing while the popover is open or the Mac is asleep.
 *   · It asks only for the selected object's identity (the same read-only question the popover asks). No contents.
 *   · It never causes a macOS permission prompt and never opens an app: every question carries the rule that the
 *     shell must first see the app running, in front and already allowed, and must not ask otherwise.
 *   · It listens to no keys and no pointer. It learns of an app switch from the system; inside an app it looks again
 *     at a pace that slows down while nothing changes.
 *   · An answer is believed only if it belongs to the newest question and to the app still in front.
 *
 * step(event) → [commands]
 *   events    { type:'app', bundleId, name, pid, own?, popover?, now, stamp? }   the app in front changed (also sent at start)
 *             { type:'tick', now, stamp? }                                        the one timer fired
 *             { type:'answer', seq, bundleId, pid, perm, ok?, reply?, code?, realPath?, emlHead?, skipped?, now, stamp? }
 *             { type:'index', stamp, text? | missing? | failed?, now }            the index file as it is now
 *             { type:'saved', now, stamp }                                        the popover wrote the index
 *             { type:'popover', open, now }   { type:'pause', now }   { type:'resume', now }   { type:'access', now }
 *   commands  { do:'show', state:'tags'|'none'|'off'|'wait', title, tags, tooltip, label }
 *             { do:'ask', seq, bundleId, pid }      ask the app in front which one object is selected (rules above)
 *             { do:'index' }                         read the index file and send it back as an 'index' event
 *             { do:'wait', ms }                      one timer; a new one replaces the old
 *             { do:'idle' }                          no timer
 *             { do:'scope', on }                     an app Context follows is (or is not) in front: register (or give up) the hot key
 */
var ContextStatus = (function (Core) {
  'use strict';
  var PACE = { settle: 120, fast: 500, mid: 1000, slow: 2000, fastFor: 10000, midFor: 60000, retry: 5000, retryMax: 10000, permission: 5000, answerLimit: 4000 };
  var TAG_UNITS = 10, TITLE_CHARS = 80;
  var NOUN = { email: 'message', note: 'note', workbook: 'workbook', file: 'file', page: 'page' };

  /* how wide a piece of text is in the menu bar, counting a Korean, Chinese or Japanese character as two */
  function wide(cp) {
    return (cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF) || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF) ||
      (cp >= 0xFE30 && cp <= 0xFE4F) || (cp >= 0xFF00 && cp <= 0xFF60) || (cp >= 0xFFE0 && cp <= 0xFFE6) || (cp >= 0x1F300 && cp <= 0x1FAFF) || (cp >= 0x20000 && cp <= 0x3FFFD);
  }
  function units(text) { var n = 0; Array.from(String(text)).forEach(function (ch) { n += wide(ch.codePointAt(0)) ? 2 : 1; }); return n; }
  function clip(text, max) {
    var chars = Array.from(String(text));
    if (units(text) <= max) return String(text);
    var out = '', n = 0;
    for (var i = 0; i < chars.length; i++) { var w = wide(chars[i].codePointAt(0)) ? 2 : 1; if (n + w > max - 1) break; out += chars[i]; n += w; }
    return out + '…';
  }
  function compact(tags) { return tags.map(function (t) { return clip(t, TAG_UNITS); }).join(', '); }
  function short(text, max) { var chars = Array.from(String(text || '')); return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join(''); }

  function create() {
    var st = { app: null, followed: false, perm: 'unknown', seq: 0, pending: 0, pendingAt: 0, sel: null, why: 'start', message: '', changedAt: 0, failures: 0,
      index: null, stamp: null, loading: false, indexFailed: false, shown: '', paused: false, popover: false, own: false,
      count: { asked: 0, answered: 0, dropped: 0, indexLoads: 0, shows: 0 } };

    function appName() { return st.app ? (Core.SELECTION_APPS[st.app.bundleId] || st.app.name || 'this app') : ''; }
    function tagsOf(sel) { var rec = st.index && sel ? st.index.objects[sel.id] : null; return rec ? rec.tags.slice() : []; }

    function show(out) {
      var view, sel = st.sel, app = appName();
      if (st.indexFailed) view = off('The index file cannot be read, so no tags can be shown.');
      else if (st.paused) view = off('Context is resting while the Mac is asleep or locked.');
      else if (!st.app || !st.followed) view = off('Nothing to tag in this app. Context follows one selected note, mail message or saved file.');
      else if (st.why === 'not-allowed') view = off('Context is not allowed to ask ' + app + ' which item is selected. Click, then choose App access.');
      else if (st.why === 'not-asked') view = off('Context has not asked to follow ' + app + ' yet. Click, then choose App access.');
      else if (st.why === 'no-answer') view = off(app + ' is not answering. Tags will show again when it does.');
      else if (st.why === 'no-item') view = off(st.message || 'Select one item in ' + app + ' to see its tags.');
      else if (!sel || !st.index) view = { state: 'wait', title: '', tags: [], tooltip: 'Checking what is selected in ' + app + '…', label: 'Context. Checking what is selected in ' + app + '.' };
      else {
        var tags = tagsOf(sel), kind = Core.KIND_LABEL[sel.kind] || 'File', what = kind + ' in ' + app + ': ' + short(sel.title, TITLE_CHARS);
        view = tags.length
          ? { state: 'tags', title: compact(tags), tags: tags, tooltip: (tags.length === 1 ? 'Tag: ' : 'Tags: ') + tags.join(', ') + '\n' + what, label: 'Context. ' + (tags.length === 1 ? 'Tag: ' : 'Tags: ') + tags.join(', ') + '. ' + what + '.' }
          : { state: 'none', title: '', tags: [], tooltip: 'No tags on this ' + (NOUN[sel.kind] || 'item') + '. Click to tag it.\n' + what, label: 'Context. No tags. ' + what + '.' };
      }
      view.do = 'show';
      var text = JSON.stringify(view);
      if (text !== st.shown) { st.shown = text; st.count.shows++; out.push(view); }
    }
    function off(why) { return { state: 'off', title: '', tags: [], tooltip: why, label: 'Context. ' + why }; }

    function pace(now) { var quiet = now - st.changedAt; return quiet < PACE.fastFor ? PACE.fast : quiet < PACE.midFor ? PACE.mid : PACE.slow; }
    function watching() { return !!st.app && st.followed && !st.paused && !st.popover && !st.own && !st.indexFailed; }
    function ask(out, now) {
      st.seq++; st.pending = st.seq; st.pendingAt = now; st.count.asked++;
      out.push({ do: 'ask', seq: st.seq, bundleId: st.app.bundleId, pid: st.app.pid || 0 });
      out.push({ do: 'wait', ms: PACE.answerLimit });
    }
    function drop() { st.seq++; st.pending = 0; }                 /* whatever is still on its way is no longer wanted */
    function needIndex(e, out) {
      if (e.stamp == null || e.stamp === st.stamp || st.loading) return;
      st.loading = true; out.push({ do: 'index' });
    }
    function clear(why, message) { st.sel = null; st.why = why; st.message = message || ''; }

    function onApp(e, out) {
      st.paused = false;
      if (e.own) {                                               /* Context itself came to the front */
        st.own = true; st.popover = !!e.popover; drop();
        out.push({ do: 'scope', on: false });                    /* while Context itself is in front the shortcut is not registered */
        if (!st.popover) { st.app = null; st.followed = false; clear('other-app'); }
        show(out); out.push({ do: 'idle' });
        return;
      }
      var same = st.app && st.app.bundleId === e.bundleId && (st.app.pid || 0) === (e.pid || 0) && !st.own;
      st.own = false; st.popover = false;
      if (same && st.followed) { if (!st.pending) out.push({ do: 'wait', ms: 0 }); return; }
      var back = st.app && st.app.bundleId === e.bundleId && (st.app.pid || 0) === (e.pid || 0) && st.sel;    /* back from Context's own popover: same app, look at once, keep what is shown until the answer */
      st.app = { bundleId: String(e.bundleId || ''), name: String(e.name || ''), pid: e.pid || 0 };
      st.followed = !!Core.scriptForSelection(st.app.bundleId);
      out.push({ do: 'scope', on: st.followed });                /* the Tag current item shortcut is registered only while such an app is in front */
      drop(); st.failures = 0; st.changedAt = e.now;
      if (!st.followed) { clear('other-app'); show(out); out.push({ do: 'idle' }); return; }
      if (!back) { st.perm = 'unknown'; clear('checking'); }
      show(out);
      out.push({ do: 'wait', ms: back ? 0 : PACE.settle });       /* a short settle, so an app only passed through is never asked */
    }

    function onAnswer(e, out) {
      if (e.seq !== st.seq || e.seq !== st.pending || !st.app || e.bundleId !== st.app.bundleId || (e.pid || 0) !== (st.app.pid || 0) || !watching()) { st.count.dropped++; return; }
      st.pending = 0; st.count.answered++;
      if (e.skipped) { out.push({ do: 'wait', ms: PACE.settle }); return; }                 /* the shell saw the app was no longer in front */
      var before = st.sel ? st.sel.id : '', wait;
      if (e.perm !== 0) {
        st.perm = e.perm === -1743 ? 'denied' : e.perm === -1744 ? 'not-asked' : 'error';
        clear(e.perm === -1743 ? 'not-allowed' : e.perm === -1744 ? 'not-asked' : 'no-answer'); wait = PACE.permission;
      } else if (!e.ok && e.code === -1743) { st.perm = 'denied'; clear('not-allowed'); wait = PACE.permission; }
      else if (!e.ok && (e.code === -1712 || e.code === -600 || e.code === -609)) { st.perm = 'allowed'; st.failures++; clear('no-answer'); wait = Math.min(PACE.retry * st.failures, PACE.retryMax); }
      else {
        st.perm = 'allowed'; st.failures = 0;
        var sel = null, message = '';
        if (e.ok) {
          var a = Core.parseActive(e.reply, e.offset == null ? 0 : e.offset);
          if (!a.ok) message = a.reason;
          else if (a.desc) sel = { id: a.desc.id, kind: a.desc.kind, title: a.desc.title };
          else if (a.path && e.realPath) { var d = Core.fileDesc(e.realPath, null, e.emlHead || null); sel = { id: d.id, kind: d.kind, title: d.title }; }
          else if (a.path) message = /^[a-z][a-z0-9+.-]*:\/\//i.test(a.path) ? 'This document is open from a web address. Only a saved file can be tagged.' : 'Only a saved file can be tagged.';
        }
        if (sel) { st.sel = sel; st.why = ''; st.message = ''; } else clear('no-item', message);
      }
      if ((st.sel ? st.sel.id : '') !== before) st.changedAt = e.now;
      show(out);
      out.push({ do: 'wait', ms: wait || pace(e.now) });
    }

    function onTick(e, out) {
      if (!watching()) { out.push({ do: 'idle' }); return; }
      if (st.pending) {
        var waited = e.now - st.pendingAt;
        if (waited < PACE.answerLimit) { out.push({ do: 'wait', ms: PACE.answerLimit - waited }); return; }
        drop(); st.failures++; clear('no-answer'); show(out);     /* too late: stop showing what may no longer be true */
        out.push({ do: 'wait', ms: Math.min(PACE.retry * st.failures, PACE.retryMax) });
        return;
      }
      ask(out, e.now);
    }

    function onIndex(e, out) {
      var wasFailed = st.indexFailed;
      st.loading = false; st.count.indexLoads++;
      if (e.failed) { st.index = null; st.indexFailed = true; st.stamp = e.stamp; }
      else {
        try { st.index = e.missing ? Core.emptyIndex() : Core.loadIndex(String(e.text)); st.indexFailed = false; }
        catch (err) { st.index = null; st.indexFailed = true; }
        st.stamp = e.stamp;
      }
      show(out);
      if (st.indexFailed) out.push({ do: 'idle' });
      else if (wasFailed && watching() && !st.pending) out.push({ do: 'wait', ms: 0 });      /* otherwise the timer that is already set carries on */
    }

    function step(e) {
      var out = [];
      e = e || {};
      if (e.type === 'app') onApp(e, out);
      else if (e.type === 'answer') onAnswer(e, out);
      else if (e.type === 'tick') onTick(e, out);
      else if (e.type === 'index') onIndex(e, out);
      else if (e.type === 'saved') { /* the stamp below brings the new index in; the label follows at once */ }
      else if (e.type === 'popover') {
        st.popover = !!e.open;
        if (st.popover) { drop(); out.push({ do: 'idle' }); } else if (watching()) out.push({ do: 'wait', ms: 0 });
      }
      else if (e.type === 'pause') { st.paused = true; drop(); clear('paused'); show(out); out.push({ do: 'idle' }); }
      else if (e.type === 'resume') { st.paused = false; if (watching()) { clear('checking'); st.changedAt = e.now; show(out); out.push({ do: 'wait', ms: PACE.settle }); } else show(out); }
      else if (e.type === 'access') { if (watching() && !st.pending) out.push({ do: 'wait', ms: 0 }); }
      if (e.type !== 'index') {
        if (st.indexFailed && e.stamp != null && e.stamp !== st.stamp) st.indexFailed = false;      /* the file changed: try it again */
        needIndex(e, out);
      }
      /* only the last timer command counts */
      var timers = out.filter(function (c) { return c.do === 'wait' || c.do === 'idle'; });
      return out.filter(function (c) { return (c.do !== 'wait' && c.do !== 'idle') || c === timers[timers.length - 1]; });
    }
    function peek() { return { app: st.app, followed: st.followed, perm: st.perm, seq: st.seq, pending: st.pending, sel: st.sel, why: st.why, count: st.count, shown: st.shown ? JSON.parse(st.shown) : null, stamp: st.stamp }; }
    return { step: step, peek: peek };
  }

  /* for the shell: one engine, events and commands as JSON text */
  var engine = null;
  function stepJson(text) {
    if (!engine) engine = create();
    var e; try { e = JSON.parse(text); } catch (err) { return '[]'; }
    return JSON.stringify(engine.step(e));
  }
  return { create: create, stepJson: stepJson, compact: compact, clip: clip, units: units, PACE: PACE, TAG_UNITS: TAG_UNITS };
})(typeof WorkIndexCore !== 'undefined' ? WorkIndexCore : require('./rules.js'));
if (typeof module !== 'undefined' && module.exports) module.exports = ContextStatus;
