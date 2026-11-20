/* Test asset: one fictional scene on a pretend Mac, used for the before/after screenshots and the task measurements.
 * It is the round-2 corpus ("Pine Ridge tooling budget") plus a mail message with a long Korean subject.
 * Both builds are shown exactly the same scene. */
'use strict';
process.env.TZ = 'Asia/Seoul';
var fs = require('fs'), os = require('os'), path = require('path');
var L = require('../rounds/lib.js');
var LONG = '[긴급] 파인리지 하우징 금형 견적 재검토 요청 및 2026년 11월 납기 일정 조정 관련 회신 드립니다 (Harborline Tooling, P20 강재 기준)';

/* popoverModule: the build's own core/popover.js, so the scene is tagged by the same build that is being shown */
async function build(popoverModule) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-scene-')), mac = L.Mac.create(dir), clock = { ms: 0 };
  var played = await L.playScenario(mac, popoverModule, clock);
  mac.addMail({ numericId: '6001', messageId: '20261119.0905.kr@harborline-tooling.example', subject: LONG, sent: '2026-11-19T09:05:00', account: 'Work', mailbox: 'INBOX',
    from: '다나 오카포 <dana.okafor@harborline-tooling.example>', text: '안녕하세요, 미나 님.\n\n요청하신 금형 견적 재검토 결과를 보내 드립니다.\n- 2캐비티 금형, P20 강재: USD 48,500\n- 납기: 발주 후 6주\n\n감사합니다.' });
  mac.select(L.MAIL, ['6001']);
  mac.select(L.NOTES, ['x-coredata://FICTIONAL-0002/ICNote/p11']);
  return { mac: mac, dir: dir, ids: played.ids, LONG: LONG, clock: clock, cleanup: function () { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* leave it */ } } };
}
module.exports = { build: build, LONG: LONG, L: L };
