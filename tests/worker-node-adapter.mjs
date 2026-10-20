// Adapts browser Worker events and local asset fetching only. Core/network are real.
import {parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
const realFetch=globalThis.fetch;
globalThis.fetch=async (url,options)=>{const u=new URL(url);if(u.protocol==='file:')return new Response(await readFile(u));return realFetch(url,options);};
globalThis.postMessage=(message,transfers)=>parentPort.postMessage(message,transfers);
await import('../dist/emulator-worker.mjs');
parentPort.on('message',data=>globalThis.onmessage({data}));
postMessage({type:'adapter_ready'});
