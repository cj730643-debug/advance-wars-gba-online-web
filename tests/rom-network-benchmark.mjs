// MPL-2.0. Private ROM stays local; relay receives hashes and synchronization only.
// Boots two independent clients and exercises Start/A/directional input. This
// does not claim to complete the game's internal Multi-Pak setup or a battle.
import {Worker} from 'node:worker_threads';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createRelay} from '../relay/server.mjs';
assert(process.env.ROM_PATH,'Set ROM_PATH to a local, user-supplied ROM');
const rom=await readFile(process.env.ROM_PATH),relay=process.env.RELAY_URL?null:createRelay();
const origin=process.env.RELAY_URL??await relay.listen(),cases=[],workers=[];
const keepAlive=setInterval(()=>{},1000);
try{for(const inputDelay of (process.env.DELAYS||'32,8,4').split(',').map(Number)){
 const clients=[];let stopSent=false;
 function launch(mode,code){
  const w=new Worker(new URL('./worker-node-adapter.mjs',import.meta.url));workers.push(w);
  let resolve,reject,roomResolve,roomReject;
  const done=new Promise((a,b)=>{resolve=a;reject=b;}),room=new Promise((a,b)=>{roomResolve=a;roomReject=b;});done.catch(()=>{});room.catch(()=>{});
  const result={role:null,states:[],errors:[],samples:[],rtt:[],videoFrames:0,complete:false},images=new Set();
  const timer=setTimeout(()=>{const e=Error('ROM benchmark timeout');reject(e);roomReject(e);},60000);
  w.on('error',e=>{reject(e);roomReject(e);});
  w.on('message',m=>{
   if(m.type==='adapter_ready'){const b=Uint8Array.from(rom).buffer;w.postMessage({type:'start',mode,code,game:'aw2',players:2,inputDelay,rom:b,saves:{},relay:origin},[b]);}
   if(m.type==='room'){result.role=m.role;roomResolve(m.code);}
   if(m.type==='state'){result.states.push(m.state);console.log(inputDelay,mode,m.state);}
   if(m.type==='rtt')result.rtt.push(m.ms);
   if(m.type==='error')result.errors.push(m.reason);
   if(m.type==='video'){++result.videoFrames;images.add(createHash('sha256').update(new Uint8Array(m.buffer)).digest('hex'));}
   if(m.type==='metrics'&&m.ready){
    result.samples.push(m);
    const step=Math.floor(m.afterReady/60)%6;w.postMessage({type:'keys',keys:step===1?1<<3:step===3?1<<8:step===5?1<<5:0});
    if(m.afterReady>=720&&m.verifiedFrame>=600)result.complete=true;
    if(clients.length===2&&clients.every(c=>c.result.complete)&&!stopSent){stopSent=true;clients[0].w.postMessage({type:'stop'});}
   }
   if(m.type==='stopped'){clearTimeout(timer);if(result.role===null)roomReject(Error(m.reason));result.distinctVideoFrames=images.size;resolve(result);}
  });const c={w,result,done,room};clients.push(c);return c;
 }
 const host=launch('host');launch('join',await host.room);
 const results=await Promise.all(clients.map(c=>c.done));
 for(const r of results){assert(r.complete,JSON.stringify(r));assert(r.distinctVideoFrames>10,'ROM must render changing graphics');assert.deepEqual(r.errors,r.role===0?[]:['PEER_DISCONNECTED']);assert(r.samples.every(m=>m.inputDelay===inputDelay));}
 cases.push({inputDelay,bufferMs:inputDelay*1000/59.7275,results});
 for(const c of clients)await c.w.terminate();
 }}finally{await Promise.all(workers.map(w=>w.terminate()));await relay?.close();clearInterval(keepAlive);}
const report={testedAt:new Date().toISOString(),scope:'User-supplied ROM boot/menu with scripted keys; 2 real WASM Workers via WS/WSS; internal Multi-Pak battle not verified; not physical input-to-photon latency',romSHA256:createHash('sha256').update(rom).digest('hex'),romBytes:rom.length,relay:origin,cases};
await writeFile(new URL('../logs/rom-network-benchmark.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
