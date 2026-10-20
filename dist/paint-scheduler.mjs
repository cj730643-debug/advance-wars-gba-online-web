// MPL-2.0. Prefer display sync, but tolerate browsers throttling visible rAF.
export function schedulePaint(paint,clock=globalThis){
 let done=false,animation,timer;
 const cancel=()=>{done=true;clock.cancelAnimationFrame(animation);clock.clearTimeout(timer);};
 const run=()=>{if(done)return;cancel();paint();};
 animation=clock.requestAnimationFrame(run);
 timer=clock.setTimeout(run,1000/59.7275);
 return cancel;
}
