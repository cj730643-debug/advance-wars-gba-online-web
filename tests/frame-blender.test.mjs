// MPL-2.0. Known red/blue source frames must yield purple midway, not change inputs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFrameBlender} from '../src/frame-blender.mjs';
function harness(){let time=0,next=0;const jobs=new Map(),output=[0,0,0],events=[];let surfaces=0;
 const context={globalAlpha:1,drawImage(surface){const a=this.globalAlpha;for(let c=0;c<3;c++)output[c]=surface.pixels[c]*a+output[c]*(1-a);}};
 const blender=createFrameBlender({context,now:()=>time,schedule(f){const id=++next;jobs.set(id,f);return()=>jobs.delete(id);},createSurface(){surfaces++;return{width:1,height:1,pixels:[],getContext(){return{putImageData:img=>{this.pixels=[...img.data];}};}};},imageData:data=>({data}),onPaint:e=>events.push(e)});
 const source=rgb=>({buffer:new Uint8ClampedArray([...rgb,255]).buffer,w:1,h:1});
 return {blender,output,events,jobs,source,at(t){time=t;},flush(t){time=t;const current=[...jobs.values()];jobs.clear();for(const f of current)f();},get surfaces(){return surfaces;}};
}
test('halfway blend, endpoint, source immutability and no endless fake frames',()=>{const h=harness(),red=h.source([255,0,0]),blue=h.source([0,0,255]);h.blender.submit(red);h.flush(16);assert.deepEqual(h.output,[255,0,0]);h.at(33);h.blender.submit(blue);h.flush(49.5);assert.deepEqual(h.output,[127.5,0,127.5]);assert(h.events.at(-1).generated);h.flush(66);assert.deepEqual(h.output,[0,0,255]);assert.equal(h.jobs.size,0);assert.deepEqual([...new Uint8Array(red.buffer)],[255,0,0,255]);assert.deepEqual([...new Uint8Array(blue.buffer)],[0,0,255,255]);});
test('only two surfaces and one scheduled paint during a 1000-frame burst',()=>{const h=harness();for(let i=0;i<1000;i++){h.at(i);h.blender.submit(h.source([i%256,0,0]));assert.equal(h.jobs.size,1);}assert.equal(h.surfaces,2);h.flush(1080);assert.deepEqual(h.output,[999%256,0,0]);assert.equal(h.jobs.size,0);});
test('high refresh display does not create more than 60 paint updates per second',()=>{const h=harness();h.blender.submit(h.source([255,0,0]));h.flush(16);h.at(100);h.blender.submit(h.source([0,0,255]));h.flush(108);const n=h.events.length;h.flush(116);assert.equal(h.events.length,n);h.flush(125);assert.equal(h.events.length,n+1);h.blender.stop();assert.equal(h.jobs.size,0);h.flush(200);assert.equal(h.events.length,n+1);});
