#!/usr/bin/env node
/* Draws the extension's icon (a plain tag shape, drawn here) at the four sizes the browser asks for.
 *   NODE_PATH=<folder with playwright> node dev/make-icons.js      Only needed if the icon is to change. */
'use strict';
var path = require('path'), chromium = require('playwright').chromium;
(async function () {
  var br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (var size of [16, 32, 48, 128]) {
    var pg = await (await br.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })).newPage();
    await pg.setContent('<body style="margin:0;background:transparent"><svg width="' + size + '" height="' + size + '" viewBox="0 0 17 17"><path d="M2.5 3.5a1 1 0 0 1 1-1h4.3a1 1 0 0 1 .7.3l6 6a1 1 0 0 1 0 1.4l-4.3 4.3a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1-.3-.7z" fill="#33566a" stroke="#33566a" stroke-width="1.2" stroke-linejoin="round"/><circle cx="5.6" cy="5.6" r="1.15" fill="#fafafa"/></svg>');
    await pg.screenshot({ path: path.join(__dirname, '..', 'extension', 'icon-' + size + '.png'), omitBackground: true });
    await pg.close();
  }
  await br.close(); console.log('extension/icon-16.png, -32, -48, -128');
})();
