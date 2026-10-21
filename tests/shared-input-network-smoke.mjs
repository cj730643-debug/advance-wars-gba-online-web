// MPL-2.0. Fault injection over real WebSockets, using production session code.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {WebSocket} from '../relay/node_modules/ws/wrapper.mjs';
import {createRelay} from '../relay/server.mjs';
import {createSharedSession} from '../src/shared-session.mjs';
let sockets=0,delayHostInputs=false,dropGuestInputs=false;
const delayed=[];
class FaultSocket extends WebSocket{
 constructor(...args){super(...args);this.side=sockets++;}
 set onmessage(fn){super.onmessage=e=>{if(this.side===0&&typeof e.data==='string'){const m=JSON.parse(e.data);if(m.type==='signal'&&m.signal?.inputMessage?.type==='keys'&&delayHostInputs){const timer=setTimeout(()=>fn(e),1150);delayed.push(timer);return;}}fn(e);};}
 get onmessage(){return super.onmessage;}
 send(data,...args){if(this.side===1&&dropGuestInputs&&typeof data==='string'&&JSON.parse(data).signal?.inputMessage?.type==='keys')return;return super.send(data,...args);}
}
globalThis.WebSocket=FaultSocket;globalThis.createImageBitmap=async()=>({width:240,height:160,close(){}});
const relay=createRelay(),origin=await relay.listen();let host,guest,code,applied=[],resets=0,hostState;
const canvas={toBlob:cb=>cb(null),getContext:()=>({drawImage(){}})};
async function until(check,timeout=4000){const end=Date.now()+timeout;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Input fault check timed out');}
try{
 host=await createSharedSession({origin,host:true,canvas,onRoom:m=>code=m.code,onState:m=>hostState=m,onKeys:k=>applied.push({keys:k,at:Date.now()})});guest=await createSharedSession({origin,host:false,code,canvas,onInputReset:()=>++resets});await until(()=>hostState?.inputReady);host.handoff();await until(()=>guest.owns);
 guest.keys(16);await until(()=>applied.at(-1)?.keys===16);const lostAt=Date.now();dropGuestInputs=true;await until(()=>applied.at(-1)?.keys===0&&resets>0);const releaseMs=applied.at(-1).at-lostAt;assert(releaseMs<600,'local safety release must not wait for the remote or relay heartbeat');dropGuestInputs=false;
 await new Promise(r=>setTimeout(r,400));assert.equal(applied.at(-1).keys,0,'expired physical press must not resurrect on reconnection');
 guest.keys(64);await until(()=>applied.at(-1)?.keys===64);guest.keys(0);await until(()=>applied.at(-1)?.keys===0);
 applied=[];delayHostInputs=true;guest.keys(128);await new Promise(r=>setTimeout(r,150));guest.keys(0);await new Promise(r=>setTimeout(r,1500));assert(!applied.some(m=>m.keys!==0),'queued direction presses older than their host freshness proof must be discarded');delayHostInputs=false;
 guest.keys(32);await until(()=>applied.at(-1)?.keys===32);guest.keys(0);await until(()=>applied.at(-1)?.keys===0);
 const result={testedAt:new Date().toISOString(),lostReleaseSafetyMs:releaseMs,expiredHoldDidNotRearm:true,queuedInputDelayMs:1150,queuedPressesDiscarded:true,freshPressWorksAfterRecovery:true,scope:'Actual shared-session source, real HTTP/WebSocket server, injected dropped input messages and delayed host receives; no browser/gameplay claim'};await writeFile(new URL('../logs/shared-input-network.json',import.meta.url),JSON.stringify(result,null,2));console.log(result);
}finally{for(const timer of delayed)clearTimeout(timer);guest?.close();host?.close();await relay.close();}
