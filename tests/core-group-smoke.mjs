// MPL-2.0. Runs independent WASM instances; each replicates every logical GBA.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import createCore from '../dist/aw-core.mjs';
const wasm=await readFile(new URL('../dist/aw-core.wasm',import.meta.url));
const cases=[];
for(const players of [3,4]){
 const rom=await readFile(new URL(`./fixtures/gba-link-group-${players}.gba`,import.meta.url));
 const cores=[];let video=0,audio=0;
 const ok=(c,n,...args)=>assert.equal(c[`_aw_group_${n}`](...args),1,`${n}: ${c.UTF8ToString(c._aw_group_error())}`);
 const put=(c,b,f,...args)=>{const p=c._malloc(b.length);try{c.HEAPU8.set(b,p);ok(c,f,...args,p,b.length);}finally{c._free(p);}};
 for(let role=0;role<players;++role){
  const c=await createCore({wasmBinary:wasm,frontend:{keys:0,terminal:false,incoming:[],notice(t,e){assert(!e,t);},video(){++video;},audio(b){audio+=b.length/2;}},print:()=>{},printErr:()=>{}});
  const p=c._malloc(rom.length);c.HEAPU8.set(rom,p);assert.equal(await c.ccall('aw_load','number',['number','number'],[p,rom.length],{async:true}),1);c._free(p);
  const save=new Uint8Array(c._aw_save_size()).fill(role+17);const s=c._malloc(save.length);c.HEAPU8.set(save,s);assert.equal(c._aw_import_save(s,save.length),1);c._free(s);
  ok(c,'capture',role,players);cores.push(c);
 }
 const snapshots=cores.map(c=>c.HEAPU8.slice(c._aw_group_snapshot_ptr(),c._aw_group_snapshot_ptr()+c._aw_group_snapshot_size()));
 for(let i=0;i<players;++i){for(let j=0;j<players;++j)if(i!==j)put(cores[i],snapshots[j],'receive_snapshot',j);ok(cores[i],'install');}
 function broadcast(role,method,...args){const c=cores[role];ok(c,method,...args);const b=c.HEAPU8.slice(c._aw_group_input_ptr(),c._aw_group_input_ptr()+c._aw_group_input_size());for(let j=0;j<players;++j)if(j!==role)put(cores[j],b,'feed_input',role);return b;}
 for(let i=0;i<players;++i)broadcast(i,'seed');
 const digest=c=>{const p=c._aw_group_digest();assert(p);return Buffer.from(c.HEAPU8.slice(p,p+32)).toString('hex');};
 const consensus=()=>{const hashes=cores.map(digest);assert.equal(new Set(hashes).size,1,`state mismatch at ${cores[0]._aw_group_frame()}`);for(const c of cores)c._aw_group_commit();};
 consensus();
 for(let frame=0;frame<360;++frame){
  for(let i=0;i<players;++i)broadcast(i,'author',frame>=120&&frame<240?(1<<[8,0,2,3][i]):0);
  for(const c of cores){ok(c,'frame_ready');ok(c,'run');}
  if((frame+1)%60===0)consensus();
 }
 const probes=cores.map(c=>Array.from({length:players},(_,i)=>Array.from({length:24},(_,word)=>c._aw_group_probe(i,word))));
 console.log('group probes',players,JSON.stringify(probes[0]));
 for(const rows of probes)for(let i=0;i<players;++i){const r=rows[i];assert.equal(r[0],0x31544b4c);assert.equal(r[2],3,`ROM failed role ${i}: ${r[2].toString(16)}`);assert.equal(r[3],i);assert.equal(r[5],players);assert(r[6]>100);assert.equal(r[7],15);assert.equal(r[8],0);assert.equal(r[9],0);assert.equal(r[10],0);assert.equal(r[12],0);assert.equal(r[23],1<<i,`independent keys role ${i}`);}
 // Malformed input tests use the actual native ring, not a JS implementation.
 const c=cores[0];const p=cores[1];ok(p,'author',0);
 const valid=p.HEAPU8.slice(p._aw_group_input_ptr(),p._aw_group_input_ptr()+p._aw_group_input_size());
 put(c,valid,'feed_input',1);put(c,valid,'feed_input',1); // identical duplicate
 const rejected=(bytes,sender=1)=>{const ptr=c._malloc(bytes.length);c.HEAPU8.set(bytes,ptr);try{assert.equal(c._aw_group_feed_input(sender,ptr,bytes.length),0);}finally{c._free(ptr);}};
 const conflict=valid.slice();conflict[conflict.length-1]^=1;rejected(conflict);
 const generation=valid.slice();generation[11]^=1;rejected(generation);
 const owner=valid.slice();owner[1]=2;rejected(owner);
 const badKeys=valid.slice();badKeys[20]|=0x80;rejected(badKeys);
 const gap=valid.slice();new DataView(gap.buffer).setBigUint64(22,999n);rejected(gap);
 const future=valid.slice();new DataView(future.buffer).setBigUint64(12,10000n);rejected(future);
 rejected(valid,players);assert.equal(c._aw_group_frame(),360);
 for(let i=0;i<players;++i){cores[i]._aw_group_stop();assert.equal(cores[i].HEAPU8[cores[i]._aw_save_data()],i+17);cores[i]._aw_stop();}
 assert(video>=players*360);assert(audio>0);
 cases.push({players,frames:360,stateCheckpoints:7,videoFrames:video,audioFrames:audio,fixtureSHA256:createHash('sha256').update(rom).digest('hex'),logicalPlayers:probes[0].map(r=>({id:r[3],participants:r[5],transfers:r[6],baudMask:r[7],errors:r[8],seenKeys:r[23]})),saveIsolation:true,inputValidation:true});
}
const report={testedAt:new Date().toISOString(),wasmSHA256:createHash('sha256').update(wasm).digest('hex'),cases};
await writeFile(new URL('../logs/core-group-smoke.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
