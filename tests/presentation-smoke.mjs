// MPL-2.0. Exercise stalled display consumers and continuous PCM resampling.
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readFile,writeFile} from 'node:fs/promises';
import {createVideoMailbox} from '../src/video-mailbox.mjs';
import {StereoRing} from '../src/audio-ring.mjs';

const sent=[],mailbox=createVideoMailbox(frame=>sent.push(frame));mailbox.enable();
for(let frame=0;frame<600;frame++)mailbox.push(frame);
assert.deepEqual(sent,[0]);assert.equal(mailbox.coalesced,598);
mailbox.acknowledge();assert.deepEqual(sent,[0,599]);
mailbox.acknowledge();mailbox.push(600);assert.deepEqual(sent,[0,599,600]);

// Stereo polarity and interpolation at a different output sample rate.
const ring=new StereoRing(48000),pcm=new Int16Array(4096*2);
for(let i=0;i<4096;i++){pcm[2*i]=i*4;pcm[2*i+1]=-i*4;}
ring.push(pcm,32768);const left=new Float32Array(128),right=new Float32Array(128);
ring.render(left,right);
for(let i=0;i<128;i++){assert(Math.abs(left[i]-i*(32768/48000)*4/32768)<1e-6);assert(Math.abs(right[i]+left[i])<1e-6);}
// Long-running continuous sound remains bounded without losing channels.
for(let i=0;i<3000;i++){
 if(ring.write-ring.read<2500)ring.push(pcm.subarray(0,1024),32768);
 ring.render(left,right);assert(left.every(Number.isFinite));assert(right.every(Number.isFinite));
 assert(ring.write-ring.read<=ring.capacity);assert.equal(ring.underruns,0);
}
for(let i=0;i<ring.capacity;i++)ring.render(left,right);
assert.equal(ring.underruns,1);ring.push(pcm,32768);ring.render(left,right);assert(ring.playing);
for(let i=0;i<20;i++)ring.push(pcm,32768);
assert(ring.overflows>0);assert(ring.write-ring.read<=ring.capacity);
ring.reset();ring.render(left,right);assert(left.every(v=>v===0));assert(right.every(v=>v===0));

const rom=Uint8Array.from(await readFile(new URL('./fixtures/gba-link-continuous.gba',import.meta.url))).buffer;
const w=new Worker(new URL('./worker-node-adapter.mjs',import.meta.url));
let video=0,observed,checkpoint=false;
try{
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('presentation test timed out')),15000);w.on('error',reject);
  w.on('message',m=>{
   if(m.type==='adapter_ready')w.postMessage({type:'start',mode:'solo',rom,saves:{},videoBackpressure:true},[rom]);
   if(m.type==='video'){++video;setTimeout(()=>w.postMessage({type:'video-ack'}),150);}
   if(m.type==='checkpoint')checkpoint=true;
   if(m.type==='metrics'&&m.frames>=120&&!observed){observed=m;w.postMessage({type:'stop'});}
   if(m.type==='error')reject(Error(m.reason));
   if(m.type==='stopped'){clearTimeout(timer);resolve();}
  });
 });
 assert(checkpoint);assert(observed.frames>video*2);assert(observed.videoCoalesced>50);assert(Number.isFinite(observed.frameRate));
}finally{await w.terminate();}
const evidence={testedAt:new Date().toISOString(),scope:'Real WASM solo with simulated 150ms display ACK delay; no commercial game FPS claim',video,frames:observed.frames,frameRate:observed.frameRate,videoCoalesced:observed.videoCoalesced,checkpoint,stereoResampling:true,continuousAudioBlocks:3000};
await writeFile(new URL('../logs/presentation-smoke.json',import.meta.url),JSON.stringify(evidence,null,2));console.log(evidence);
