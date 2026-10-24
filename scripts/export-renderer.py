#!/usr/bin/env python3
"""Export the unchanged desktop renderer for another window.agentUsage host."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def export(destination):
    subprocess.run(['git', '-C', str(ROOT), 'diff', '--quiet', 'HEAD', '--', 'desktop/ui'], check=True)
    source = ROOT / 'desktop/ui'
    destination.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in source.rglob('*') if p.is_file())
    hashes = {}
    for path in files:
        relative = path.relative_to(source)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        hashes[str(relative)] = hashlib.sha256(path.read_bytes()).hexdigest()
    shutil.copyfile(ROOT / 'LICENSE', destination / 'LICENSE.txt')
    notices = [ROOT / 'LICENSE', *(ROOT / 'desktop/vendor').iterdir()]
    (destination / 'THIRD-PARTY-NOTICES.txt').write_text('\n\n'.join(
        path.name + '\n' + path.read_text() for path in sorted(notices) if path.is_file()))
    (destination / 'source.json').write_text(json.dumps({
        'repository': 'https://github.com/f-petrozzi/Agent-Usage',
        'commit': subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
        'version': json.loads((ROOT / 'desktop/package.json').read_text())['version'],
        'files': hashes,
    }, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    export(parser.parse_args().destination.resolve())
