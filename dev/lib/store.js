/* Work Index v9 — the local index file. One small JSON file; no content, no history, no archive. */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var Core = require('../../core/rules.js');



function homeDir(opt) { return path.resolve(opt || process.env.WORKINDEX_HOME || path.join(os.homedir(), 'WorkIndex')); }
function indexPath(home) { return path.join(home, 'index.json'); }

function load(home) {
  var p = indexPath(home), raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return Core.emptyIndex(); var err = new Error('The index at ' + p + ' cannot be opened (' + e.code + ').'); err.code = 'INDEX_UNREADABLE'; throw err; }
  try { return Core.loadIndex(raw); } catch (e2) { var er = new Error('The index at ' + p + ' is not readable as a Work Index file. It was left untouched; move it aside to start a new one.'); er.code = 'INDEX_UNREADABLE'; throw er; }
}
function save(home, index) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  var p = indexPath(home), tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, Core.dumpIndex(index), { mode: 0o600 });
  fs.renameSync(tmp, p);
}
module.exports = { homeDir: homeDir, indexPath: indexPath, load: load, save: save };
