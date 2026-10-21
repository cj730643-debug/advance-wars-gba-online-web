// MPL-2.0. Use basic AbortController APIs supported by older mobile browsers.
// Keep cancellation active while decoding the response body, and always clean up.
export async function fetchJsonWithTimeout(url,{signal,timeoutMs=20000,...options}={}){
 if(signal?.aborted)throw Error('SESSION_STOPPED');
 const controller=new AbortController();let timedOut=false;
 const cancel=()=>controller.abort();
 signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
 try{const response=await fetch(url,{...options,signal:controller.signal});const body=await response.json();return {response,body};}
 catch(e){if(signal?.aborted)throw Error('SESSION_STOPPED');if(timedOut)throw Error('RELAY_HTTP_TIMEOUT');if(e instanceof TypeError)throw Error('RELAY_HTTP_UNREACHABLE');throw e;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
