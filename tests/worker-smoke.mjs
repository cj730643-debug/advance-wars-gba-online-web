import {Worker} from 'node:worker_threads';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRelay} from '../relay/server.mjs';
const rom=await readFile(new URL('./fixtures/gba-link-continuous.gba',import.meta.url));
const relay=process.env.RELAY_URL?null:createRelay();const origin=process.env.RELAY_URL??await relay.listen();
const workers=[];
function launch(mode,code){let resolve,reject,roomResolve;const done=new Promise((a,b)=>{resolve=a;reject=b;}),room=new Promise(a=>roomResolve=a);done.catch(()=>{});const w=new Worker(new URL('./worker-node-adapter.mjs',import.meta.url));workers.push(w);
 const result={mode,states:[],errors:[],metrics:null,video:0,audio:0,saveBytes:0,exportWhilePaused:false,complete:false};let askedExport=false;
 const timer=setTimeout(()=>reject(Error(`${mode} timeout ${JSON.stringify(result)}`)),55000);
 w.on('error',reject);w.on('message',m=>{
 if(m.type==='adapter_ready'){const b=Uint8Array.from(rom).buffer;w.postMessage({type:'start',mode,code,relay:origin,game:'diagnostic',rom:b,saves:{}},[b]);}
 if(m.type==='room')roomResolve(m.code);
 if(m.type==='state'){result.states.push(m.state);console.log(mode,'state',m.state);}
 if(m.type==='log')console.log(mode,m.text);
 if(m.type==='error'){result.errors.push(m.reason);console.log(mode,'error',m.reason);}
 if(m.type==='video')result.video++;
 if(m.type==='audio')result.audio+=m.buffer.byteLength/4;
 if(m.type==='save'){result.saveBytes=m.buffer.byteLength;if(mode==='solo'&&askedExport){result.exportWhilePaused=true;w.postMessage({type:'stop'});}}
 if(m.type==='metrics'){result.metrics=m;if(mode==='solo'&&m.frames>=60&&!askedExport){askedExport=true;w.postMessage({type:'pause',paused:true});w.postMessage({type:'export'});}else if(mode!=='solo'&&m.ready&&m.afterReady>=120&&m.stateSent>0&&m.stateReceived>0){result.complete=true;maybeStop();}}
 if(m.type==='stopped'){console.log(mode,'stopped',JSON.stringify(result));clearTimeout(timer);resolve(result);}
 });return{w,result,done,room};}
let host,join;
function maybeStop(){if(host?.result.complete&&join?.result.complete){host.w.postMessage({type:'stop'});join.w.postMessage({type:'stop'});}}
try{const solo=launch('solo');const s=await solo.done;assert.deepEqual(s.errors,[]);assert(s.video>=60&&s.audio>0&&s.exportWhilePaused&&s.saveBytes>0);
 host=launch('host');const code=await host.room;join=launch('join',code);const pair=await Promise.all([host.done,join.done]);for(const r of pair){assert.deepEqual(r.errors,[]);assert(r.complete);assert(r.saveBytes>0);assert(r.states.includes('playing_online'));}
 const report={testedAt:new Date().toISOString(),relay:origin,scope:'Actual browser Worker source in Node Worker, CC0 diagnostic ROM; no browser UI or commercial game claim',solo:s,pair};const name=process.env.RELAY_URL?'worker-public-wss':'worker-smoke';await writeFile(new URL(`../logs/${name}.json`,import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await Promise.all(workers.map(w=>w.terminate()));await relay?.close();}
