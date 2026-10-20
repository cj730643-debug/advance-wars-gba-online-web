import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachPacketWait} from '../src/packet-wait.mjs';

test('packet wakes a waiting receiver before its liveness timer',async()=>{
 const q=attachPacketWait([]);let resolved=false;
 const waiting=q.wait(10_000).then(()=>resolved=true);
 await Promise.resolve();assert.equal(resolved,false);
 q.push(new Uint8Array([1]));q.wake();await waiting;
 assert.equal(resolved,true);assert.equal(q.length,1);
});
test('already queued packet is consumed without waiting',async()=>{
 const q=attachPacketWait([1]);await q.wait(10_000);assert.equal(q[0],1);
});
test('explicit wake also releases a stopped empty receiver',async()=>{
 const q=attachPacketWait([]),waiting=q.wait(10_000);q.wake();await waiting;
});
test('liveness timer releases a silent receiver',async()=>{
 const q=attachPacketWait([]);await q.wait(10);assert.equal(q.length,0);
});
