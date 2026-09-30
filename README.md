# Agent Usage

A hidden-at-startup Windows edge notch for Codex and Claude usage, reset times,
and banked resets. Hold **Shift+F1** to reveal it and follow your cursor
around either monitor's edges. Release, then hover an agent for scrollable details.
Colored rings show usage consumed; right-click to switch between 5-hour and weekly
readings or change the shortcut.

[Notch controls, G815 setup, and validation](docs/notch.md). Opening Agent Usage
again from Start reveals the existing instance.

<p><img src="docs/expanded.png" width="420" alt="Expanded design"><br><img src="docs/compact.png" width="192" alt="Compact design"></p>
<sub>Previous panel previews; the default interface is now the edge notch.</sub>

## Install

Install the collector on the machine running your agents:

```bash
git clone https://github.com/f-petrozzi/Agent-Usage.git
cd Agent-Usage
scripts/install-agent-usage.sh --force
```

Download **AgentUsage-Setup-&lt;version&gt;.exe** from the
[latest release](https://github.com/f-petrozzi/Agent-Usage/releases/latest) and run it.
It installs per-user without administrator access and migrates a ZIP install in
place. Choose local WSL or an SSH host in Settings → General.

Needs Windows 10/11 and signed-in Codex/Claude CLIs on the collector machine.
The installer is unsigned, so SmartScreen may ask you to confirm it.

## Update

A dot on the Settings button marks a new release. Choose **Update** in
Settings → General, then **Restart**. On the collector machine, run
`git pull --ff-only && scripts/install-agent-usage.sh --force`.

Claude reads are cached, and HTTP 429 responses trigger a shared cooldown.
The app never opens credentials on Windows. [MIT license](LICENSE).

Codex stream reads frame raw pipe bytes so coalesced notifications and replies do
not cause false timeouts. Regression: `python3 tests/test-codex-stream.py`.
