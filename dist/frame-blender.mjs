// MPL-2.0. Optional display-only frame blending, not motion prediction or AI.
// Two source surfaces, one scheduled paint; never extrapolates game/input state.
import {schedulePaint} from './paint-scheduler.mjs';
const FRAME=1000/60;
export function createFrameBlender({context,onPaint=()=>{},now=()=>performance.now(),schedule=schedulePaint,createSurface=()=>document.createElement('canvas'),imageData=(bytes,w,h)=>new ImageData(bytes,w,h)}){
 const surfaces=[createSurface(),createSurface()];let index=0,previous=null,current=null,lastAt=null,lastPaintAt=null,start=0,duration=FRAME,cancel=null;
 function queue(){if(!cancel)cancel=schedule(paint);}
 function paint(){
  cancel=null;if(!current)return;const at=now();
  if(lastPaintAt!==null&&at-lastPaintAt<FRAME-.5){queue();return;}
  const t=previous?Math.min(1,Math.max(0,(at-start)/duration)):1,began=now();
  context.globalAlpha=1;
  if(previous){context.drawImage(previous,0,0);context.globalAlpha=t;}
  context.drawImage(current,0,0);context.globalAlpha=1;lastPaintAt=at;
  onPaint({generated:!!previous&&t>0&&t<1,ms:now()-began});
  if(t<1)queue();
 }
 return{
  submit({buffer,w,h}){
   const at=now();if(current&&(current.width!==w||current.height!==h)){previous=current=null;lastAt=null;}
   const surface=surfaces[index];index=1-index;
   if(surface.width!==w||surface.height!==h){surface.width=w;surface.height=h;}
   surface.getContext('2d',{alpha:false}).putImageData(imageData(new Uint8ClampedArray(buffer),w,h),0,0);
   previous=current;current=surface;duration=lastAt===null?FRAME:Math.min(80,Math.max(FRAME,at-lastAt));start=at;lastAt=at;queue();
  },
  stop(){cancel?.();cancel=null;previous=current=null;lastAt=lastPaintAt=null;context.globalAlpha=1;}
 };
}
