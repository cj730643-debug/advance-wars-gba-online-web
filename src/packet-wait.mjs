// Wake a waiting simulation directly when a packet arrives. The timer is only
// a liveness fallback, never a minimum per-packet delay (including background).
export function attachPacketWait(queue){
 let wake;
 queue.wake=()=>wake?.();
 queue.wait=timeout=>queue.length?Promise.resolve():new Promise(resolve=>{
  const done=()=>{clearTimeout(timer);if(wake===done)wake=undefined;resolve();};
  const timer=setTimeout(done,timeout);wake=done;
 });
 return queue;
}
