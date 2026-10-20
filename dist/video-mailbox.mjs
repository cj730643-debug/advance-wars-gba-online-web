// MPL-2.0. Keep emulation independent from a busy or hidden UI thread.
// At most one transferred frame and one latest pending frame are retained.
export function createVideoMailbox(send){
 let bounded=false,inFlight=false,pending=null,coalesced=0;
 function dispatch(frame){inFlight=true;send(frame);}
 return {
  enable(){bounded=true;},
  push(frame){
   if(!bounded){send(frame);return;}
   if(!inFlight){dispatch(frame);return;}
   if(pending)++coalesced;
   pending=frame;
  },
  acknowledge(){
   if(!bounded)return;
   inFlight=false;
   if(pending){const frame=pending;pending=null;dispatch(frame);}
  },
  get coalesced(){return coalesced;}
 };
}
