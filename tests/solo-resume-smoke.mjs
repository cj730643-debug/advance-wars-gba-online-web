// Actual WASM serialization, then a completely new browser Worker instance.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import createCore from '../dist/aw-core.mjs';
const rom=await readFile(new URL('./fixtures/gba-link-continuous.gba',import.meta.url));
const wasm=await readFile(new URL('../dist/aw-core.wasm',import.meta.url));
const c=await createCore({wasmBinary:wasm,frontend:{keys:0,incoming:[],terminal:false,notice(){},video(){},audio(){}},print:()=>{},printErr:()=>{}});
let p=c._malloc(rom.length);c.HEAPU8.set(rom,p);assert.equal(await c.ccall('aw_load','number',['number','number'],[p,rom.length],{async:true}),1);c._free(p);
for(let i=0;i<120;i++)assert.equal(await c.ccall('aw_run','number',[],[],{async:true}),1);
const capture=()=>{const n=c._aw_state_capture();assert(n>0&&n<=4*1024*1024);return c.HEAPU8.slice(c._aw_state_data(),c._aw_state_data()+n);};
const original=capture();for(let i=0;i<30;i++)assert.equal(await c.ccall('aw_run','number',[],[],{async:true}),1);assert.notDeepEqual(capture(),original);
p=c._malloc(original.length);c.HEAPU8.set(original,p);assert.equal(c._aw_state_load(p,original.length),1);c._free(p);assert.deepEqual(capture(),original);c._aw_stop();
const workers=[];
async function run(resume){return new Promise((resolve,reject)=>{
 const w=new Worker(new URL('./worker-node-adapter.mjs',import.meta.url));workers.push(w);let checkpoint,resumed,errors=[],asked=false,video=0;
 const timer=setTimeout(()=>reject(Error('resume test timeout')),20000);
 w.on('error',reject);w.on('message',m=>{
  if(m.type==='adapter_ready'){const b=Uint8Array.from(rom).buffer;w.postMessage({type:'start',mode:'solo',game:'diagnostic',rom:b,saves:{},resume},[b]);}
  if(m.type==='resumed')resumed=m;
  if(m.type==='error')errors.push(m.reason);
  if(m.type==='video'){video++;if(video>=120&&!asked){asked=true;w.postMessage({type:'pause',paused:true});w.postMessage({type:'checkpoint'});}}
  if(m.type==='checkpoint'&&asked){checkpoint=m;w.postMessage({type:'stop'});}
  if(m.type==='stopped'){clearTimeout(timer);resolve({checkpoint,resumed,errors,video});}
 });
});}
try{const first=await run();assert.deepEqual(first.errors,[]);assert(first.checkpoint?.frames>=120);assert(first.checkpoint.save.byteLength>0);
 const second=await run(first.checkpoint);assert.deepEqual(second.errors,[]);assert.equal(second.resumed.frames,first.checkpoint.frames);assert(second.checkpoint.frames>=first.checkpoint.frames+120);
 const report={testedAt:new Date().toISOString(),nativeRoundTripBytes:original.length,nativeStateExact:true,firstFrame:first.checkpoint.frames,resumedFrame:second.resumed.frames,continuedFrame:second.checkpoint.frames,scope:'Real WASM + new Worker resume; browser IndexedDB reload tested separately'};
 await writeFile(new URL('../logs/solo-resume-smoke.json',import.meta.url),JSON.stringify(report,null,2));console.log(report);
}finally{await Promise.all(workers.map(w=>w.terminate()));}
