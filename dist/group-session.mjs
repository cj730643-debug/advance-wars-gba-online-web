// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
// One deterministic 2–4-player path, with packet-driven receive wakeups.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MAX_SNAPSHOT=2*1024*1024,CHUNK=16384;
const MAX_SYNC_WAIT_MS=300_000;
export async function runGroupSession({core:c,transport,front,players,role,emit,metrics,stopped,isBackground=()=>false,onVerified=()=>{},inputDelay=8}){
 let installed=false,checks=0,lastMetrics=performance.now(),windowFrame=0,runMs=0,inputWaitMs=0,checkpointMs=0,lastPerformance={},pendingCheck=null;
 const pipeline=typeof c._aw_group_stage_save==='function';
 const snapshots=Array(players).fill(null),pending=[],states=new Map();
 const check=(name,...args)=>{if(c[`_aw_group_${name}`](...args)!==1)throw Error(c.UTF8ToString(c._aw_group_error()));};
 const apply=(bytes,name,...args)=>{const p=c._malloc(bytes.length);if(!p)throw Error('GROUP_ALLOCATION_FAILED');try{c.HEAPU8.set(bytes,p);check(name,...args,p,bytes.length);}finally{c._free(p);}};
 const send=(kind,payload)=>{if(!transport.send(kind,payload))throw Error('GROUP_SEND_FAILED');};
 const input=()=>c.HEAPU8.slice(c._aw_group_input_ptr(),c._aw_group_input_ptr()+c._aw_group_input_size());
 const hash=()=>{const p=c._aw_group_digest();if(!p)throw Error('GROUP_DIGEST_FAILED');return c.HEAPU8.slice(p,p+32);};
 function drain(){
  if(front.terminal||stopped())throw Error('SESSION_STOPPED');
  for(const msg of front.incoming.splice(0)){
   const {role:sender,kind,payload:b}=msg;
   if(kind===1){
    if(installed||b.length<=8)throw Error('GROUP_INVALID_SNAPSHOT');
    const v=new DataView(b.buffer,b.byteOffset,b.byteLength),total=v.getUint32(0),offset=v.getUint32(4);
    if(!total||total>MAX_SNAPSHOT||offset+b.length-8>total)throw Error('GROUP_INVALID_SNAPSHOT');
    let s=snapshots[sender];if(!s){if(offset!==0)throw Error('GROUP_INVALID_SNAPSHOT');s=snapshots[sender]={bytes:new Uint8Array(total),offset:0,done:false};}
    if(s.done||s.bytes.length!==total||s.offset!==offset)throw Error('GROUP_INVALID_SNAPSHOT');
    s.bytes.set(b.subarray(8),offset);s.offset+=b.length-8;
    if(s.offset===total){apply(s.bytes,'receive_snapshot',sender);s.done=true;s.bytes=null;}
   }else if(kind===2){
    if(installed)apply(b,'feed_input',sender);
    else{if(pending.length>=64)throw Error('GROUP_INPUT_LIMIT');pending.push(msg);}
   }else if(kind===3){
    if(b.length!==40)throw Error('GROUP_BAD_STATE_PACKET');
    const n=new DataView(b.buffer,b.byteOffset,b.byteLength).getBigUint64(0);
    if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('GROUP_BAD_STATE_PACKET');
    const frame=Number(n),now=c._aw_group_frame();
    if(frame%60||(frame<now&&frame!==pendingCheck?.frame)||frame>now+60)throw Error('GROUP_BAD_STATE_PACKET');
    let s=states.get(frame);if(!s){s=Array(players).fill(null);states.set(frame,s);}
    if(s[sender])throw Error('GROUP_DUPLICATE_STATE');s[sender]=b.slice(8);
   }else throw Error('BAD_PACKET');
  }
 }
 async function until(test,timeout){const start=performance.now();for(;;){drain();if(test())return;if(performance.now()-start>=timeout)throw Error(installed?'GROUP_SYNC_TIMEOUT':'GROUP_HANDSHAKE_TIMEOUT');await front.incoming.wait(1000);}}
 function beginCheckpoint(){
  const frame=c._aw_group_frame(),digest=hash(),packet=new Uint8Array(40);new DataView(packet.buffer).setBigUint64(0,BigInt(frame));packet.set(digest,8);
  let hashes=states.get(frame);if(!hashes){hashes=Array(players).fill(null);states.set(frame,hashes);}hashes[role]=digest;
  if(pipeline)check('stage_save');pendingCheck={frame,digest,hashes};send(3,packet);
 }
 function finishCheckpoint(){
  if(!pendingCheck)return true;const {frame,digest,hashes}=pendingCheck;
  for(const other of hashes)if(other&&other.some((v,i)=>v!==digest[i]))throw Error('GROUP_STATE_MISMATCH');
  if(!hashes.every(Boolean))return false;
  c._aw_group_commit();onVerified();states.delete(frame);pendingCheck=null;++checks;return true;
 }
 async function consensus(){beginCheckpoint();await until(finishCheckpoint,MAX_SYNC_WAIT_MS);}

 try{
  check('capture',role,players);snapshots[role]={done:true};
  const bytes=c.HEAPU8.slice(c._aw_group_snapshot_ptr(),c._aw_group_snapshot_ptr()+c._aw_group_snapshot_size());
  for(let offset=0;offset<bytes.length;offset+=CHUNK){const data=bytes.subarray(offset,offset+CHUNK),packet=new Uint8Array(8+data.length),v=new DataView(packet.buffer);v.setUint32(0,bytes.length);v.setUint32(4,offset);packet.set(data,8);send(1,packet);if(offset%(CHUNK*8)===0)await sleep(0);}
  await until(()=>snapshots.every(s=>s?.done),MAX_SYNC_WAIT_MS);if(c._aw_group_set_delay)check('set_delay',inputDelay);check('install');installed=true;
  for(const msg of pending)apply(msg.payload,'feed_input',msg.role);pending.length=0;
  check('seed');send(2,input());if(c._aw_group_seed_next){for(let more;(more=c._aw_group_seed_next())!==0;){if(more!==1)throw Error('GROUP_SEED_FAILED');send(2,input());}}await consensus();emit('state',{state:'playing_online'});
  let next=performance.now();lastMetrics=next;windowFrame=c._aw_group_frame();
  while(!stopped()&&!front.terminal){
   check('author',front.keys);send(2,input());let t=performance.now();await until(()=>!!c._aw_group_frame_ready(),MAX_SYNC_WAIT_MS);finishCheckpoint();inputWaitMs+=performance.now()-t;t=performance.now();check('run');runMs+=performance.now()-t;
   if(c._aw_group_frame()%60===0){t=performance.now();if(pendingCheck)await until(finishCheckpoint,MAX_SYNC_WAIT_MS);beginCheckpoint();if(pipeline)finishCheckpoint();else await until(finishCheckpoint,MAX_SYNC_WAIT_MS);checkpointMs+=performance.now()-t;}
   const now=performance.now();if(now-lastMetrics>=1000){const n=c._aw_group_frame()-windowFrame;lastPerformance={frameRate:Math.round(n*10000/(now-lastMetrics))/10,coreMsPerFrame:Math.round(runMs*100/n)/100,inputWaitMsPerFrame:Math.round(inputWaitMs*100/n)/100,checkpointMs:Math.round(checkpointMs),background:isBackground()};metrics({ready:true,afterReady:c._aw_group_frame(),stateSent:checks,stateReceived:checks*(players-1),players,inputDelay,verifiedFrame:c._aw_group_verified_frame?.()??0,...lastPerformance});lastMetrics=now;windowFrame=c._aw_group_frame();runMs=inputWaitMs=checkpointMs=0;}
   next+=1000/59.7275;if(next<now-100)next=now;await sleep(Math.max(0,next-now));drain();finishCheckpoint();
  }
 }finally{c._aw_group_stop();metrics({ready:installed,afterReady:c._aw_group_frame(),stateSent:checks,stateReceived:checks*(players-1),players,inputDelay,verifiedFrame:c._aw_group_verified_frame?.()??0,...lastPerformance});}
}
