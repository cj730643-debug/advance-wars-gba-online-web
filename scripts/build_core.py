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
 insertion=marker+'\n\t'+cal+'\n\t'+accept+'\n\t'+needle
 text=text.replace(needle,insertion,1)
adapter.write_text(text,encoding='utf-8')

# Background-tab throttling can delay a calibration ACK beyond the strict 1 s
# sample bound. Keep one delayed sample from killing the entire session; the
# selector uses a trimmed high percentile. The absolute phase deadline must
# match the 10 s browser WAN profile too.
def patch_once(path, old, new, label):
 content=path.read_text(encoding='utf-8')
 if content.count(old)==1:
  content=content.replace(old,new,1)
 elif content.count(new)!=1:
  raise SystemExit('Unexpected source version while patching '+label)
 path.write_text(content,encoding='utf-8')

protocol=src/'include/mgba/internal/gba/sio/netplay/protocol-v2.h'
patch_once(protocol,
 '#define GBA_LINK_CALIBRATION_MAX_SAMPLE_US 1000000\n',
 '#define GBA_LINK_CALIBRATION_MAX_SAMPLE_US 10000000\n',
 'calibration sample bound')
patch_once(protocol,
 '#define GBA_LINK_CALIBRATION_POLICY_VERSION 1\n',
 '#define GBA_LINK_CALIBRATION_POLICY_VERSION 2\n',
 'calibration policy version')
session=src/'src/gba/sio/netplay/session-v2.c'
text=session.read_text(encoding='utf-8')
start=text.find('static bool _absoluteDeadline(')
end=text.find('\\n}',start)
if start<0 or end<0:
 raise SystemExit('Could not locate protocol-v2 absolute deadline helper')
body=text[start:end]
old_duration='const uint64_t duration = UINT64_C(3000000);'
new_duration='const uint64_t duration = UINT64_C(10000000);'
if body.count(old_duration)==1:
 body=body.replace(old_duration,new_duration,1)
elif body.count(new_duration)!=1:
 raise SystemExit('Unexpected absolute deadline constant in protocol-v2 helper')
 text=text[:start]+body+text[end:]
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
