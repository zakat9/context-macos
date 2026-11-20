/* Regression group new in 0.12.3: the app is called "contexta" (it was "Context"). Used by run.js.
 *   BR  the new name everywhere a person sees it; everything that identifies the app to macOS, the browser and the
 *       index unchanged; the generic words ("Insert context", "Find context") kept; what keeps a 0.12.2 set-up working.
 * Text checks of the shipped files. The upgrade itself (old registrations, old settings) is run natively by the app's
 * self-test with temporary folders. */
'use strict';
var fs = require('fs'), path = require('path');
module.exports = function (ctx) {
  var t = ctx.t, ROOT = ctx.ROOT;
  function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
  function plist(key) { var m = new RegExp('<key>' + key + '</key>\\s*<string>([^<]*)</string>').exec(read('app/Info.plist')); return m ? m[1] : null; }

  t('BR01', 'Info.plist: the app is called contexta (name and display name), version 0.12.3 build 9; bundle ID local.workindex.app and executable WorkIndex are unchanged, and the Automation prompt text names contexta',
    plist('CFBundleName') === 'contexta' && plist('CFBundleDisplayName') === 'contexta' && plist('CFBundleShortVersionString') === '0.12.3' && plist('CFBundleVersion') === '9' &&
    plist('CFBundleIdentifier') === 'local.workindex.app' && plist('CFBundleExecutable') === 'WorkIndex' && /^contexta asks the app in front/.test(plist('NSAppleEventsUsageDescription')),
    JSON.stringify(['CFBundleName', 'CFBundleDisplayName', 'CFBundleShortVersionString', 'CFBundleVersion', 'CFBundleIdentifier', 'CFBundleExecutable'].map(plist)));

  var man = JSON.parse(read('extension/manifest.json')), scripts = read('app/Sources/Scripts.swift'), host = read('app/Sources/ComposerHost.swift');
  var digest = require('crypto').createHash('sha256').update(Buffer.from(man.key, 'base64')).digest('hex').slice(0, 32).split('').map(function (c) { return String.fromCharCode(97 + parseInt(c, 16)); }).join('');
  t('BR02', 'the extension is shown as "contexta: Insert context" (short name contexta); its key and so its ID (oendmnmglkecffebbhkecfhobmphjapb), the helper\'s name local.workindex.composer and the socket ~/WorkIndex/composer/bridge.sock are unchanged, so a browser that was set up keeps trusting it',
    man.name === 'contexta: Insert context' && man.short_name === 'contexta' && man.version === '0.12.3' && digest === 'oendmnmglkecffebbhkecfhobmphjapb' &&
    /composerExtensionId: String = "oendmnmglkecffebbhkecfhobmphjapb"/.test(scripts) && /composerHostName: String = "local\.workindex\.composer"/.test(scripts) && require('../extension/lib.js').HOST === 'local.workindex.composer' &&
    /appendingPathComponent\("composer", isDirectory: true\)\.appendingPathComponent\("bridge\.sock"\)/.test(host),
    JSON.stringify([man.name, man.short_name, digest]));

  var store = read('app/Sources/Host.swift') + read('app/Sources/Settings.swift');
  t('BR03', 'the index and settings stay where they were (~/WorkIndex/index.json, ~/WorkIndex/settings.json): nothing to move, nothing lost',
    /appendingPathComponent\("WorkIndex"/.test(store) && /appendingPathComponent\("index\.json"\)/.test(store) && /appendingPathComponent\("settings\.json"\)/.test(store), '');

  /* every place a person reads text: the old product name is gone, except where it explains the rename */
  var shown = ['core/popover.html', 'core/popover.js', 'core/access.html', 'core/access.js', 'core/settings.html', 'core/settings.js', 'core/status.js', 'core/insert.js', 'core/rules.js', 'core/read.js',
    'extension/popup.html', 'extension/popup.js', 'extension/composer.js', 'extension/lib.js', 'extension/manifest.json', 'app/Info.plist', 'README.md', 'LIVE-CHECKS.md', 'RELEASE-NOTES.md']
    .concat(fs.readdirSync(path.join(ROOT, 'app', 'Sources')).map(function (f) { return 'app/Sources/' + f; }));
  var left = [];
  shown.forEach(function (f) {
    read(f).split('\n').forEach(function (line, i) {
      if (!/\bContext\b/.test(line)) return;
      if (/Context\.app|Context became contexta|called Context|from Context|Quit Context \(|Context → contexta|Context 0\.12\.2|given to Context|quit Context|formerly called|gave Context|named Context/i.test(line)) return;   /* explaining the rename */
      left.push(f + ':' + (i + 1) + ': ' + line.trim().slice(0, 120));
    });
  });
  t('BR04', 'no window, menu, message, accessibility label, extension text or public document still calls the app "Context" (mentions that explain the rename are allowed)', left.length === 0, left.slice(0, 12).join('\n'));

  var all = shown.map(read).join('\n');
  t('BR05', 'the generic words are kept: "Insert context", "Find context", "copy context for an AI"; the copied text starts "# contexta context for"',
    /Insert context/.test(all) && /Find context/.test(all) && /copy context for an AI/.test(all) && /'# contexta context for '/.test(read('core/rules.js')) && !/Insert contexta|Find contexta/.test(all), '');

  var prefs = read('app/Sources/Settings.swift'), comp = read('app/Sources/Composer.swift');
  var refresh = (comp.match(/func refresh\(_ browsers: \[PairedBrowser\]\) -> \[String\] \{[\s\S]*?\n    \}/) || [''])[0];
  t('BR06', 'continuity for a person who had set up Insert context: at launch, and only when it is on, each registration listed in their settings that still names another executable (the old Context.app) is pointed at this one; a missing registration is not made again, nothing new is registered, no browser is asked, and the old app is never touched',
    /func start\(\) \{\n\s*hotKeys\.begin\(with: current\.tagShortcut\)\n\s*if current\.insertOn \{\n\s*composer\.refresh\(current\.browsers\)/.test(prefs) &&
    /return "absent"/.test(refresh) && /if \(root\["path"\] as\? String\) == executable \{ return "current" \}/.test(refresh) && /register\(in: file\.deletingLastPathComponent\(\)\)/.test(refresh) &&
    /\(root\["name"\] as\? String\) == Scripts\.composerHostName/.test(refresh) && !/removeItem|Context\.app/.test(refresh.replace(/\/\/\/.*$/gm, '')), refresh.slice(0, 300));

  /* dev/make-publish.sh is a development script and is not in the published source; it is checked where it exists */
  var build = read('app/build.sh'), hasPub = fs.existsSync(path.join(ROOT, 'dev', 'make-publish.sh')), pub = hasPub ? read('dev/make-publish.sh') : '', popup = read('extension/popup.js');
  t('BR07', 'build and packaging make contexta.app and contexta-<version> files; "build.sh install" copies to ~/Applications/contexta.app and never removes or overwrites an old Context.app; the extension\'s "helper stopped" message says how to repair a renamed or moved app',
    /APP="build\/contexta\.app"/.test(build) && /rm -rf "\$HOME\/Applications\/contexta\.app"/.test(build) && !/Context\.app/.test(build) && (!hasPub || (/NAME="contexta-\$VERSION"/.test(pub) && /contexta\.app/.test(pub))) &&
    /exited: '[^']*opening it once updates the helper; if this message stays, turn Insert context off in its Settings and set it up again\./.test(popup), '');
};
