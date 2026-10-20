import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrateNetwork,selectInputWindow} from '../src/network-calibration.mjs';
import {attachPacketWait} from '../src/packet-wait.mjs';

test('window covers slow samples, remains bounded and never drops below eight',()=>{
 assert.equal(selectInputWindow([10,12,11]),8);
 assert(selectInputWindow([180,200,190])>8);
 assert.equal(selectInputWindow([2000,2500,2200]),32);
});
test('three peers with different clocks agree the slowest window and preserve deferred snapshots',async()=>{
 const fronts=Array.from({length:3},()=>({incoming:attachPacketWait([]),terminal:false})),jobs=new Set();
 function deliver(to,message,delay){const timer=setTimeout(()=>{jobs.delete(timer);fronts[to].incoming.push(message);fronts[to].incoming.wake?.();},delay);jobs.add(timer);}
 try{
  deliver(0,{role:1,kind:1,payload:new Uint8Array([99])},5);
  const results=await Promise.all(fronts.map((front,role)=>calibrateNetwork({front,role,players:3,stopped:()=>false,now:()=>performance.now()+role*100000,transport:{send(kind,payload){for(let to=0;to<3;to++)if(to!==role)deliver(to,{role,kind,payload:payload.slice()},role===2||to===2?75:2);return true;}}})));
  assert.equal(new Set(results.map(x=>x.frames)).size,1);
  assert(results[0].frames>=11&&results[0].frames<=32);
  assert(fronts[0].incoming.some(m=>m.kind===1&&m.payload[0]===99));
 }finally{for(const timer of jobs)clearTimeout(timer);}
});
test('missing peer times out instead of starting with unconfirmed input window',async()=>{
 const front={incoming:attachPacketWait([]),terminal:false};
 await assert.rejects(calibrateNetwork({front,role:0,players:2,stopped:()=>false,timeout:1,transport:{send:()=>true}}),/GROUP_CALIBRATION_TIMEOUT/);
});
