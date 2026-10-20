// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
import createAwCore from './aw-core.mjs';
import {createTransport,PROTOCOL} from './transport.mjs';
const PROFILE='aw-browser-profile-1;hle;skip-bios;stable;wan-calibration-10s;digital;no-cheats;no-patches';
const sleep=n=>new Promise(r=>setTimeout(r,n));
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
let running=false,stopping=false,paused=false,exportRequested=false,transport,core,mode,role='solo',fatal='',frames=0,audioFrames=0,afterReady=0;
const emit=(type,data={})=>postMessage({type,...data});
function fail(reason){if(!fatal&&!stopping){fatal=reason;front.terminal=true;emit('error',{reason});}}
const front={keys:0,terminal:false,incoming:[],audioEnabled:true,
 notice(text,error){emit('log',{text:String(text).slice(0,2000)});if(error)fail(/calibrat.*(timeout|timed out)/i.test(text)?'CORE_CALIBRATION_TIMEOUT':'CORE_SYNC_FAILURE');},
 video(bytes,w,h){++frames;postMessage({type:'video',buffer:bytes.buffer,w,h},[bytes.buffer]);},
 audio(bytes,rate){audioFrames+=bytes.length/2;if(front.audioEnabled)postMessage({type:'audio',buffer:bytes.buffer,rate},[bytes.buffer]);}};
function battery(){if(!core)return;const n=core._aw_save_size(),p=core._aw_save_data();if(n>0&&n<=1024*1024&&p){const bytes=core.HEAPU8.slice(p,p+n);postMessage({type:'save',role,buffer:bytes.buffer},[bytes.buffer]);}}
function importBattery(saves){const b=saves?.[role];if(!b)return;const bytes=new Uint8Array(b);const p=core._malloc(bytes.length);try{core.HEAPU8.set(bytes,p);if(!core._aw_import_save(p,bytes.length))throw Error('SAVE_SIZE_MISMATCH');}finally{core._free(p);}}
function metrics(){emit('metrics',{frames,audioFrames,afterReady,ready:!!core?!!core._aw_ready():false,stateSent:core?core._aw_state_sent():0,stateReceived:core?core._aw_state_received():0});}
async function boot(msg){if(running)return;running=true;mode=msg.mode;try{
 emit('state',{state:'loading'});const rom=new Uint8Array(msg.rom);if(rom.length<192||rom.length>32*1024*1024||rom[0xb2]!==0x96)throw Error('INVALID_ROM');
 const response=await fetch(new URL('./aw-core.wasm',import.meta.url));if(!response.ok)throw Error('CORE_DOWNLOAD_FAILED');const wasm=new Uint8Array(await response.arrayBuffer());
 const [romHash,coreHash,configHash]=await Promise.all([sha(rom),sha(wasm),sha(new TextEncoder().encode(PROFILE))]);
 if(stopping)return;
 core=await createAwCore({wasmBinary:wasm,frontend:front,print:()=>{},printErr:text=>emit('log',{text:String(text).slice(0,2000)}),onAbort:()=>fail('CORE_ABORT')});
 const p=core._malloc(rom.length);try{core.HEAPU8.set(rom,p);if(!await core.ccall('aw_load','number',['number','number'],[p,rom.length],{async:true}))throw Error('CORE_LOAD_FAILED');}finally{core._free(p);}
 if(stopping)return;
 if(mode==='solo'){importBattery(msg.saves);emit('state',{state:'playing_solo'});}else{
  transport=await createTransport({origin:msg.relay,host:mode==='host',code:msg.code,manifest:{game:msg.game,protocol:PROTOCOL,coreProtocol:'mgba-gba-link-replicated-v2',rom:romHash,core:coreHash,config:configHash},front,
   onRoom:async info=>{role=info.role===0?'p0':'p1';importBattery(msg.saves);emit('room',info);},onState:state=>emit('state',{state}),onFailure:fail,onRtt:ms=>emit('rtt',{ms})});
  await transport.ready;if(stopping)return;emit('state',{state:'synchronizing'});if(!await core.ccall('aw_link','number',['number'],[transport.role],{async:true}))throw Error('CORE_LINK_FAILED');
 }
 let next=performance.now(),lastMetrics=next,lastSave=next,announced=false;
 while(!stopping&&!front.terminal){
  if(paused&&mode==='solo'){if(exportRequested){battery();exportRequested=false;}await sleep(50);next=performance.now();continue;}
  const ok=await core.ccall('aw_run','number',[],[],{async:true});if(!ok)break;
  if(core._aw_ready()){++afterReady;if(!announced){announced=true;emit('state',{state:'playing_online'});}}
  const now=performance.now();if(now-lastMetrics>=1000){metrics();lastMetrics=now;}
  if(mode==='solo'&&(exportRequested||now-lastSave>=10000)){battery();exportRequested=false;lastSave=now;}
  next+=1000/59.7275;if(next<now-100)next=now;await sleep(Math.max(0,next-now));
 }
 if(!stopping&&!fatal)fail('CORE_SESSION_ENDED');
 }catch(e){if(!stopping)fail(e.message||'UNKNOWN_ERROR');}
 finally{front.keys=0;if(core){await core.ccall('aw_stop',null,[],[],{async:true});battery();metrics();}transport?.close();emit('stopped',{reason:fatal||'SESSION_STOPPED'});}
}
globalThis.onmessage=({data:m})=>{switch(m.type){case'start':void boot(m);break;case'keys':front.keys=m.keys&0xffff;break;case'audio':front.audioEnabled=!!m.enabled;break;case'pause':paused=!!m.paused;front.keys=0;break;case'export':exportRequested=true;break;case'stop':stopping=true;front.terminal=true;front.keys=0;transport?.close();break;}};
