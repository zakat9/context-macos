#!/usr/bin/env node
/* Insert context, in a real browser.
 *
 *   NODE_PATH=<folder with playwright> node tests/composer/run.js [label]
 *
 * WHAT IS REAL HERE     Chrome for Testing, with the extension in extension/ loaded exactly as it ships; its real
 *                       toolbar picker (opened with chrome.action.openPopup and driven with real key and mouse
 *                       events); its real page script; the browser's real native-messaging launch of a helper; the
 *                       system clipboard of the test display; the real rules of the Mac app (core/insert.js).
 * WHAT IS A FIXTURE     The chat page. Requests for https://chatgpt.com/... are answered inside the test browser with
 *                       tests/composer/fixture.html. No request reaches chatgpt.com, and ChatGPT's own editor is not
 *                       what is being typed into.
 * WHAT IS A STAND-IN    The Mac side. The helper the browser launches is tests/composer/host-standin.js (Node), not the
 *                       Swift helper; the app it talks to is this test process with a pretend Mac (fictional notes,
 *                       mail and files in a temporary folder), not Context.app.
 * NOT DONE HERE         Pressing a keyboard shortcut (Chrome's own shortcut handling opens the same picker); any real
 *                       AI chat; macOS; the compiled app.
 *
 * It needs a display: it starts itself again under xvfb-run when there is none. */
'use strict';
process.env.TZ = 'Asia/Seoul';
var fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), cp = require('child_process');
if (process.argv.indexOf('--inner') < 0) {
  var env = Object.assign({}, process.env); delete env.SANDBOX_PLAYWRIGHT_CBOR_PIPE;
  var args = [__filename, '--inner'].concat(process.argv.slice(2)), haveDisplay = !!process.env.DISPLAY, xvfb = ['/usr/bin/xvfb-run', '/usr/local/bin/xvfb-run'].filter(function (x) { return fs.existsSync(x); })[0];
  if (!haveDisplay && !xvfb) { console.log('BLOCKED: this test needs a display (or xvfb-run) for the browser\'s toolbar picker. Nothing was run.'); process.exit(3); }
  var child = haveDisplay ? cp.spawnSync(process.execPath, args, { env: env, stdio: 'inherit' }) : cp.spawnSync(xvfb, ['-a', process.execPath].concat(args), { env: env, stdio: 'inherit' });
  process.exit(child.status == null ? 2 : child.status);
}

var ROOT = path.join(__dirname, '..', '..'), C = require('../cycles/lib.js'), L = C.L, Insert = require('../../core/insert.js'), Lib = require('../../extension/lib.js');
var label = process.argv.filter(function (a) { return !/^--/.test(a) && a !== __filename && a !== process.argv[0] && a !== process.argv[1]; })[0] || 'run';
var EXT = path.join(ROOT, 'extension'), MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
var EXT_ID = (function () { var h = require('crypto').createHash('sha256').update(Buffer.from(MANIFEST.key, 'base64')).digest('hex').slice(0, 32); return h.split('').map(function (c) { return String.fromCharCode(97 + parseInt(c, 16)); }).join(''); })();
var results = [], blocked = [];
function t(id, text, pass, detail) { results.push({ id: id, text: text, pass: !!pass, detail: pass ? '' : String(detail == null ? '' : detail).slice(0, 700) }); console.log((pass ? 'PASS ' : 'FAIL ') + id + '  ' + text + (pass ? '' : '\n       → ' + String(detail == null ? '' : detail).slice(0, 700))); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function frame(obj) { var body = Buffer.from(JSON.stringify(obj), 'utf8'), head = Buffer.alloc(4); head.writeUInt32LE(body.length, 0); return Buffer.concat([head, body]); }

(async function () {
  var chromium = require('playwright').chromium, work = C.temp('context-composer'), ud = path.join(work, 'profile'), sockPath = path.join(work, 'bridge.sock');
  var sc = await C.Scene.build(C.Popover), mac = sc.mac, NOTES = L.NOTES, MAIL = L.MAIL;
  var wb = path.join(mac.files, 'tooling-budget.xlsx');

  /* ── the stand-in for the app's side of the bridge: the real rules, a pretend Mac ── */
  var world = { closed: {}, notAllowed: {}, refusedReads: 0, requests: [], hellos: [] };
  function appRead(bid, name, fn) { return function (arg) { if (world.closed[bid]) { world.refusedReads++; return { ok: false, reason: name + ' is closed: open it to include this' }; } if (world.notAllowed[bid]) { world.refusedReads++; return { ok: false, reason: 'Context is not allowed to ask ' + name + ' (App access)' }; } return fn(arg); }; }
  var engine = Insert.create({ readIndex: mac.now.readIndex, readFile: mac.now.readFile, readNote: appRead(NOTES, 'Notes', mac.now.readNote), readMail: appRead(MAIL, 'Mail', mac.now.readMail) });
  var server = null, conns = [];
  function startApp() { return new Promise(function (res) { try { fs.unlinkSync(sockPath); } catch (e) { /* none */ } server = net.createServer(function (conn) { conns.push(conn); var buf = Buffer.alloc(0), greeted = false; conn.on('data', function (d) { buf = Buffer.concat([buf, d]); for (;;) { if (buf.length < 4) return; var n = buf.readUInt32LE(0); if (buf.length < 4 + n) return; var m = JSON.parse(buf.slice(4, 4 + n).toString('utf8')); buf = buf.slice(4 + n); if (!greeted) { greeted = true; world.hellos.push(m); continue; } world.requests.push(m.op); conn.write(frame(engine.handle(m))); } }); conn.on('error', function () {}); }); server.listen(sockPath, res); }); }
  function stopApp() { return new Promise(function (res) { if (!server) return res(); server.close(function () { res(); }); conns.forEach(function (c) { c.destroy(); }); conns = []; server = null; try { fs.unlinkSync(sockPath); } catch (e) { /* none */ } }); }
  await startApp();

  /* ── the browser, with the extension as it ships and the helper registered the way the app registers it ── */
  fs.mkdirSync(path.join(ud, 'NativeMessagingHosts'), { recursive: true });
  var wrapper = path.join(work, 'context-helper'); fs.writeFileSync(wrapper, '#!/bin/sh\nexec "' + process.execPath + '" "' + path.join(__dirname, 'host-standin.js') + '" "' + sockPath + '" "$@"\n'); fs.chmodSync(wrapper, 0o755);
  var hostManifest = path.join(ud, 'NativeMessagingHosts', Lib.HOST + '.json');
  function registerHelper() { fs.writeFileSync(hostManifest, JSON.stringify({ name: Lib.HOST, description: 'Context: Insert context (test stand-in)', path: wrapper, type: 'stdio', allowed_origins: ['chrome-extension://' + EXT_ID + '/'] })); }
  registerHelper();
  var ctx = await chromium.launchPersistentContext(ud, { executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: false, timeout: 40000, args: ['--no-sandbox', '--disable-extensions-except=' + EXT, '--load-extension=' + EXT], viewport: { width: 980, height: 760 } });
  var fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8'), outside = [];
  await ctx.route('**/*', function (r) {
    var u = r.request().url();
    if (u.indexOf('https://chatgpt.com/') === 0) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture });
    if (u.indexOf('https://example.com/') === 0) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><title>Another site</title><textarea id="prompt-textarea">a look-alike box on another site</textarea>' });
    if (/^https?:/.test(u)) { outside.push(u); return r.abort(); }
    return r.continue();
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://chatgpt.com' });
  var bs = await ctx.browser().newBrowserCDPSession(), version = (await bs.send('Browser.getVersion')).product;
  var helper = await ctx.newPage(); await helper.goto('chrome-extension://' + EXT_ID + '/popup.html').catch(function () {});
  var loadedId = await helper.evaluate(function () { return typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : ''; }).catch(function () { return ''; });
  var pg = ctx.pages()[0];

  /* the real toolbar picker of the window whose front tab is `page`, driven over the browser's debugging protocol */
  var waiters = {}, seq = 0;
  bs.on('Target.receivedMessageFromTarget', function (ev) { var m = JSON.parse(ev.message), w = m.id && waiters[ev.sessionId + ':' + m.id]; if (w) { delete waiters[ev.sessionId + ':' + m.id]; w(m); } });
  async function targets() { return (await bs.send('Target.getTargets')).targetInfos; }
  async function openPicker(page) {
    await page.bringToFront(); await sleep(120);
    var before = (await targets()).map(function (x) { return x.targetId; });
    var said = await helper.evaluate(async function () { try { var w = await chrome.windows.getLastFocused(); await chrome.action.openPopup({ windowId: w.id }); return 'ok'; } catch (e) { return String(e); } });
    var tg = null;
    for (var i = 0; i < 40 && !tg; i++) { await sleep(75); tg = (await targets()).filter(function (x) { return before.indexOf(x.targetId) < 0 && /popup\.html/.test(x.url); })[0]; }
    if (!tg) throw new Error('the picker did not open: ' + said);
    var session = (await bs.send('Target.attachToTarget', { targetId: tg.targetId, flatten: false })).sessionId;
    function send(method, params) { var id = ++seq; return new Promise(function (res) { waiters[session + ':' + id] = res; bs.send('Target.sendMessageToTarget', { sessionId: session, message: JSON.stringify({ id: id, method: method, params: params || {} }) }).catch(function () { delete waiters[session + ':' + id]; res({ gone: true }); }); setTimeout(function () { if (waiters[session + ':' + id]) { delete waiters[session + ':' + id]; res({ gone: true }); } }, 6000); }); }
    var P = { id: tg.targetId };
    P.ev = async function (expr) { var r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
    P.closed = async function () { return !(await targets()).some(function (x) { return x.targetId === tg.targetId; }); };
    P.wait = async function (expr, ms) { for (var n = 0; n < (ms || 5000) / 60; n++) { if (await P.closed()) return false; if (await P.ev('!!(' + expr + ')')) return true; await sleep(60); } return false; };
    P.text = function (sel) { return P.ev('(document.querySelector(' + JSON.stringify(sel) + ')||{}).textContent'); };
    P.type = async function (text) { await send('Input.insertText', { text: text }); await sleep(90); };
    var KEYS = { Enter: [13, '\r'], ArrowDown: [40], ArrowUp: [38], Tab: [9], ' ': [32, ' '], Escape: [27] };
    P.key = async function (key) { var k = KEYS[key]; await send('Input.dispatchKeyEvent', { type: k[1] ? 'keyDown' : 'rawKeyDown', key: key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: k[0], nativeVirtualKeyCode: k[0], text: k[1] }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: k[0], nativeVirtualKeyCode: k[0] }); await sleep(110); };
    P.click = async function (sel) { var b = JSON.parse(await P.ev('(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return "null";e.scrollIntoView({block:"nearest"});var r=e.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()')); if (!b) throw new Error('nothing to click: ' + sel); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 }); await sleep(120); };
    P.close = async function () { await send('Runtime.evaluate', { expression: 'window.close()' }); await sleep(150); };
    P.shot = async function (file) { var r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result && r.result.data) fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
    P.started = await P.wait('document.getElementById("msg").textContent && !/Asking Context|Checking where/.test(document.body.innerText)', 6000);
    P.state = function () { return P.ev('JSON.stringify({target:document.getElementById("target").textContent,chat:document.getElementById("chat").textContent,msg:document.getElementById("msg").textContent,insert:document.getElementById("insert").textContent+(document.getElementById("insert").disabled?" (off)":""),copy:document.getElementById("copy").disabled?"off":"on",tags:Array.prototype.map.call(document.querySelectorAll("#tags .tagrow"),function(b){return b.textContent}),rows:Array.prototype.map.call(document.querySelectorAll("#list .src"),function(r){return r.querySelector(".badge").textContent+(r.querySelector("input").checked?"":"(out)")+(r.querySelector(".flag")?"(changed)":"")}),summary:document.getElementById("summary").textContent,focus:document.activeElement?document.activeElement.id||document.activeElement.tagName:""})').then(function (s) { return s ? JSON.parse(s) : null; }); };
    P.choose = async function (typed) { await P.type(typed); await P.key('Enter'); return P.wait('document.querySelectorAll("#list .src").length > 0 || /No source|No tag|not |Choose/.test(document.getElementById("msg").textContent)', 6000); };
    return P;
  }
  async function fresh(page, where, draft, caret, caretEnd) {
    await page.goto('https://chatgpt.com' + where); await page.bringToFront(); await sleep(150);
    if (draft != null) await page.evaluate(function (a) { window.__setDraft(a[0], a[1], a[2]); }, [draft, caret == null ? draft.length : caret, caretEnd == null ? null : caretEnd]);
    return page.evaluate(function () { return { outside: window.__outside(), draft: window.__draft() }; });
  }
  function side(page) { return page.evaluate(function () { return { draft: window.__draft(), caret: window.__caret(), outside: window.__outside(), sent: window.__sent, sendClicks: window.__sendClicks, keys: window.__keys, paste: window.__pasteHandled, active: document.activeElement && document.activeElement.id, href: location.pathname }; }); }
  async function clip(page) { await page.bringToFront(); return page.evaluate(function () { return navigator.clipboard.readText(); }).catch(function (e) { return 'UNREADABLE ' + e; }); }
  async function setClip(page, text) { await page.bringToFront(); await page.evaluate(function (x) { return navigator.clipboard.writeText(x); }, text); }
  /* the labels of the sources in a piece of evidence, in its order (read with the same reader the earlier rounds use) */
  function labelsIn(text) { var i = text.indexOf(Insert.BEGIN), j = text.indexOf(Insert.END); if (i < 0 || j < 0) return []; return L.parseContext(text.slice(i + Insert.BEGIN.length + 1, j)).filter(function (x) { return x.label; }).map(function (x) { return x.label; }); }
  var SENTINEL = 'CLIPBOARD-BEFORE-FICTIONAL';

  try {
    /* ── the extension itself ── */
    t('I01', 'the extension loads in the browser under its fixed identity; it asks for one permission (talking to the local helper) and one site (chatgpt.com); it has no background script, no script on any other site, and no shortcut until the person sets one',
      loadedId === EXT_ID && MANIFEST.permissions.join() === 'nativeMessaging' && MANIFEST.host_permissions.join() === 'https://chatgpt.com/*' && !MANIFEST.background && MANIFEST.content_scripts.length === 1 && MANIFEST.content_scripts[0].matches.join() === 'https://chatgpt.com/*' && !MANIFEST.commands._execute_action.suggested_key && !MANIFEST.web_accessible_resources && !MANIFEST.externally_connectable, loadedId + ' vs ' + EXT_ID);

    /* ── the happy path ── */
    var DRAFT = 'Please compare the two quotes and tell me which fits the cap.';
    var b0 = await fresh(pg, '/c/aaa', DRAFT); await setClip(pg, SENTINEL);
    var P = await openPicker(pg), s0 = await P.state(), keysBefore = (await side(pg)).keys;
    await P.type('co'); var s1 = await P.state(); await P.key('Enter'); await P.wait('document.querySelectorAll("#list .src").length > 0'); var s2 = await P.state();
    if (process.env.SHOTS) await P.shot(path.join(process.env.SHOTS, 'picker-real-chrome.png'));
    await P.key('Enter'); for (var w = 0; w < 50 && !(await P.closed()); w++) await sleep(60);
    var a0 = await side(pg), closed0 = await P.closed(), c0 = await clip(pg), ev0 = a0.draft.slice(DRAFT.length);
    if (process.env.SHOTS) await pg.screenshot({ path: path.join(process.env.SHOTS, 'fixture-chat-after-insert.png') });
    t('I02', 'HAPPY PATH: with a draft in the message box and the caret at its end, the picker opens saying where the text will go; "co" + Return chooses Cost and lists its 8 sources by title with Insert ready; Return inserts; the picker closes; the draft is the old draft followed by the evidence on lines of its own',
      P.started && /^Into the ChatGPT message box, at the caret \(the end of your draft\)\.$/.test(s0.target) && s0.chat === 'Chat: Fixture chat aaa' && s1.tags.length === 1 && /^Cost8 sources$/.test(s1.tags[0]) && s2.rows.join() === 'E1,E2,E3,N1,E4,W1,E5,X1' && s2.insert === 'Insert 8 sources' && s2.focus === 'insert' && closed0 &&
      a0.draft.indexOf(DRAFT + '\n' + Insert.BEGIN + '\n') === 0 && new RegExp(Insert.END.replace(/[-]/g, '\\-') + '\\n?$').test(a0.draft), JSON.stringify([s0, s1.tags, s2.rows, s2.insert, s2.focus, closed0, a0.draft.slice(0, 140)]));
    t('I03', 'what was inserted is cited, dated and current: the eight labels in date order, each source with its own date and kind of date, the workbook\'s value as saved now ($55,000.00) and none of its earlier ones, the deleted file named as unavailable, and an example citation per source',
      labelsIn(ev0).join() === 'E1,E2,E3,N1,E4,W1,E5,X1' && /\[E1\] Email — “Competing quote: Pine Ridge housing mold”; sent Nov 6, 2026 15:40/.test(ev0) && /\[W1\] Workbook — “tooling-budget\.xlsx”; last saved Nov 18, 2026 16:40/.test(ev0) && /B1: \$55,000\.00/.test(ev0) && !/50,000\.00|48,234/.test(ev0) && /\[X1\] Workbook “vendor-shortlist\.csv” — file not found/.test(ev0) && /Cite cells as \[W1 › Summary!A1\]/.test(ev0), ev0.slice(0, 300));
    t('I04', 'nothing else happened: the clipboard still holds what it held; no message was sent, the Send button was not pressed and the page saw no key press; the transcript, the other text field, the search field and the password field are as they were; the caret stands after the inserted text, in the message box',
      c0 === SENTINEL && a0.sent === 0 && a0.sendClicks === 0 && a0.keys === keysBefore && a0.outside === b0.outside && a0.caret === a0.draft.length && a0.active === 'prompt-textarea', JSON.stringify({ clip: c0, sent: a0.sent, clicks: a0.sendClicks, keys: a0.keys - keysBefore, outsideSame: a0.outside === b0.outside, caret: a0.caret, len: a0.draft.length, active: a0.active }));

    /* ── inside a draft, with Korean and emoji ── */
    var KR = '가격 비교 😀 부탁드립니다.\n둘째 줄: 감사합니다 🙏 끝', at = KR.indexOf('부탁');
    await fresh(pg, '/c/aaa', KR, at); P = await openPicker(pg); var sk = await P.state(); await P.choose('Travel'); await P.key('Enter'); for (w = 0; w < 50 && !(await P.closed()); w++) await sleep(60);
    var ak = await side(pg), headK = KR.slice(0, at), tailK = KR.slice(at);
    t('I05', 'the caret is in the middle of a draft written in Korean with emoji, on two lines: the picker says "inside your draft"; after Insert the text before the caret and the text after it are both exactly as they were, character for character, and the evidence stands between them on its own lines',
      /inside your draft/.test(sk.target) && ak.draft.indexOf(headK) === 0 && ak.draft.slice(-tailK.length) === tailK && Lib.norm(ak.draft.slice(headK.length, ak.draft.length - tailK.length)).indexOf(Lib.norm(Insert.BEGIN)) === 0 && /Busan trip/.test(ak.draft) && ak.draft.split(Insert.BEGIN).length === 2 && ak.sent === 0, JSON.stringify([sk.target, ak.draft.slice(0, 60), ak.draft.slice(-40)]));

    /* ── leaving sources out ── */
    await fresh(pg, '/c/aaa', DRAFT); P = await openPicker(pg); await P.choose('Cost');
    await P.click('#list .src:nth-child(1) input'); await P.click('#list .src:nth-child(7) input'); var sx = await P.state(); await P.click('#insert'); for (w = 0; w < 50 && !(await P.closed()); w++) await sleep(60);
    var ax = await side(pg);
    t('I06', 'two sources are unticked in the list (no separate preview step): the button reads "Insert 6 of 8"; the inserted text holds exactly the six, says it is 6 of 8, and has no trace of the two left out',
      sx.insert === 'Insert 6 of 8' && sx.rows.join() === 'E1(out),E2,E3,N1,E4,W1,E5(out),X1' && labelsIn(ax.draft).join() === 'E2,E3,N1,E4,W1,X1' && /This copy holds 6 of the 8 sources linked to ::Cost/.test(ax.draft) && !/Kestrel|UNSELECTED-CANARY|FYI: steel grade|P20 is enough/.test(ax.draft), sx.insert + ' ' + labelsIn(ax.draft).join());

    /* ── the chat changes in the same tab ── */
    await fresh(pg, '/c/aaa', DRAFT); await setClip(pg, SENTINEL); P = await openPicker(pg); await P.choose('Cost');
    await pg.evaluate(function () { window.__switchChat('bbb'); });                         /* same tab, same message box, same draft text: another conversation */
    await P.click('#insert'); await P.wait('/Nothing was inserted/.test(document.getElementById("msg").textContent)'); var sw = await P.state(), aw = await side(pg), cw = await clip(pg);
    await pg.bringToFront(); var stillOpen = !(await P.closed());
    t('I07', 'SAME-TAB CHAT SWITCH: after the picker was opened in chat aaa the tab moves to chat bbb (same message box, same draft); Insert puts nothing anywhere; the picker says the chat changed and offers Copy; the clipboard has not been touched',
      aw.href === '/c/bbb' && aw.draft === DRAFT && /^The chat changed after this was opened\. Nothing was inserted\. You can copy instead/.test(sw.msg) && sw.insert === 'Insert 8 sources (off)' && sw.copy === 'on' && cw === SENTINEL, JSON.stringify([aw.href, aw.draft === DRAFT, sw.msg, sw.insert, sw.copy, cw]));
    if (stillOpen) { await P.click('#copy'); await P.wait('/Copied/.test(document.getElementById("msg").textContent)'); }
    var swc = stillOpen ? await P.state() : { msg: 'the picker had closed' }, cwc = await clip(pg), awc = await side(pg);
    if (!(await P.closed())) await P.close();
    t('I08', 'the fallback is explicit: only when "Copy instead" is pressed does the evidence go to the clipboard, and the picker says so; the draft is still untouched and nothing was sent',
      /^✓ Copied 8 sources\. Paste it yourself\. Nothing was sent\.$/.test(swc.msg) && cwc.indexOf(Insert.BEGIN) === 0 && labelsIn(cwc).length === 8 && awc.draft === DRAFT && awc.sent === 0, swc.msg + ' | ' + cwc.slice(0, 60));

    /* ── two tabs ── */
    var pg2 = await ctx.newPage(); await fresh(pg2, '/c/bbb', 'Draft in tab two'); await fresh(pg, '/c/aaa', 'Draft in tab one');
    P = await openPicker(pg); await P.choose('Travel');
    await pg2.bringToFront(); await sleep(400); var goneWithTab = await P.closed(), one = await side(pg), two = await side(pg2);
    var P2 = await openPicker(pg2); await P2.choose('Travel'); await P2.key('Enter'); for (w = 0; w < 50 && !(await P2.closed()); w++) await sleep(60);
    var one2 = await side(pg), two2 = await side(pg2);
    var forged = await helper.evaluate(async function () { var out = []; var tabs = await chrome.tabs.query({}); for (var i = 0; i < tabs.length; i++) { try { out.push(await chrome.tabs.sendMessage(tabs[i].id, { to: 'context-composer', op: 'insert', capture: 'guessed', document: 'guessed', text: 'FORGED-TEXT' })); } catch (e) { out.push('no listener'); } } return JSON.stringify(out); });
    var one3 = await side(pg), two3 = await side(pg2);
    t('I09', 'INDEPENDENT TABS: the picker opened over tab one closes when tab two comes to the front, and nothing is inserted in either; opened over tab two it inserts into tab two only; an insert request that does not carry the capture of that very page and moment is refused by every tab',
      goneWithTab && one.draft === 'Draft in tab one' && two.draft === 'Draft in tab two' && one2.draft === 'Draft in tab one' && two2.draft.indexOf('Draft in tab two\n' + Insert.BEGIN) === 0 && /stale-capture/.test(forged) && !/"ok":true/.test(forged) && one3.draft === one2.draft && two3.draft === two2.draft && !/FORGED/.test(one3.draft + two3.draft), JSON.stringify([goneWithTab, one2.draft.slice(0, 30), two2.draft.slice(0, 40), forged]));
    await pg2.close();

    /* ── the draft or the caret changes after the picker opened ── */
    await fresh(pg, '/c/aaa', DRAFT); P = await openPicker(pg); await P.choose('Travel');
    await pg.evaluate(function () { var d = 'Please compare the two quotes and tell me which fits the cap. One more thought.'; window.__setDraft(d, d.length); });
    await P.click('#insert'); await P.wait('/Nothing was inserted/.test(document.getElementById("msg").textContent)'); var sd = await P.state(), ad = await side(pg); await P.close();
    await fresh(pg, '/c/aaa', DRAFT); P = await openPicker(pg); await P.choose('Travel');
    await pg.evaluate(function (d) { window.__setDraft(d, 6); }, DRAFT);
    await P.click('#insert'); await P.wait('/Nothing was inserted/.test(document.getElementById("msg").textContent)'); var sm = await P.state(), am = await side(pg); await P.close();
    t('I10', 'the draft is changed, or only the caret is moved, after the picker opened: nothing is inserted and the picker says which of the two it was', /^The draft changed after this was opened\. Nothing was inserted\./.test(sd.msg) && !/Context evidence/.test(ad.draft) && /^The caret moved after this was opened\. Nothing was inserted\./.test(sm.msg) && am.draft === DRAFT, sd.msg + ' | ' + sm.msg);

    /* ── places where nothing may be inserted ── */
    await fresh(pg, '/c/aaa', DRAFT, 7, 14); var bsel = await side(pg); P = await openPicker(pg); var ss = await P.state(); await P.choose('Travel'); var ss2 = await P.state(); await P.close();
    var asel = await side(pg);
    t('I11', 'text is selected in the message box: nothing can be inserted (it would replace the selection); the picker says to click where the evidence should go; the tag can still be looked up and copied; the draft and the selection are untouched',
      /^Text is selected in the message box\./.test(ss.target) && /You can still copy/.test(ss.chat) && ss2.insert === 'Insert 1 source (off)' && ss2.copy === 'on' && asel.draft === DRAFT && asel.outside === bsel.outside, JSON.stringify([ss.target, ss2.insert, ss2.copy]));
    var others = [];
    for (var f = 0; f < 3; f++) {
      var field = ['edit-earlier', 'search', 'pw'][f];
      await fresh(pg, '/c/aaa', DRAFT); await pg.evaluate(function (id) { window.__focusOn(id); }, field); var bo = await side(pg);
      P = await openPicker(pg); var so = await P.state(); await P.choose('Travel'); var so2 = await P.state(); await P.close(); var ao = await side(pg);
      others.push({ field: field, target: so.target, insert: so2.insert, same: ao.outside === bo.outside && ao.draft === DRAFT });
    }
    t('I12', 'the caret is in another field (the box for editing an earlier message, the search field, a password field): nothing can be inserted, the picker says the caret is not in the message box, and none of those fields changes',
      others.every(function (o) { return /^The caret is not in the message box\./.test(o.target) && / \(off\)$/.test(o.insert) && o.same; }), JSON.stringify(others));
    var kinds = [];
    for (f = 0; f < 5; f++) {
      var kind = ['two', 'none', 'input', 'password'][f] || 'elsewhere';
      if (kind === 'elsewhere') { await pg.goto('https://example.com/'); await pg.bringToFront(); await pg.click('#prompt-textarea'); }
      else { await pg.goto('https://chatgpt.com/c/aaa?composer=' + kind); await pg.bringToFront(); await pg.evaluate(function () { var b = document.querySelector('#slot #prompt-textarea'); if (b) b.focus(); }); }
      var before = await pg.evaluate(function () { return document.body.innerHTML + '|' + Array.prototype.map.call(document.querySelectorAll('input,textarea'), function (e) { return e.value; }).join('|'); });
      P = await openPicker(pg); var sk2 = await P.state(); await P.choose('Travel'); var sk3 = await P.state(); await P.close();
      kinds.push({ kind: kind, target: sk2.target, insert: sk3.insert, same: before === await pg.evaluate(function () { return document.body.innerHTML + '|' + Array.prototype.map.call(document.querySelectorAll('input,textarea'), function (e) { return e.value; }).join('|'); }) });
    }
    t('I13', 'unclear or unsupported places: two message boxes; no message box; a one-line field or a password field carrying the message box\'s name; a look-alike box on another site. In each the picker says why, Insert stays off, and the page is not changed',
      /More than one message box/.test(kinds[0].target) && /was not found/.test(kinds[1].target) && /a kind Context does not know/.test(kinds[2].target) && /a kind Context does not know/.test(kinds[3].target) && /This tab is not ChatGPT/.test(kinds[4].target) && kinds.every(function (k) { return / \(off\)$/.test(k.insert) && k.same; }), JSON.stringify(kinds));

    /* ── sources that are missing, or that changed ── */
    await fresh(pg, '/c/aaa', DRAFT); P = await openPicker(pg); await P.choose('Cost'); var rowX = await P.ev('document.querySelector("#list .src:nth-child(8) .m").textContent');
    await P.click('#none'); await P.click('#list .src:nth-child(8) input'); var sn = await P.state(); await P.click('#insert'); await P.wait('/Nothing was inserted/.test(document.getElementById("msg").textContent)'); var sn2 = await P.state(), an = await side(pg); await P.close();
    t('I14', 'MISSING SOURCES: the deleted file is listed as unavailable with the reason and no date; with only that one ticked, Insert gives nothing and says none of the ticked sources can be read; the draft is untouched (ticked together with readable ones it is named in the evidence, as I03 shows)',
      /^Workbook, unavailable: file not found at .*vendor-shortlist\.csv/.test(rowX) && sn.insert === 'Insert 1 of 8' && /^None of the ticked sources can be read now, so there is nothing to give\. Nothing was inserted or copied\.$/.test(sn2.msg) && an.draft === DRAFT, rowX + ' | ' + sn2.msg);
    await fresh(pg, '/c/aaa', DRAFT); await setClip(pg, SENTINEL); P = await openPicker(pg); await P.choose('Cost');
    fs.writeFileSync(wb, L.workbook(2));                                                    /* the workbook is saved again after it was listed */
    await P.click('#insert'); await P.wait('/changed after/.test(document.getElementById("msg").textContent)'); var sch = await P.state(), ach = await side(pg), cch = await clip(pg);
    await pg.bringToFront(); var openAfter = !(await P.closed());
    if (openAfter) { await P.click('#insert'); for (w = 0; w < 50 && !(await P.closed()); w++) await sleep(60); }
    var ach2 = await side(pg); fs.writeFileSync(wb, L.workbook(3)); var dd = new Date('2026-11-18T07:40:00Z'); fs.utimesSync(wb, dd, dd);
    t('I15', 'SOURCE CHANGED: the workbook is saved again after the list was shown; Insert puts nothing in the draft and nothing on the clipboard, names W1 and marks its row Changed; pressing Insert again, having seen that, inserts the values as saved now',
      /^W1 changed after it was listed\. Check it, then press again\. Nothing was inserted or copied\.$/.test(sch.msg) && sch.rows.indexOf('W1(changed)') >= 0 && ach.draft === DRAFT && cch === SENTINEL && /B2: \$48,234\.00/.test(ach2.draft) && !/B2: \$48,500\.00/.test(ach2.draft), sch.msg + ' ' + sch.rows.join() + ' ' + (ach.draft === DRAFT));

    /* ── the Mac side says no ── */
    world.notAllowed[MAIL] = true; world.closed[NOTES] = true;
    await fresh(pg, '/c/aaa', DRAFT); P = await openPicker(pg); await P.choose('Cost'); var sp = await P.state(), rowsP = JSON.parse(await P.ev('JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#list .src .m"),function(m){return m.textContent}))'));
    await P.close(); world.notAllowed = {}; world.closed = {};
    t('I16', 'Mail is not allowed for Context and Notes is closed: their sources are listed as unavailable with those reasons (the bridge never asks macOS for permission and never opens an app); the files are still read',
      rowsP.filter(function (r) { return /not allowed to ask Mail/.test(r); }).length === 4 && rowsP.filter(function (r) { return /Notes is closed/.test(r); }).length === 1 && rowsP.filter(function (r) { return /^Email, sent|^Workbook, last saved/.test(r); }).length === 2 && world.refusedReads >= 5, JSON.stringify(rowsP));
    await stopApp(); await fresh(pg, '/c/aaa', DRAFT); P = await openPicker(pg); var sr = await P.state(); await P.close(); await startApp();
    fs.writeFileSync(sockPath + '.off', ''); P = await openPicker(pg); var sf = await P.state(); await P.close(); fs.unlinkSync(sockPath + '.off');
    fs.unlinkSync(hostManifest); P = await openPicker(pg); var sh = await P.state(); await P.close(); registerHelper();
    var ar = await side(pg);
    t('I17', 'the app is not running; Insert context is switched off in the app; the helper is not registered with this browser: each time the picker says which, in plain words with the way out, lists nothing, and Insert and Copy stay off',
      /^The Context Mac app is not running\./.test(sr.msg) && /^Insert context is switched off in the Context Mac app\. It is switched on in its Settings\.$/.test(sf.msg) && /^Context is not connected to this browser\. In the Context Mac app, open Settings and set up Insert context for this browser\.$/.test(sh.msg) && [sr, sf, sh].every(function (x) { return x.insert === 'Insert (off)' && x.copy === 'off' && x.tags.length === 0; }) && ar.draft === DRAFT, [sr.msg, sf.msg, sh.msg].join(' | '));

    /* ── other kinds of message box ── */
    await fresh(pg, '/c/aaa?composer=textarea', 'Line one\nLine two', 8); P = await openPicker(pg); await P.choose('Travel'); await P.key('Enter'); for (w = 0; w < 50 && !(await P.closed()); w++) await sleep(60);
    var at2 = await side(pg), ta = await pg.evaluate(function () { return document.querySelector('#prompt-textarea').value; });
    t('I18', 'a message box that is a plain text area: the evidence is put at the caret (end of line one) and the result is exactly line one, the evidence, line two', ta.indexOf('Line one\n' + Insert.BEGIN + '\n') === 0 && ta.slice(-(Insert.END + '\nLine two').length) === Insert.END + '\nLine two' && at2.caret === ta.length - '\nLine two'.length && at2.sent === 0, ta.slice(0, 60) + ' … ' + ta.slice(-40));
    await fresh(pg, '/c/aaa?composer=handover', DRAFT); await setClip(pg, SENTINEL); P = await openPicker(pg); await P.choose('Travel'); await P.key('Enter'); for (w = 0; w < 50 && !(await P.closed()); w++) await sleep(60);
    var ah = await side(pg), ch = await clip(pg), reverted = await pg.evaluate(function () { return window.__reverted || 0; });
    t('I19', 'an editor that keeps its own copy of the text and puts it back when something is typed in from outside, taking text only through its own paste handling: the first way is undone by the editor, the page script notices, hands the evidence over the second way, it arrives once and stays; the system clipboard still holds what it held', reverted >= 1 && ah.paste === 1 && ah.draft.indexOf(DRAFT + '\n' + Insert.BEGIN) === 0 && ah.draft.split(Insert.BEGIN).length === 2 && ch === SENTINEL && ah.sent === 0, JSON.stringify([reverted, ah.paste, ah.draft.slice(0, 90), ch]));

    /* ── a tag is renamed in Context while the picker is open ── */
    await fresh(pg, '/c/aaa', DRAFT); P = await openPicker(pg); await P.choose('Travel');
    var pop = C.Popover.create(mac.host); await pop.opened({ bundleId: NOTES }); await pop.manageOpen(); await pop.renameChoose('Travel'); await pop.renamePreview('Trips'); var rn = await pop.renameCommit('rename');
    await P.click('#insert'); await P.wait('/Tags were changed/.test(document.getElementById("msg").textContent)'); var si = await P.state(), ai = await side(pg);
    await P.choose('Tri'); var si2 = await P.state(); await P.key('Enter'); for (w = 0; w < 50 && !(await P.closed()); w++) await sleep(60); var ai2 = await side(pg);
    t('I20', 'a tag is renamed in Context (Manage tags) while the picker shows its sources: Insert gives nothing and says the tags were changed; the picker\'s list of tags already shows the new name; choosing it inserts',
      /Renamed Travel to Trips/.test(rn.manage.message) && /^Tags were changed in Context after this list was shown\. Choose the tag again\. Nothing was inserted or copied\.$/.test(si.msg) && ai.draft === DRAFT && si.tags.some(function (x) { return /^Trips1 source$/.test(x); }) && !si.tags.some(function (x) { return /^Travel/.test(x); }) && /context for ::Trips/.test(ai2.draft), si.msg + ' ' + si.tags.join() + ' ' + ai2.draft.slice(60, 130));

    /* ── across everything above ── */
    var total = await pg.evaluate(function () { return { sent: window.__sent, clicks: window.__sendClicks }; });
    t('I21', 'in the whole run no request left the test browser for any site, the page script of the extension was never asked by a page, and the stand-in app was asked only its four kinds of request',
      outside.length === 0 && world.requests.every(function (op) { return ['open', 'lookup', 'render', 'done'].indexOf(op) >= 0; }) && world.hellos.length > 0 && world.hellos.every(function (h) { return h.origin === 'chrome-extension://' + EXT_ID + '/'; }), outside.slice(0, 3).join() + ' ' + JSON.stringify(world.requests.filter(function (x, i, a) { return a.indexOf(x) === i; })));
  } catch (e) { var where = ''; try { where = ' | browser connected: ' + ctx.browser().isConnected() + ' | pages: ' + ctx.pages().map(function (p) { return p.url(); }).join(', '); } catch (e2) { where = ' | ' + e2; } t('I.crash', 'the run reaches its end', false, ((e && e.stack) || e) + where); }

  blocked.push(['I.N1', 'an actual AI chat: the real ChatGPT page and its real editor (does it have one visible #prompt-textarea, does it take inserted text this way, does it keep the caret)', 'not run: no request may reach chatgpt.com from here, and no account was used']);
  blocked.push(['I.N2', 'the keyboard shortcut: set one at chrome://extensions/shortcuts and press it in a ChatGPT tab', 'not run: the picker was opened with chrome.action.openPopup; the shortcut is the browser\'s own way of opening the same picker']);
  blocked.push(['I.N3', 'the Mac helper and app: the browser starting Context.app\'s executable as the helper, the helper reaching the running app, the app refusing anything that is not its own helper started by the browser it was set up for', 'not run: needs macOS and the compiled app; here a Node stand-in played both']);
  blocked.push(['I.N4', 'other browsers (Aside included): whether they load this extension and where they look for the helper\'s registration', 'not run']);
  var bad = results.filter(function (r) { return !r.pass; });
  var out = { label: label, ranAt: new Date().toISOString(), build: L.buildHash(), browser: version, extensionId: EXT_ID, real: 'browser, extension, toolbar picker, page script, native-messaging launch, clipboard of the test display, core/insert.js', fixture: 'the chat page (tests/composer/fixture.html answered under https://chatgpt.com inside the test browser)', standIn: 'the Mac helper and the Mac app (Node, pretend Mac)', checks: results, blocked: blocked.map(function (b) { return { id: b[0], text: b[1], why: b[2] }; }) };
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'results', label + '.json'), JSON.stringify(out, null, 1));
  console.log('\n== ' + (results.length - bad.length) + '/' + results.length + ' Insert context checks passed in ' + version + ' (real browser and extension; fixture chat page; stand-in Mac side)' + (bad.length ? '; FAILED: ' + bad.map(function (r) { return r.id; }).join(', ') : '') + '; ' + blocked.length + ' not run ==');
  await ctx.close().catch(function () {}); await stopApp(); sc.cleanup(); C.remove(work);
  process.exit(bad.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
