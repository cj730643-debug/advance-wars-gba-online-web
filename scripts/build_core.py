#!/usr/bin/env python3
"""Build the modified pinned mGBA libretro core for a single browser Worker."""
import argparse,os,subprocess,shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--emsdk',required=True);p.add_argument('--source',required=True);a=p.parse_args()
root=Path(__file__).resolve().parent.parent
sdk=Path(a.emsdk).resolve();src=Path(a.source).resolve()
if (src/'.git').exists():
 assert subprocess.check_output(['git','-C',str(src),'rev-parse','HEAD'],text=True).strip()=='9e919b0cfbb93af7d1171570dfc6745d00eeebab'
assert 'mLibretroAWGroupCore' in (src/'src/platform/libretro/libretro.c').read_text(encoding="utf-8"), 'Extract the complete corresponding vendor source from dist/source.zip first'
assert '_pairSleep' in (src/'src/gba/replicated-pair.c').read_text(encoding="utf-8")
# The browser profile advertises a WAN-safe 10 s calibration window. The pinned
# upstream helper currently hard-codes 3 s for calibration/accept deadlines.
# Patch that exact constant before building; fail closed if upstream changes it.
session=src/'src/gba/sio/netplay/session-v2.c'
text=session.read_text(encoding='utf-8')
old='const uint64_t duration = UINT64_C(3000000);'
new='const uint64_t duration = UINT64_C(10000000);'
if text.count(old)==1:
 text=text.replace(old,new,1)
elif text.count(new)!=1:
 raise SystemExit('Expected exactly one protocol-v2 absolute deadline constant')
session.write_text(text,encoding='utf-8')
(root/'logs').mkdir(exist_ok=True);(root/'dist').mkdir(exist_ok=True)
env=os.environ.copy();env['EMSDK']=str(sdk);env['EM_CONFIG']=str(sdk/'.emscripten')
cmake=shutil.which('cmake') or str(Path.home()/'.local/bin/cmake');ninja=shutil.which('ninja') or str(Path.home()/'.local/bin/ninja')
commands=[[cmake,'-S',str(root/'native'),'-B',str(root/'build'),'-G','Ninja',f'-DCMAKE_MAKE_PROGRAM={ninja}',f'-DCMAKE_TOOLCHAIN_FILE={sdk}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake',f'-DMGBA_SOURCE_DIR={src}','-DCMAKE_BUILD_TYPE=Release'],[cmake,'--build',str(root/'build'),'--target','aw-core','--parallel','3']]
with (root/'logs/core-build.log').open('w') as log:
 for cmd in commands:
  log.write(' '.join(cmd)+'\n');log.flush();subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
for f in ['aw-core.mjs','aw-core.wasm']:shutil.copy2(root/'build'/f,root/'dist'/f)
print('Built real mGBA WebAssembly core')
