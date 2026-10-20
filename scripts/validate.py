from pathlib import Path
from html.parser import HTMLParser
import re,hashlib,zipfile
r=Path(__file__).resolve().parent.parent;d=r/'dist'
class Parser(HTMLParser):
 def __init__(self):super().__init__();self.ids=[];self.refs=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if 'id' in a:self.ids.append(a['id'])
  for k in ['src','href']:
   if k in a:self.refs.append(a[k])
p=Parser();p.feed((d/'index.html').read_text(encoding="utf-8"));assert len(p.ids)==len(set(p.ids)),'Duplicate HTML IDs'
for ref in p.refs:
 if not re.match(r'^[a-z]+:|^#',ref):assert (d/ref).exists(),f'Missing asset: {ref}'
for id in re.findall(r"\$\('([^']+)'\)",(d/'app.mjs').read_text(encoding="utf-8")):assert id in p.ids,f'Missing HTML id: {id}'
assert (d/'aw-core.wasm').read_bytes()[:4]==b'\0asm'
for line in (d/'SHA256SUMS.txt').read_text(encoding="utf-8").splitlines():
 sha,name=line.split('  ',1);assert hashlib.sha256((d/name).read_bytes()).hexdigest()==sha,name
with zipfile.ZipFile(d/'source.zip') as z:
 assert z.testzip() is None
 assert not any(Path(n).name.startswith('.env') or '.vercel' in Path(n).parts for n in z.namelist()),'Runtime credentials must not be archived'
 assert 'aw-web-source/native/core-host.cpp' in z.namelist()
print('PASS: unique IDs, UI bindings, linked assets, real WASM, source archive, SHA-256 manifest')
