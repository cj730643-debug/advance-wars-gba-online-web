// MPL-2.0. A single persistent node replaces per-frame AudioBufferSource nodes.
import {StereoRing} from './audio-ring.mjs';
class AwPcmPlayer extends AudioWorkletProcessor {
 constructor(){
  super();this.ring=new StereoRing(sampleRate);this.blocks=0;
  this.port.onmessage=({data})=>{if(data.reset)this.ring.reset();else if(data.buffer)this.ring.push(new Int16Array(data.buffer),data.rate);};
 }
 process(_inputs,outputs){
  const channels=outputs[0];if(channels?.length===2)this.ring.render(channels[0],channels[1]);
  if(++this.blocks>=Math.ceil(sampleRate/128)){this.blocks=0;this.port.postMessage({underruns:this.ring.underruns,overflows:this.ring.overflows,queuedMs:Math.round((this.ring.write-this.ring.read)*1000/this.ring.sourceRate)});}
  return true;
 }
}
registerProcessor('aw-pcm-player',AwPcmPlayer);
