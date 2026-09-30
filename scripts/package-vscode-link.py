#!/usr/bin/env python3
"""Package the small, dependency-free local VS Code terminal focus helper."""
from pathlib import Path
import json
import zipfile
root = Path(__file__).resolve().parents[1]
meta = json.loads((root / 'vscode-link/package.json').read_text())
out = root / 'desktop/resources/agent-usage-link.vsix'
manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="{meta['name']}" Version="{meta['version']}" Publisher="{meta['publisher']}"/><DisplayName>{meta['displayName']}</DisplayName><Description xml:space="preserve">{meta['description']}</Description><Tags>terminal</Tags><Categories>Other</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="{meta['engines']['vscode']}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/></Properties></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'''
types = '''<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'''
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('extension.vsixmanifest', manifest)
    archive.writestr('[Content_Types].xml', types)
    for name in ['package.json', 'extension.js', 'README.md']:
        archive.write(root / 'vscode-link' / name, 'extension/' + name)
    archive.write(root / 'LICENSE', 'extension/LICENSE.md')
print(out)
