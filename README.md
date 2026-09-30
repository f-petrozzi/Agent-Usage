# Agent Usage

A hidden-at-startup Windows edge notch for Codex, Claude, and Antigravity usage, reset times,
and banked resets. Hold **Scroll Lock** to reveal it and follow your cursor
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

Needs Windows 10/11 and signed-in provider CLIs on the collector machine.
The installer is unsigned, so SmartScreen may ask you to confirm it.

## Update

A dot on the Settings button marks a new release. Choose **Update** in
Settings → General, then **Restart**. On the collector machine, run
`git pull --ff-only && scripts/install-agent-usage.sh --force`.

Claude reads are cached, and HTTP 429 responses trigger a shared cooldown.
The app never opens credentials on Windows. [MIT license](LICENSE).

Codex stream reads frame raw pipe bytes so coalesced notifications and replies do
not cause false timeouts. Regression: `python3 tests/test-codex-stream.py`.

## Antigravity

Sign into `agy` with your Google AI Pro account on the collector machine.
The collector automatically adds Antigravity when `agy` is on PATH or installed in `~/.local/bin`, using
`agy -p /usage --output-format json` (requires agy 1.1.11 or later).
It shows the measured weekly and five-hour buckets for Gemini and Claude/GPT
models, including reset times. It does not infer quota from model availability
or label CLI reports with account identity or a plan the CLI does not provide.
Use `--no-antigravity` to skip it. Update the collector alongside the Windows app.

While reading one account, the other gauges become small account glyphs. Hover
a glyph or focus it with the keyboard to switch; leaving restores all gauges.
