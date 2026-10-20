#!/usr/bin/env python3
"""Build the modified pinned mGBA libretro core for a single browser Worker."""
import argparse,os,subprocess,shutil,re
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--emsdk',required=True);p.add_argument('--source',required=True);a=p.parse_args()
root=Path(__file__).resolve().parent.parent
sdk=Path(a.emsdk).resolve();src=Path(a.source).resolve()
if (src/'.git').exists():
 assert subprocess.check_output(['git','-C',str(src),'rev-parse','HEAD'],text=True).strip()=='9e919b0cfbb93af7d1171570dfc6745d00eeebab'
assert 'mLibretroAWGroupCore' in (src/'src/platform/libretro/libretro.c').read_text(encoding="utf-8"), 'Extract the complete corresponding vendor source from dist/source.zip first'
assert '_pairSleep' in (src/'src/gba/replicated-pair.c').read_text(encoding="utf-8")
# The upstream session already supports per-operation deadlines; the web
# adapter was leaving calibration/accept at the 3 s default. Enforce the 10 s
# WAN window advertised by PROFILE after any upstream optional policy handling.
adapter=src/'src/platform/libretro/gba-wifi-link.c'
text=adapter.read_text(encoding='utf-8')
marker='/* Advance Wars Online web build: enforce the 10 s WAN calibration window advertised by PROFILE. */'
cal='adapter->sessionConfig.deadlines.milliseconds[GBA_LINK_V2_DEADLINE_CALIBRATION] = 10000;'
accept='adapter->sessionConfig.deadlines.milliseconds[GBA_LINK_V2_DEADLINE_ACCEPT] = 10000;'
if marker in text:
 if text.count(marker)!=1 or text.count(cal)!=1 or text.count(accept)!=1:
  raise SystemExit('Partially applied or ambiguous WAN deadline configuration')
else:
 needle='adapter->sessionConfig.callbacks = &_sessionCallbacks;'
 if text.count(needle)!=1:
  raise SystemExit('Could not locate unique GBA Wi-Fi Link callback initialization')
 insertion=marker+'\\n\\t'+cal+'\\n\\t'+accept+'\\n\\t'+needle
 text=text.replace(needle,insertion,1)
adapter.write_text(text,encoding='utf-8')
(root/'logs').mkdir(exist_ok=True);(root/'dist').mkdir(exist_ok=True)
env=os.environ.copy();env['EMSDK']=str(sdk);env['EM_CONFIG']=str(sdk/'.emscripten')
cmake=shutil.which('cmake') or str(Path.home()/'.local/bin/cmake');ninja=shutil.which('ninja') or str(Path.home()/'.local/bin/ninja')
commands=[[cmake,'-S',str(root/'native'),'-B',str(root/'build'),'-G','Ninja',f'-DCMAKE_MAKE_PROGRAM={ninja}',f'-DCMAKE_TOOLCHAIN_FILE={sdk}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake',f'-DMGBA_SOURCE_DIR={src}','-DCMAKE_BUILD_TYPE=Release'],[cmake,'--build',str(root/'build'),'--target','aw-core','--parallel','3']]
with (root/'logs/core-build.log').open('w') as log:
 for cmd in commands:
  log.write(' '.join(cmd)+'\n');log.flush();subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
for f in ['aw-core.mjs','aw-core.wasm']:shutil.copy2(root/'build'/f,root/'dist'/f)
print('Built real mGBA WebAssembly core')
