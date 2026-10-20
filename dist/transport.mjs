// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
export const PROTOCOL='aw-relay-1';
const BACKGROUND_LIVENESS_TIMEOUT_MS=300_000;
const MAX_QUEUED_PACKETS=32768,MAX_QUEUED_BYTES=8*1024*1024;
export function relayOrigin(value){const u=new URL(value);if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('INVALID_RELAY_URL');return u.origin;}
export async function createTransport({origin,host,code,manifest,front,onState=()=>{},onRoom=()=>{},onFailure=()=>{},onRtt=()=>{}}){
 origin=relayOrigin(origin);code=(code||'').trim().toUpperCase();if(!host&&!/^[A-HJ-NP-Z2-9]{8}$/.test(code))throw Error('INVALID_CODE');
 const abort=new AbortController(),deadline=setTimeout(()=>abort.abort(),20000);let auth;
 try{const r=await fetch(origin+(host?'/v1/rooms':`/v1/rooms/${code}/join`),{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify(manifest),signal:abort.signal});auth=await r.json();if(!r.ok)throw Error(/^[A-Z_]+$/.test(auth.error)?auth.error:'RELAY_HTTP_FAILED');}
 catch(e){throw Error(e.name==='AbortError'?'RELAY_HTTP_TIMEOUT':e instanceof TypeError?'RELAY_HTTP_UNREACHABLE':e.message);}finally{clearTimeout(deadline);}
 if(auth.role!==(host?0:1)||auth.protocol!==PROTOCOL||typeof auth.token!=='string'||!/^[A-HJ-NP-Z2-9]{8}$/.test(auth.code))throw Error('INVALID_AUTH_RESPONSE');
 await onRoom({code:auth.code,role:auth.role});
 const ws=new WebSocket(origin.replace(/^http/,'ws')+'/v1/relay');ws.binaryType='arraybuffer';
 let resolve,reject,peerReady=false,closed=false,lastSeen=Date.now(),nonce=0,lastPing=0,pingAt=0;
 const ready=new Promise((a,b)=>{resolve=a;reject=b;});ready.catch(()=>{});
 const admission=setTimeout(()=>fail('AUTH_TIMEOUT'),20000);
 const heartbeat=setInterval(()=>{if(closed)return;if(Date.now()-lastSeen>BACKGROUND_LIVENESS_TIMEOUT_MS){fail('HEARTBEAT_TIMEOUT');return;}if(ws.readyState===1){lastPing=++nonce;pingAt=Date.now();ws.send(JSON.stringify({type:'ping',nonce:lastPing}));}},3000);
 function clear(){clearTimeout(admission);clearInterval(heartbeat);}
 function fail(reason){if(closed)return;closed=true;front.terminal=true;clear();reject(Error(reason));onFailure(reason);ws.close();}
 ws.onopen=()=>{if(closed)return;ws.send(JSON.stringify({code:auth.code,role:auth.role,token:auth.token}));auth.token='';onState('auth_sent');};
 ws.onmessage=e=>{if(closed)return;lastSeen=Date.now();try{
  if(typeof e.data==='string'){const m=JSON.parse(e.data);if(m.type==='waiting'){if(m.role!==auth.role)throw Error('ROLE_MISMATCH');clearTimeout(admission);onState('waiting');}else if(m.type==='ready'){if(peerReady||m.role!==auth.role)throw Error('ROLE_MISMATCH');peerReady=true;clearTimeout(admission);onState('connected');resolve(auth.role);}else if(m.type==='pong'){if(m.nonce===lastPing)onRtt(Date.now()-pingAt);}else if(m.type==='ended'||m.type==='error')fail(/^[A-Z_]+$/.test(m.reason)?m.reason:'RELAY_PROTOCOL_ERROR');else throw Error('BAD_CONTROL');
  }else{const b=new Uint8Array(e.data);if(!peerReady||b.length<=12||b.length>65548||front.incoming.length>=MAX_QUEUED_PACKETS||(front.incoming.bytes||0)+b.length>MAX_QUEUED_BYTES)throw Error('BAD_PACKET');front.incoming.push(b);}
 }catch(e){fail(e.message);}};
 ws.onerror=()=>fail('TRANSPORT_ERROR');ws.onclose=()=>fail('PEER_DISCONNECTED');
 front.send=bytes=>{if(closed||!peerReady||ws.readyState!==1)return false;if(ws.bufferedAmount+bytes.length>4*1024*1024){fail('BACKPRESSURE');return false;}try{ws.send(bytes);return true;}catch{fail('SEND_FAILED');return false;}};
 return{ready,role:auth.role,close(){if(closed)return;closed=true;clear();reject(Error('SESSION_STOPPED'));ws.close(1000,'client stopped');}};
}
