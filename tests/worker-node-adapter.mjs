// Adapts browser Worker events and local asset fetching only. Core/network are real.
import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
// Test-only fault injection on real WebSocket bytes, after native state hashing.
if(workerData?.corruptStateAt60){const RealWebSocket=globalThis.WebSocket;
 globalThis.WebSocket=class extends RealWebSocket{send(data){if(data instanceof Uint8Array && data.length===56 && data[6]===3 && new DataView(data.buffer,data.byteOffset).getBigUint64(16)===60n){data=data.slice();data[24]^=1;}return super.send(data);}};
}
const realFetch=globalThis.fetch;
globalThis.fetch=async (url,options)=>{const u=new URL(url);if(u.protocol==='file:')return new Response(await readFile(u));return realFetch(url,options);};
globalThis.postMessage=(message,transfers)=>parentPort.postMessage(message,transfers);
await import('../dist/emulator-worker.mjs');
parentPort.on('message',data=>globalThis.onmessage({data}));
postMessage({type:'adapter_ready'});
