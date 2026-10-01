# Agent Usage Link

Bundled VS Code UI extension for the personal Agent Usage app. The desktop app installs its local VSIX through Code's CLI on the first terminal-linked click, and only when Code does not already list this version. No Marketplace publication or dependency download is required.

The `/open` URI accepts validated Claude/Codex session identity, process ancestor ids and a workspace path. In the focused matching workspace it shows an existing terminal with a matching process id. It never sends terminal text or creates a terminal. Missing terminals fall back to a fixed provider conversation URI. For 15 seconds after the helper wakes (a link that launched VS Code, or the first link in a new window) it waits for restored terminals before falling back. Remote workspace shell ids must match the collector; a Windows WSL wrapper pid may not match.

Package: `python3 scripts/package-vscode-link.py`. Tests: `node --test tests/test-session-open.cjs`. Windows focus/installation require a device check.
