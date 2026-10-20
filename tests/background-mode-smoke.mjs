import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [app, worker, pair, group, groupSession, relay, html, readme] = await Promise.all([
  read('../src/app.mjs'), read('../src/emulator-worker.mjs'), read('../src/transport.mjs'),
  read('../src/group-transport.mjs'), read('../src/group-session.mjs'), read('../relay/server.mjs'),
  read('../src/index.html'), read('../README.md'),
]);
assert(!app.includes('联机页面进入后台，已结束会话'), 'background visibility must not terminate multiplayer');
assert(!app.includes("$('stop').click()"), 'visibility handling must not click the stop button');
assert(app.includes('后台运行中 · 联机不会因切换标签页主动结束'), 'background state should be visible');
assert(app.includes('visibility=visible; multiplayer session remains active'), 'returning to foreground should be logged');
const visibilityHandler = app.slice(app.indexOf("document.addEventListener('visibilitychange'"));
assert(!visibilityHandler.includes("mode==='solo'&&!paused"), 'solo mode must not auto-pause on visibility changes');
assert(!visibilityHandler.includes("type:'pause'"), 'visibility changes must not send a pause command');
assert(visibilityHandler.includes("document.hidden&&active&&mode!=='solo'"), 'background status handling should be multiplayer-only');
assert(app.includes("$('pause').onclick=()=>{if(mode!=='solo'||!worker)return;paused=!paused;"), 'manual single-player pause control must remain available');
assert(worker.includes('createIncomingQueue()'), 'worker should use a byte-accounted receive queue');
assert(worker.includes("case'visibility':pageHidden=!!m.hidden;"), 'worker should receive visibility state');
assert(worker.includes('isBackground:()=>pageHidden'), 'group sync should know when its own page is hidden');
for (const [name, source] of [['two-player', pair], ['group', group]]) {
  assert(source.includes('const BACKGROUND_LIVENESS_TIMEOUT_MS=300_000;'), `${name} heartbeat should tolerate background timer throttling`);
  assert(source.includes('Date.now()-lastSeen>BACKGROUND_LIVENESS_TIMEOUT_MS'), `${name} heartbeat should use the tolerant timeout`);
}
assert(pair.includes('MAX_QUEUED_PACKETS=32768,MAX_QUEUED_BYTES=8*1024*1024;'), 'two-player queue should tolerate background dispatch backlog with a byte cap');
assert(group.includes('MAX_QUEUED_PACKETS=65536,MAX_QUEUED_BYTES=16*1024*1024;'), 'group queue should tolerate background dispatch backlog with a byte cap');
assert(groupSession.includes('const MAX_SYNC_WAIT_MS=300_000;'), 'all group peers should tolerate throttled background sync');
assert(relay.includes('const heartbeat = options.heartbeat ?? 300_000;'), 'relay should tolerate a five-minute background heartbeat gap');
assert(html.includes('支持切换标签页或最小化'), 'room instructions should explain background mode');
assert(html.includes('不会因进入后台而主动结束房间'), 'help dialog should explain background behavior');
assert(readme.includes('心跳容错为 5 分钟'), 'README should document the background policy');
console.log('PASS: no forced stop on visibility change; receive queues and multiplayer timeouts tolerate background throttling.');
