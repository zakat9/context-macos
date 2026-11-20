/* Context — reading a source's current saved contents.
 * Pure: bytes and text in, structured content out. No file, network or operating-system access, no libraries.
 * The same file runs inside the Mac app's popover and under the tests.
 * Every call works on what it is handed; nothing is kept between calls. */
var WorkIndexRead = (function (Core) {
  'use strict';

  /* ───────── bytes and text ───────── */
  function u16(b, i) { return b[i] | (b[i + 1] << 8); }
  function u32(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0; }
  function latin1(b) {
    var s = '', n = b.length;
    for (var i = 0; i < n; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(n, i + 8192)));
    return s;
  }
  function bytesOfLatin1(str) { var n = str.length, b = new Uint8Array(n); for (var i = 0; i < n; i++) b[i] = str.charCodeAt(i) & 0xFF; return b; }
  function utf8(b) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(b);
    var s = '', i = 0, n = b.length, c, cp;
    while (i < n) {
      c = b[i++];
      if (c < 0x80) cp = c;
      else if (c >= 0xC2 && c < 0xE0 && i < n && (b[i] & 0xC0) === 0x80) cp = ((c & 0x1F) << 6) | (b[i++] & 0x3F);
      else if (c >= 0xE0 && c < 0xF0 && i + 1 < n && (b[i] & 0xC0) === 0x80 && (b[i + 1] & 0xC0) === 0x80) { cp = ((c & 0x0F) << 12) | ((b[i] & 0x3F) << 6) | (b[i + 1] & 0x3F); i += 2; }
      else if (c >= 0xF0 && c < 0xF5 && i + 2 < n && (b[i] & 0xC0) === 0x80 && (b[i + 1] & 0xC0) === 0x80 && (b[i + 2] & 0xC0) === 0x80) { cp = ((c & 0x07) << 18) | ((b[i] & 0x3F) << 12) | ((b[i + 1] & 0x3F) << 6) | (b[i + 2] & 0x3F); i += 3; }
      else cp = 0xFFFD;
      s += String.fromCodePoint(cp);
    }
    return s;
  }
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [], s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return new Uint8Array(out);
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64Bytes(text) {
    var s = String(text).replace(/[^A-Za-z0-9+/]/g, ''), n = Math.floor(s.length * 3 / 4), out = new Uint8Array(n), o = 0, acc = 0, bits = 0;
    if (typeof atob === 'function') {                       /* the quick way, where the host has it */
      try { var bin = atob(s + '==='.slice(0, (4 - s.length % 4) % 4)), quick = new Uint8Array(bin.length); for (var q = 0; q < bin.length; q++) quick[q] = bin.charCodeAt(q); return quick; } catch (e) { /* fall through */ }
    }
    for (var i = 0; i < s.length; i++) {
      acc = (acc << 6) | B64.indexOf(s.charAt(i)); bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xFF; }
    }
    return out.subarray(0, o);
  }
  function decodeBytes(b, charset) {
    var cs = String(charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
    if (cs === 'utf-8' || cs === 'utf8' || cs === 'us-ascii' || cs === 'ascii') return utf8(b);
    if (cs === 'iso-8859-1' || cs === 'latin1') return latin1(b);
    try { return new TextDecoder(cs).decode(b); } catch (e) { return utf8(b); }
  }

  /* ───────── inflate (RFC 1951), enough for .xlsx ───────── */
  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  function huffman(lengths, from, n) {
    var count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(n), i;
    for (i = 0; i < n; i++) count[lengths[from + i]]++;
    count[0] = 0;
    for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    for (i = 0; i < n; i++) if (lengths[from + i]) symbol[offs[lengths[from + i]]++] = i;
    return { count: count, symbol: symbol };
  }
  var FIXED = null;
  function fixedTables() {
    if (FIXED) return FIXED;
    var l = new Uint8Array(288), d = new Uint8Array(30), i;
    for (i = 0; i < 144; i++) l[i] = 8; for (; i < 256; i++) l[i] = 9; for (; i < 280; i++) l[i] = 7; for (; i < 288; i++) l[i] = 8;
    for (i = 0; i < 30; i++) d[i] = 5;
    FIXED = { len: huffman(l, 0, 288), dist: huffman(d, 0, 30) };
    return FIXED;
  }
  function inflateRaw(input, sizeHint, maxSize) {
    var pos = 0, hold = 0, have = 0, limit = maxSize || 64 * 1024 * 1024;
    var out = new Uint8Array(Math.max(1024, sizeHint || input.length * 4)), op = 0;
    function room(n) {
      if (op + n <= out.length) return;
      if (op + n > limit) throw new Error('part too large');
      var bigger = new Uint8Array(Math.min(limit, Math.max(out.length * 2, op + n))); bigger.set(out.subarray(0, op)); out = bigger;
    }
    function bits(n) {
      while (have < n) { if (pos >= input.length) throw new Error('compressed data ends early'); hold |= input[pos++] << have; have += 8; }
      var v = hold & ((1 << n) - 1); hold >>>= n; have -= n; return v;
    }
    function decode(h) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len <= 15; len++) {
        code |= bits(1);
        var c = h.count[len];
        if (code - c < first) return h.symbol[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw new Error('damaged compressed data');
    }
    function block(lenTable, distTable) {
      for (;;) {
        var sym = decode(lenTable);
        if (sym < 256) { room(1); out[op++] = sym; continue; }
        if (sym === 256) return;
        sym -= 257;
        if (sym >= 29) throw new Error('damaged compressed data');
        var len = LBASE[sym] + bits(LEXT[sym]), ds = decode(distTable);
        if (ds >= 30) throw new Error('damaged compressed data');
        var dist = DBASE[ds] + bits(DEXT[ds]);
        if (dist > op) throw new Error('damaged compressed data');
        room(len);
        for (var k = 0; k < len; k++, op++) out[op] = out[op - dist];
      }
    }
    var last;
    do {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        hold = 0; have = 0;
        if (pos + 4 > input.length) throw new Error('compressed data ends early');
        var n = u16(input, pos), nn = u16(input, pos + 2); pos += 4;
        if ((n ^ 0xFFFF) !== nn) throw new Error('damaged compressed data');
        if (pos + n > input.length) throw new Error('compressed data ends early');
        room(n); out.set(input.subarray(pos, pos + n), op); op += n; pos += n;
      } else if (type === 1) {
        var f = fixedTables(); block(f.len, f.dist);
      } else if (type === 2) {
        var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, lengths = new Uint8Array(320), i;
        if (nlen > 286 || ndist > 30) throw new Error('damaged compressed data');
        for (i = 0; i < ncode; i++) lengths[CLORDER[i]] = bits(3);
        var cl = huffman(lengths, 0, 19);
        lengths = new Uint8Array(320); i = 0;
        while (i < nlen + ndist) {
          var s = decode(cl), rep, val = 0;
          if (s < 16) { lengths[i++] = s; continue; }
          if (s === 16) { if (i === 0) throw new Error('damaged compressed data'); val = lengths[i - 1]; rep = 3 + bits(2); }
          else if (s === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (i + rep > nlen + ndist) throw new Error('damaged compressed data');
          while (rep--) lengths[i++] = val;
        }
        if (lengths[256] === 0) throw new Error('damaged compressed data');
        block(huffman(lengths, 0, nlen), huffman(lengths, nlen, ndist));
      } else throw new Error('damaged compressed data');
    } while (!last);
    return out.subarray(0, op);
  }

  /* ───────── zip (enough for .xlsx) ───────── */
  function unzip(buf) {
    var eocd = -1;
    for (var i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip file');
    var count = u16(buf, eocd + 10), off = u32(buf, eocd + 16);
    if (count === 0xFFFF || off === 0xFFFFFFFF) throw new Error('zip64 files are not supported');
    var entries = {};
    for (var n = 0; n < count; n++) {
      if (off + 46 > buf.length || u32(buf, off) !== 0x02014b50) throw new Error('damaged zip directory');
      var method = u16(buf, off + 10), csize = u32(buf, off + 20), usize = u32(buf, off + 24);
      var nlen = u16(buf, off + 28), elen = u16(buf, off + 30), clen = u16(buf, off + 32), lho = u32(buf, off + 42);
      entries[utf8(buf.subarray(off + 46, off + 46 + nlen))] = { method: method, csize: csize, usize: usize, lho: lho };
      off += 46 + nlen + elen + clen;
    }
    return {
      names: Object.keys(entries),
      read: function (name) {
        var e = entries[name]; if (!e) return null;
        if (e.usize > 64 * 1024 * 1024) throw new Error('part too large: ' + name);
        if (e.lho + 30 > buf.length || u32(buf, e.lho) !== 0x04034b50) throw new Error('damaged zip entry');
        var start = e.lho + 30 + u16(buf, e.lho + 26) + u16(buf, e.lho + 28);
        var data = buf.subarray(start, start + e.csize);
        if (e.method === 0) return data;
        if (e.method === 8) return inflateRaw(data, e.usize);
        throw new Error('unsupported zip compression');
      }
    };
  }

  /* ───────── xml helpers ───────── */
  function xmlText(s) {
    return String(s).replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(+d); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/_x([0-9A-Fa-f]{4})_/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
  }
  function attr(tag, name) { var m = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')); return m ? xmlText(m[1]) : null; }

  /* ───────── workbook (.xlsx / .xlsm) ───────── */
  var BUILTIN_DATE_FMT = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 27: 1, 28: 1, 29: 1, 30: 1, 31: 1, 32: 1, 33: 1, 34: 1, 35: 1, 36: 1, 45: 1, 46: 1, 47: 1, 50: 1, 51: 1, 52: 1, 53: 1, 54: 1, 55: 1, 56: 1, 57: 1, 58: 1 };
  function isDateFormat(code) {
    var c = String(code || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
    return /[dmyhs]/i.test(c) && !/^general$/i.test(c.trim());
  }
  function serialToIso(n, date1904) {
    var ms = Math.round((n - (date1904 ? -1462 : 0) - 25569) * 86400000);   /* Excel serial → Unix ms (1900 system) */
    var d = new Date(ms); if (isNaN(d.getTime())) return String(n);
    var p = function (x) { return ('0' + x).slice(-2); };
    var day = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    return (n % 1 === 0) ? day : day + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }
  /* A number format that shows money (₩, $, USD, KRW, 원 …): the pieces needed to show a value the way the workbook does.
     Returns null for anything else, or for a format this reader does not fully understand, and the number stays as stored. */
  var MONEY = /[$\u20A9\uFFE6\u20AC\u00A3\u00A5]|\b(USD|KRW|EUR|JPY|GBP|CNY|CAD|AUD)\b|\uC6D0|\uB2EC\uB7EC/;
  function moneyFormat(code) {
    var first = String(code || '').split(';')[0], before = '', after = '', pattern = '', i = 0, ch, end;
    function lit(t) { if (pattern) after += t; else before += t; }
    while (i < first.length) {
      ch = first[i];
      if (ch === '"') { end = first.indexOf('"', i + 1); if (end < 0) return null; lit(first.slice(i + 1, end)); i = end + 1; }
      else if (ch === '\\') { lit(first[i + 1] || ''); i += 2; }
      else if (ch === '_' || ch === '*') i += 2;                                   /* spacing and fill: nothing to show */
      else if (ch === '[') {
        end = first.indexOf(']', i); if (end < 0) return null;
        var m = first.slice(i + 1, end).match(/^\$([^-\]]*)(?:-.*)?$/);           /* [$₩-412] → ₩ ; colours and conditions are skipped */
        if (m) lit(m[1]);
        i = end + 1;
      }
      else if (/[0#?.,]/.test(ch)) { if (after) return null; pattern += ch; i++; }
      else if (/[$\u20A9\uFFE6\u20AC\u00A3\u00A5 ()+:\/-]/.test(ch)) { lit(ch); i++; }
      else return null;                                                           /* General, @, %, dates, exponents: not money */
    }
    if (!/[0#?]/.test(pattern) || /,$/.test(pattern.split('.')[0]) || !MONEY.test(before + after)) return null;
    var parts = pattern.split('.');
    if (parts.length > 2) return null;
    var frac = parts[1] || '';
    return { before: before.replace(/[()]/g, ''), after: after.replace(/[()]/g, ''), group: parts[0].indexOf(',') >= 0, places: frac.replace(/[^0#?]/g, '').length, fixed: frac.replace(/[^0]/g, '').length };
  }
  function showMoney(num, f) {
    var neg = num < 0, s = Math.abs(num).toFixed(f.places), whole = s.split('.')[0], frac = s.split('.')[1] || '';
    while (frac.length > f.fixed && frac.charAt(frac.length - 1) === '0') frac = frac.slice(0, -1);
    if (f.group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var shown = (neg ? '-' : '') + (f.before + whole + (frac ? '.' + frac : '') + f.after).replace(/\s+/g, ' ').trim();
    return Number((neg ? '-' : '') + s) === num ? shown : shown + ' (stored ' + String(num) + ')';      /* never hide what rounding left out */
  }
  var BUILTIN_MONEY_FMT = { 5: 1, 6: 1, 7: 1, 8: 1, 42: 1, 44: 1 };                 /* currency of the computer's region: the file does not name it */
  function colNum(ref) { var m = ref.match(/^([A-Z]+)/), n = 0; if (!m) return 0; for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64); return n; }
  function colName(n) { var s = ''; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

  function workbookMeta(zip) {
    var core = zip.read('docProps/core.xml'), out = { created: null, modified: null };
    if (core) {
      var x = utf8(core), m;
      if ((m = x.match(/<dcterms:created[^>]*>([^<]+)</))) out.created = m[1].trim();
      if ((m = x.match(/<dcterms:modified[^>]*>([^<]+)</))) out.modified = m[1].trim();
    }
    return out;
  }
  function readWorkbook(buf, limits) {
    limits = limits || {};
    var maxCells = limits.maxCellsPerSheet || 5000;
    var zip = unzip(buf);
    var wbx = zip.read('xl/workbook.xml'); if (!wbx) throw new Error('not an Excel workbook (no xl/workbook.xml)');
    var wb = utf8(wbx);
    var date1904 = /<(?:\w+:)?workbookPr[^>]*date1904="(1|true)"/.test(wb);
    var rels = {}, relx = zip.read('xl/_rels/workbook.xml.rels');
    if (relx) (utf8(relx).match(/<Relationship\b[^>]*>/g) || []).forEach(function (t) { rels[attr(t, 'Id')] = attr(t, 'Target'); });
    var shared = [], ssx = zip.read('xl/sharedStrings.xml');
    if (ssx) (utf8(ssx).match(/<(?:\w+:)?si\b[\s\S]*?<\/(?:\w+:)?si>/g) || []).forEach(function (si) {
      var clean = si.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
      shared.push((clean.match(/<(?:\w+:)?t\b[^>]*>[\s\S]*?<\/(?:\w+:)?t>/g) || []).map(function (t) { return xmlText(t.replace(/^<[^>]*>/, '').replace(/<\/[^>]*>$/, '')); }).join(''));
    });
    var dateStyle = [], moneyStyle = [], stx = zip.read('xl/styles.xml');
    if (stx) {
      var st = utf8(stx), custom = {};
      (st.match(/<(?:\w+:)?numFmt\b[^>]*>/g) || []).forEach(function (t) { custom[attr(t, 'numFmtId')] = attr(t, 'formatCode'); });
      var xfs = st.match(/<(?:\w+:)?cellXfs\b[\s\S]*?<\/(?:\w+:)?cellXfs>/);
      if (xfs) (xfs[0].match(/<(?:\w+:)?xf\b[^>]*>/g) || []).forEach(function (t) {
        var id = attr(t, 'numFmtId'), isDate = !!(BUILTIN_DATE_FMT[id] || (custom[id] && isDateFormat(custom[id])));
        dateStyle.push(isDate);
        moneyStyle.push(isDate ? null : custom[id] ? moneyFormat(custom[id]) : BUILTIN_MONEY_FMT[id] ? 'unnamed' : null);
      });
    }
    var sheets = [];
    (wb.match(/<(?:\w+:)?sheet\b[^>]*>/g) || []).forEach(function (t) {
      var name = attr(t, 'name'), rid = attr(t, 'r:id'), target = rels[rid];
      if (!target) return;
      var p = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      var sx = zip.read(p); if (!sx) return;
      var xml = utf8(sx), rows = [], total = 0, kept = 0, minC = Infinity, maxC = 0, minR = Infinity, maxR = 0, byRow = {};
      var re = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g, m;
      while ((m = re.exec(xml))) {
        var at = m[1], inner = m[2] || '', ref = attr(at, 'r'), type = attr(at, 't') || 'n', s = attr(at, 's');
        if (!ref) continue;
        var vm = inner.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/), fm = inner.match(/<(?:\w+:)?f\b[^>]*>([\s\S]*?)<\/(?:\w+:)?f>/);
        var raw = vm ? xmlText(vm[1]) : null, v = null;
        if (type === 's') v = raw == null ? null : (shared[+raw] == null ? '' : shared[+raw]);
        else if (type === 'inlineStr') v = (inner.match(/<(?:\w+:)?t\b[^>]*>[\s\S]*?<\/(?:\w+:)?t>/g) || []).map(function (x) { return xmlText(x.replace(/^<[^>]*>/, '').replace(/<\/[^>]*>$/, '')); }).join('');
        else if (type === 'b') v = raw === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'e' || type === 'str') v = raw;
        else if (raw != null) {
          var num = Number(raw), money = s != null ? moneyStyle[+s] : null;
          if (s != null && dateStyle[+s] && isFinite(num)) v = serialToIso(num, date1904);
          else if (!isFinite(num)) v = raw;
          else if (money === 'unnamed') v = String(num) + ' (shown as currency in the workbook; the file does not say which)';
          else v = money ? showMoney(num, money) : String(num);
        }
        if (v == null || v === '') { if (!fm) continue; v = ''; }
        total++;
        if (kept >= maxCells) continue;
        kept++;
        var rn = +ref.replace(/^[A-Z]+/, ''), cn = colNum(ref);
        minC = Math.min(minC, cn); maxC = Math.max(maxC, cn); minR = Math.min(minR, rn); maxR = Math.max(maxR, rn);
        var cell = { ref: ref, v: v }; if (fm) cell.f = xmlText(fm[1]);
        (byRow[rn] = byRow[rn] || []).push(cell);
      }
      Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; }).forEach(function (rn) {
        rows.push({ r: rn, cells: byRow[rn].sort(function (a, b) { return colNum(a.ref) - colNum(b.ref); }) });
      });
      sheets.push({ name: name, hidden: /^(hidden|veryHidden)$/.test(attr(t, 'state') || ''), range: kept ? colName(minC) + minR + ':' + colName(maxC) + maxR : null, rows: rows,
        truncated: total > kept ? (total - kept) + ' more cells' : null });
    });
    return { type: 'workbook', sheets: sheets, meta: workbookMeta(zip) };
  }
  function readCsv(text, sep) {
    var rows = [], row = [], cur = '', q = false, s = String(text).replace(/^﻿/, '');
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    var out = [], maxC = 0;
    rows.forEach(function (r, ri) {
      var cells = []; r.forEach(function (v, ci) { if (v !== '') { cells.push({ ref: colName(ci + 1) + (ri + 1), v: v }); maxC = Math.max(maxC, ci + 1); } });
      if (cells.length) out.push({ r: ri + 1, cells: cells });
    });
    return { type: 'workbook', sheets: [{ name: 'Sheet1', hidden: false, range: out.length ? 'A1:' + colName(maxC) + rows.length : null, rows: out, truncated: null }], meta: { created: null, modified: null } };
  }

  /* ───────── email (.eml, RFC 5322 / MIME) ───────── */
  function decodeQP(s) {
    var bytes = [], t = String(s).replace(/=\r?\n/g, '');
    for (var i = 0; i < t.length; i++) {
      if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.substr(i + 1, 2))) { bytes.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; }
      else { var code = t.charCodeAt(i); if (code < 256) bytes.push(code); else { var b = utf8Bytes(t[i]); for (var k = 0; k < b.length; k++) bytes.push(b[k]); } }
    }
    return new Uint8Array(bytes);
  }
  function decodeWords(s) {   /* RFC 2047 encoded words in headers */
    return String(s).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, function (_, cs, enc, data) {
      try { return decodeBytes(enc.toUpperCase() === 'B' ? base64Bytes(data) : decodeQP(data.replace(/_/g, ' ')), cs); } catch (e) { return data; }
    });
  }
  function splitMessage(text) {
    var i = text.search(/\r?\n\r?\n/);
    var head = i < 0 ? text : text.slice(0, i), body = i < 0 ? '' : text.slice(i).replace(/^\r?\n\r?\n/, '');
    var headers = {};
    head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^([!-9;-~]+):\s*(.*)$/); if (m) { var k = m[1].toLowerCase(); if (headers[k] == null) headers[k] = m[2]; }
    });
    return { headers: headers, body: body };
  }
  function param(value, name) { var m = String(value || '').match(new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i')); return m ? (m[1] != null ? m[1] : m[2]) : null; }
  function partText(part) {
    var ct = part.headers['content-type'] || 'text/plain', enc = String(part.headers['content-transfer-encoding'] || '7bit').toLowerCase().trim();
    var bytes = enc === 'base64' ? base64Bytes(part.body) : enc === 'quoted-printable' ? decodeQP(part.body) : bytesOfLatin1(part.body);
    return decodeBytes(bytes, param(ct, 'charset') || 'utf-8');
  }
  function walkParts(part, acc) {
    var ct = String(part.headers['content-type'] || 'text/plain').toLowerCase(), disp = String(part.headers['content-disposition'] || '').toLowerCase();
    var fname = param(part.headers['content-disposition'], 'filename') || param(part.headers['content-type'], 'name');
    if (/^multipart\//.test(ct)) {
      var b = param(part.headers['content-type'], 'boundary'); if (!b) return;
      var chunks = part.body.split(new RegExp('(?:^|\\r?\\n)--' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?[ \\t]*(?:\\r?\\n|$)'));
      chunks.slice(1).forEach(function (c) { if (c.trim()) walkParts(splitMessage(c), acc); });
      return;
    }
    if (/attachment/.test(disp) || (fname && !/^text\/(plain|html)/.test(ct))) { acc.attachments.push(decodeWords(fname || '(unnamed attachment)')); return; }
    if (/^text\/plain/.test(ct) && acc.plain == null) acc.plain = partText(part);
    else if (/^text\/html/.test(ct) && acc.html == null) acc.html = partText(part);
  }
  function htmlToText(h) {
    return String(h).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function emailHeaders(buf) {
    var msg = splitMessage(latin1(buf)), h = msg.headers, utf = function (s) { return s == null ? null : decodeWords(utf8(bytesOfLatin1(s))); };
    var sent = null;
    if (h.date) { var ms = Date.parse(h.date); if (!isNaN(ms)) { var z = h.date.match(/([+-])(\d{2})(\d{2})\s*(?:\([^)]*\))?\s*$/); var off = z ? (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +z[3]) : 0; sent = Core.toLocalIso(ms, off); } }
    return { msg: msg, from: utf(h.from), to: utf(h.to), cc: utf(h.cc), subject: utf(h.subject), date: h.date || null, sent: sent,
      messageId: h['message-id'] ? h['message-id'].trim().replace(/^<|>$/g, '') : null };
  }
  function readEmail(buf) {
    var e = emailHeaders(buf), acc = { plain: null, html: null, attachments: [] };
    walkParts(e.msg, acc);
    var text = acc.plain != null ? acc.plain : (acc.html != null ? htmlToText(acc.html) : '');
    return { type: 'email', headers: { from: e.from, to: e.to, cc: e.cc, subject: e.subject, date: e.date, messageId: e.messageId }, text: text, attachments: acc.attachments, sent: e.sent };
  }

  /* ───────── one saved file: what it is now, and its contents now ───────── */
  var MAX_FILE = 40 * 1024 * 1024;
  function baseName(p) { return String(p).split('/').pop(); }
  function extName(p) { var m = baseName(p).match(/(\.[^.]+)$/); return m ? m[1] : ''; }
  function localIso(ms) { return Core.toLocalIso(ms, -new Date(ms).getTimezoneOffset()); }
  /* why a file could not be opened, in words. file.reason: missing | folder | not-a-file | denied | link | too-large | error */
  function fileReason(file, p) {
    var r = file && file.reason;
    if (r === 'missing') return 'file not found at ' + p + ' (moved, renamed or deleted)';
    if (r === 'denied') return 'no permission to read ' + p;
    if (r === 'folder') return p + ' is a folder now, not a file';
    if (r === 'not-a-file') return p + ' is no longer a file';
    if (r === 'link') return 'the link at ' + p + ' leads nowhere';
    return 'could not be read (' + ((file && file.detail) || 'unknown error') + ')';
  }
  /* title, the file's own date and what kind of date that is */
  function observe(realPath, bytes, mtimeMs) {
    var kind = Core.kindForPath(realPath), title = baseName(realPath), mtime = mtimeMs ? localIso(Math.floor(mtimeMs)) : null;
    var o = { title: title, sourceTime: mtime, sourceTimeType: mtime ? 'modified-only' : 'unknown', sourceCreated: null, kind: kind, messageId: null };
    if (kind === 'email') {
      var e = emailHeaders(bytes);
      o.title = Core.cleanTitle(e.subject) || title; o.messageId = e.messageId;
      if (e.sent) { o.sourceTime = e.sent; o.sourceTimeType = 'sent'; }
    } else if (/\.(xlsx|xlsm)$/i.test(realPath)) {
      try {
        var meta = workbookMeta(unzip(bytes));
        if (meta.modified && !isNaN(Date.parse(meta.modified))) {
          o.sourceTime = localIso(Date.parse(meta.modified)); o.sourceTimeType = 'modified';
          o.sourceCreated = (meta.created && !isNaN(Date.parse(meta.created))) ? localIso(Date.parse(meta.created)) : null;
        }
      } catch (e2) { /* fall back to the file date */ }
    }
    return o;
  }
  /* a saved file as a source object. file: { ok, realPath, bytes, mtimeMs, size } or { ok:false, reason } */
  function describeFile(file, shownPath) {
    if (!file || !file.ok) {
      var r = file && file.reason;
      return { ok: false, reason: r === 'folder' ? 'only a saved file can be tagged; ' + shownPath + ' is a folder' : fileReason(file, shownPath) };
    }
    if (file.size > MAX_FILE) return { ok: false, reason: 'file is larger than 40 MB' };
    var o = observe(file.realPath, file.bytes, file.mtimeMs);
    var id = (o.kind === 'email' && o.messageId) ? Core.messageId(o.messageId) : Core.fileId(file.realPath);
    return { ok: true, desc: { id: id, kind: o.kind, title: o.title, locator: { type: 'file', value: file.realPath }, sourceTime: o.sourceTime, sourceTimeType: o.sourceTimeType, sourceCreated: o.sourceCreated } };
  }
  /* Read one indexed file as it is saved right now.
     → {status:'ok', content, observed} | {status:'unreadable', reason, observed} | {status:'unavailable', reason} */
  function readFile(record, file, opts) {
    opts = opts || {};
    var p = record.locator.value;
    if (!file || !file.ok) return { status: 'unavailable', reason: fileReason(file, p) };
    if (file.size > MAX_FILE || !file.bytes) return { status: 'unreadable', reason: 'file is larger than 40 MB', observed: { title: baseName(p), sourceTime: file.mtimeMs ? localIso(Math.floor(file.mtimeMs)) : null, sourceTimeType: 'modified-only', sourceCreated: null } };
    var buf = file.bytes, o, observed;
    try { o = observe(p, buf, file.mtimeMs); } catch (e0) { o = { kind: Core.kindForPath(p), title: baseName(p), sourceTime: file.mtimeMs ? localIso(Math.floor(file.mtimeMs)) : null, sourceTimeType: 'modified-only', sourceCreated: null }; }
    observed = { title: o.title, sourceTime: o.sourceTime, sourceTimeType: o.sourceTimeType, sourceCreated: o.sourceCreated };
    try {
      if (o.kind === 'email') {
        var em = readEmail(buf);
        /* the entry points at one specific message; a different message now saved at this path is not it */
        if (/^mid:/.test(record.id) && Core.messageId(em.headers.messageId) !== record.id) return { status: 'unavailable', reason: 'the file at ' + p + ' is now a different message' };
        return { status: 'ok', content: em, observed: observed };
      }
      if (/\.(xlsx|xlsm)$/i.test(p)) return { status: 'ok', content: readWorkbook(buf, opts), observed: observed };
      if (/\.(csv|tsv)$/i.test(p)) return { status: 'ok', content: readCsv(utf8(buf), /\.tsv$/i.test(p) ? '\t' : ','), observed: observed };
      if (o.kind === 'note' || /\.(json|log|xml|html?|ya?ml|ini|conf|rtf)$/i.test(p)) {
        var zero = Array.prototype.indexOf.call(buf.subarray(0, 4096), 0);
        if (zero >= 0) return { status: 'unreadable', reason: 'not a text file', observed: observed };
        return { status: 'ok', content: { type: 'text', lines: utf8(buf).replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n') }, observed: observed };
      }
      return { status: 'unreadable', reason: 'no reader for ' + (extName(p) || 'this kind of') + ' files in this version; the file is there and can be opened where it is', observed: observed };
    } catch (e) {
      return { status: 'unreadable', reason: 'the file is there but could not be parsed (' + e.message + ')', observed: observed };
    }
  }
  /* the reply of the read-only script for one Apple Note or Mail message → the same shape as readFile */
  function readAppReply(record, reply, offsetMinutes) {
    var f = String(reply == null ? '' : reply).replace(/\n$/, '').split(Core.SEP);
    if (f[0] === 'ERR') return { status: 'unavailable', reason: f[1] || 'not accessible' };
    if (f[0] === 'note') {
      var nt = Core.isotToIso(f[2], offsetMinutes);
      return { status: 'ok', content: { type: 'text', lines: String(f.slice(4).join(Core.SEP)).replace(/\r\n?/g, '\n').split('\n') },
        observed: { title: f[1], sourceTime: nt, sourceTimeType: nt ? 'modified' : 'unknown', sourceCreated: Core.isotToIso(f[3], offsetMinutes) } };
    }
    if (f[0] === 'email') {
      if (Core.messageId(f[1]) !== record.id) return { status: 'unavailable', reason: 'a different message is now at that place in Mail' };
      var mt = Core.isotToIso(f[3], offsetMinutes);
      return { status: 'ok', content: { type: 'email', headers: { from: f[4], subject: f[2], messageId: f[1] }, text: f.slice(5).join(Core.SEP), attachments: [] },
        observed: { title: f[2], sourceTime: mt, sourceTimeType: mt ? 'sent' : 'unknown', sourceCreated: null } };
    }
    return { status: 'unavailable', reason: 'the app gave an unexpected answer' };
  }
  /* why an app could not be asked, in words (AppleScript error numbers) */
  function appReason(code, message) {
    if (code === -1743) return 'macOS is not allowing this. Allow it under System Settings › Privacy & Security › Automation';
    if (code === -1712) return 'the app did not answer in time';
    if (code === -1728 || code === -1719) return 'the object could not be found in the app';
    return 'the app could not be asked' + (message ? ' (' + String(message).split('\n').pop().slice(0, 160) + ')' : '');
  }

  return { u16: u16, u32: u32, latin1: latin1, bytesOfLatin1: bytesOfLatin1, utf8: utf8, utf8Bytes: utf8Bytes, base64Bytes: base64Bytes, decodeBytes: decodeBytes,
    moneyFormat: moneyFormat, showMoney: showMoney, inflateRaw: inflateRaw, unzip: unzip, readWorkbook: readWorkbook, readCsv: readCsv, readEmail: readEmail, emailHeaders: emailHeaders,
    observe: observe, describeFile: describeFile, readFile: readFile, readAppReply: readAppReply, appReason: appReason, fileReason: fileReason, localIso: localIso, MAX_FILE: MAX_FILE };
})(typeof WorkIndexCore !== 'undefined' ? WorkIndexCore : require('./rules.js'));
if (typeof module !== 'undefined' && module.exports) module.exports = WorkIndexRead;
