// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
export const PROTOCOL='aw-relay-group-2';
const BACKGROUND_LIVENESS_TIMEOUT_MS=300_000;
const MAX_QUEUED_PACKETS=65536,MAX_QUEUED_BYTES=16*1024*1024;
const MAX_PENDING_BYTES=4*1024*1024;
export function relayOrigin(value){const u=new URL(value);if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('INVALID_RELAY_URL');return u.origin;}
export async function createGroupTransport({origin,host,code,manifest,front,onState=()=>{},onRoom=()=>{},onFailure=()=>{},onRtt=()=>{},onRoster=()=>{}}){
 origin=relayOrigin(origin);code=(code||'').trim().toUpperCase();if(!host&&!/^[A-HJ-NP-Z2-9]{8}$/.test(code))throw Error('INVALID_CODE');
 const abort=new AbortController(),deadline=setTimeout(()=>abort.abort(),20000);let auth;
 try{const r=await fetch(origin+(host?'/v2/rooms':`/v2/rooms/${code}/join`),{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify(manifest),signal:abort.signal});auth=await r.json();if(!r.ok)throw Error(/^[A-Z_]+$/.test(auth.error)?auth.error:'RELAY_HTTP_FAILED');}
 catch(e){throw Error(e.name==='AbortError'?'RELAY_HTTP_TIMEOUT':e instanceof TypeError?'RELAY_HTTP_UNREACHABLE':e.message);}finally{clearTimeout(deadline);}
 if((!Number.isInteger(auth.role)||auth.role<0||auth.role>=manifest.players||(host&&auth.role!==0)||(!host&&auth.role===0)||auth.players!==manifest.players)||auth.protocol!==PROTOCOL||typeof auth.token!=='string'||typeof auth.resumeToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(auth.resumeToken)||!/^[A-HJ-NP-Z2-9]{8}$/.test(auth.code))throw Error('INVALID_AUTH_RESPONSE');
 await onRoom({code:auth.code,role:auth.role});
 const expected=Array(manifest.players).fill(1n),pending=new Map();
 let outgoing=1n,accepted=1n,pendingBytes=0,socket,authenticated=false,everOpened=false,peerReady=false,closed=false,resolve,reject,admission,retryTimer,graceTimer,lostAt=0,attempt=0,lastSeen=Date.now(),nonce=0,lastPing=0,pingAt=0;
 const grace=Math.min(120000,Math.max(1000,auth.resumeGraceMs||120000));
 const ready=new Promise((a,b)=>{resolve=a;reject=b;});ready.catch(()=>{});
 function clear(){clearTimeout(admission);clearTimeout(retryTimer);clearTimeout(graceTimer);clearInterval(heartbeat);}
 function fail(reason){if(closed)return;closed=true;front.terminal=true;clear();reject(Error(reason));onFailure(reason);front.incoming.wake?.();socket?.close();}
 function receipt(value){if(typeof value!=='string'||!/^\d{1,20}$/.test(value))throw Error('BAD_RECEIPT');const n=BigInt(value);if(n<accepted||n>outgoing)throw Error('BAD_RECEIPT');accepted=n;for(const [seq,bytes]of pending){if(seq>=n)break;pending.delete(seq);pendingBytes-=bytes.length;}if(n<outgoing&&!pending.has(n))throw Error('RESUME_WINDOW_EXPIRED');}
 function transmit(bytes){if(socket?.readyState!==1||!authenticated)return;if(socket.bufferedAmount+bytes.length>MAX_PENDING_BYTES)throw Error('BACKPRESSURE');socket.send(bytes);}
 function pause(state){front.networkPaused=true;onState(state);front.incoming.wake?.();}
 function reconnect(immediate=false){
  if(closed)return;authenticated=false;pause('reconnecting');clearTimeout(admission);
  if(!lostAt){lostAt=Date.now();graceTimer=setTimeout(()=>fail('RECONNECT_TIMEOUT'),grace);}
  const old=socket;socket=null;try{old?.close();}catch{}
  clearTimeout(retryTimer);retryTimer=setTimeout(connect,immediate?0:Math.min(5000,500*2**Math.min(attempt++,4)));
 }
 function ping(){if(!authenticated||socket?.readyState!==1)return;lastPing=++nonce;pingAt=Date.now();socket.send(JSON.stringify({type:'ping',nonce:lastPing,received:expected.map(String)}));}
 const heartbeat=setInterval(()=>{if(closed)return;if(Date.now()-lastSeen>BACKGROUND_LIVENESS_TIMEOUT_MS){fail('HEARTBEAT_TIMEOUT');return;}if(authenticated&&Date.now()-lastSeen>15000){reconnect();return;}try{ping();}catch{reconnect();}},3000);
 function connect(){
  if(closed)return;clearTimeout(retryTimer);clearTimeout(admission);
  let ws;try{ws=new WebSocket(origin.replace(/^http/,'ws')+'/v1/relay');}catch{reconnect();return;}
  socket=ws;ws.binaryType='arraybuffer';admission=setTimeout(()=>{if(socket===ws)reconnect();},15000);
  ws.onopen=()=>{if(closed||socket!==ws)return;const resume=everOpened;everOpened=true;ws.send(JSON.stringify({code:auth.code,role:auth.role,token:resume?auth.resumeToken:auth.token,resume,received:expected.map(String)}));if(!peerReady)onState('auth_sent');};
  ws.onmessage=e=>{if(closed||socket!==ws)return;lastSeen=Date.now();try{
   if(typeof e.data==='string'){
    const m=JSON.parse(e.data);
    if(m.type==='session'){
     if(authenticated||m.role!==auth.role||m.players!==manifest.players)throw Error('ROLE_MISMATCH');
     authenticated=true;clearTimeout(admission);receipt(m.accepted);for(const bytes of pending.values())transmit(bytes);
    }else if(m.type==='waiting'){
     if(!authenticated||m.role!==auth.role||m.players!==manifest.players||!Number.isInteger(m.connected)||m.connected<1||m.connected>manifest.players)throw Error('ROLE_MISMATCH');
     onRoster({connected:m.connected,players:m.players});if(peerReady)pause('peer_reconnecting');else{front.networkPaused=false;lostAt=0;attempt=0;clearTimeout(graceTimer);onState('waiting');}
    }else if(m.type==='ready'||m.type==='resumed'){
     if(!authenticated||m.role!==auth.role||m.players!==manifest.players)throw Error('ROLE_MISMATCH');
     const resumed=peerReady;peerReady=true;front.networkPaused=false;lostAt=0;attempt=0;clearTimeout(graceTimer);onRoster({connected:manifest.players,players:manifest.players});onState(resumed?'reconnected':'connected');front.incoming.wake?.();resolve(auth.role);ping();
    }else if(m.type==='reconnecting'){
     if(!authenticated||!peerReady||m.players!==manifest.players)throw Error('ROLE_MISMATCH');onRoster({connected:m.connected,players:m.players});pause('peer_reconnecting');
    }else if(m.type==='pong'){receipt(m.accepted);if(m.nonce===lastPing)onRtt(Date.now()-pingAt);}
    else if(m.type==='ended'||m.type==='error')fail(/^[A-Z_]+$/.test(m.reason)?m.reason:'RELAY_PROTOCOL_ERROR');
    else throw Error('BAD_CONTROL');
   }else{
    const b=new Uint8Array(e.data),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
    if(!authenticated||b.length<=16||b.length>65548||front.incoming.length>=MAX_QUEUED_PACKETS||(front.incoming.bytes||0)+b.length>MAX_QUEUED_BYTES)throw Error('BAD_PACKET');
    if(String.fromCharCode(...b.subarray(0,4))!=='AWG1'||b[4]>=manifest.players||b[4]===auth.role||b[5]!==manifest.players||![1,2,3].includes(b[6])||b[7]||v.getBigUint64(8)!==expected[b[4]])throw Error('BAD_SEQUENCE');
    ++expected[b[4]];front.incoming.push({role:b[4],kind:b[6],payload:b.subarray(16),bytes:b.length});
   }
  }catch(e){fail(e.message);}};
  ws.onerror=()=>{if(!closed&&socket===ws)reconnect();};ws.onclose=()=>{if(!closed&&socket===ws)reconnect();};
 }
 function send(kind,payload){
  if(![1,2,3].includes(kind)||payload.length===0||payload.length>65532||closed||!peerReady)return false;
  const bytes=new Uint8Array(16+payload.length);bytes.set([65,87,71,49,auth.role,manifest.players,kind,0]);new DataView(bytes.buffer).setBigUint64(8,outgoing);bytes.set(payload,16);
  if(pendingBytes+bytes.length>MAX_PENDING_BYTES){fail('BACKPRESSURE');return false;}
  pending.set(outgoing++,bytes);pendingBytes+=bytes.length;
  try{transmit(bytes);}catch(e){if(e.message==='BACKPRESSURE'){fail(e.message);return false;}reconnect();}return true;
 }
 connect();
 return{ready,send,role:auth.role,get reconnecting(){return !!front.networkPaused;},retry(){if(front.networkPaused)reconnect(true);},close(){if(closed)return;closed=true;clear();reject(Error('SESSION_STOPPED'));if(authenticated&&socket?.readyState===1)socket.send(JSON.stringify({type:'leave'}));socket?.close(1000,'client stopped');auth.token=auth.resumeToken='';pending.clear();}};
}
