// MPL-2.0. Real WebSockets, stable roles, authenticated bounded replay.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createRelay,RESUMABLE_GROUP_PROTOCOL} from '../server.mjs';
const base={game:'diagnostic',protocol:RESUMABLE_GROUP_PROTOCOL,coreProtocol:'mgba-gba-link-group-1',players:2,rom:'a'.repeat(64),core:'b'.repeat(64),config:'c'.repeat(64)};
const packet=(role,players,seq)=>{const b=Buffer.alloc(20);b.write('AWG1');b[4]=role;b[5]=players;b[6]=2;b.writeBigUInt64BE(BigInt(seq),8);b.writeUInt32BE(123,16);return b;};
async function setup(t,opts){const relay=createRelay(opts),origin=await relay.listen(),clients=[];t.after(async()=>{for(const ws of clients)ws.terminate();await relay.close();});
 const post=async(path,m)=>{const r=await fetch(origin+path,{method:'POST',body:JSON.stringify(m)});assert(r.ok);return r.json();};
 async function connect(a,extra={}){const ws=new WebSocket(origin.replace('http:','ws:')+'/v1/relay'),queue=[],wait=[];clients.push(ws);
 ws.on('message',(b,binary)=>{const m=binary?b:JSON.parse(b);if(wait.length)wait.shift()(m);else queue.push(m);});
 ws.next=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout')),4000);wait.push(m=>{clearTimeout(timer);resolve(m);});});
 ws.until=async type=>{for(;;){const m=await ws.next();if(m.type===type)return m;}};
 await once(ws,'open');ws.send(JSON.stringify({code:a.code,role:a.role,token:a.token,received:Array(a.players).fill('1'),...extra}));return ws;}
 async function group(players=2){const m={...base,players},auth=[await post('/v2/rooms',m)];for(let i=1;i<players;i++)auth.push(await post(`/v2/rooms/${auth[0].code}/join`,m));const sockets=[];for(const a of auth){const ws=await connect(a);await ws.until('session');sockets.push(ws);}await Promise.all(sockets.map(ws=>ws.until('ready')));return{auth,sockets};}
 return{relay,group,connect};}
for(const players of [2,3,4])test(`${players} peers retain role and replay exactly the missed packets`,{timeout:10000},async t=>{
 const {relay,group,connect}=await setup(t),{auth,sockets}=await group(players),r=relay.rooms.get(auth[0].code);
 sockets[0].send(packet(0,players,1));for(const ws of sockets.slice(1))assert.deepEqual(await ws.next(),packet(0,players,1));
 sockets[1].terminate();await sockets[0].until('reconnecting');
 sockets[0].send(packet(0,players,2));for(const ws of sockets.slice(2)){await ws.until('reconnecting');assert.deepEqual(await ws.next(),packet(0,players,2));}
 const cursor=Array(players).fill('1');cursor[0]='2';const restored=await connect(auth[1],{resume:true,token:auth[1].resumeToken,received:cursor});
 assert.equal((await restored.until('session')).accepted,'1');assert.deepEqual(await restored.next(),packet(0,players,2));await restored.until('resumed');for(const [i,ws]of sockets.entries())if(i!==1)await ws.until('resumed');
 assert.equal(r.players[1].ws!==null,true);assert.equal(relay.rooms.size,1);restored.send(packet(1,players,1));for(const [i,ws]of sockets.entries())if(i!==1)assert.deepEqual(await ws.next(),packet(1,players,1));
 restored.send(JSON.stringify({type:'leave'}));assert.equal((await sockets[0].until('ended')).reason,'PEER_DISCONNECTED');assert.equal(relay.rooms.size,0);
});
test('resume token can replace a half-open connection, but another role and initial-token replay cannot',async t=>{
 const {relay,group,connect}=await setup(t),{auth,sockets}=await group();
 const wrong=await connect(auth[1],{resume:true,role:0,token:auth[1].resumeToken});assert.equal((await wrong.until('error')).reason,'AUTH_REJECTED');
 const replay=await connect(auth[0]);assert.equal((await replay.until('error')).reason,'AUTH_REJECTED');assert.equal(relay.rooms.size,1);
 const next=await connect(auth[1],{resume:true,token:auth[1].resumeToken});await next.until('session');await next.until('resumed');await sockets[0].until('resumed');assert.equal(relay.rooms.size,1);
});
test('grace expiry ends the room and invalidates credentials',async t=>{let now=0;const {relay,group,connect}=await setup(t,{clock:()=>now,resumeGrace:100}),{auth,sockets}=await group();sockets[1].terminate();await sockets[0].until('reconnecting');now=101;relay.sweep();assert.equal((await sockets[0].until('ended')).reason,'RECONNECT_TIMEOUT');assert.equal(relay.rooms.size,0);const bad=await connect(auth[1],{resume:true,token:auth[1].resumeToken});assert.equal((await bad.until('error')).reason,'AUTH_REJECTED');});
test('receipts free retained history and cannot claim a future sequence',async t=>{const{relay,group}=await setup(t),{auth,sockets}=await group();sockets[0].send(packet(0,2,1));await sockets[1].next();sockets[1].send(JSON.stringify({type:'ping',nonce:1,received:['2','1']}));await sockets[1].until('pong');assert.equal(relay.rooms.get(auth[0].code).players[0].history.length,0);sockets[1].send(JSON.stringify({type:'ping',nonce:2,received:['3','1']}));assert.equal((await sockets[0].until('ended')).reason,'PROTOCOL_ERROR');});
test('replay history is bounded and duplicate input remains fatal',async t=>{const{group}=await setup(t,{maxReplayBytes:20}),{sockets}=await group();sockets[0].send(packet(0,2,1));await sockets[1].next();sockets[0].send(packet(0,2,2));assert.equal((await sockets[1].until('ended')).reason,'BACKPRESSURE');});
test('resume protocol still rejects duplicate sequence immediately',async t=>{const{group}=await setup(t),{sockets}=await group();sockets[0].send(packet(0,2,1));await sockets[1].next();sockets[0].send(packet(0,2,1));assert.equal((await sockets[1].until('ended')).reason,'BAD_SEQUENCE');});
