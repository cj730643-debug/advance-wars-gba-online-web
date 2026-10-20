// Adapts browser Worker events and local asset fetching only. Core/network are real.
import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
// Test-only ordered receive delay, including state and input packets.
if(workerData?.receiveDelayMs){const RealWebSocket=globalThis.WebSocket;globalThis.WebSocket=class extends RealWebSocket{
 set onmessage(callback){super.onmessage=e=>{if(typeof e.data==='string')callback(e);else setTimeout(()=>callback(e),workerData.receiveDelayMs);};}
 get onmessage(){return super.onmessage;}
};}
// Test-only fault injection on real WebSocket bytes, after native state hashing.
if(workerData?.corruptStateAt60){const RealWebSocket=globalThis.WebSocket;
 globalThis.WebSocket=class extends RealWebSocket{send(data){if(data instanceof Uint8Array && data.length===56 && data[6]===3 && new DataView(data.buffer,data.byteOffset).getBigUint64(16)===60n){data=data.slice();data[24]^=1;}return super.send(data);}};
}
const realFetch=globalThis.fetch;
if(workerData?.disconnectBeforeInput){
 const RealWebSocket=globalThis.WebSocket;let dropped=false;
 globalThis.WebSocket=class extends RealWebSocket{send(data){
  if(!dropped&&data instanceof Uint8Array&&data.length>=38&&data[6]===2&&new DataView(data.buffer,data.byteOffset).getBigUint64(28)>=150n){dropped=true;parentPort.postMessage({type:'test_drop',phase:'before_input_send'});super.close();return;}
  return super.send(data);
 }};
}
globalThis.fetch=async (url,options)=>{const u=new URL(url);if(u.protocol==='file:')return new Response(await readFile(u));return realFetch(url,options);};
globalThis.postMessage=(message,transfers)=>{
 parentPort.postMessage(message,transfers);
 // Test-only: freeze the Worker, including network callbacks, like a suspended
 // background tab. Exercise both the initial handshake and an active game.
 if(workerData?.stallMs&&message.type==='state'&&['synchronizing','playing_online'].includes(message.state)){
  const started=performance.now();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,workerData.stallMs);
  parentPort.postMessage({type:'test_stall',state:message.state,milliseconds:performance.now()-started});
 }
};
await import('../dist/emulator-worker.mjs');
parentPort.on('message',data=>globalThis.onmessage({data}));
postMessage({type:'adapter_ready'});
