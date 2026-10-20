// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
// Keep full corresponding source while respecting upload transport size limits.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const data=await readFile('dist/source.zip');await mkdir('source-archive',{recursive:true});
const parts=[];for(let offset=0;offset<data.length;offset+=8*1024*1024){const name=`part-${String(parts.length+1).padStart(3,'0')}.bin`;await writeFile(`source-archive/${name}`,data.subarray(offset,offset+8*1024*1024));parts.push(name);}
await writeFile('source-archive/manifest.json',JSON.stringify({sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length,parts},null,2)+'\n');
