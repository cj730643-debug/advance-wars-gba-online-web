// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
// Vercel serves the tested WASM artifact; native rebuilding uses build_core.py.
import {readdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const archive=JSON.parse(await readFile('source-archive/manifest.json','utf8'));
let source;try{source=await readFile('dist/source.zip');}catch{}
if(!source||createHash('sha256').update(source).digest('hex')!==archive.sha256){
 source=Buffer.concat(await Promise.all(archive.parts.map(name=>{if(!/^part-[0-9]{3}\.bin$/.test(name))throw Error('Invalid source part');return readFile(`source-archive/${name}`);})));
 if(source.length!==archive.bytes||createHash('sha256').update(source).digest('hex')!==archive.sha256)throw Error('Corresponding source integrity failure');
 await writeFile('dist/source.zip',source);
}
for(const name of await readdir('src'))await copyFile(`src/${name}`,`dist/${name}`);
const wasm=await readFile('dist/aw-core.wasm');
if(wasm.subarray(0,4).toString('hex')!=='0061736d')throw Error('Missing compiled WebAssembly core');
const evidence=JSON.parse(await readFile('dist/test-evidence.json','utf8'));
const sha=createHash('sha256').update(wasm).digest('hex');
if(evidence['core-smoke']?.wasmSHA256!==sha)throw Error('Core differs from the tested artifact');
for(const name of ['index.html','aw-core.mjs','source.zip','LICENSE.txt','THIRD_PARTY_NOTICES.txt','TEST_REPORT.txt'])await readFile(`dist/${name}`);
// Refresh the shipped static-asset manifest after copying the latest source files.
const sums=(await readFile('dist/SHA256SUMS.txt','utf8')).trim().split(/\r?\n/);
const listed=new Set(sums.map(line=>line.slice(line.indexOf('  ')+2)));
for(const name of await readdir('src'))if(!listed.has(name))sums.push(`pending  ${name}`);
const refreshed=[];
for(const line of sums){const sep=line.indexOf('  ');if(sep<0)throw Error('Invalid SHA-256 manifest');const name=line.slice(sep+2);const bytes=await readFile(`dist/${name}`);refreshed.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);}
await writeFile('dist/SHA256SUMS.txt',`${refreshed.join('\n')}\n`);
console.log(`Static browser build verified. mGBA WASM SHA-256 ${sha}`);
