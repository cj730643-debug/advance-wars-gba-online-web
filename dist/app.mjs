// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
import {relayOrigin} from './transport.mjs';
import {BUILD_ID} from './version.mjs';
const $=id=>document.getElementById(id),canvas=$('game-canvas'),ctx=canvas.getContext('2d',{alpha:false});
let file,romHash='',worker,active=false,mode='',currentRole='solo',keys=0,paused=false,sound=true,audio,nextAudio=0,generation=0,exportPending=false,dbPromise,writeQueue=Promise.resolve();
let audioNode,audioSetup,audioStats={},pendingVideo,paintRequest=0,painted=0,paintMs=0,lastPaintReport=0;
const cache=new Map(),lines=[];let saveContext,quickState=null,romSelection=0;
const stateText={loading:'正在加载模拟器…',auth_sent:'正在认证连接…',waiting:'等待房间玩家到齐…',connected:'全员已连接，准备同步…',synchronizing:'正在交换快照并核对游戏状态…',playing_solo:'单人游戏中 · 按 Enter 开始',playing_online:'联机游戏中 · 同步已完成'};
const errors={INVALID_ROM:'请选择有效的 .gba 游戏文件（最大 32 MB）。',INVALID_CODE:'请输入有效的 8 位房间码。',ROM_MISMATCH:'所有玩家的游戏文件不同。请使用字节完全相同的 ROM。',CONFIG_MISMATCH:'人数、游戏版本或模拟器配置不同。所有玩家刷新同一网址后重建房间。',PROTOCOL_MISMATCH:'协议版本不同。请所有玩家刷新同一网址。',ROOM_FULL:'这个房间已满员。',ROOM_EXPIRED:'房间已过期，请重新创建。',TOKEN_EXPIRED:'认证已过期，请重新创建或加入房间。',PEER_DISCONNECTED:'对手已断开连接，本次联机已结束。',HEARTBEAT_TIMEOUT:'网络连接超时，本次联机已结束。',SERVER_SHUTDOWN:'中继服务已重启，本次联机已结束。',TRANSPORT_ERROR:'无法连接中继服务，请检查网络和 Relay 地址。',RELAY_HTTP_UNREACHABLE:'无法访问房间服务，请检查网络、Relay 地址及跨域设置。',RELAY_HTTP_TIMEOUT:'房间服务响应超时，请稍后重试。',SAVE_SIZE_MISMATCH:'存档大小与此游戏不匹配。请选择正确的电池存档。',CORE_CALIBRATION_TIMEOUT:'所有玩家网络校准超时，已停止游戏。请检查网络后重建房间。',CORE_SYNC_FAILURE:'联机模拟器报告同步错误，对局已停止。可下载诊断日志。',CORE_SESSION_ENDED:'模拟器核心已停止运行，请下载诊断日志查看最后的核心日志。',CORE_LINK_FAILED:'模拟器联机初始化失败，游戏已停止。',BACKPRESSURE:'网络发送积压，已停止本次联机。',ORIGIN_REJECTED:'Relay 未允许当前网页地址。请在服务端配置允许的网页来源。',GROUP_STATE_MISMATCH:'全员模拟状态不一致，已停止对局。存档保留到上次一致性检查。',GROUP_SYNC_TIMEOUT:'有玩家同步超时，已停止对局。请检查网络并重建房间。',GROUP_HANDSHAKE_TIMEOUT:'多人初始同步超时，请检查网络后重建房间。',GROUP_INPUT_REJECTED:'收到不兼容或冲突的玩家输入，已停止对局。',GROUP_INVALID_SNAPSHOT:'初始快照无效，已停止对局。',SNAPSHOT_CORE_UNAVAILABLE:'即时存档核心正在更新，请稍后刷新。已保留原存档。',SNAPSHOT_LOAD_FAILED:'即时存档读取失败，已保留原文件。可从游戏内存档启动。',SESSION_STOPPED:'游戏已结束。'};
function log(text){lines.push(`${new Date().toISOString()} ${String(text).slice(0,2000)}`);if(lines.length>250)lines.shift();}
function showError(reason){$('error').textContent=errors[reason]||`运行失败：${String(reason).slice(0,100)}。请下载诊断日志。`;$('error').hidden=false;log(reason);}
function refresh(){$('solo').innerHTML=quickState?'继续单人游戏 <span>→</span>':'开始单人游戏 <span>→</span>';$('solo-restart').hidden=!quickState;$('solo-restart').disabled=!file||active;for(const id of ['solo','host','join'])$(id).disabled=!file||active;for(const id of ['choose-rom','game-version','relay','join-code','player-count','input-delay'])$(id).disabled=active;$('stop').disabled=!active;$('pause').disabled=!active||mode!=='solo';$('import-save').disabled=!file||active;$('save-slot').disabled=active;$('export-save').disabled=!file||(active&&mode!=='solo');for(const b of document.querySelectorAll('[data-key]'))b.disabled=!active||paused;$('power').classList.toggle('on',active);$('mode-label').textContent=active?(mode==='solo'?'SINGLE PLAYER':'MULTI-PAK LINK'):'待机';}
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
function database(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('advance-wars-gba-online',1);r.onupgradeneeded=()=>r.result.createObjectStore('saves');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
const saveKey=(hash,slot)=>`aw-web-1:${hash}:${slot}`;
const checkpointKey=hash=>`aw-web-checkpoint-v1:${hash}:solo`;
async function readLocal(key){const db=await database();return new Promise((resolve,reject)=>{const q=db.transaction('saves').objectStore('saves').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
function putLocal(key,value,extra){writeQueue=writeQueue.catch(()=>{}).then(async()=>{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('saves','readwrite'),store=tx.objectStore('saves');store.put(value,key);if(extra)store.put(extra.value,extra.key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('STORAGE_ABORTED'));});});return writeQueue;}
function rememberPreferences(){void putLocal('aw-web-preferences-v1',{game:$('game-version').value,players:$('player-count').value,inputDelay:$('input-delay').value,sound}).catch(()=>log('PREFERENCES_WRITE_FAILED'));}
async function selectRom(chosen,{remember=true}={}){
 const mine=++romSelection,b=await chosen.arrayBuffer();if(b.byteLength<192||b.byteLength>32*1024*1024||new Uint8Array(b)[0xb2]!==0x96)throw Error('INVALID_ROM');const h=await hash(b);if(mine!==romSelection||active)return;
 file=chosen;romHash=h;quickState=await readLocal(checkpointKey(h)).catch(()=>null);if(mine!==romSelection||active)return;
 $('file-label').replaceChildren(document.createTextNode(chosen.name));const small=document.createElement('small');small.textContent=`${(b.byteLength/1024/1024).toFixed(2)} MB · 已准备`;$('file-label').append(small);
 $('file-info').textContent=`SHA-256 ${h.slice(0,12)}… · 保留在此浏览器`;$('game-status').textContent=quickState?'已找到自动即时存档 · 点击继续单人游戏':'准备完成 · 点击开始单人游戏';$('error').hidden=true;$('save-status').textContent=quickState?`单人可继续 ${new Date(quickState.savedAt).toLocaleString('zh-CN')} 的进度。`:'单人与玩家 1–4 的游戏内存档分开保存。';refresh();
 if(remember){await putLocal('aw-web-last-rom-v1',{file:chosen,name:chosen.name,hash:h});rememberPreferences();}
}
async function restoreLocalGame(){const selection=romSelection;try{const [prefs,last]=await Promise.all([readLocal('aw-web-preferences-v1'),readLocal('aw-web-last-rom-v1')]);if(romSelection!==selection||active||file)return;
 if(prefs){if(['aw1','aw2'].includes(prefs.game))$('game-version').value=prefs.game;if(['2','3','4'].includes(prefs.players))$('player-count').value=prefs.players;if(['8','16','32'].includes(prefs.inputDelay))$('input-delay').value=prefs.inputDelay;if(typeof prefs.sound==='boolean'){sound=prefs.sound;$('sound').textContent=`声音 ${sound?'开':'关'}`;$('sound').setAttribute('aria-pressed',String(sound));}}
 if(last?.file instanceof Blob)await selectRom(new File([last.file],last.name||'game.gba'),{remember:false});
 }catch{log('LOCAL_GAME_RESTORE_FAILED');$('save-status').textContent='无法读取本地游戏，仍可重新选择 ROM 并导入存档。';}}

async function getSave(hash,slot){const key=saveKey(hash,slot);if(cache.has(key))return cache.get(key);try{const db=await database();const value=await new Promise((r,j)=>{const q=db.transaction('saves').objectStore('saves').get(key);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});if(value)cache.set(key,value);return value;}catch{log('SAVE_STORAGE_UNAVAILABLE');$('save-status').textContent='浏览器存储不可用，请及时导出存档。';}}
function storeSave(hash,slot,buffer){const key=saveKey(hash,slot);cache.set(key,buffer);writeQueue=writeQueue.catch(()=>{}).then(async()=>{const db=await database();await new Promise((r,j)=>{const tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(buffer,key);tx.oncomplete=r;tx.onerror=()=>j(tx.error);});}).then(()=>{$('save-status').textContent=`已保存${slot==='solo'?'单人':`玩家 ${Number(slot.slice(1))+1}`}电池存档 · ${new Date().toLocaleTimeString('zh-CN')}`;}).catch(()=>{$('save-status').textContent='本地自动保存失败，请立即导出存档备份。';log('SAVE_WRITE_FAILED');});}
function download(data,name,type='application/octet-stream'){const u=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
async function audioStart(){
 const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)return;
 audio??=new Audio({latencyHint:'interactive'});await audio.resume();nextAudio=audio.currentTime;
 audioSetup??=(async()=>{if(!audio.audioWorklet||!globalThis.AudioWorkletNode){log('AUDIO_LEGACY_FALLBACK');return;}
  try{await audio.audioWorklet.addModule(new URL('./audio-worklet.mjs',import.meta.url));audioNode=new AudioWorkletNode(audio,'aw-pcm-player',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});audioNode.port.onmessage=({data})=>{audioStats=data;};audioNode.connect(audio.destination);log(`AUDIO_WORKLET rate=${audio.sampleRate}`);}catch(e){log(`AUDIO_LEGACY_FALLBACK ${e.message}`);}
 })();await audioSetup;audioNode?.port.postMessage({reset:true});
}
function playAudio(buffer,rate){if(!sound||!audio||audio.state!=='running')return;if(audioNode){audioNode.port.postMessage({buffer,rate},[buffer]);return;}const p=new Int16Array(buffer),n=p.length/2;if(!n||n>8192||rate<8000||rate>192000)return;if(nextAudio>audio.currentTime+.25)return;const b=audio.createBuffer(2,n,rate);for(let c=0;c<2;c++){const d=b.getChannelData(c);for(let i=0;i<n;i++)d[i]=p[i*2+c]/32768;}const src=audio.createBufferSource();src.buffer=b;src.connect(audio.destination);nextAudio=Math.max(nextAudio,audio.currentTime+.015);src.start(nextAudio);nextAudio+=n/rate;}
function queueVideo(m,w){
 if(m.w>512||m.h>512||m.buffer.byteLength!==m.w*m.h*4){w.postMessage({type:'video-ack'});return;}
 pendingVideo={m,w};if(paintRequest)return;
 paintRequest=requestAnimationFrame(()=>{paintRequest=0;const frame=pendingVideo;pendingVideo=null;if(!frame||worker!==frame.w)return;
  const {m,w}=frame,t=performance.now();
  try{if(canvas.width!==m.w||canvas.height!==m.h){canvas.width=m.w;canvas.height=m.h;}ctx.putImageData(new ImageData(new Uint8ClampedArray(m.buffer),m.w,m.h),0,0);++painted;paintMs+=performance.now()-t;$('screen-empty').hidden=true;}finally{w.postMessage({type:'video-ack'});}
 });
}
function showPerformance(m){
 if(!Number.isFinite(m.frameRate))return;
 const now=performance.now(),elapsed=now-lastPaintReport,displayFps=elapsed?painted*1000/elapsed:0,drawMs=painted?paintMs/painted:0;
 $('performance').textContent=`模拟 ${m.frameRate.toFixed(1)} FPS · 显示 ${displayFps.toFixed(1)} FPS · 核心 ${m.coreMsPerFrame.toFixed(1)} ms/帧 · 等包 ${m.inputWaitMsPerFrame.toFixed(1)} ms/帧`;
 $('performance-hint').textContent=document.hidden?'后台运行中，浏览器会限制画面刷新。':m.coreMsPerFrame>16?'模拟计算超过每帧预算，设备当前无法满速。':m.inputWaitMsPerFrame>4?'正在等待其他玩家输入，请检查全员网络与帧率。':m.frameRate>54&&displayFps<45?'模拟接近满速，画面显示受浏览器或主线程影响。':m.frameRate>54&&mode!=='solo'?`模拟接近满速；当前网络缓冲约 ${(Number($('input-delay').value)/59.7275).toFixed(2)} 秒，按键会有对应延迟。`:'声音与画面独立播放，模拟不会等待绘制。';
 log(`presentation ${JSON.stringify({displayFps:Math.round(displayFps*10)/10,drawMs:Math.round(drawMs*100)/100,audio:audioNode?'worklet':'legacy',...audioStats,hidden:document.hidden})}`);
 painted=paintMs=0;lastPaintReport=now;
}
function setKeys(v){keys=v;worker?.postMessage({type:'keys',keys});}
function clearKeys(){setKeys(0);}
function finish(w){if(w!==worker)return;worker=null;active=false;paused=false;clearKeys();cancelAnimationFrame(paintRequest);paintRequest=0;pendingVideo=null;audioNode?.port.postMessage({reset:true});$('pause').textContent='暂停';$('game-status').textContent='游戏已结束，可重新开始';$('local-status').textContent='已断开';$('peer-status').textContent='已断开';$('latency').textContent='— ms';audio?.suspend();w.terminate();refresh();}
function handle(m,w,context){if(worker!==w)return;
 if(m.type==='state'){$('game-status').textContent=m.state==='playing_solo'&&context.resumed?'单人游戏中 · 已继续上次进度':stateText[m.state]||m.state;log(`state=${m.state}`);if(['playing_solo','playing_online'].includes(m.state)){painted=paintMs=0;lastPaintReport=performance.now();}if(['waiting','auth_sent'].includes(m.state))$('local-status').textContent=`${currentRole==='solo'?'本地':`玩家 ${Number(currentRole.slice(1))+1}`} · ${m.state==='waiting'?'已认证':'认证中'}`;if(['connected','synchronizing','playing_online'].includes(m.state)){$('local-status').textContent=`玩家 ${Number(currentRole.slice(1))+1} · 已连接`;$('peer-status').textContent=`${Number($('player-count').value)-1} 位已连接`;}}
 else if(m.type==='video')queueVideo(m,w);
 else if(m.type==='audio')playAudio(m.buffer,m.rate);
 else if(m.type==='room'){currentRole=`p${m.role}`;$('save-slot').value=currentRole;$('invite-code').textContent=m.code;$('invite-box').hidden=false;$('local-status').textContent=`玩家 ${m.role+1}`;}
 else if(m.type==='roster'){$('peer-status').textContent=`${m.connected} / ${m.players} 人到齐`;log(`roster ${m.connected}/${m.players}`);}
 else if(m.type==='save'){storeSave(context.hash,m.role,m.buffer);if(exportPending){exportPending=false;download(m.buffer,`${context.game}-${m.role}.sav`);}}
 else if(m.type==='checkpoint'){
  const saved={format:m.format,romHash:m.romHash,buffer:m.buffer,save:m.save,frames:m.frames,savedAt:m.savedAt};quickState=saved;if(m.save)cache.set(saveKey(context.hash,'solo'),m.save);
  void putLocal(checkpointKey(context.hash),saved,m.save?{key:saveKey(context.hash,'solo'),value:m.save}:null).then(()=>{if(romHash===context.hash)$('save-status').textContent=`单人即时进度已自动保存 · ${new Date(m.savedAt).toLocaleTimeString('zh-CN')}`;refresh();}).catch(()=>{$('save-status').textContent='即时存档写入失败，请先在游戏内保存并导出备份。';log('CHECKPOINT_WRITE_FAILED');});
 }
 else if(m.type==='resumed'){context.resumed=true;$('save-status').textContent=`已恢复 ${new Date(m.savedAt).toLocaleString('zh-CN')} 的即时进度。`;log(`resumed frames=${m.frames}`);}
 else if(m.type==='warning'){$('save-status').textContent=m.reason==='SNAPSHOT_INCOMPATIBLE'?'旧即时存档格式不兼容，已从游戏内存档启动。':'即时存档未能生成，请在游戏内保存并导出备份。';log(m.reason);}
 else if(m.type==='rtt')$('latency').textContent=`${m.ms} ms`;
 else if(m.type==='build'){log(`build ${JSON.stringify(m)}`);if(m.version!==BUILD_ID){showError('CONFIG_MISMATCH');w.postMessage({type:'stop'});}}
 else if(m.type==='log')log(m.text);
 else if(m.type==='metrics'){log(`metrics ${JSON.stringify(m)}`);showPerformance(m);}
 else if(m.type==='error')showError(m.reason);
 else if(m.type==='stopped')finish(w);
}
async function start(nextMode,{fresh=false}={}){if(active||!file)return;const mine=++generation;mode=nextMode;active=true;paused=false;exportPending=false;$('error').hidden=true;$('invite-box').hidden=true;refresh();$('game-status').textContent='正在准备游戏…';$('performance').textContent='正在测量运行速度…';
 try{if(nextMode!=='solo')relayOrigin($('relay').value);if(sound)await audioStart().catch(()=>log('AUDIO_UNAVAILABLE'));const rom=await file.arrayBuffer();const hashValue=romHash;const resume=nextMode==='solo'&&!fresh?await readLocal(checkpointKey(hashValue)).catch(()=>null):null;const saves={};for(const slot of ['solo','p0','p1','p2','p3']){const b=await getSave(hashValue,slot);if(b)saves[slot]=b.slice(0);}if(mine!==generation)return;currentRole=nextMode==='solo'?'solo':nextMode==='host'?'p0':'p1';$('save-slot').value=currentRole;saveContext={hash:hashValue,game:$('game-version').value};const w=new Worker(new URL('./emulator-worker.mjs',import.meta.url),{type:'module'});worker=w;w.onmessage=({data})=>handle(data,w,saveContext);w.onerror=e=>{showError('WORKER_ERROR');log(e.message);finish(w);};w.postMessage({type:'start',videoBackpressure:true,mode:nextMode,players:Number($('player-count').value),inputDelay:Number($('input-delay').value),game:$('game-version').value,rom,saves,resume,relay:$('relay').value,code:$('join-code').value},[rom]);w.postMessage({type:'audio',enabled:sound});log(`start build=${BUILD_ID} mode=${nextMode} players=${$('player-count').value} game=${$('game-version').value} romSHA256=${hashValue}`);
 }catch(e){if(mine!==generation)return;showError(e.message);if(worker)finish(worker);else{active=false;refresh();$('game-status').textContent='启动失败，请检查提示。';}}
}
$('choose-rom').onclick=()=>$('rom-file').click();
$('rom-file').onchange=async e=>{const chosen=e.target.files[0];if(!chosen)return;try{await selectRom(chosen);}catch(e){if(e.message==='INVALID_ROM')showError(e.message);else{$('file-info').textContent='游戏可运行，但本地保留失败，刷新后需重新选择。';log('ROM_PERSIST_FAILED');}}e.target.value='';};
$('player-count').onchange=()=>{$('group-note').textContent=$('player-count').value==='2'?'按原版 Multi-Pak 规则，每人独立控制一支军队。':'3–4 人核心测试版：每人独立控制军队；两代商业游戏完整对局未验证。';};
$('solo').onclick=()=>start('solo');$('solo-restart').onclick=()=>start('solo',{fresh:true});$('host').onclick=()=>start('host');$('join').onclick=()=>start('join');
$('stop').onclick=()=>{++generation;if(worker){worker.postMessage({type:'stop'});$('game-status').textContent='正在安全结束并保存…';}else{active=false;audio?.suspend();refresh();$('game-status').textContent='已取消启动';}};
$('pause').onclick=()=>{if(mode!=='solo'||!worker)return;paused=!paused;audioNode?.port.postMessage({reset:true});clearKeys();worker.postMessage({type:'pause',paused});$('pause').textContent=paused?'继续':'暂停';$('game-status').textContent=paused?'已暂停':'单人游戏中';refresh();};
$('sound').onclick=async()=>{sound=!sound;rememberPreferences();$('sound').textContent=`声音 ${sound?'开':'关'}`;$('sound').setAttribute('aria-pressed',String(sound));worker?.postMessage({type:'audio',enabled:sound});if(sound&&active)await audioStart().catch(()=>{});else await audio?.suspend();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('screen').requestFullscreen();}catch{$('game-status').textContent='当前浏览器不支持全屏。';}};
$('copy-code').onclick=async()=>{try{await navigator.clipboard.writeText($('invite-code').textContent);$('copy-code').textContent='已复制';setTimeout(()=>$('copy-code').textContent='复制',1500);}catch{$('game-status').textContent='复制受限，请手动复制上面的房间码。';}};
$('diagnose').onclick=async()=>{const b=$('diagnose');b.disabled=true;try{const origin=relayOrigin($('relay').value),start=performance.now();const r=await fetch(origin+'/health',{credentials:'omit',signal:AbortSignal.timeout(10000)});const body=await r.json();if(!r.ok||body.status!=='ok'||body.protocol!=='aw-relay-1')throw Error('INVALID_RELAY_RESPONSE');$('diagnostic-result').textContent=`服务可用 · ${Math.round(performance.now()-start)} ms · aw-relay-1`;}catch(e){$('diagnostic-result').textContent=`检测失败：${errors[e.message]||'无法访问服务，请检查网络与跨域配置。'}`;}finally{b.disabled=false;}};
$('download-log').onclick=()=>download(`AW Web ${BUILD_ID}\nUser agent: ${navigator.userAgent}\n${lines.join('\n')}`,`aw-web-diagnostic-${Date.now()}.txt`,'text/plain;charset=utf-8');
$('help-open').onclick=()=>$('help-dialog').showModal();$('help-close').onclick=()=>$('help-dialog').close();
$('import-save').onclick=()=>$('save-file').click();$('save-file').onchange=async e=>{if(active||!file)return;const b=await e.target.files?.[0]?.arrayBuffer();if(!b)return;if(b.byteLength<512||b.byteLength>1024*1024){showError('SAVE_SIZE_MISMATCH');return;}storeSave(romHash,$('save-slot').value,b);if($('save-slot').value==='solo'){$('save-status').textContent='已导入游戏内存档，请点击「从游戏内存档启动」以使用它。';}e.target.value='';};
$('export-save').onclick=async()=>{if(!file)return;if(active&&mode==='solo'){exportPending=true;worker?.postMessage({type:'export'});return;}const slot=$('save-slot').value;const b=await getSave(romHash,slot);if(b)download(b,`${$('game-version').value}-${slot}.sav`);else $('save-status').textContent='此槽位还没有存档。请先在游戏内保存，再结束游戏。';};
const keyMap={ArrowUp:4,ArrowDown:5,ArrowLeft:6,ArrowRight:7,KeyZ:8,KeyX:0,Enter:3,ShiftLeft:2,ShiftRight:2,KeyA:10,KeyS:11};
addEventListener('keydown',e=>{if(!active||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||$('help-dialog').open||!(e.code in keyMap))return;e.preventDefault();if(!paused)setKeys(keys|(1<<keyMap[e.code]));});addEventListener('keyup',e=>{if(e.code in keyMap)setKeys(keys&~(1<<keyMap[e.code]));});addEventListener('blur',clearKeys);
for(const b of document.querySelectorAll('[data-key]')){b.onpointerdown=e=>{e.preventDefault();if(!active||paused)return;b.setPointerCapture(e.pointerId);setKeys(keys|(1<<+b.dataset.key));};for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>setKeys(keys&~(1<<+b.dataset.key)));}
document.addEventListener('visibilitychange',()=>{clearKeys();if(document.hidden&&active&&mode!=='solo'){$('game-status').textContent='后台运行中 · 联机不会因切换标签页主动结束';log('visibility=hidden; multiplayer session remains active');}else if(!document.hidden&&active&&mode!=='solo'){$('game-status').textContent='已返回前台 · 联机继续运行中';log('visibility=visible; multiplayer session remains active');}worker?.postMessage({type:'visibility',hidden:document.hidden});});
refresh();
$('game-version').addEventListener('change',rememberPreferences);$('player-count').addEventListener('change',rememberPreferences);$('input-delay').addEventListener('change',rememberPreferences);
addEventListener('pagehide',()=>worker?.postMessage({type:'checkpoint'}));
addEventListener('beforeunload',e=>{if(active&&mode!=='solo'){e.preventDefault();e.returnValue='';}});
void restoreLocalGame();
