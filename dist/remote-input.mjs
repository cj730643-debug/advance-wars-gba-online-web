// MPL-2.0. Host-issued freshness proofs require no shared wall clock.
export const MAX_INPUT_AGE_MS=1000,REMOTE_HOLD_TIMEOUT_MS=300;
export function createRemoteInput({clock=()=>performance.now(),apply=()=>{},onReset=()=>{}}={}){
 const pulses=new Map();let nonce=0,revision=-1,blocked=-1,held=0,lastAt=0,epoch=0;
 function expire(){if(held&&clock()-lastAt>=REMOTE_HOLD_TIMEOUT_MS){blocked=Math.max(blocked,revision);held=0;apply(0);onReset({epoch,revision});}}
 return {
  reset(nextEpoch){epoch=nextEpoch;revision=blocked=-1;held=0;pulses.clear();apply(0);},
  pulse(){const now=clock();for(const [id,at] of pulses)if(now-at>MAX_INPUT_AGE_MS)pulses.delete(id);const id=++nonce;pulses.set(id,now);return {id,epoch};},
  receive(m){expire();if(m.epoch!==epoch||!Number.isSafeInteger(m.revision)||m.revision<0||m.revision<revision||!Number.isInteger(m.keys)||m.keys<0||(m.keys&~0xDFD))return false;
   if(m.keys){const at=pulses.get(m.pulse);if(at===undefined||clock()-at>MAX_INPUT_AGE_MS||m.revision<=blocked)return false;if(m.revision===revision&&m.keys!==held)return false;}
   revision=m.revision;lastAt=clock();held=m.keys;apply(held);return true;
  },
  release(){if(held){blocked=Math.max(blocked,revision);held=0;apply(0);onReset({epoch,revision});}},tick:expire,
 };
}
