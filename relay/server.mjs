// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

export const PROTOCOL = 'aw-relay-1';
export const GROUP_PROTOCOL = 'aw-relay-group-1';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const token = () => randomBytes(32).toString('base64url');
const code = () => [...randomBytes(8)].map(n => alphabet[n % alphabet.length]).join('');
const hash = /^[a-f0-9]{64}$/;
function manifest(m, group = false) {
  if (!m || !['aw1', 'aw2', 'diagnostic'].includes(m.game) || m.protocol !== (group ? GROUP_PROTOCOL : PROTOCOL) ||
      m.coreProtocol !== (group ? 'mgba-gba-link-group-1' : 'mgba-gba-link-replicated-v2') ||
      (group && (!Number.isInteger(m.players) || m.players < 2 || m.players > 4)) ||
      !['rom', 'core', 'config'].every(k => typeof m[k] === 'string' && hash.test(m[k]))) {
    throw Object.assign(new Error('INVALID_MANIFEST'), { status: 400 });
  }
  return Object.fromEntries(['game', 'protocol', 'coreProtocol', 'rom', 'core', 'config', ...(group ? ['players'] : [])].map(k => [k, m[k]]));
}

// Opaque binary envelopes carry unmodified core packets. Sequence belongs to
// this transport, independently of the core's already validated sequence.
export function unpack(bytes, expected) {
  if (bytes.length <= 12 || bytes.length > 65548 || bytes.toString('ascii', 0, 4) !== 'AWR1') throw new Error('BAD_PACKET');
  const n = bytes.readBigUInt64BE(4);
  if (n !== expected || n === 0n || n === 0xffffffffffffffffn) throw new Error('BAD_SEQUENCE');
  return bytes.subarray(12);
}

// Group envelope: magic, authenticated sender, player count, payload kind,
// reserved zero, and strictly increasing unsigned 64-bit sequence.
export function unpackGroup(bytes, expected, role, players) {
 if(bytes.length<=16 || bytes.length>65548 || bytes.toString('ascii',0,4)!=='AWG1' || bytes[4]!==role || bytes[5]!==players || ![1,2,3].includes(bytes[6]) || bytes[7]!==0)throw Error('BAD_PACKET');
 const n=bytes.readBigUInt64BE(8);
 if(n!==expected || n===0n || n===0xffffffffffffffffn)throw Error('BAD_SEQUENCE');
 return bytes.subarray(16);
}

export function createRelay(options = {}) {
  const allowedOrigins = new Set(options.allowedOrigins ?? (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean));
  const clock = options.clock ?? (() => performance.now());
  const ttl = options.roomTtl ?? 10 * 60_000;
  const authTtl = options.authTtl ?? 60_000;
  const heartbeat = options.heartbeat ?? 300_000;
  const maxLifetime = options.maxLifetime ?? 8 * 3600_000;
  const maxRooms = options.maxRooms ?? 100;
  const maxConnections = options.maxConnections ?? 200;
  const rooms = new Map();
  const sockets = new Set();
  const requestBuckets = new Map();
  let closing = false;

  function bucket(map, key, max, period) {
    const now = clock();
    let b = map.get(key);
    if (!b || now - b.at >= period) { b = { at: now, n: 0 }; map.set(key, b); }
    return ++b.n <= max;
  }
  function send(ws, value) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
  }
  function end(room, reason) {
    if (!room || room.ended) return;
    room.ended = true;
    rooms.delete(room.code);
    for (const p of room.players) {
      if (p?.ws) { send(p.ws, { type: 'ended', reason }); p.ws.close(4000, reason); }
      if (p) p.token = '';
    }
  }
  function credential(role) {
    return { role, token: token(), expires: clock() + authTtl, ws: null, seq: 1n, lastSeen: clock() };
  }
  function publicCredential(room, p) {
    return { code: room.code, role: p.role, token: p.token, expiresInMs: authTtl, protocol: room.manifest.protocol, players: room.players.length };
  }
  function sweep() {
    const now = clock();
    for (const r of rooms.values()) {
      if (now - r.created >= maxLifetime || (!r.ready && now >= r.expires)) end(r, 'ROOM_EXPIRED');
      else if (r.players.some(p => p?.ws && now - p.lastSeen >= heartbeat)) end(r, 'HEARTBEAT_TIMEOUT');
      else if (r.players.some(p => p && !p.ws && now >= p.expires)) end(r, 'TOKEN_EXPIRED');
    }
    for (const ws of sockets) if (!ws.player && now - ws.openedAt >= authTtl) ws.close(4001, 'AUTH_TIMEOUT');
    for (const [key, value] of requestBuckets) if (now - value.at >= 60_000) requestBuckets.delete(key);
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin', ...(allowedOrigins.has(req.headers.origin) ? { 'Access-Control-Allow-Origin': req.headers.origin } : {}) });
      res.end(JSON.stringify(obj));
    };
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return reply(403, { error: 'ORIGIN_REJECTED' });
    if (req.method === 'OPTIONS') {
      const headers = (req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      if (!allowedOrigins.has(req.headers.origin) || !['GET', 'POST'].includes(req.headers['access-control-request-method']) || headers.some(h => h !== 'content-type')) return reply(403, { error: 'ORIGIN_REJECTED' });
      res.writeHead(204, { 'Access-Control-Allow-Origin': req.headers.origin, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' }); return res.end();
    }
    if (req.url === '/health' && req.method === 'GET') return reply(200, { status: 'ok', protocol: PROTOCOL, groupProtocol: GROUP_PROTOCOL });
    if (req.method !== 'POST') return reply(404, { error: 'NOT_FOUND' });
    // Trust the TCP peer only. A reverse proxy must also impose its own per-IP
    // limits; user-controlled X-Forwarded-For is never trusted here.
    if (!bucket(requestBuckets, req.socket.remoteAddress, 30, 60_000)) return reply(429, { error: 'RATE_LIMIT' });
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk.toString('utf8');
        if (Buffer.byteLength(body) > 4096) { reply(413, { error: 'BODY_TOO_LARGE' }); req.destroy(); return; }
      }
      const group = req.url.startsWith('/v2/');
      const m = manifest(JSON.parse(body), group);
      sweep();
      if ((req.url === '/v1/rooms' || req.url === '/v2/rooms')) {
        if (rooms.size >= maxRooms) return reply(503, { error: 'CAPACITY' });
        let c; do { c = code(); } while (rooms.has(c));
        const r = { code: c, manifest: m, players: Array.from({length:group ? m.players : 2},(_,i)=>i===0?credential(0):null), created: clock(), expires: clock() + ttl, ready: false, ended: false };
        rooms.set(c, r);
        return reply(201, publicCredential(r, r.players[0]));
      }
      const match = /^\/v[12]\/rooms\/([A-Z2-9]{8})\/join$/.exec(req.url);
      if (!match) return reply(404, { error: 'NOT_FOUND' });
      const r = rooms.get(match[1]);
      if (!r) return reply(404, { error: 'INVALID_CODE' });
      const role = r.players.findIndex(p=>!p);
      if (role < 0) return reply(409, { error: 'ROOM_FULL' });
      if (r.manifest.rom !== m.rom) return reply(409, { error: 'ROM_MISMATCH' });
      if (r.manifest.protocol !== m.protocol || r.manifest.coreProtocol !== m.coreProtocol) return reply(409, { error: 'PROTOCOL_MISMATCH' });
      if (JSON.stringify(r.manifest) !== JSON.stringify(m)) return reply(409, { error: 'CONFIG_MISMATCH' });
      r.players[role] = credential(role);
      return reply(200, publicCredential(r, r.players[role]));
    } catch (e) { if (!res.headersSent) reply(e.status ?? 400, { error: e.status ? e.message : 'BAD_REQUEST' }); }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65548, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    if (closing || req.url !== '/v1/relay' || sockets.size >= maxConnections ||
        !bucket(requestBuckets, req.socket.remoteAddress, 30, 60_000)) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', ws => {
    sockets.add(ws); ws.openedAt = clock();
    const rate = new Map();
    ws.on('error', () => { if (ws.room) end(ws.room, 'TRANSPORT_ERROR'); });
    ws.on('close', () => { sockets.delete(ws); if (ws.room) end(ws.room, 'PEER_DISCONNECTED'); });
    ws.on('message', (data, binary) => {
      try {
        if (!bucket(rate, 'packets', 600, 1000) || !bucket(rate, 'bytes', 1e9, 1000)) throw new Error('RATE_LIMIT');
        const b = rate.get('bytes'); b.n += data.length;
        if (b.n > 8 * 1024 * 1024) throw new Error('RATE_LIMIT');
        if (!ws.player) {
          if (binary || data.length > 512) throw new Error('AUTH_REQUIRED');
          const a = JSON.parse(data.toString());
          const r = rooms.get(a.code);
          if (!r || r.ended || (!Number.isInteger(a.role) || a.role<0 || a.role>=r.players.length)) throw new Error('INVALID_AUTH');
          const p = r.players[a.role];
          if (!p || !p.token || p.token !== a.token || p.ws || clock() >= p.expires) throw new Error('INVALID_AUTH');
          p.token = ''; p.ws = ws; p.lastSeen = clock(); ws.player = p; ws.room = r;
          if(r.manifest.protocol===GROUP_PROTOCOL){for(const q of r.players)if(q?.ws)send(q.ws,{type:'waiting',role:q.role,players:r.players.length,connected:r.players.filter(x=>x?.ws?.readyState===WebSocket.OPEN).length});}
          else send(ws,{type:'waiting',role:p.role});
          if (r.players.every(p => p?.ws?.readyState === WebSocket.OPEN)) {
            r.ready = true;
            for (const q of r.players) send(q.ws, { type: 'ready', role: q.role, players:r.players.length });
          }
          return;
        }
        const r = ws.room; const p = ws.player;
        if (r.ended) return;
        p.lastSeen = clock();
        if (!binary) {
          if (data.length > 256) throw new Error('BAD_CONTROL');
          const msg = JSON.parse(data.toString());
          if (msg.type !== 'ping' || !Number.isSafeInteger(msg.nonce) || msg.nonce < 0) throw new Error('BAD_CONTROL');
          send(ws, { type: 'pong', nonce: msg.nonce }); return;
        }
        if (!r.ready) throw new Error('NOT_READY');
        if(r.manifest.protocol===GROUP_PROTOCOL)unpackGroup(data,p.seq,p.role,r.players.length);
        else unpack(data,p.seq);
        ++p.seq;
        const peers=r.players.filter(q=>q.role!==p.role).map(q=>q.ws);
        for(const peer of peers){
          if(!peer || peer.readyState!==WebSocket.OPEN)throw Error('PEER_DISCONNECTED');
          if(peer.bufferedAmount+data.length>4*1024*1024)throw Error('BACKPRESSURE');
        }
        for(const peer of peers)peer.send(data,{binary:true});
      } catch (e) {
        if (ws.room) end(ws.room, ['BAD_SEQUENCE','PEER_DISCONNECTED','BACKPRESSURE','NOT_READY','RATE_LIMIT'].includes(e.message) ? e.message : 'PROTOCOL_ERROR');
        else { send(ws, { type: 'error', reason: 'AUTH_REJECTED' }); ws.close(4001, 'AUTH_REJECTED'); }
      }
    });
  });
  const interval = setInterval(sweep, Math.min(1000, heartbeat / 2)); interval.unref();
  return {
    server, rooms, sweep,
    async listen(port = 0, host = '127.0.0.1') {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
      return `http://${host}:${server.address().port}`;
    },
    async close() {
      closing = true; clearInterval(interval);
      for (const r of [...rooms.values()]) end(r, 'SERVER_SHUTDOWN');
      for (const ws of sockets) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = createRelay();
  await relay.listen(Number(process.env.PORT ?? 8787), process.env.HOST ?? '127.0.0.1');
  console.log('AW Relay listening. Use a TLS reverse proxy for internet access.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => relay.close().then(() => process.exit(0)));
}
