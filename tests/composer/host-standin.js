#!/usr/bin/env node
/* TEST STAND-IN for the Swift helper (the contexta app run by the browser with "chrome-extension://…" as its
 * argument). It does what that helper is written to do: speak the browser's native-messaging framing on stdin and
 * stdout (4 bytes of length, then JSON), pass each request to the app over a local socket with the same framing,
 * and pass the answer back; when the app cannot be reached, answer every request with the reason.
 *   argv: <socket path> <chrome-extension origin from the browser> */
'use strict';
var net = require('net'), fs = require('fs');
var sockPath = process.argv[2], origin = process.argv[3] || '';
function frame(obj) { var body = Buffer.from(JSON.stringify(obj), 'utf8'), head = Buffer.alloc(4); head.writeUInt32LE(body.length, 0); return Buffer.concat([head, body]); }
function reader(onMessage) { var buf = Buffer.alloc(0); return function (d) { buf = Buffer.concat([buf, d]); for (;;) { if (buf.length < 4) return; var n = buf.readUInt32LE(0); if (buf.length < 4 + n) return; var m = JSON.parse(buf.slice(4, 4 + n).toString('utf8')); buf = buf.slice(4 + n); onMessage(m); } }; }
var off = fs.existsSync(sockPath + '.off'), sock = null, pending = [], why = off ? 'off' : '';
function refuse(m) { process.stdout.write(frame({ id: m.id, ok: false, reason: why || 'not-running' })); }
if (!off) {
  sock = net.createConnection(sockPath);
  sock.on('connect', function () { sock.write(frame({ hello: 'context-composer-host', origin: origin, pid: process.pid, ppid: process.ppid })); pending.forEach(function (m) { sock.write(frame(m)); }); pending = null; });
  sock.on('data', reader(function (m) { process.stdout.write(frame(m)); }));
  sock.on('error', function () { why = 'not-running'; sock = null; (pending || []).forEach(refuse); pending = null; });
  sock.on('close', function () { why = why || 'not-running'; sock = null; });
}
process.stdin.on('data', reader(function (m) { if (why || !sock) { if (pending && !why) pending.push(m); else refuse(m); } else if (pending) pending.push(m); else sock.write(frame(m)); }));
process.stdin.on('end', function () { if (sock) sock.end(); process.exit(0); });
