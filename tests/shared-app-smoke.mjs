// MPL-2.0. Execute the real app handlers against a minimal DOM/IndexedDB shim.
// Host runs the real WASM Worker; guest does not create one. No browser/ICE claim.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Worker as Thread} from 'node:worker_threads';
import {createRelay} from '../relay/server.mjs';
import {WebSocket} from '../relay/node_modules/ws/wrapper.mjs';
import {createSharedSession} from '../src/shared-session.mjs';
import {relayOrigin} from '../src/transport.mjs';
import {BUILD_ID} from '../src/version.mjs';
globalThis.WebSocket=WebSocket;globalThis.createImageBitmap=async()=>({width:240,height:160,close(){}});
const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8'),source=(await readFile(new URL('../src/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('../src/app.mjs',import.meta.url).href));
const relay=createRelay(),origin=await relay.listen();let workerCount=0;
const allWorkers=[];
function createApp(saved=new Map()){
 const elements=new Map();const element=id=>({id,disabled:false,hidden:false,value:'',textContent:'',innerHTML:'',tagName:'DIV',dataset:{},classList:{toggle(){},add(){},remove(){},contains(){return false;}},setAttribute(){},append(){},replaceChildren(){},addEventListener(){},setPointerCapture(){},getContext(){return{putImageData(){},drawImage(){}};},toBlob(cb){cb(new Blob([Buffer.from('RIFF1234WEBPtest-frame') ]));},pause(){},play:async()=>{},getTracks:()=>[],terminate(){}});
 for(const m of html.matchAll(/id="([^"]+)"/g))elements.set(m[1],element(m[1]));
 for(const [id,value] of Object.entries({'session-mode':'shared','game-version':'aw2','player-count':'2','input-delay':'0','save-slot':'solo','relay':origin}))elements.get(id).value=value;
 const buttons=[0,2,3,4,5,6,7,8,10,11].map(k=>Object.assign(element('key'+k),{dataset:{key:String(k)}}));
 function tx(){const transaction={objectStore:()=>({get(key){const req={};queueMicrotask(()=>{req.result=saved.get(key);req.onsuccess?.();});return req;},put(value,key){saved.set(key,structuredClone(value));queueMicrotask(()=>transaction.oncomplete?.());}})};return transaction;}
 const database={transaction:tx};
 class WorkerShim{constructor(){++workerCount;this.thread=new Thread(new URL('./worker-node-adapter.mjs',import.meta.url));allWorkers.push(this);this.ready=false;this.pending=[];this.thread.on('message',m=>{if(m.type==='adapter_ready'){this.ready=true;for(const args of this.pending)this.thread.postMessage(...args);this.pending=[];}else this.onmessage?.({data:m});});this.thread.on('error',e=>this.onerror?.(e));}postMessage(...args){if(this.ready)this.thread.postMessage(...args);else this.pending.push(args);}terminate(){return this.thread.terminate();}}
 const context=vm.createContext({console,URL,Blob,File,crypto,ArrayBuffer,Uint8Array,Uint8ClampedArray,Int16Array,ImageData:class{constructor(data,w,h){Object.assign(this,{data,w,h});}},setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,performance,AbortController,AbortSignal,structuredClone,fetch,Worker:WorkerShim,createSharedSession,relayOrigin,BUILD_ID,createFrameBlender:()=>{throw Error('Unexpected blending');},schedulePaint:f=>{const id=setTimeout(f,0);return()=>clearTimeout(id);},navigator:{userAgent:'Node test'},location:{},addEventListener(){},document:{getElementById:id=>elements.get(id),querySelectorAll:()=>buttons,hidden:false,addEventListener(){},createElement:()=>element('new'),createTextNode:t=>({textContent:t})},indexedDB:{open(){const req={};queueMicrotask(()=>{req.result=database;req.onsuccess?.();});return req;}}});
 vm.runInContext(source,context,{filename:'app.mjs'});vm.runInContext('sound=false',context);
 return {elements,buttons,saved,context,run:code=>vm.runInContext(code,context)};
}
async function until(check){for(let i=0;i<700;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('App flow timeout');}
let a,b;
try{
 a=createApp();b=createApp();assert.equal(b.elements.get('join').disabled,false,'guest join is available without ROM');assert.equal(b.elements.get('host').disabled,true);
 a.context.chosen=new File([await readFile(new URL('./fixtures/gba-link-continuous.gba',import.meta.url))],'diagnostic.gba');await a.run('selectRom(chosen)');const hash=a.run('romHash');const sentinel={format:'untouched-solo',savedAt:1};a.saved.set(`aw-web-checkpoint-v1:${hash}:solo`,sentinel);
 await a.run("start('shared-host')");await until(()=>!a.elements.get('invite-box').hidden);b.elements.get('join-code').value=a.elements.get('invite-code').textContent;await b.run('startSharedGuest()');
 await until(()=>!a.elements.get('handoff').disabled);assert.equal(workerCount,1);assert(b.buttons.every(x=>x.disabled));assert(a.buttons.every(x=>!x.disabled));
 a.elements.get('handoff').onclick();await until(()=>b.buttons.every(x=>!x.disabled));assert(a.buttons.every(x=>x.disabled));assert(b.elements.get('controller-status').textContent.includes('轮到你操作'));
 b.run('setKeys(256)');assert.equal(b.run('keys'),256);a.elements.get('reclaim-control').onclick();await until(()=>a.buttons.every(x=>!x.disabled));assert(b.buttons.every(x=>x.disabled));
 await until(()=>a.saved.has(`aw-web-checkpoint-v1:${hash}:shared`));assert.deepEqual(a.saved.get(`aw-web-checkpoint-v1:${hash}:solo`),sentinel,'shared mode must preserve single-player checkpoint');
 b.elements.get('stop').onclick();await until(()=>a.run('sharedState.online[1]')===false);assert.equal(a.run('active'),true);a.elements.get('stop').onclick();await until(()=>!a.run('active'));
 await a.run("start('shared-host')");await until(()=>a.run('saveContext.resumed')===true);assert.equal(a.elements.get('save-slot').value,'shared');a.elements.get('stop').onclick();await until(()=>!a.run('active'));
 const result={testedAt:new Date().toISOString(),singleEmulatorDuringTwoPlayerSession:true,guestJoinWithoutROM:true,UIControlOwnership:true,hostReclaim:true,sharedCheckpointSeparate:true,hostCheckpointRestored:true,scope:'Real app event handlers and real WASM, DOM/IndexedDB/canvas shims. Browser video and ICE not verified'};await writeFile(new URL('../logs/shared-app-smoke.json',import.meta.url),JSON.stringify(result,null,2));console.log(result);
}finally{a?.run('shared?.close()');b?.run('shared?.close()');for(const w of allWorkers)await w.terminate();await relay.close();}
