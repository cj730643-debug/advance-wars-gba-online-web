// MPL-2.0. Measure the whole peer-relay-peer path, then agree one input window.
// Control messages use a distinct fixed-size payload inside the existing state
// channel. No speculative input, rollback, clock synchronization or ROM bytes.
const FRAME=1000/59.7275,ROUNDS=5;
export function selectInputWindow(samples){
 const peak=Math.max(...samples),low=Math.min(...samples);
 // Budget a full measured round trip, jitter and two scheduler frames.
 return Math.min(32,Math.max(8,Math.ceil((peak+Math.min(100,peak-low))/FRAME)+2));
}
export async function calibrateNetwork({transport,front,players,role,stopped,timeout=30000,now=()=>performance.now()}){
 const samples=[],sent=new Map(),replies=new Set(),votes=Array(players).fill(null),deferred=[];
 let last=now(),activeMs=0;
 function packet(type,owner,id,value=0){const b=new Uint8Array(16);b.set([65,87,80,49,type,owner,id,0]);new DataView(b.buffer).setFloat64(8,value);if(!transport.send(3,b))throw Error('GROUP_SEND_FAILED');}
 function consume(msg){
  const b=msg.payload;if(msg.kind!==3||b.length!==16)return false;
  if(b[0]!==65||b[1]!==87||b[2]!==80||b[3]!==49||b[7]||b[5]>=players||b[6]>=ROUNDS||b[4]>2)throw Error('GROUP_BAD_CALIBRATION');
  const [type,owner,id]=b.subarray(4,7),value=new DataView(b.buffer,b.byteOffset,b.byteLength).getFloat64(8);
  if(type===0){if(owner!==msg.role||value!==0)throw Error('GROUP_BAD_CALIBRATION');packet(1,owner,id);}
  else if(type===1){if(value!==0)throw Error('GROUP_BAD_CALIBRATION');if(owner===role){const key=`${msg.role}:${id}`;if(!sent.has(id)||replies.has(key))throw Error('GROUP_BAD_CALIBRATION');replies.add(key);samples.push(Math.max(0,now()-sent.get(id)));}}
  else{if(owner!==msg.role||id!==0||!Number.isInteger(value)||value<8||value>32||votes[owner]!==null)throw Error('GROUP_BAD_CALIBRATION');votes[owner]=value;}
  return true;
 }
 async function until(test){for(;;){if(front.terminal||stopped())throw Error('SESSION_STOPPED');for(const m of front.incoming.splice(0))if(!consume(m))deferred.push(m);if(!front.networkPaused&&test())return;const at=now();if(!front.networkPaused)activeMs+=at-last;last=at;if(activeMs>timeout)throw Error('GROUP_CALIBRATION_TIMEOUT');await front.incoming.wait(1000);}}
 try{
  for(let id=0;id<ROUNDS;++id){sent.set(id,now());packet(0,role,id);await until(()=>Array.from({length:players},(_,i)=>i).every(i=>i===role||replies.has(`${i}:${id}`)));}
  votes[role]=selectInputWindow(samples);packet(2,role,0,votes[role]);await until(()=>votes.every(x=>x!==null));
  return {frames:Math.max(...votes),peakRttMs:Math.round(Math.max(...samples)),consume};
 }finally{front.incoming.push(...deferred);}
}
