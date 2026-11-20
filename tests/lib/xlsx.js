/* Test asset: writes a small .xlsx workbook from plain data, so the tests can make synthetic workbooks with known
 * cells, number formats (KRW, USD, dates) and a known "last saved" date. Deterministic: same input, same bytes.
 * This writer is only used by tests. The product never writes a workbook. */
'use strict';
var zlib = require('zlib');

var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { var c = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files, how) {                       /* how: 'deflate' (default) | 'store' */
  var parts = [], central = [], offset = 0;
  files.forEach(function (f) {
    var name = Buffer.from(f.name, 'utf8'), data = Buffer.from(f.data, 'utf8'), stored = how === 'store';
    var body = stored ? data : zlib.deflateRawSync(data, { level: 6 }), head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt16LE(0, 10); head.writeUInt16LE(0x21, 12);                       /* fixed time and date: 1980-01-01 */
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
    var c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(stored ? 0 : 8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(head, name, body); central.push(c, name); offset += 30 + name.length + body.length;
  });
  var cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(parts.concat([cd, end]));
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* workbook = { modified: ISO (UTC), created: ISO, sheets: [{ name, cells: { A1: 'text' | 12.5 | { v: 12.5, format: '"₩"#,##0' } | { f: 'B1-B2', v: 1500, format } } }] } */
function write(workbook, options) {
  options = options || {};
  var formats = [], styleOf = function (code) { if (!code) return 0; var i = formats.indexOf(code); if (i < 0) { formats.push(code); i = formats.length - 1; } return i + 1; };
  var shared = [], sharedAt = {}, str = function (t) { if (sharedAt[t] == null) { sharedAt[t] = shared.length; shared.push(t); } return sharedAt[t]; };
  function col(ref) { var m = ref.match(/^[A-Z]+/)[0], n = 0; for (var i = 0; i < m.length; i++) n = n * 26 + m.charCodeAt(i) - 64; return n; }
  var sheetXml = workbook.sheets.map(function (sh) {
    var rows = {};
    Object.keys(sh.cells).forEach(function (ref) { var r = +ref.replace(/^[A-Z]+/, ''); (rows[r] = rows[r] || []).push(ref); });
    var body = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).map(function (r) {
      return '<row r="' + r + '">' + rows[r].sort(function (a, b) { return col(a) - col(b); }).map(function (ref) {
        var c = sh.cells[ref], o = (c !== null && typeof c === 'object') ? c : { v: c }, s = styleOf(o.format), sa = s ? ' s="' + s + '"' : '';
        if (o.f != null) return '<c r="' + ref + '"' + sa + (typeof o.v === 'string' ? ' t="str"' : '') + '><f>' + esc(o.f) + '</f><v>' + esc(o.v) + '</v></c>';
        if (typeof o.v === 'number') return '<c r="' + ref + '"' + sa + '><v>' + o.v + '</v></c>';
        if (options.inlineStrings) return '<c r="' + ref + '"' + sa + ' t="inlineStr"><is><t xml:space="preserve">' + esc(o.v) + '</t></is></c>';
        return '<c r="' + ref + '"' + sa + ' t="s"><v>' + str(String(o.v)) + '</v></c>';
      }).join('') + '</row>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + '</sheetData></worksheet>';
  });
  var X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', files = [];
  files.push({ name: '[Content_Types].xml', data: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    workbook.sheets.map(function (_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' });
  files.push({ name: '_rels/.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' });
  files.push({ name: 'docProps/core.xml', data: X + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:creator>Synthetic</dc:creator>' + (workbook.created ? '<dcterms:created xsi:type="dcterms:W3CDTF">' + workbook.created + '</dcterms:created>' : '') + (workbook.modified ? '<dcterms:modified xsi:type="dcterms:W3CDTF">' + workbook.modified + '</dcterms:modified>' : '') + '</cp:coreProperties>' });
  files.push({ name: 'xl/workbook.xml', data: X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    workbook.sheets.map(function (sh, i) { return '<sheet name="' + esc(sh.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>' });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    workbook.sheets.map(function (_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
    '<Relationship Id="rId' + (workbook.sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId' + (workbook.sheets.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>' });
  sheetXml.forEach(function (x, i) { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: x }); });
  files.push({ name: 'xl/styles.xml', data: X + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    (formats.length ? '<numFmts count="' + formats.length + '">' + formats.map(function (f, i) { return '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + esc(f) + '"/>'; }).join('') + '</numFmts>' : '') +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + (formats.length + 1) + '"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' + formats.map(function (_, i) { return '<xf numFmtId="' + (164 + i) + '" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'; }).join('') + '</cellXfs></styleSheet>' });
  files.push({ name: 'xl/sharedStrings.xml', data: X + '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + shared.length + '" uniqueCount="' + shared.length + '">' + shared.map(function (t) { return '<si><t xml:space="preserve">' + esc(t) + '</t></si>'; }).join('') + '</sst>' });
  return zip(files, options.store ? 'store' : 'deflate');
}
/* a message file (.eml), UTF-8, quoted-printable or base64 */
function eml(m) {
  function word(s) { return /^[\x20-\x7E]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?='; }
  var body = m.encoding === 'base64' ? Buffer.from(m.text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')
    : Array.prototype.map.call(Buffer.from(m.text, 'utf8'), function (b) { return (b === 10) ? '\r\n' : (b === 61 || b > 126 || (b < 32 && b !== 9)) ? '=' + ('0' + b.toString(16).toUpperCase()).slice(-2) : String.fromCharCode(b); }).join('').replace(/([^\r\n]{72})(?=[^\r\n])/g, function (x) { return /=[0-9A-F]?$/.test(x) ? x : x + '=\r\n'; });
  return Buffer.from(['From: ' + word(m.fromName) + ' <' + m.fromAddress + '>', 'To: ' + (m.to || 'Mina Seo <mina.seo@northfield-devices.example>'), 'Subject: ' + word(m.subject), 'Date: ' + m.date, 'Message-ID: <' + m.messageId + '>',
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: ' + (m.encoding === 'base64' ? 'base64' : 'quoted-printable'), '', body, ''].join('\r\n'), 'latin1');
}
module.exports = { write: write, zip: zip, crc32: crc32, eml: eml };
