import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelay} from '../server.mjs';
test('browser Origin and CORS preflight match the configured origin only',async()=>{const origin='https://advance-wars-gba-online-web.cj730643.chatgpt.site',r=createRelay({allowedOrigins:[origin]});const base=await r.listen();try{
 let res=await fetch(base+'/v1/rooms',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});assert.equal(res.status,204);assert.equal(res.headers.get('access-control-allow-origin'),origin);assert.equal(res.headers.get('access-control-allow-credentials'),null);
 res=await fetch(base+'/health',{headers:{Origin:origin}});assert.equal(res.status,200);assert.equal(res.headers.get('access-control-allow-origin'),origin);
 res=await fetch(base+'/health',{headers:{Origin:'https://invalid.example'}});assert.equal(res.status,403);
 res=await fetch(base+'/health');assert.equal(res.status,200);
 res=await fetch(base+'/v1/rooms',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'DELETE'}});assert.equal(res.status,403);
}finally{await r.close();}});
