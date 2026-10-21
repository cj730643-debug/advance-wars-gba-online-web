// MPL-2.0. Real HTTP/WSS shared transport + exactly one real WASM Worker.
// Canvas encoding/decoding are shims here; browser video/ICE is not covered.
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readFile,writeFile} from 'node:fs/promises';
import {WebSocket} from '../relay/node_modules/ws/wrapper.mjs';
import {createRelay} from '../relay/server.mjs';
import {createSharedSession} from '../src/shared-session.mjs';
if(!process.env.SHARED_ORIGIN)globalThis.WebSocket=WebSocket;
let decoded=0;globalThis.createImageBitmap=async()=>({width:240,height:160,close(){}});
const hostCanvas={toBlob:cb=>cb(new Blob([Buffer.from('RIFF1234WEBPtest-picture')]))},guestCanvas={getContext:()=>({drawImage(){++decoded;}})};
const relay=process.env.SHARED_ORIGIN?null:createRelay(),origin=process.env.SHARED_ORIGIN||await relay.listen();
let host,guest,hostState,guestState,hostWorker,workerCount=0,frames=0,checkpoint=false,roomCode,observedKeys=[],status=[],metrics;
const wait=async check=>{for(let i=0;i<600;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Shared flow timed out');};
try{
 const rom=Uint8Array.from(await readFile(new URL('./fixtures/gba-link-continuous.gba',import.meta.url))).buffer;
 hostWorker=new Worker(new URL('./worker-node-adapter.mjs',import.meta.url));++workerCount;
 hostWorker.on('message',m=>{if(m.type==='adapter_ready')hostWorker.postMessage({type:'start',mode:'solo',rom,saves:{},videoBackpressure:true},[rom]);if(m.type==='video'){++frames;hostWorker.postMessage({type:'video-ack'});}if(m.type==='checkpoint')checkpoint=true;if(m.type==='metrics')metrics=m;if(m.type==='error')throw Error(m.reason);});
 host=await createSharedSession({origin,host:true,canvas:hostCanvas,onRoom:m=>roomCode=m.code,onState:m=>hostState=m,onKeys:keys=>{observedKeys.push(keys);hostWorker.postMessage({type:'keys',keys});},onStatus:s=>status.push(s),onFailure:r=>status.push('failure:'+r)});
 // The guest never supplies a ROM and never starts a Worker.
 guest=await createSharedSession({origin,host:false,code:roomCode,canvas:guestCanvas,onState:m=>guestState=m,onStatus:s=>status.push(s),onFailure:r=>status.push('failure:'+r)});
 await wait(()=>decoded>=2&&frames>=5);assert.equal(workerCount,1);assert(host.owns);assert(!guest.owns);
 guest.keys(256);await new Promise(r=>setTimeout(r,80));assert(!observedKeys.includes(256),'spectator must not control host');
 host.handoff();await wait(()=>guest.owns&&!host.owns);guest.keys(256);await wait(()=>observedKeys.includes(256));guest.keys(0);await wait(()=>observedKeys.at(-1)===0);
 guest.handoff();await wait(()=>host.owns&&!guest.owns);host.handoff();await wait(()=>guest.owns);guest.keys(16);await wait(()=>observedKeys.includes(16));guest.close();await wait(()=>host.owns&&!hostState.online[1]&&observedKeys.at(-1)===0);
 const before=frames;await new Promise(r=>setTimeout(r,1200));assert(frames>before+30,'host simulation continues while guest is offline');
 guest=await createSharedSession({origin,host:false,code:roomCode,canvas:guestCanvas,onState:m=>guestState=m});await wait(()=>hostState.online[1]);assert(!guest.owns);assert(host.owns);await wait(()=>checkpoint&&metrics);
 const evidence={testedAt:new Date().toISOString(),origin,protocol:'aw-shared-screen-1',workerCount,guestRomRequired:false,forwardedPictures:decoded,renderedHostFrames:frames,guestKeysReachedHost:true,handoffBothWays:true,guestRejoinSameRoom:true,hostContinuesWithoutGuest:true,hostCheckpointGenerated:checkpoint,hostMeasuredFPS:metrics.frameRate,scope:'Real WASM diagnostic ROM, real HTTP/WebSocket transport, canvas/decoding shims; browser WebRTC and commercial gameplay not verified'};
 await writeFile(new URL(`../logs/shared-session-${relay?'local':'public'}.json`,import.meta.url),JSON.stringify(evidence,null,2));console.log(evidence);
}finally{guest?.close();host?.close();await hostWorker?.terminate();await relay?.close();}
