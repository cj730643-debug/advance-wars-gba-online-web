// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
import createAwCore from './aw-core.mjs';
import {BUILD_ID,SOLO_STATE_FORMAT} from './version.mjs';
import {attachPacketWait} from './packet-wait.mjs';
import {createGroupTransport,PROTOCOL as GROUP_PROTOCOL} from './group-transport.mjs';
import {runGroupSession} from './group-session.mjs';
import {createVideoMailbox} from './video-mailbox.mjs';
const PROFILE='aw-browser-profile-2;hle;skip-bios;group-lockstep-2to4;delay8;digital;no-cheats;no-patches';
const sleep=n=>new Promise(r=>setTimeout(r,n));
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
let running=false,stopping=false,paused=false,exportRequested=false,checkpointRequested=false,soloPlayable=false,loadedRomHash='',transport,core,mode,role='solo',fatal='',frames=0,audioFrames=0,afterReady=0,groupMetrics=null;
const emit=(type,data={})=>postMessage({type,...data});
const videoMailbox=createVideoMailbox(frame=>postMessage({type:'video',...frame},[frame.buffer]));
function createIncomingQueue(){
 const queue=[];queue.bytes=0;
 const size=item=>item?.byteLength??item?.bytes??item?.payload?.byteLength??0;
 const push=queue.push.bind(queue),shift=queue.shift.bind(queue),splice=queue.splice.bind(queue);
 queue.push=(...items)=>{for(const item of items)queue.bytes+=size(item);const n=push(...items);queue.wake?.();return n;};
 queue.shift=()=>{const item=shift();if(item)queue.bytes=Math.max(0,queue.bytes-size(item));return item;};
 queue.splice=function(start,deleteCount,...items){
  const args=arguments.length===1?[start]:[start,deleteCount,...items];
  const added=arguments.length>=3?items:[];
  const removed=splice(...args);
  for(const item of removed)queue.bytes=Math.max(0,queue.bytes-size(item));
  for(const item of added)queue.bytes+=size(item);
  return removed;
 };
 return attachPacketWait(queue);
}
function fail(reason){if(!fatal&&!stopping){fatal=reason;front.terminal=true;emit('error',{reason});}}
let pageHidden=false,inputDeadline=0;
const front={keys:0,terminal:false,incoming:createIncomingQueue(),audioEnabled:true,
 notice(text,error){const detail=String(text).slice(0,2000);emit('log',{text:detail});if(!error)return;if(mode==='solo'){emit('log',{text:`single-player core diagnostic (non-fatal): ${detail}`});return;}fail(/calibrat.*(timeout|timed out)/i.test(detail)?'CORE_CALIBRATION_TIMEOUT':'CORE_SYNC_FAILURE');},
 video(bytes,w,h){++frames;if(pageHidden&&frames%60!==0)return;videoMailbox.push({buffer:bytes.buffer,w,h});},
 audio(bytes,rate){audioFrames+=bytes.length/2;if(front.audioEnabled)postMessage({type:'audio',buffer:bytes.buffer,rate},[bytes.buffer]);}};
function battery(){if(!core)return;const n=core._aw_save_size(),p=core._aw_save_data();if(n>0&&n<=1024*1024&&p){const bytes=core.HEAPU8.slice(p,p+n);postMessage({type:'save',role,buffer:bytes.buffer},[bytes.buffer]);}}
function importBattery(saves){const b=saves?.[role];if(!b)return;const bytes=new Uint8Array(b);const p=core._malloc(bytes.length);try{core.HEAPU8.set(bytes,p);if(!core._aw_import_save(p,bytes.length))throw Error('SAVE_SIZE_MISMATCH');}finally{core._free(p);}}
function checkpoint(){
 if(mode!=='solo'||!soloPlayable||fatal||!core?._aw_state_capture)return;
 const n=core._aw_state_capture(),p=core._aw_state_data();if(!n||!p||n>4*1024*1024){emit('warning',{reason:'SNAPSHOT_SAVE_FAILED'});return;}
 const buffer=core.HEAPU8.slice(p,p+n).buffer,saveSize=core._aw_save_size(),savePtr=core._aw_save_data();
 const save=saveSize&&savePtr?core.HEAPU8.slice(savePtr,savePtr+saveSize).buffer:null;
 postMessage({type:'checkpoint',format:SOLO_STATE_FORMAT,romHash:loadedRomHash,buffer,save,frames,savedAt:Date.now()},save?[buffer,save]:[buffer]);
}
function restoreCheckpoint(saved){
 if(!saved)return false;
 if(saved.format!==SOLO_STATE_FORMAT||saved.romHash!==loadedRomHash){emit('warning',{reason:'SNAPSHOT_INCOMPATIBLE'});return false;}
 if(!core._aw_state_load)throw Error('SNAPSHOT_CORE_UNAVAILABLE');
 const b=new Uint8Array(saved.buffer);if(!b.length||b.length>4*1024*1024)throw Error('SNAPSHOT_LOAD_FAILED');
 const p=core._malloc(b.length);try{core.HEAPU8.set(b,p);if(!core._aw_state_load(p,b.length))throw Error('SNAPSHOT_LOAD_FAILED');}finally{core._free(p);}
 if(saved.save)importBattery({solo:saved.save});
 frames=Number.isSafeInteger(saved.frames)&&saved.frames>=0?saved.frames:0;
 emit('resumed',{frames,savedAt:saved.savedAt});return true;
}
function metrics(extra={}){if(extra.players)groupMetrics=extra;emit('metrics',{frames,audioFrames,videoCoalesced:videoMailbox.coalesced,afterReady,ready:!!core?!!core._aw_ready():false,stateSent:core?core._aw_state_sent():0,stateReceived:core?core._aw_state_received():0,...groupMetrics,...extra});}
async function boot(msg){if(running)return;running=true;mode=msg.mode;try{
 if(msg.videoBackpressure)videoMailbox.enable();
 emit('state',{state:'loading'});const rom=new Uint8Array(msg.rom);if(rom.length<192||rom.length>32*1024*1024||rom[0xb2]!==0x96)throw Error('INVALID_ROM');
 const response=await fetch(new URL('./aw-core.wasm',import.meta.url),{cache:'no-store'});if(!response.ok)throw Error('CORE_DOWNLOAD_FAILED');const wasm=new Uint8Array(await response.arrayBuffer());
 const [romHash,coreHash,configHash]=await Promise.all([sha(rom),sha(wasm),sha(new TextEncoder().encode(PROFILE))]);
 loadedRomHash=romHash;
 if(stopping)return;
 core=await createAwCore({wasmBinary:wasm,frontend:front,print:()=>{},printErr:text=>emit('log',{text:String(text).slice(0,2000)}),onAbort:()=>fail('CORE_ABORT')});
 const p=core._malloc(rom.length);try{core.HEAPU8.set(rom,p);if(!await core.ccall('aw_load','number',['number','number'],[p,rom.length],{async:true}))throw Error('CORE_LOAD_FAILED');}finally{core._free(p);}
 if(stopping)return;
 emit('build',{version:BUILD_ID,coreSHA256:coreHash,configSHA256:configHash,players:mode==='solo'?1:(msg.players??2),transport:mode==='solo'?'solo':GROUP_PROTOCOL});
 if(mode!=='solo'){
  const inputDelay=core._aw_group_set_delay?(msg.inputDelay??0):8;if(![0,4,8,16,32].includes(inputDelay))throw Error('GROUP_INVALID_DELAY');
  msg.players??=2;
  if(![2,3,4].includes(msg.players))throw Error('GROUP_INVALID_ROLE');
  transport=await createGroupTransport({origin:msg.relay,host:mode==='host',code:msg.code,manifest:{game:msg.game,players:msg.players,protocol:GROUP_PROTOCOL,coreProtocol:'mgba-gba-link-group-1',rom:romHash,core:coreHash,config:await sha(new TextEncoder().encode(PROFILE+';group-v5-calibrated;delay='+inputDelay+';players='+msg.players))},front,onRoom:async info=>{role=`p${info.role}`;importBattery(msg.saves);emit('room',{...info,players:msg.players});},onRoster:info=>emit('roster',info),onState:state=>emit('state',{state}),onFailure:fail,onRtt:ms=>emit('rtt',{ms})});
  await transport.ready;if(stopping)return;emit('state',{state:'synchronizing'});
  let lastOnlineSave=-5000;
  await runGroupSession({core,transport,front,players:msg.players,role:transport.role,emit,metrics,stopped:()=>stopping,isBackground:()=>pageHidden,inputDelay,onVerified:()=>{const now=performance.now();if(now-lastOnlineSave>=5000){battery();lastOnlineSave=now;}}});return;
 }
 importBattery(msg.saves);restoreCheckpoint(msg.resume);soloPlayable=true;emit('state',{state:'playing_solo'});
 let next=performance.now(),lastMetrics=next,lastSave=next,lastCheckpoint=0,announced=false,windowFrame=frames,runMs=0,snapshotMs=0;
 while(!stopping&&!front.terminal){
  if(inputDeadline&&performance.now()>=inputDeadline){inputDeadline=0;front.keys=0;emit('input-released',{reason:'LEASE_EXPIRED'});}
  if(paused&&mode==='solo'){if(exportRequested){battery();exportRequested=false;}if(checkpointRequested||performance.now()-lastCheckpoint>=2000){checkpoint();checkpointRequested=false;lastCheckpoint=performance.now();}await sleep(50);next=performance.now();continue;}
  const runStart=performance.now();const ok=await core.ccall('aw_run','number',[],[],{async:true});runMs+=performance.now()-runStart;if(!ok)break;
  if(core._aw_ready()){++afterReady;if(!announced){announced=true;emit('state',{state:'playing_online'});}}
  const now=performance.now();if(now-lastMetrics>=1000){const n=frames-windowFrame;metrics({frameRate:Math.round(n*10000/(now-lastMetrics))/10,coreMsPerFrame:n?Math.round(runMs*100/n)/100:0,inputWaitMsPerFrame:0,checkpointMs:Math.round(snapshotMs),background:pageHidden});lastMetrics=now;windowFrame=frames;runMs=snapshotMs=0;}
  if(mode==='solo'&&(exportRequested||now-lastSave>=10000)){battery();exportRequested=false;lastSave=now;}
  if(checkpointRequested||now-lastCheckpoint>=2000){const t=performance.now();checkpoint();snapshotMs+=performance.now()-t;checkpointRequested=false;lastCheckpoint=now;}
  next+=1000/59.7275;const pacedNow=performance.now();if(next<pacedNow-100)next=pacedNow;await sleep(Math.max(0,next-pacedNow));
 }
 if(!stopping&&!fatal)fail('CORE_SESSION_ENDED');
 }catch(e){if(!stopping)fail(e.message||'UNKNOWN_ERROR');}
 finally{front.keys=0;if(core){if(soloPlayable&&!fatal)checkpoint();await core.ccall('aw_stop',null,[],[],{async:true});if(mode!=='solo'||soloPlayable)battery();metrics();}transport?.close();emit('stopped',{reason:fatal||'SESSION_STOPPED'});}
}
globalThis.onmessage=({data:m})=>{switch(m.type){case'start':void boot(m);break;case'reconnect':transport?.retry?.();break;case'video-ack':videoMailbox.acknowledge();break;case'keys':front.keys=m.keys&0xffff;inputDeadline=Number.isFinite(m.leaseMs)&&m.leaseMs>0?performance.now()+Math.min(500,m.leaseMs):0;break;case'audio':front.audioEnabled=!!m.enabled;break;case'pause':paused=!!m.paused;front.keys=0;checkpointRequested=true;break;case'visibility':pageHidden=!!m.hidden;checkpointRequested=pageHidden;break;case'checkpoint':checkpointRequested=true;break;case'export':exportRequested=true;break;case'stop':stopping=true;front.terminal=true;front.keys=0;front.incoming.wake?.();transport?.close();break;}};
