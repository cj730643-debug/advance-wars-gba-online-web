// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
export const PROTOCOL='aw-relay-group-1';
const BACKGROUND_LIVENESS_TIMEOUT_MS=300_000;
const MAX_QUEUED_PACKETS=65536,MAX_QUEUED_BYTES=16*1024*1024;
export function relayOrigin(value){const u=new URL(value);if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('INVALID_RELAY_URL');return u.origin;}
export async function createGroupTransport({origin,host,code,manifest,front,onState=()=>{},onRoom=()=>{},onFailure=()=>{},onRtt=()=>{},onRoster=()=>{}}){
 origin=relayOrigin(origin);code=(code||'').trim().toUpperCase();if(!host&&!/^[A-HJ-NP-Z2-9]{8}$/.test(code))throw Error('INVALID_CODE');
 const abort=new AbortController(),deadline=setTimeout(()=>abort.abort(),20000);let auth;
 try{const r=await fetch(origin+(host?'/v2/rooms':`/v2/rooms/${code}/join`),{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify(manifest),signal:abort.signal});auth=await r.json();if(!r.ok)throw Error(/^[A-Z_]+$/.test(auth.error)?auth.error:'RELAY_HTTP_FAILED');}
 catch(e){throw Error(e.name==='AbortError'?'RELAY_HTTP_TIMEOUT':e instanceof TypeError?'RELAY_HTTP_UNREACHABLE':e.message);}finally{clearTimeout(deadline);}
 if((!Number.isInteger(auth.role)||auth.role<0||auth.role>=manifest.players||(host&&auth.role!==0)||(!host&&auth.role===0)||auth.players!==manifest.players)||auth.protocol!==PROTOCOL||typeof auth.token!=='string'||!/^[A-HJ-NP-Z2-9]{8}$/.test(auth.code))throw Error('INVALID_AUTH_RESPONSE');
 await onRoom({code:auth.code,role:auth.role});
 const ws=new WebSocket(origin.replace(/^http/,'ws')+'/v1/relay');ws.binaryType='arraybuffer';
 let outgoing=1n;const expected=Array(manifest.players).fill(1n);let resolve,reject,peerReady=false,closed=false,lastSeen=Date.now(),nonce=0,lastPing=0,pingAt=0;
 const ready=new Promise((a,b)=>{resolve=a;reject=b;});ready.catch(()=>{});
 const admission=setTimeout(()=>fail('AUTH_TIMEOUT'),20000);
 const heartbeat=setInterval(()=>{if(closed)return;if(Date.now()-lastSeen>BACKGROUND_LIVENESS_TIMEOUT_MS){fail('HEARTBEAT_TIMEOUT');return;}if(ws.readyState===1){lastPing=++nonce;pingAt=Date.now();ws.send(JSON.stringify({type:'ping',nonce:lastPing}));}},3000);
 function clear(){clearTimeout(admission);clearInterval(heartbeat);}
 function fail(reason){if(closed)return;closed=true;front.terminal=true;clear();reject(Error(reason));onFailure(reason);ws.close();}
 ws.onopen=()=>{if(closed)return;ws.send(JSON.stringify({code:auth.code,role:auth.role,token:auth.token}));auth.token='';onState('auth_sent');};
 ws.onmessage=e=>{if(closed)return;lastSeen=Date.now();try{
  if(typeof e.data==='string'){const m=JSON.parse(e.data);if(m.type==='waiting'){if(m.role!==auth.role||m.players!==manifest.players||!Number.isInteger(m.connected)||m.connected<1||m.connected>manifest.players)throw Error('ROLE_MISMATCH');clearTimeout(admission);onRoster({connected:m.connected,players:m.players});onState('waiting');}else if(m.type==='ready'){if(peerReady||m.role!==auth.role||m.players!==manifest.players)throw Error('ROLE_MISMATCH');peerReady=true;clearTimeout(admission);onState('connected');resolve(auth.role);}else if(m.type==='pong'){if(m.nonce===lastPing)onRtt(Date.now()-pingAt);}else if(m.type==='ended'||m.type==='error')fail(/^[A-Z_]+$/.test(m.reason)?m.reason:'RELAY_PROTOCOL_ERROR');else throw Error('BAD_CONTROL');
  }else{const b=new Uint8Array(e.data),v=new DataView(b.buffer,b.byteOffset,b.byteLength);if(!peerReady||b.length<=16||b.length>65548||front.incoming.length>=MAX_QUEUED_PACKETS||(front.incoming.bytes||0)+b.length>MAX_QUEUED_BYTES)throw Error('BAD_PACKET');
   if(String.fromCharCode(...b.subarray(0,4))!=='AWG1'||b[4]>=manifest.players||b[4]===auth.role||b[5]!==manifest.players||![1,2,3].includes(b[6])||b[7]||v.getBigUint64(8)!==expected[b[4]])throw Error('BAD_SEQUENCE');
   ++expected[b[4]];front.incoming.push({role:b[4],kind:b[6],payload:b.subarray(16),bytes:b.length});}
 }catch(e){fail(e.message);}};
 ws.onerror=()=>fail('TRANSPORT_ERROR');ws.onclose=()=>fail('PEER_DISCONNECTED');
 function send(kind,payload){if(![1,2,3].includes(kind)||payload.length===0||payload.length>65532||closed||!peerReady||ws.readyState!==1)return false;
 const bytes=new Uint8Array(16+payload.length);bytes.set([65,87,71,49,auth.role,manifest.players,kind,0]);new DataView(bytes.buffer).setBigUint64(8,outgoing++);bytes.set(payload,16);
 if(ws.bufferedAmount+bytes.length>4*1024*1024){fail('BACKPRESSURE');return false;}try{ws.send(bytes);return true;}catch{fail('SEND_FAILED');return false;}}

 return{ready,send,role:auth.role,close(){if(closed)return;closed=true;clear();reject(Error('SESSION_STOPPED'));ws.close(1000,'client stopped');}};
}
