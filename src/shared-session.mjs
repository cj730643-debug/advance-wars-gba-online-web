// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
import {fetchJsonWithTimeout} from './fetch-json.mjs';
import {createRemoteInput} from './remote-input.mjs';
import {relayOrigin} from './transport.mjs';
export const SHARED_PROTOCOL='aw-shared-screen-1';
// Only the host has an emulator. The relay owns the control token. A WebRTC
// picture uses the same canvas; a bounded image relay works when ICE fails.
export async function createSharedSession({signal:abortSignal,origin,host,code,canvas,video,audioStream,onState=()=>{},onKeys=()=>{},onInputReset=()=>{},onFrame=()=>{},onStatus=()=>{},onFailure=()=>{},onRoom=()=>{},onRtt=()=>{}}){
 origin=relayOrigin(origin);code=(code||'').trim().toUpperCase();if(!host&&!/^[A-HJ-NP-Z2-9]{8}$/.test(code))throw Error('INVALID_CODE');
 const {response:res,body:auth}=await fetchJsonWithTimeout(origin+(host?'/v3/rooms':`/v3/rooms/${code}/join`),{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify({protocol:SHARED_PROTOCOL,inputVersion:2}),signal:abortSignal,timeoutMs:20000});
 if(!res.ok)throw Error(auth.error||'TRANSPORT_ERROR');if(auth.protocol!==SHARED_PROTOCOL||auth.role!==(host?0:1)||typeof auth.token!=='string'||typeof auth.resumeToken!=='string')throw Error('PROTOCOL_MISMATCH');
 let ws,closed=false,ready=false,owner=0,epoch=0,online=[false,false],keys=0,retry,admission,disconnected=0,pc,stream,ice=[],direct=false,encoding=false,decodeBusy=false,pendingFrame=null,frameCount=0,lastReport=performance.now(),lastSeen=Date.now(),pingAt=0,nonce=0,negotiating=false,inputRevision=0,inputPulse=0,inputReady=false,capabilityTimer,lastInputPulse=-Infinity;
 const remoteInput=createRemoteInput({apply:onKeys,onReset:m=>{sendInputMessage({type:'input-reset',...m});onStatus('远端输入超时，已松开按键，请对方重新按键');}});
 let resolveReady,rejectReady;const admitted=new Promise((r,j)=>{resolveReady=r;rejectReady=j;});admitted.catch(()=>{});
 const api={get owns(){return !closed&&ready&&owner===auth.role&&(host||inputReady);},get role(){return auth.role;},get epoch(){return epoch;},keys(v){const next=api.owns?v:0;if(next!==keys){keys=next;++inputRevision;}if(!host)sendInput();},releaseInput(){if(host)remoteInput.release();else api.keys(0);},handoff(){if(!inputReady){onStatus('请双方刷新网页后重新加入，以使用新版按键保护');return;}api.keys(0);send({type:'handoff',epoch});},request(){send({type:'request'});},reclaim(){send({type:'reclaim'});},close(){if(closed)return;send({type:'leave'});dispose();},ready:admitted};
 function send(m){if(!ready||ws?.readyState!==1||ws.bufferedAmount>=65548)return false;ws.send(JSON.stringify(m));return true;}
 function sendInputMessage(m){return send({type:'signal',signal:{inputMessage:m}});}
 function sendInput(){if(!inputReady)return false;return sendInputMessage({type:'keys',keys,epoch,revision:inputRevision,pulse:inputPulse});}
 function reportState(connected=ready){onState({owner,epoch,online,connected,role:auth.role,inputReady});}
 function negotiateInput(){clearTimeout(capabilityTimer);inputReady=false;send({type:'signal',signal:{inputProtocol:2}});capabilityTimer=setTimeout(()=>{if(!inputReady&&!closed)fail('CONFIG_MISMATCH');},10000);}
 function inputMessage(m){if(!inputReady||!m||m.epoch!==epoch)return;
  if(m.type==='keys'&&host&&owner===1){remoteInput.receive(m);pulseInput();}
  else if(m.type==='input-pulse'&&!host&&Number.isSafeInteger(m.id)&&m.id>0){inputPulse=m.id;if(api.owns)sendInput();}
  else if(m.type==='input-reset'&&!host&&Number.isSafeInteger(m.revision)&&m.revision>=inputRevision){keys=0;++inputRevision;sendInput();onInputReset();}
 }


 function pulseInput(){if(host&&owner===1&&online[1]&&inputReady&&performance.now()-lastInputPulse>=200){lastInputPulse=performance.now();sendInputMessage({type:'input-pulse',...remoteInput.pulse()});}}
 function setDirect(value){if(direct===value)return;direct=value;if(video&&!value)video.hidden=true;if(!host)send({type:'media',direct:value});onStatus(value?'视频直连 · 目标 60 FPS':'中继画面 · 最高 20 FPS，游戏独立运行');}
 function resetPeer(){pc?.close();pc=null;stream?.getTracks().forEach(t=>t.stop());stream=null;ice=[];negotiating=false;setDirect(false);if(video){video.pause();video.srcObject=null;video.hidden=true;}}
 function makePeer(){
  if(pc||closed||!globalThis.RTCPeerConnection)return pc;
  pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]});const current=pc;
  current.onicecandidate=e=>{if(e.candidate)send({type:'signal',signal:{candidate:e.candidate.toJSON()}});};
  current.onconnectionstatechange=()=>{if(pc!==current)return;if(['failed','disconnected','closed'].includes(current.connectionState))setDirect(false);};
  if(!host){current.ontrack=e=>{if(pc!==current||!video)return;video.srcObject=e.streams[0];video.onplaying=()=>{if(pc===current){video.hidden=false;setDirect(true);onFrame();}};video.play().catch(()=>onStatus('点击「声音 开」以播放共享画面'));};}
  return current;
 }
 async function offer(){if(!host||negotiating||pc||!online[1])return;negotiating=true;try{const current=makePeer();if(!current||!canvas.captureStream)return;stream=canvas.captureStream(60);for(const t of stream.getTracks())current.addTrack(t,stream);if(audioStream)for(const t of audioStream.getAudioTracks())current.addTrack(t,stream);await current.setLocalDescription(await current.createOffer());if(pc===current)send({type:'signal',signal:{description:current.localDescription.toJSON()}});}catch{onStatus('视频直连未建立，使用中继画面');}finally{negotiating=false;}}
 async function signal(m){try{const current=makePeer();if(!current)return;if(m.description){if((host&&m.description.type!=='answer')||(!host&&m.description.type!=='offer'))return;await current.setRemoteDescription(m.description);for(const c of ice)await current.addIceCandidate(c);ice=[];if(!host){await current.setLocalDescription(await current.createAnswer());send({type:'signal',signal:{description:current.localDescription.toJSON()}});}}else if(m.candidate){if(current.remoteDescription)await current.addIceCandidate(m.candidate);else if(ice.length<64)ice.push(m.candidate);}}catch{setDirect(false);}}
 async function decode(){if(decodeBusy)return;decodeBusy=true;try{while(pendingFrame&&!closed){const bytes=pendingFrame;pendingFrame=null;if(direct)continue;const bitmap=await createImageBitmap(new Blob([bytes]));try{if(!closed&&!direct&&bitmap.width===240&&bitmap.height===160){canvas.getContext('2d',{alpha:false}).drawImage(bitmap,0,0);++frameCount;onFrame();}}finally{bitmap.close();}}}catch{onStatus('画面解码失败，正在等待下一帧');}finally{decodeBusy=false;}}
 function dispose(){closed=true;ready=false;clearInterval(ticker);clearTimeout(retry);clearTimeout(admission);clearTimeout(capabilityTimer);resetPeer();remoteInput.reset(0);ws?.close();rejectReady(Error('SESSION_STOPPED'));onKeys(0);}
 function fail(reason){if(closed)return;rejectReady(Error(reason));dispose();onFailure(reason);}
 function connect(resume=false){
  if(closed)return;lastSeen=Date.now();const socket=ws=new WebSocket(origin.replace(/^http/,'ws')+'/v1/relay');socket.binaryType='arraybuffer';
  admission=setTimeout(()=>socket.close(),15000);
  socket.onopen=()=>socket.send(JSON.stringify({code:auth.code,role:auth.role,token:resume?auth.resumeToken:auth.token,resume}));
  socket.onmessage=({data})=>{if(closed||ws!==socket)return;lastSeen=Date.now();if(typeof data!=='string'){if(!host){pendingFrame=data;void decode();}return;}
   try{const m=JSON.parse(data);if(m.type==='shared-ready'){ready=true;disconnected=0;clearTimeout(admission);resolveReady();onRoom({code:auth.code,role:auth.role});}
   else if(m.type==='shared-state'){const oldOnline=online;owner=m.owner;epoch=m.epoch;online=m.online;keys=0;inputRevision=0;inputPulse=0;remoteInput.reset(epoch);if(!online[1-auth.role]){inputReady=false;clearTimeout(capabilityTimer);resetPeer();}else if(!oldOnline[1-auth.role]){negotiateInput();if(host)void offer();}reportState(true);}
   else if(m.type==='signal'){
    if(m.signal?.inputProtocol===2){if(!inputReady){inputReady=true;clearTimeout(capabilityTimer);reportState();}}
    else if(m.signal?.inputMessage)inputMessage(m.signal.inputMessage);
    else void signal(m.signal);
   }
   else if(m.type==='media'&&host)setDirect(m.direct);
   else if(m.type==='request')onStatus('对方请求操作，请点击「交接控制权」');
   else if(m.type==='pong'&&m.nonce===nonce)onRtt(Date.now()-pingAt);
   else if(['ended','error'].includes(m.type))fail(m.reason||'TRANSPORT_ERROR');
   }catch{fail('PROTOCOL_MISMATCH');}
  };
  socket.onerror=()=>socket.close();socket.onclose=()=>{if(closed||ws!==socket)return;clearTimeout(admission);ready=false;keys=0;inputRevision=0;inputPulse=0;remoteInput.reset(0);onInputReset();resetPeer();online=[false,false];inputReady=false;clearTimeout(capabilityTimer);owner=0;reportState(false);disconnected||=Date.now();if(Date.now()-disconnected>110000){fail('RECONNECT_TIMEOUT');return;}onStatus('同屏连接中断，正在重连；房主游戏继续运行');retry=setTimeout(()=>connect(true),1500);};
 }
 let tick=0;const ticker=setInterval(()=>{if(!ready)return;if(Date.now()-lastSeen>15000){ws.close();return;}remoteInput.tick();pulseInput();if(++tick%30===0){pingAt=Date.now();send({type:'ping',nonce:++nonce});}if(!host&&api.owns)sendInput();
  if(host&&online[1]&&!direct&&!encoding&&ws.bufferedAmount<65548){encoding=true;canvas.toBlob(blob=>{encoding=false;if(!closed&&ready&&!direct&&blob&&blob.size<=65548&&ws.bufferedAmount<65548)ws.send(blob);},'image/webp',.8);}
  if(!host&&performance.now()-lastReport>2000){const dt=performance.now()-lastReport;onStatus(direct?'视频直连 · 目标 60 FPS':`中继画面 ${(frameCount*1000/dt).toFixed(1)} FPS · 房主游戏独立运行`);lastReport=performance.now();frameCount=0;}
 },50);
 if(abortSignal?.aborted){dispose();throw Error('SESSION_STOPPED');}abortSignal?.addEventListener('abort',()=>dispose(),{once:true});onStatus('正在连接同屏房间…');connect();await admitted;return api;
}
