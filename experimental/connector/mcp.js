/* Work Index v9 — connector: a Model Context Protocol server over stdio (newline-delimited JSON-RPC 2.0).
 * Read-only: it can list tags, resolve a tag to its linked sources, and read those sources on demand.
 * It cannot tag, cannot read anything that is not in the index, and makes no network connection.
 * Each call reads the index and the sources again; nothing is cached between calls. */
'use strict';
var Core = require('../../core/rules.js');
var Ops = require('../../dev/lib/ops.js');

var PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
var INSTRUCTIONS =
  'Work Index links local tags to whole source objects on the user\'s computer (one email message, one note, one saved file such as an entire workbook). ' +
  'When the user\'s message contains a token of the form ::Name (for example ::Cost), call workindex_context with that token before answering. ' +
  'The result lists every linked source once, in order of the source\'s own date, with its current saved contents quoted. ' +
  'Answer only from those quoted contents and cite them with the labels given: [E1] for a message, [N1 › L3] for a line of a note, [W1 › Sheet!B2] for a workbook cell. ' +
  'State the date type shown for each source (sent, last saved, file date only, unknown). A file saved many times is one source in its current form: ' +
  'do not describe earlier values or changes between saves, because none are available. If a source is listed as unavailable or not read, say so; do not fill in from memory. ' +
  'Use workindex_lookup for a quick list without opening sources, and workindex_read to read one source in full.';

var TOOLS = [
  { name: 'workindex_context', title: 'Read everything linked to a tag',
    description: 'Resolve one or more ::Tag tokens and read every linked source as it is saved right now. Returns one entry per source in order of the source\'s own date, with quoted contents and citation labels, plus sources that are unavailable.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'The tag as typed, e.g. "::Cost". Several tags narrow the result to sources carrying all of them.' },
      max_chars_per_source: { type: 'integer', minimum: 500, maximum: 200000, description: 'Optional cap on quoted text per source (default 6000). Anything cut is stated.' } }, required: ['query'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'workindex_lookup', title: 'List sources linked to a tag',
    description: 'Resolve ::Tag tokens from the local index only. Fast: no source is opened. Returns each linked source with its kind, title, date, date type, tags and id.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'The tag as typed, e.g. "::Cost".' } }, required: ['query'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'workindex_read', title: 'Read one linked source in full',
    description: 'Read the current saved contents of one source by the id returned from workindex_lookup or workindex_context. Only sources in the index can be read.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, max_chars: { type: 'integer', minimum: 500, maximum: 400000 } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'workindex_tags', title: 'List tags in use',
    description: 'List the tags in the local index with the number of sources each one links.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }
];

function text(t, data, isError) { var r = { content: [{ type: 'text', text: t }], isError: !!isError }; if (data) r.structuredContent = data; return r; }

function callTool(home, name, args) {
  args = args || {};
  if (name === 'workindex_tags') {
    var ts = Ops.tags(home);
    return text(ts.length ? ts.map(function (t) { return Core.LOOKUP_PREFIX + t.name + ' (' + t.count + ')'; }).join('\n') : 'No tags yet.', { tags: ts.map(function (t) { return { tag: t.name, sources: t.count }; }) });
  }
  if (name === 'workindex_lookup') {
    var l = Ops.lookup(home, String(args.query || ''));
    if (!l.ok) return text(l.error.message + (l.known && l.known.length ? ' Tags in use: ' + l.known.map(function (t) { return '::' + t; }).join(' ') : ''), null, true);
    return text(l.text, { query: l.query.tags.map(function (t) { return '::' + t.name; }).join(' '),
      sources: l.records.map(function (r) { return { id: r.id, kind: r.kind, title: r.title, tags: r.tags, sourceTime: /^unavailable/.test(l.availability[r.id]) ? null : r.sourceTime, sourceTimeType: /^unavailable/.test(l.availability[r.id]) ? null : r.sourceTimeType, capturedAt: r.capturedAt, locator: r.locator, availability: l.availability[r.id] }; }) });
  }
  if (name === 'workindex_context') {
    var c = Ops.context(home, String(args.query || ''), { maxCharsPerSource: args.max_chars_per_source });
    if (!c.ok) return text(c.error.message, null, true);
    return text(c.markdown, c.data);
  }
  if (name === 'workindex_read') {
    var r = Ops.readOne(home, String(args.id || ''), { maxCharsPerSource: args.max_chars });
    if (!r.ok) return text(r.error.message, null, true);
    return text(r.markdown, r.data);
  }
  return null;
}

function handle(home, msg) {
  var id = msg.id, m = msg.method;
  function ok(result) { return { jsonrpc: '2.0', id: id, result: result }; }
  function err(code, message) { return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code: code, message: message } }; }
  if (msg.jsonrpc !== '2.0' || typeof m !== 'string') return id === undefined ? null : err(-32600, 'Invalid request');
  if (id === undefined) return null;                                   /* notifications need no reply */
  if (m === 'initialize') {
    var want = msg.params && msg.params.protocolVersion;
    return ok({ protocolVersion: PROTOCOLS.indexOf(want) >= 0 ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'work-index', title: 'Work Index', version: Core.VERSION }, instructions: INSTRUCTIONS });
  }
  if (m === 'ping') return ok({});
  if (m === 'tools/list') return ok({ tools: TOOLS });
  if (m === 'resources/list') return ok({ resources: [] });
  if (m === 'prompts/list') return ok({ prompts: [] });
  if (m === 'tools/call') {
    var p = msg.params || {};
    try {
      var res = callTool(home, p.name, p.arguments);
      if (!res) return err(-32602, 'Unknown tool: ' + p.name);
      return ok(res);
    } catch (e) {
      return ok(text('Work Index could not answer: ' + (e && e.message ? e.message : String(e)), null, true));
    }
  }
  return err(-32601, 'Method not found: ' + m);
}

function serve(home, input, output) {
  var buf = '';
  input.setEncoding('utf8');
  input.on('data', function (chunk) {
    buf += chunk;
    var i;
    while ((i = buf.indexOf('\n')) >= 0) {
      var line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      var msg, reply;
      try { msg = JSON.parse(line); } catch (e) { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
      if (Array.isArray(msg)) { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batches are not supported' } }) + '\n'); continue; }
      reply = handle(home, msg);
      if (reply) output.write(JSON.stringify(reply) + '\n');
    }
  });
  input.on('end', function () { process.exit(0); });
}
module.exports = { serve: serve, handle: handle, TOOLS: TOOLS, INSTRUCTIONS: INSTRUCTIONS };
