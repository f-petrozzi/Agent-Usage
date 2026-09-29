#!/usr/bin/env python3
"""Stage the NSIS installer and its matching update feed without publishing."""
from pathlib import Path
import hashlib
import json
import shutil
import sys
root = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'preview/downloads'
version = json.loads((root / 'desktop/package.json').read_text())['version']
names = [f'AgentUsage-Setup-{version}.exe', f'AgentUsage-Setup-{version}.exe.blockmap', 'latest.yml']
dist = root / 'desktop/dist'
for name in names:
    if not (dist / name).is_file():
        raise SystemExit(f'Missing {name}; run npm run pack:windows in desktop first')
out.mkdir(parents=True, exist_ok=True)
checksums = []
for name in names:
    temporary = out / (name + '.tmp')
    shutil.copyfile(dist / name, temporary)
    temporary.replace(out / name)
    checksums.append(hashlib.sha256((out / name).read_bytes()).hexdigest() + '  ' + name)
(out / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
print(out / names[0])
