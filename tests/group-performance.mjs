// Real-core CPU benchmark: identical deterministic input stream, no network.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const {default:createCore}=await import(process.env.CORE_MODULE||'../dist/aw-core.mjs');
const wasm=await readFile(process.env.WASM_PATH||new URL('../dist/aw-core.wasm',import.meta.url)),cases=[];
for(const players of (process.env.PLAYERS||'2,4').split(',').map(Number)){
 const rom=await readFile(process.env.ROM_PATH||new URL(players===2?'./fixtures/gba-link-continuous.gba':'./fixtures/gba-link-group-4.gba',import.meta.url)),cores=[];
 for(let role=0;role<players;role++){
  const c=await createCore({wasmBinary:wasm,frontend:{keys:0,terminal:false,incoming:[],notice(t,e){assert(!e,t);},video(){},audio(){}},print:()=>{},printErr:()=>{}});
  const p=c._malloc(rom.length);c.HEAPU8.set(rom,p);assert.equal(await c.ccall('aw_load','number',['number','number'],[p,rom.length],{async:true}),1);c._free(p);assert.equal(c._aw_group_capture(role,players),1);cores.push(c);
 }
 const c=cores[0],check=(name,...a)=>assert.equal(c['_aw_group_'+name](...a),1,c.UTF8ToString(c._aw_group_error()));
 for(let role=1;role<players;role++){const other=cores[role],b=other.HEAPU8.slice(other._aw_group_snapshot_ptr(),other._aw_group_snapshot_ptr()+other._aw_group_snapshot_size()),p=c._malloc(b.length);c.HEAPU8.set(b,p);check('receive_snapshot',role,p,b.length);c._free(p);}
 check('install');
 function broadcast(){const b=c.HEAPU8.slice(c._aw_group_input_ptr(),c._aw_group_input_ptr()+c._aw_group_input_size()),p=c._malloc(b.length);for(let role=1;role<players;role++){b[1]=role;c.HEAPU8.set(b,p);check('feed_input',role,p,b.length);}c._free(p);}
 check('seed');broadcast();let runMs=0,hashMs=0;const count=Number(process.env.FRAMES||360),start=performance.now();
 for(let frame=0;frame<count;frame++){check('author',process.env.ROM_PATH&&((frame>=120&&frame<132)||(frame>=480&&frame<492))?1<<3:0);broadcast();check('frame_ready');let t=performance.now();check('run');runMs+=performance.now()-t;if((frame+1)%60===0){t=performance.now();assert(c._aw_group_digest());c._aw_group_commit();hashMs+=performance.now()-t;}}
 const elapsedMs=performance.now()-start;
 cases.push({players,frames:count,elapsedMs,runMs,hashMs,runMsPerFrame:runMs/count,coreCapacityFps:count*1000/runMs});
 c._aw_group_stop();for(const core of cores)core._aw_stop();
}
const report={testedAt:new Date().toISOString(),scope:process.env.ROM_PATH?'User-supplied ROM, fixed-frame Start input, real WASM replication; network-free CPU capacity, not browser/network FPS':'One real WASM client replicating 2/4 diagnostic GBAs; network-free CPU capacity, not browser/network FPS',wasmSHA256:createHash('sha256').update(wasm).digest('hex'),cases};
await writeFile(new URL(`../logs/group-performance-${process.env.PERF_LABEL||'current'}.json`,import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
