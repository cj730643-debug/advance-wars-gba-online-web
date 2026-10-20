#!/usr/bin/env python3
"""Assemble static assets, full corresponding MPL source and checksums."""
from pathlib import Path
import shutil,hashlib,json,zipfile
root=Path(__file__).resolve().parent.parent;dist=root/'dist';dist.mkdir(exist_ok=True)
for f in (root/'src').iterdir():shutil.copy2(f,dist/f.name)
for name in ['LICENSE.txt','THIRD_PARTY_NOTICES.txt','TEST_REPORT.txt']:
 shutil.copy2(root/('LICENSE' if name=='LICENSE.txt' else name),dist/name)
shutil.copytree(root/'licenses',dist/'licenses',dirs_exist_ok=True)
evidence_names={'core-smoke','solo-resume-smoke','delayed-worker-group-smoke','group-performance-before','group-performance-after','worker-smoke','worker-public-wss','public-cors','vercel-public-http','browser-public-peer','browser-ui-evidence','core-group-smoke','worker-group-smoke','worker-group-public-wss','group-failure-smoke','group-failure-public-wss','browser-group-public-peer'}
evidence={p.stem:json.loads(p.read_text(encoding="utf-8")) for p in (root/'logs').glob('*.json') if p.stem in evidence_names}
(dist/'test-evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding="utf-8")
allowed={'gba-link-group-3.gba':'ad263fb206c8a19b75db52f037c1b51e1968d0bc603a501dda53fc460af46c8d','gba-link-group-4.gba':'adda943faa13e0995d719b022b4e857daf9b7853b06e4ac03ec25a65e2dddbfb','gba-link-continuous.gba':'c1fe01752d4f5863d6e3e1a9866b061aaadf2927ccc3df31ba9ecbf4bc68fe9d','gba-link-test.gba':'2f662e4bcf2ac81c438ae5eacc786b2d2984c00807d3656b4990da66a99edc13'}
def include(f,rel):
 if f.name.startswith('.env'):return False
 if any(p in {'.git','node_modules','__pycache__','build','cinema','.openai','.vercel','source-archive','logs','dist'} for p in rel.parts):return False
 if f.suffix.lower() in {'.gba','.gb','.gbc','.nds','.bios'}:
  if f.name not in allowed:return False
  assert hashlib.sha256(f.read_bytes()).hexdigest()==allowed[f.name]
 return True
with zipfile.ZipFile(dist/'source.zip','w',zipfile.ZIP_DEFLATED) as z:
 for f in root.rglob('*'):
  rel=f.relative_to(root)
  if f.is_file() and include(f,rel):z.write(f,str(Path('aw-web-source')/rel))
with zipfile.ZipFile(dist/'source.zip') as z:
 assert z.testzip() is None
 assert 'aw-web-source/vendor/mgba-wifi-link/src/gba/sio/netplay/session-v2.c' in z.namelist()
checks=''.join(f'{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.relative_to(dist).as_posix()}\n' for f in sorted(dist.rglob('*')) if f.is_file() and f.name!='SHA256SUMS.txt')
(dist/'SHA256SUMS.txt').write_text(checks,encoding='utf-8')
print('Static assets and full corresponding source prepared')
