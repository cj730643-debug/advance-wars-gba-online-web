import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [worker, app] = await Promise.all([
  read('../src/emulator-worker.mjs'), read('../src/app.mjs'),
]);
const noticeStart = worker.indexOf('notice(text,error){');
const noticeEnd = worker.indexOf('\n video(bytes,w,h)', noticeStart);
assert(noticeStart >= 0 && noticeEnd > noticeStart, 'worker core notice handler must exist');
const notice = worker.slice(noticeStart, noticeEnd);
const soloGuard = notice.indexOf("if(mode==='solo')");
const fatalCall = notice.indexOf("fail(/calibrat.*(timeout|timed out)/i.test(detail)?'CORE_CALIBRATION_TIMEOUT':'CORE_SYNC_FAILURE')");
assert(soloGuard >= 0 && fatalCall > soloGuard, 'single-player core logs must be handled before multiplayer fatal sync errors');
assert(notice.includes("single-player core diagnostic (non-fatal)"), 'single-player core diagnostics must still be preserved in logs');
assert(app.includes("CORE_SESSION_ENDED:'模拟器核心已停止运行，请下载诊断日志查看最后的核心日志。'"), 'unexpected core termination must tell users how to diagnose it');
assert(app.includes("CORE_SYNC_FAILURE:'联机模拟器报告同步错误，对局已停止。可下载诊断日志。'"), 'sync failure wording must identify the multiplayer context');
console.log('Single-player core diagnostic regression test passed.');
