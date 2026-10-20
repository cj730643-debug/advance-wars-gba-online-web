// MPL-2.0. Real browser Worker source and 3/4 independent WASM clients over WS/WSS.
import {Worker} from 'node:worker_threads';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRelay} from '../relay/server.mjs';
const relay=process.env.RELAY_URL?null:createRelay(),origin=process.env.RELAY_URL??await relay.listen(),workers=[],cases=[];
try{for(const players of [4]){
 const rom=await readFile(new URL(`./fixtures/gba-link-group-${players}.gba`,import.meta.url));let host,stopSent=false;
 const group=[];
 function stopIfReady(){if(group.length===players&&group.every(c=>c.result.complete)&&!stopSent){stopSent=true;host.w.postMessage({type:'stop'});}}
 function launch(mode,code){let resolve,reject,roomResolve;const done=new Promise((a,b)=>{resolve=a;reject=b;}),room=new Promise(a=>roomResolve=a);done.catch(()=>{});const w=new Worker(new URL('./worker-node-adapter.mjs',import.meta.url),{workerData:{corruptStateAt60:group.length===3}});workers.push(w);const result={mode,role:null,states:[],errors:[],metrics:null,video:0,audio:0,saveBytes:0,complete:false};const c={w,result,done,room};group.push(c);
 const timer=setTimeout(()=>reject(Error('group timeout '+JSON.stringify(result))),70000);
 w.on('error',reject);w.on('message',m=>{
  if(m.type==='adapter_ready'){const b=Uint8Array.from(rom).buffer;w.postMessage({type:'start',mode,code,players,relay:origin,game:'diagnostic',rom:b,saves:{}},[b]);}
  if(m.type==='room'){result.role=m.role;roomResolve(m.code);}
  if(m.type==='state'){result.states.push(m.state);console.log(players,mode,result.role,m.state);if(m.state==='playing_online')w.postMessage({type:'keys',keys:1<<[8,0,2,3][result.role]});}
  if(m.type==='error'){result.errors.push(m.reason);console.log(players,'error',result.role,m.reason);}
  if(m.type==='video')++result.video;if(m.type==='audio')result.audio+=m.buffer.byteLength/4;
  if(m.type==='save'){result.saveBytes=m.buffer.byteLength;result.saveRole=m.role;}
  if(m.type==='metrics'){result.metrics=m;if(m.ready&&m.afterReady>=180&&m.stateSent>=4){result.complete=true;stopIfReady();}}
  if(m.type==='stopped'){clearTimeout(timer);console.log(players,'stopped',result.role,JSON.stringify(result.metrics));resolve(result);}
 });return c;}
 host=launch('host');const code=await host.room;for(let i=1;i<players;++i){const peer=launch('join',code);await peer.room;}
 const results=await Promise.all(group.map(c=>c.done));for(const r of results){assert(r.errors.some(e=>['GROUP_STATE_MISMATCH','PEER_DISCONNECTED'].includes(e)),JSON.stringify(r));assert(r.metrics.afterReady<=120);assert.equal(r.metrics.verifiedFrame??0,0);assert(r.states.includes('playing_online'));assert(r.video>=50&&r.audio>0,`expected sustained A/V output, got video=${r.video}, audio=${r.audio}`);assert.equal(r.saveBytes,131072);assert.equal(r.saveRole,`p${r.role}`);}
 assert.deepEqual(results.map(r=>r.role),Array.from({length:players},(_,i)=>i));cases.push({players,results,safeStateMismatch:true});for(const c of group)await c.w.terminate();
 }}finally{await Promise.all(workers.map(w=>w.terminate()));await relay?.close();}
const report={testedAt:new Date().toISOString(),relay:origin,scope:'Real browser Worker code in Node Workers; self-authored CC0 ROM; commercial games unverified',cases};await writeFile(new URL(`../logs/${process.env.RELAY_URL?'group-failure-public-wss':'group-failure-smoke'}.json`,import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
