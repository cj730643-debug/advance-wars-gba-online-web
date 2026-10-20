// MPL-2.0. Continuous PCM playback; emulation never waits for the audio device.
export class StereoRing {
 constructor(targetRate,capacity=16384){
  this.left=new Float32Array(capacity);this.right=new Float32Array(capacity);
  this.capacity=capacity;this.targetRate=targetRate;this.sourceRate=32768;
  this.read=0;this.write=0;this.playing=false;this.underruns=0;this.overflows=0;
 }
 push(pcm,rate){
  if(!Number.isFinite(rate)||rate<8000||rate>192000||pcm.length%2)return;
  if(rate!==this.sourceRate){this.reset();this.sourceRate=rate;}
  const n=pcm.length/2;
  for(let i=0;i<n;i++){const at=this.write%this.capacity;this.left[at]=pcm[i*2]/32768;this.right[at]=pcm[i*2+1]/32768;++this.write;}
  // Discard stale sound after a stalled tab, rather than playing a long backlog.
  if(this.write-this.read>this.capacity-2){this.read=this.write-Math.min(this.capacity-2,Math.ceil(rate*.06));this.playing=false;++this.overflows;}
 }
 reset(){this.read=this.write=0;this.playing=false;}
 render(left,right){
  left.fill(0);right.fill(0);
  if(!this.playing){if(this.write-this.read<Math.ceil(this.sourceRate*.045))return;this.playing=true;}
  const step=this.sourceRate/this.targetRate;
  for(let i=0;i<left.length;i++){
   const base=Math.floor(this.read);
   if(base+1>=this.write){this.playing=false;++this.underruns;break;}
   const a=base%this.capacity,b=(base+1)%this.capacity,t=this.read-base;
   left[i]=this.left[a]+(this.left[b]-this.left[a])*t;
   right[i]=this.right[a]+(this.right[b]-this.right[a])*t;
   this.read+=step;
  }
 }
}
