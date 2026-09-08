#!/usr/bin/env python3
"""Package a reviewable, source-built Windows installer; no credentials or state."""
from pathlib import Path
import hashlib
import sys
import zipfile
root = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/agent-usage-release')
out.mkdir(parents=True, exist_ok=True)
files = ['Install.cmd', 'README.md', 'LICENSE', 'docs/expanded.png', 'docs/compact.png', 'windows/AgentUsageFrame.cs',
         'windows/install.ps1', 'windows/uninstall.ps1', 'windows/update.ps1',
         'windows/assets/agent-usage.ico', 'scripts/agent-usage', 'scripts/install-agent-usage.sh']
archive = out / 'AgentUsage-Windows.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
    for name in files:
        package.write(root / name, 'AgentUsage/' + name)
(out / 'SHA256SUMS.txt').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
print(archive)
