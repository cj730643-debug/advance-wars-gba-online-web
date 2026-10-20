// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRelay, PROTOCOL, unpack } from '../server.mjs';

const base = { game: 'aw1', protocol: PROTOCOL, coreProtocol: 'mgba-gba-link-replicated-v2', rom: 'a'.repeat(64), core: 'b'.repeat(64), config: 'c'.repeat(64) };
async function setup(t, opts) {
  const r = createRelay(opts); const url = await r.listen();
  t.after(() => r.close());
  const post = async (path, m = base) => {
    const res = await fetch(url + path, { method: 'POST', body: JSON.stringify(m) });
    return { status: res.status, body: await res.json() };
  };
  const create = () => post('/v1/rooms');
  const join = (c, m) => post(`/v1/rooms/${c}/join`, m);
  const connect = async c => {
    const ws = new WebSocket(url.replace('http:', 'ws:') + '/v1/relay');
    const messages = []; const waiters = [];
    ws.on('message', (bytes, binary) => {
      const msg = binary ? bytes : JSON.parse(bytes.toString());
      const w = waiters.shift(); if (w) w(msg); else messages.push(msg);
    });
    ws.next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('message timeout')), 3000);
      waiters.push(msg => { clearTimeout(timer); resolve(msg); });
    });
    await once(ws, 'open'); ws.send(JSON.stringify(c)); return ws;
  };
  const pair = async () => {
    const a = (await create()).body; const b = (await join(a.code)).body;
    const x = await connect(a); assert.equal((await x.next()).type, 'waiting');
    const y = await connect(b); assert.equal((await y.next()).type, 'waiting');
    assert.equal((await x.next()).role, 0); assert.equal((await y.next()).role, 1);
    return { x, y, a, b };
  };
  return { r, post, create, join, connect, pair };
}
function packet(seq = 1n, payload = Buffer.from('opaque-core-packet')) {
  const b = Buffer.alloc(12 + payload.length); b.write('AWR1'); b.writeBigUInt64BE(seq, 4); payload.copy(b, 12); return b;
}
test('two authenticated players exchange opaque bytes in both directions and clean up', { timeout: 5000 }, async t => {
  const { pair, r } = await setup(t); const { x, y } = await pair();
  x.send(packet()); assert.deepEqual(await y.next(), packet());
  y.send(packet()); assert.deepEqual(await x.next(), packet());
  x.send(JSON.stringify({ type: 'ping', nonce: 42 })); assert.deepEqual(await x.next(), { type: 'pong', nonce: 42 });
  x.close(); assert.equal((await y.next()).type, 'ended');
  assert.equal(r.rooms.size, 0);
});
test('third player, invalid code, wrong ROM, core, game, config and protocol rejected', async t => {
  const { create, join } = await setup(t); const a = (await create()).body;
  assert.equal((await join('ZZZZZZZZ')).status, 404);
  for (const k of ['rom', 'core', 'config']) assert.equal((await join(a.code, { ...base, [k]: 'd'.repeat(64) })).status, 409);
  assert.equal((await join(a.code, { ...base, game: 'aw2' })).status, 409);
  assert.equal((await join(a.code, { ...base, protocol: 'wrong' })).status, 400);
  assert.equal((await join(a.code, { ...base, coreProtocol: 'wrong' })).status, 400);
  assert.equal((await join(a.code)).status, 200);
  assert.equal((await join(a.code)).status, 409);
});
test('expired token, token replay and stolen role rejected', async t => {
  let now = 0;
  const { create, join, connect } = await setup(t, { clock: () => now, authTtl: 100 });
  const a = (await create()).body; now = 101;
  const bad = await connect(a); assert.equal((await bad.next()).reason, 'AUTH_REJECTED');
  const c = (await create()).body;
  const x = await connect(c); await x.next();
  const replay = await connect(c); assert.equal((await replay.next()).reason, 'AUTH_REJECTED');
  const b = (await join(c.code)).body;
  const wrongRole = await connect({ ...b, role: 0 }); assert.equal((await wrongRole.next()).reason, 'AUTH_REJECTED');
});
test('default heartbeat tolerates a five-minute background timer pause', async t => {
  let now = 0;
  const { pair, r } = await setup(t, { clock: () => now });
  const { x, y } = await pair();
  now = 299_999; r.sweep();
  assert.equal(r.rooms.size, 1, 'room should survive a pause shorter than the default heartbeat');
  now = 300_001; r.sweep();
  assert.equal((await x.next()).reason, 'HEARTBEAT_TIMEOUT');
  assert.equal((await y.next()).reason, 'HEARTBEAT_TIMEOUT');
  assert.equal(r.rooms.size, 0);
});
test('room expiry, heartbeat timeout, no reconnection after drop', async t => {
  let now = 0; const { create, join, pair, r } = await setup(t, { clock: () => now, authTtl: 1000, roomTtl: 200, heartbeat: 100 });
  const a = (await create()).body; now = 201; r.sweep(); assert.equal((await join(a.code)).status, 404);
  const { x, y, b } = await pair(); now = 302; r.sweep();
  assert.equal((await x.next()).reason, 'HEARTBEAT_TIMEOUT');
  assert.equal((await y.next()).reason, 'HEARTBEAT_TIMEOUT');
  assert.equal((await join(b.code)).status, 404); assert.equal(r.rooms.size, 0);
});
for (const [name, bad] of [['zero', packet(0n)], ['skipped', packet(2n)], ['bad magic', Buffer.alloc(20)], ['empty payload', packet(1n, Buffer.alloc(0))]]) {
  test(`invalid envelope ${name} ends both players`, async t => {
    const { pair } = await setup(t); const { x, y } = await pair();
    x.send(bad); assert.equal((await y.next()).type, 'ended');
  });
}
test('duplicate packet sequence ends session', async t => {
  const { pair } = await setup(t); const { x, y } = await pair();
  x.send(packet()); await y.next(); x.send(packet()); assert.equal((await y.next()).reason, 'BAD_SEQUENCE');
});
test('oversized packet rejected by websocket parser and peer notified', async t => {
  const { pair } = await setup(t); const { x, y } = await pair();
  x.send(Buffer.alloc(65549)); assert.equal((await y.next()).type, 'ended');
});
test('restart terminates peers and credentials cannot be reused on a new server', async t => {
  const one = await setup(t); const { x, y, a } = await one.pair();
  await one.r.close();
  assert.equal((await x.next()).reason, 'SERVER_SHUTDOWN'); assert.equal((await y.next()).reason, 'SERVER_SHUTDOWN');
  const two = await setup(t); const ws = await two.connect(a); assert.equal((await ws.next()).reason, 'AUTH_REJECTED');
});
test('packet size and unsigned sequence boundaries', () => {
  assert.equal(unpack(packet(1n, Buffer.alloc(65536)), 1n).length, 65536);
  assert.throws(() => unpack(packet(0xffffffffffffffffn), 0xffffffffffffffffn));
});
