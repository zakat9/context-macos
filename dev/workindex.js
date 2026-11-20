#!/usr/bin/env node
/* Work Index — development harness: the app's rules from the command line, for tests and for trying things without a Mac.
 * The product is the Mac menu-bar app in app/. Needs Node 18 or later. No dependencies. No network access. */
'use strict';
var fs = require('fs');
var path = require('path');
var Core = require('../core/rules.js');
var Store = require('./lib/store.js');
var Ops = require('./lib/ops.js');
var Mac = require('./lib/macos.js');

var HELP = [
  'Work Index ' + Core.VERSION + ' — local tags that point to whole source objects',
  '',
  'Tag (the source itself is never changed):',
  '  workindex tag <file-or-link> <tag> [tag]      up to two tags per source, e.g.  tag ./costs.xlsx ::Cost',
  '  workindex tag --active [<tag> [tag]]          macOS: tag the single object active in the app in front',
  '                [--prompt]                      macOS: ask for the tags in a small native field',
  '  workindex untag <file-or-link-or-id> [tag]    remove one tag, or the whole entry',
  '          --replace                             with tag: replace the existing tags instead of adding',
  '',
  'Look up:',
  '  workindex lookup ::Cost                       list linked sources from the index (sources not opened)',
  '  workindex context ::Cost [--copy] [--json]    read every linked source now; show them by their own dates',
  '  workindex read <id>                           read one linked source in full',
  '  workindex tags | list                         tags in use | every entry',
  '',
  'Experimental (not part of the app; see experimental/connector/README.md):',
  '  workindex mcp                                 connector (MCP server over stdio)',
  '',
  'Other:',
  '  workindex demo [--dir ./workindex-demo]       set up fictional sources (email, workbook, note) and tags',
  '  workindex where                               show where the index is kept',
  '',
  'Options: --home <dir>  (or WORKINDEX_HOME; default ~/WorkIndex)',
  '         --max-chars <n> quoted text per source (default 6000)   --max-total <n> per answer (default 120000)',
  ''
].join('\n');

function parseArgs(argv) {
  var o = { _: [] }, i;
  for (i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--home' || a === '--dir' || a === '--port' || a === '--max-chars' || a === '--max-total') o[a.slice(2)] = argv[++i];
    else if (/^--[a-z-]+$/.test(a)) o[a.slice(2)] = true;
    else o._.push(a);
  }
  return o;
}
function out(s) { process.stdout.write(s.replace(/\n?$/, '\n')); }
function fail(s, code) { process.stderr.write(s.replace(/\n?$/, '\n')); process.exit(code || 1); }
function tagsText(r) { return r.tags.map(function (t) { return Core.LOOKUP_PREFIX + t; }).join(' '); }

function demo(dir) {
  var src = path.join(__dirname, '..', 'demo', 'fixtures'), root = path.resolve(dir || './workindex-demo'), sdir = path.join(root, 'sources'), home = path.join(root, 'home');
  fs.mkdirSync(sdir, { recursive: true });
  try { fs.rmSync(path.join(home, 'index.json'), { force: true }); } catch (e) { /* first run */ }
  /* file dates for the fictional sources (a plain note or scan carries no date of its own) */
  var when = { 'Supplier call notes - Harborline.md': '2026-11-12T17:20:00+09:00', 'first-quote-scan.pdf': '2026-11-04T10:30:00+09:00', 'vendor-shortlist.csv': '2026-11-05T11:00:00+09:00',
    'tooling-cost-model.xlsx': '2026-11-18T16:40:00+09:00', 'Revised tooling quote - Pine Ridge housing.eml': '2026-11-10T09:12:00+09:00', 'Tooling budget cap for Pine Ridge.eml': '2026-11-17T14:05:00+09:00' };
  fs.readdirSync(src).forEach(function (f) {
    fs.copyFileSync(path.join(src, f), path.join(sdir, f));
    if (when[f]) { var t = new Date(when[f]); fs.utimesSync(path.join(sdir, f), t, t); }
  });
  var p = function (f) { return path.join(sdir, f); }, steps = [];
  function t(input, tags, title) { var r = Ops.tagInput(home, input, tags, { title: title, now: '2026-11-19T09:00:00+09:00' }); steps.push((r.ok ? r.status : 'refused') + ': ' + tags + '  ←  ' + (title || path.basename(input)) + (r.ok ? '' : '  (' + r.error.message + ')')); return r; }
  t(p('Revised tooling quote - Pine Ridge housing.eml'), '::Cost ::PineRidge');
  t(p('Tooling budget cap for Pine Ridge.eml'), '::Cost');
  t(p('Supplier call notes - Harborline.md'), '::Cost');
  t(p('tooling-cost-model.xlsx'), '::Cost ::PineRidge');
  t(p('first-quote-scan.pdf'), '::Cost');
  t(p('vendor-shortlist.csv'), '::Cost');
  t('https://mail.google.com/mail/u/0/#inbox/FMfcgzQfictionalThread01', '::Cost', 'Re: steel grade decision (web mail link)');
  t(p('tooling-cost-model.xlsx'), '::Budget');                         /* a third tag on the workbook: refused, not dropped */
  fs.rmSync(p('vendor-shortlist.csv'));                                 /* tagged, then deleted: must show as unavailable */
  out('Fictional demo set up in ' + root + '\n\n' + steps.map(function (s) { return '  ' + s; }).join('\n') + '\n  deleted after tagging: vendor-shortlist.csv\n\nTry:\n' +
    '  node "' + path.join(__dirname, 'workindex.js') + '" --home "' + home + '" context ::Cost');
}

function main() {
  var a = parseArgs(process.argv.slice(2)), cmd = a._.shift(), home = Store.homeDir(a.home), r;
  var max = a['max-chars'] ? Math.max(500, parseInt(a['max-chars'], 10) || 0) : undefined;
  try {
    if (!cmd || cmd === 'help' || a.help) return out(HELP);
    if (cmd === 'where') return out(Store.indexPath(home));
    if (cmd === 'demo') return demo(a.dir);
    if (cmd === 'mcp') return require('../experimental/connector/mcp.js').serve(home, process.stdin, process.stdout);
    if (cmd === 'tag') {
      var desc = null, tagText;
      if (a.active) {
        var act = Mac.active();
        if (!act.ok) return fail('Nothing was tagged: ' + act.reason + '.');
        desc = act.desc; tagText = a._.join(' ');
        if (a.prompt || !tagText) tagText = Mac.promptTags(desc.title);
        r = Ops.tag(home, desc, tagText, { replace: !!a.replace });
      } else {
        if (a._.length < 2) return fail('Usage: workindex tag <file-or-link> <tag> [tag]');
        r = Ops.tagInput(home, a._[0], a._.slice(1).join(' '), { replace: !!a.replace });
      }
      if (!r.ok) return fail('Nothing was tagged. ' + r.error.message);
      return out((r.status === 'created' ? 'Tagged' : r.status === 'updated' ? 'Updated' : 'Already tagged') + ': “' + r.record.title + '” ' + tagsText(r.record) + '  (' + Core.KIND_LABEL[r.record.kind] + '; one entry; the source was not changed)');
    }
    if (cmd === 'untag') {
      if (!a._.length) return fail('Usage: workindex untag <file-or-link-or-id> [tag]');
      r = Ops.untag(home, a._[0], a._.slice(1).join(' '));
      if (!r.ok) return fail(r.error.message);
      return out(r.status === 'removed' ? 'Removed from the index.' : r.status === 'updated' ? 'Now tagged ' + tagsText(r.record) + '.' : 'No change.');
    }
    if (cmd === 'tags') { var ts = Ops.tags(home); return out(ts.length ? ts.map(function (t) { return Core.LOOKUP_PREFIX + t.name + '  ' + t.count; }).join('\n') : 'No tags yet.'); }
    if (cmd === 'list') { var rs = Ops.list(home); return out(rs.length ? rs.map(function (x) { return tagsText(x) + '  ' + Core.KIND_LABEL[x.kind] + '  “' + x.title + '”  ' + x.id; }).join('\n') : 'The index is empty.'); }
    if (cmd === 'lookup') { r = Ops.lookup(home, a._.join(' ')); if (!r.ok) return fail(r.error.message); return out(r.text); }
    if (cmd === 'context') {
      r = Ops.context(home, a._.join(' '), { maxCharsPerSource: max, maxTotalChars: a['max-total'] ? Math.max(2000, parseInt(a['max-total'], 10) || 0) : undefined });
      if (!r.ok) return fail(r.error.message);
      if (a.copy) { if (!Mac.isMac()) return fail('--copy needs macOS (pbcopy). Without it, select the text and copy it yourself.'); Mac.copy(r.markdown); process.stderr.write('Copied. Nothing was sent anywhere; paste it where you need it.\n'); }
      return out(a.json ? JSON.stringify(r.data, null, 1) : r.markdown);
    }
    if (cmd === 'read') { r = Ops.readOne(home, a._[0] || '', { maxCharsPerSource: max }); if (!r.ok) return fail(r.error.message); return out(r.markdown); }
    return fail('Unknown command: ' + cmd + '\n\n' + HELP);
  } catch (e) {
    fail(e && e.code === 'INDEX_UNREADABLE' ? e.message : 'Work Index stopped: ' + (e && e.stack ? e.stack : e), 2);
  }
}
main();
